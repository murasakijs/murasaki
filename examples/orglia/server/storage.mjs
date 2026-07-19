import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export class RevisionConflictError extends Error {
  constructor(revision) { super('Revision conflict'); this.code = 'REVISION_CONFLICT'; this.revision = revision }
}

export async function openStore(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? (process.env.DATABASE_URL_FILE ? (await readFile(process.env.DATABASE_URL_FILE, 'utf8')).trim() : '')
  if (databaseUrl?.startsWith('postgres') || process.env.PGHOST) return openPostgres(databaseUrl, options)
  return openSqlite(options.sqlitePath ?? process.env.SQLITE_PATH ?? resolve('data/orglia.db'))
}

function sanitizeData(data, tenantId) {
  const tenantFields = ['users', 'customers', 'opportunities', 'orders', 'inventory', 'projects', 'approvals', 'shifts', 'incidents']
  const projected = { ...structuredClone(data), tenants: (data.tenants ?? []).filter((item) => item.id === tenantId) }
  delete projected.audit
  delete projected.revision
  for (const field of tenantFields) projected[field] = (data[field] ?? []).filter((item) => item.tenantId === tenantId)
  projected.revenueTargets = [...(data.revenueTargets ?? [])]
  return projected
}

function auditHash(event) {
  return createHash('sha256').update(JSON.stringify({
    id: event.id, tenantId: event.tenantId, at: event.at, actorId: event.actorId, actor: event.actor,
    action: event.action, entity: event.entity, summary: event.summary, before: event.before ?? null,
    after: event.after ?? null, previousHash: event.previousHash,
  })).digest('hex')
}

function eventRecord(tenantId, actor, input, previousHash = '') {
  const event = {
    id: randomUUID(), tenantId, at: new Date().toISOString(), actorId: actor.userId, actor: actor.name,
    action: input.action, entity: input.entity, summary: input.summary,
    before: input.before ?? null, after: input.after ?? null, previousHash,
  }
  return { ...event, hash: auditHash(event) }
}

