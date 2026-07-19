import { createServer } from 'node:http'
import { Pool } from 'pg'
import { WebSocket, WebSocketServer } from 'ws'
import { MAX_BUFFERED_BYTES, MAX_CLIENTS, MAX_MESSAGE_BYTES, MAX_ROOM_CLIENTS, MAX_ROOMS, SAFE_ROOM, tokenMatches, validWorkspace } from './protocol.mjs'

const port = Number(process.env.PORT ?? 4100)
const host = process.env.HOST ?? '127.0.0.1'
if (!['127.0.0.1', '0.0.0.0', '::1', '::'].includes(host)) throw new Error('HOST must be a local bind address')
const roomToken = process.env.PAPELLE_ROOM_TOKEN
if (!roomToken || roomToken.length < 16) throw new Error('PAPELLE_ROOM_TOKEN must be at least 16 characters')
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5_000 })
const rooms = new Map()
const clients = new WeakMap()
const rates = new WeakMap()
const queues = new Map()
const RATE_WINDOW_MS = 10_000
const MAX_MESSAGES_PER_WINDOW = 10
const MAX_BYTES_PER_WINDOW = 25 * 1024 * 1024
const MAX_GLOBAL_BYTES_PER_WINDOW = 64 * 1024 * 1024
const globalRate = { startedAt: Date.now(), bytes: 0 }

await pool.query(`
  CREATE TABLE IF NOT EXISTS workspaces (
    room text PRIMARY KEY,
    payload jsonb NOT NULL,
    revision bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;
`)

const http = createServer(async (request, response) => {
  if (request.url === '/health') {
    try {
      await pool.query('SELECT 1')
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ ok: true, service: 'papelle-sync' }))
    } catch {
      response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false }))
    }
    return
  }
  response.writeHead(404).end()
})
const sockets = new WebSocketServer({ server: http, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false })

function peers(room, create = true) {
  let values = rooms.get(room)
  if (!values && create) {
    if (rooms.size >= MAX_ROOMS) throw new Error('room limit reached')
    rooms.set(room, values = new Set())
  }
  return values
}

function safeSend(socket, value) {
  if (socket.readyState !== WebSocket.OPEN) return
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return socket.close(1013, 'client is too slow')
  const payload = JSON.stringify(value)
  if (Buffer.byteLength(payload) > MAX_MESSAGE_BYTES) return socket.close(1009, 'message too large')
  socket.send(payload)
}

async function current(room) {
  const result = await pool.query('SELECT payload, revision FROM workspaces WHERE room = $1', [room])
  const row = result.rows[0]
  return row ? { workspace: row.payload, revision: Number(row.revision) } : null
}

async function join(socket, message) {
  if (!SAFE_ROOM.test(message.room) || !tokenMatches(message.token, roomToken)) throw new Error('not authorized')
  const roomPeers = peers(message.room)
  if (roomPeers.size >= MAX_ROOM_CLIENTS) throw new Error('room client limit reached')
  const previous = clients.get(socket)
  if (previous) leave(socket, previous.room)
  clients.set(socket, { room: message.room, clientId: String(message.clientId || '').slice(0, 128) })
  roomPeers.add(socket)
  const saved = await current(message.room)
  safeSend(socket, saved ? { type: 'snapshot', ...saved } : { type: 'ready', revision: 0 })
}

function enqueue(room, operation) {
  const previous = queues.get(room) ?? Promise.resolve()
  const next = previous.then(operation, operation).finally(() => { if (queues.get(room) === next) queues.delete(room) })
  queues.set(room, next)
  return next
}

async function publish(socket, message) {
  const client = clients.get(socket)
  if (!client || client.room !== message.room || !validWorkspace(message.workspace) || !Number.isSafeInteger(message.baseRevision) || message.baseRevision < 0) throw new Error('invalid workspace update')
  await enqueue(message.room, async () => {
    const saved = await current(message.room)
    const revision = saved?.revision ?? 0
    if (revision !== message.baseRevision) {
      safeSend(socket, saved ? { type: 'conflict', ...saved } : { type: 'ready', revision: 0 })
      return
    }
    const nextRevision = revision + 1
    const workspace = { ...message.workspace, revision: nextRevision }
    const result = saved
      ? await pool.query('UPDATE workspaces SET payload = $2::jsonb, revision = $3, updated_at = now() WHERE room = $1 AND revision = $4 RETURNING revision', [message.room, JSON.stringify(workspace), nextRevision, revision])
      : await pool.query('INSERT INTO workspaces (room, payload, revision, updated_at) VALUES ($1, $2::jsonb, $3, now()) ON CONFLICT DO NOTHING RETURNING revision', [message.room, JSON.stringify(workspace), nextRevision])
    // The in-process queue serializes one server instance. The guarded write
    // also preserves correctness when two instances share PostgreSQL.
    if (result.rowCount !== 1) {
      const latest = await current(message.room)
      safeSend(socket, latest ? { type: 'conflict', ...latest } : { type: 'ready', revision: 0 })
      return
    }
    for (const peer of peers(message.room, false) ?? []) safeSend(peer, { type: 'snapshot', revision: nextRevision, workspace })
  })
}

function leave(socket, room) {
  const roomPeers = peers(room, false)
  if (!roomPeers) return
  roomPeers.delete(socket)
  if (roomPeers.size === 0) rooms.delete(room)
}

sockets.on('connection', (socket) => {
  if (sockets.clients.size > MAX_CLIENTS) return socket.close(1013, 'server client limit reached')
  rates.set(socket, { startedAt: Date.now(), count: 0, bytes: 0 })
  socket.on('message', async (raw) => {
    try {
      const rate = rates.get(socket)
      const bytes = raw.length
      if (Date.now() - rate.startedAt > RATE_WINDOW_MS) { rate.startedAt = Date.now(); rate.count = 0; rate.bytes = 0 }
      if (Date.now() - globalRate.startedAt > RATE_WINDOW_MS) { globalRate.startedAt = Date.now(); globalRate.bytes = 0 }
      rate.count += 1; rate.bytes += bytes
      globalRate.bytes += bytes
      if (rate.count > MAX_MESSAGES_PER_WINDOW || rate.bytes > MAX_BYTES_PER_WINDOW) return socket.close(1008, 'rate limit exceeded')
      if (globalRate.bytes > MAX_GLOBAL_BYTES_PER_WINDOW) return socket.close(1013, 'server work budget exceeded')
      if (raw.length > MAX_MESSAGE_BYTES) throw new Error('message too large')
      const message = JSON.parse(raw.toString())
      if (message.type === 'join') await join(socket, message)
      else if (message.type === 'workspace') await publish(socket, message)
      else throw new Error('unsupported message')
    } catch (error) {
      safeSend(socket, { type: 'error', message: error instanceof Error ? error.message : 'invalid request' })
      socket.close(1008, 'invalid message')
    }
  })
  socket.on('close', () => {
    const client = clients.get(socket)
    if (client) leave(socket, client.room)
  })
})

http.listen(port, host, () => console.log(`Papelle sync listening on ${host}:${port}`))

async function shutdown() {
  for (const socket of sockets.clients) socket.close(1001, 'server shutting down')
  await new Promise((resolve) => sockets.close(resolve))
  await new Promise((resolve) => http.close(resolve))
  await pool.end()
}
process.on('SIGTERM', () => void shutdown())
process.on('SIGINT', () => void shutdown())
