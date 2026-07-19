import type { Workspace } from '../domain/types'
import { createEmptyWorkspace, mergeWorkspaces, normalizeWorkspace } from '../domain/workspace.js'

export type SyncState = 'offline' | 'connecting' | 'connected' | 'error'

export interface SyncSession {
  publish(workspace: Workspace): void
  close(): void
}

const same = (left: Workspace, right: Workspace) => JSON.stringify(left) === JSON.stringify(right)

export function connectSync(
  url: string,
  room: string,
  token: string,
  onWorkspace: (workspace: Workspace) => void,
  onState: (state: SyncState) => void,
): SyncSession {
  let socket: WebSocket | undefined
  let closed = false
  let retry: number | undefined
  let latest: Workspace | undefined
  let base: Workspace | undefined
  let revision = 0
  let ready = false
  let inFlight = false
  const clientId = crypto.randomUUID()

  const sendLatest = () => {
    if (!ready || inFlight || !latest || socket?.readyState !== WebSocket.OPEN) return
    if (base && same(latest, base)) return
    inFlight = true
    socket.send(JSON.stringify({ type: 'workspace', room, baseRevision: revision, workspace: { ...latest, revision } }))
  }

  const acceptSnapshot = (remoteValue: Workspace, nextRevision: number) => {
    if (!Number.isSafeInteger(nextRevision) || nextRevision < revision || (nextRevision === revision && ready)) return
    const remote = normalizeWorkspace({ ...remoteValue, revision: nextRevision })
    const local = latest ?? remote
    const ancestor = base ?? createEmptyWorkspace(local.locale)
    const merged = mergeWorkspaces(ancestor, local, remote)
    merged.revision = nextRevision
    base = remote
    revision = nextRevision
    latest = merged
    ready = true
    inFlight = false
    onState('connected')
    onWorkspace(merged)
    window.setTimeout(sendLatest, 0)
  }

  const open = () => {
    if (closed) return
    ready = false
    inFlight = false
    onState('connecting')
    socket = new WebSocket(url)
    socket.addEventListener('open', () => {
      socket?.send(JSON.stringify({ type: 'join', room, token, clientId, lastRevision: revision }))
    })
    socket.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type?: string; revision?: number; workspace?: Workspace }
        if ((message.type === 'snapshot' || message.type === 'conflict') && message.workspace && typeof message.revision === 'number') {
          acceptSnapshot(message.workspace, message.revision)
        } else if (message.type === 'ready' && message.revision === 0) {
          revision = 0
          base = createEmptyWorkspace(latest?.locale)
          ready = true
          inFlight = false
          onState('connected')
          sendLatest()
        } else if (message.type === 'error') {
          onState('error')
          socket?.close(1008, 'sync rejected')
        }
      } catch {
        onState('error')
        socket?.close(1002, 'invalid sync message')
      }
    })
    socket.addEventListener('close', () => {
      ready = false
      inFlight = false
      if (closed) return
      onState('connecting')
      retry = window.setTimeout(open, 2_000)
    })
    socket.addEventListener('error', () => socket?.close())
  }
  open()
  return {
    publish(workspace) {
      latest = normalizeWorkspace(workspace)
      sendLatest()
    },
    close() {
      closed = true
      if (retry) window.clearTimeout(retry)
      socket?.close()
      onState('offline')
    },
  }
}