async function openSqlite(path) {
  await mkdir(dirname(path), { recursive: true })
  const database = new DatabaseSync(path)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS tenant_state (
      tenant_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS accounts (
      account_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      UNIQUE (tenant_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      tenant_id TEXT NOT NULL,
      at TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      summary TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      previous_hash TEXT NOT NULL,
      event_hash TEXT NOT NULL UNIQUE
    );
    CREATE INDEX IF NOT EXISTS audit_tenant_sequence ON audit_events(tenant_id, sequence DESC);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `)
  const columns = database.prepare('PRAGMA table_info(tenant_state)').all().map((row) => row.name)
  if (!columns.includes('revision')) database.exec('ALTER TABLE tenant_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 0')

  function readRow(tenantId) {
    const row = database.prepare('SELECT state_json, revision FROM tenant_state WHERE tenant_id = ?').get(tenantId)
    return row ? { data: JSON.parse(row.state_json), revision: Number(row.revision) } : null
  }
  function appendAudit(tenantId, actor, input) {
    const previous = database.prepare('SELECT event_hash FROM audit_events WHERE tenant_id = ? ORDER BY sequence DESC LIMIT 1').get(tenantId)
    const event = eventRecord(tenantId, actor, input, previous?.event_hash ?? '')
    const result = database.prepare('INSERT INTO audit_events (id, tenant_id, at, actor_id, actor, action, entity, summary, before_json, after_json, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      event.id, event.tenantId, event.at, event.actorId, event.actor, event.action, event.entity, event.summary,
      JSON.stringify(event.before), JSON.stringify(event.after), event.previousHash, event.hash,
    )
    return { ...event, sequence: Number(result.lastInsertRowid) }
  }

  return {
    kind: 'sqlite',
    async initializeTenant(tenantId, data, accounts, passwordHash) {
      database.exec('BEGIN IMMEDIATE')
      try {
        database.prepare('INSERT OR IGNORE INTO tenant_state (tenant_id, state_json, revision, updated_at) VALUES (?, ?, 0, ?)').run(tenantId, JSON.stringify(sanitizeData(data, tenantId)), new Date().toISOString())
        const statement = database.prepare('INSERT OR IGNORE INTO accounts (account_id, tenant_id, user_id, email, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)')
        for (const account of accounts) statement.run(`${account.tenantId}:${account.userId}`, account.tenantId, account.userId, account.email.toLowerCase(), account.role, passwordHash)
        database.exec('COMMIT')
      } catch (error) { database.exec('ROLLBACK'); throw error }
    },
    async read(tenantId) { return readRow(tenantId) },
    async readAudit(tenantId, limit = 200) {
      return database.prepare('SELECT * FROM audit_events WHERE tenant_id = ? ORDER BY sequence DESC LIMIT ?').all(tenantId, limit).map(mapAuditRow)
    },
    async mutate(tenantId, expectedRevision, actor, reducer) {
      database.exec('BEGIN IMMEDIATE')
      try {
        const current = readRow(tenantId)
        if (!current) throw new Error('Tenant not found')
        if (current.revision !== expectedRevision) throw new RevisionConflictError(current.revision)
        const result = reducer(structuredClone(current.data))
        const nextRevision = current.revision + 1
        database.prepare('UPDATE tenant_state SET state_json = ?, revision = ?, updated_at = ? WHERE tenant_id = ? AND revision = ?').run(JSON.stringify(sanitizeData(result.data, tenantId)), nextRevision, new Date().toISOString(), tenantId, current.revision)
        const events = (result.events ?? []).map((event) => appendAudit(tenantId, actor, event))
        database.exec('COMMIT')
        return { data: sanitizeData(result.data, tenantId), revision: nextRevision, events }
      } catch (error) { database.exec('ROLLBACK'); throw error }
    },
    async findAccountByEmail(email) { return database.prepare('SELECT * FROM accounts WHERE lower(email) = lower(?) AND enabled = 1').get(email) ?? null },
    async createSession(tokenHash, accountId, expiresAt) {
      database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString())
      database.prepare('INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(tokenHash, accountId, expiresAt, new Date().toISOString())
    },
    async getSession(tokenHash) {
      return database.prepare('SELECT a.account_id, a.tenant_id, a.user_id, a.email, a.role, s.expires_at FROM sessions s JOIN accounts a ON a.account_id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ? AND a.enabled = 1').get(tokenHash, new Date().toISOString()) ?? null
    },
    async deleteSession(tokenHash) { database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash) },
    async close() { database.close() },
  }
}

async function postgresConfig(databaseUrl, options) {
  if (databaseUrl) return { connectionString: databaseUrl }
  const passwordFile = options.pgPasswordFile ?? process.env.PGPASSWORD_FILE
  return {
    host: options.pgHost ?? process.env.PGHOST,
    port: Number(options.pgPort ?? process.env.PGPORT ?? 5432),
    user: options.pgUser ?? process.env.PGUSER,
    database: options.pgDatabase ?? process.env.PGDATABASE,
    password: options.pgPassword ?? process.env.PGPASSWORD ?? (passwordFile ? (await readFile(passwordFile, 'utf8')).trim() : undefined),
  }
}

async function openPostgres(databaseUrl, options) {
  const { Pool } = await import('pg')
  const pool = new Pool(await postgresConfig(databaseUrl, options))
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenant_state (tenant_id TEXT PRIMARY KEY, state_json JSONB NOT NULL, revision BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS accounts (account_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, password_hash TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE, UNIQUE (tenant_id, user_id));
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE TABLE IF NOT EXISTS audit_events (sequence BIGSERIAL PRIMARY KEY, id UUID NOT NULL UNIQUE, tenant_id TEXT NOT NULL, at TIMESTAMPTZ NOT NULL, actor_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL, summary TEXT NOT NULL, before_json JSONB, after_json JSONB, previous_hash TEXT NOT NULL, event_hash TEXT NOT NULL UNIQUE);
    CREATE INDEX IF NOT EXISTS audit_tenant_sequence ON audit_events(tenant_id, sequence DESC);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `)
  return {
    kind: 'postgres',
    async initializeTenant(tenantId, data, accounts, passwordHash) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('INSERT INTO tenant_state (tenant_id, state_json, revision) VALUES ($1, $2::jsonb, 0) ON CONFLICT DO NOTHING', [tenantId, JSON.stringify(sanitizeData(data, tenantId))])
        for (const account of accounts) await client.query('INSERT INTO accounts (account_id, tenant_id, user_id, email, role, password_hash) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING', [`${account.tenantId}:${account.userId}`, account.tenantId, account.userId, account.email.toLowerCase(), account.role, passwordHash])
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async read(tenantId) { const result = await pool.query('SELECT state_json, revision FROM tenant_state WHERE tenant_id = $1', [tenantId]); return result.rows[0] ? { data: result.rows[0].state_json, revision: Number(result.rows[0].revision) } : null },
    async readAudit(tenantId, limit = 200) { const result = await pool.query('SELECT * FROM audit_events WHERE tenant_id = $1 ORDER BY sequence DESC LIMIT $2', [tenantId, limit]); return result.rows.map(mapAuditRow) },
    async mutate(tenantId, expectedRevision, actor, reducer) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const currentResult = await client.query('SELECT state_json, revision FROM tenant_state WHERE tenant_id = $1 FOR UPDATE', [tenantId])
        if (!currentResult.rows[0]) throw new Error('Tenant not found')
        const revision = Number(currentResult.rows[0].revision)
        if (revision !== expectedRevision) throw new RevisionConflictError(revision)
        const result = reducer(structuredClone(currentResult.rows[0].state_json))
        const nextRevision = revision + 1
        await client.query('UPDATE tenant_state SET state_json = $1::jsonb, revision = $2, updated_at = NOW() WHERE tenant_id = $3', [JSON.stringify(sanitizeData(result.data, tenantId)), nextRevision, tenantId])
        const events = []
        for (const input of result.events ?? []) {
          const previous = await client.query('SELECT event_hash FROM audit_events WHERE tenant_id = $1 ORDER BY sequence DESC LIMIT 1', [tenantId])
          const event = eventRecord(tenantId, actor, input, previous.rows[0]?.event_hash ?? '')
          const inserted = await client.query('INSERT INTO audit_events (id, tenant_id, at, actor_id, actor, action, entity, summary, before_json, after_json, previous_hash, event_hash) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12) RETURNING sequence', [event.id, event.tenantId, event.at, event.actorId, event.actor, event.action, event.entity, event.summary, JSON.stringify(event.before), JSON.stringify(event.after), event.previousHash, event.hash])
          events.push({ ...event, sequence: Number(inserted.rows[0].sequence) })
        }
        await client.query('COMMIT')
        return { data: sanitizeData(result.data, tenantId), revision: nextRevision, events }
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
    },
    async findAccountByEmail(email) { const result = await pool.query('SELECT * FROM accounts WHERE lower(email) = lower($1) AND enabled = TRUE', [email]); return result.rows[0] ?? null },
    async createSession(tokenHash, accountId, expiresAt) { await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()'); await pool.query('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, accountId, expiresAt]) },
    async getSession(tokenHash) { const result = await pool.query('SELECT a.account_id, a.tenant_id, a.user_id, a.email, a.role, s.expires_at FROM sessions s JOIN accounts a ON a.account_id = s.account_id WHERE s.token_hash = $1 AND s.expires_at > NOW() AND a.enabled = TRUE', [tokenHash]); return result.rows[0] ?? null },
    async deleteSession(tokenHash) { await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]) },
    async close() { await pool.end() },
  }
}

function mapAuditRow(row) {
  return {
    id: row.id, sequence: Number(row.sequence), tenantId: row.tenant_id, at: new Date(row.at).toISOString(),
    actorId: row.actor_id, actor: row.actor, action: row.action, entity: row.entity, summary: row.summary,
    before: parseJson(row.before_json), after: parseJson(row.after_json), previousHash: row.previous_hash, hash: row.event_hash,
  }
}

function parseJson(value) {
  if (value == null) return null
  return typeof value === 'string' ? JSON.parse(value) : value
}

export function projectTenant(data, tenantId) { return sanitizeData(data, tenantId) }
