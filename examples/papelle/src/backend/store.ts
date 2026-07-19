import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type { Workspace } from '../domain/types'
import { createEmptyWorkspace, createSampleWorkspace, normalizeWorkspace } from '../domain/workspace.js'
import { runtimeState, selectWorkspaceSlot } from './runtime'

let openPath = ''
let database: DatabaseSync | undefined

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max
const stamp = (value: unknown) => text(value, 64) && Number.isFinite(Date.parse(value))
const id = (value: unknown) => text(value, 128) && /^[\w.-]+$/u.test(value)

function validAttachment(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const attachment = value as Record<string, unknown>
  return id(attachment.id) && text(attachment.name, 255) && text(attachment.mime, 128)
    && Number.isSafeInteger(attachment.size) && Number(attachment.size) >= 0 && Number(attachment.size) <= 5 * 1024 * 1024
    && text(attachment.dataUrl, 7 * 1024 * 1024) && /^(data:(image\/|audio\/|application\/pdf)|\/)/.test(attachment.dataUrl)
}

function validBlock(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return id(item.id) && ['heading', 'paragraph', 'check', 'callout', 'attachment'].includes(String(item.type))
    && text(item.text, 200_000) && (item.checked === undefined || typeof item.checked === 'boolean')
    && stamp(item.updatedAt) && (item.attachment === undefined || validAttachment(item.attachment))
}

function validPage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const page = value as Record<string, unknown>
  return id(page.id) && (page.parentId === null || id(page.parentId)) && text(page.title, 500) && text(page.icon, 16)
    && Array.isArray(page.tags) && page.tags.length <= 64 && page.tags.every((tag) => text(tag, 64))
    && typeof page.favorite === 'boolean' && stamp(page.updatedAt) && (page.sample === undefined || typeof page.sample === 'boolean')
    && Array.isArray(page.blocks) && page.blocks.length <= 2_000 && page.blocks.every(validBlock)
}

function validPageCollection(value: unknown[], hierarchy: unknown[] = value): boolean {
  if (!value.every(validPage)) return false
  const pages = value as Array<Record<string, unknown>>
  const hierarchyPages = hierarchy as Array<Record<string, unknown>>
  const ownIds = new Set(pages.map((page) => String(page.id)))
  const ids = new Set(hierarchyPages.map((page) => String(page.id)))
  if (ownIds.size !== pages.length || pages.some((page) => page.parentId !== null && !ids.has(String(page.parentId)))) return false
  for (const page of pages) {
    const seen = new Set<string>()
    let current: Record<string, unknown> | undefined = page
    while (current && current.parentId !== null) {
      const parentId: string = String(current.parentId)
      if (seen.has(parentId)) return false
      seen.add(parentId)
      current = hierarchyPages.find((candidate): boolean => candidate.id === parentId)
    }
    const blocks = page.blocks as Array<Record<string, unknown>>
    if (new Set(blocks.map((block) => String(block.id))).size !== blocks.length) return false
  }
  return true
}

function validDatabaseItem(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return id(item.id) && text(item.title, 500) && text(item.owner, 200) && text(item.due, 32)
    && ['Not started', 'In progress', 'Done'].includes(String(item.status))
    && Array.isArray(item.tags) && item.tags.length <= 64 && item.tags.every((tag) => text(tag, 64))
    && stamp(item.updatedAt) && (item.sample === undefined || typeof item.sample === 'boolean')
}

export function validWorkspaceShape(value: unknown): value is Workspace {
  if (!value || typeof value !== 'object') return false
  const workspace = value as Record<string, unknown>
  if (workspace.version !== 1 || !['en', 'ja'].includes(String(workspace.locale)) || !stamp(workspace.updatedAt)) return false
  if (!Number.isSafeInteger(workspace.revision) || Number(workspace.revision) < 0 || typeof workspace.sampleData !== 'boolean') return false
  if (workspace.selectedPageId !== null && !id(workspace.selectedPageId)) return false
  if (!['table', 'board', 'calendar'].includes(String(workspace.databaseView))) return false
  if (!Array.isArray(workspace.pages) || workspace.pages.length > 10_000 || !validPageCollection(workspace.pages)) return false
  if (!Array.isArray(workspace.trash) || workspace.trash.length > 10_000 || !validPageCollection(workspace.trash, [...workspace.pages, ...workspace.trash])) return false
  if (new Set([...workspace.pages, ...workspace.trash].map((page) => String((page as Record<string, unknown>).id))).size !== workspace.pages.length + workspace.trash.length) return false
  if (!Array.isArray(workspace.database) || workspace.database.length > 50_000 || !workspace.database.every(validDatabaseItem)) return false
  if (new Set(workspace.database.map((item) => String((item as Record<string, unknown>).id))).size !== workspace.database.length) return false
  if (workspace.selectedPageId !== null && !workspace.pages.some((page) => (page as Record<string, unknown>).id === workspace.selectedPageId)) return false
  return [...workspace.pages, ...workspace.trash].reduce((total, page) => total + page.blocks.length, 0) <= 20_000
}

function db(): { database: DatabaseSync; path: string } {
  const { dataRoot } = runtimeState()
  const path = join(dataRoot, 'papelle.db')
  if (!database || openPath !== path) {
    database?.close()
    database = new DatabaseSync(path)
    openPath = path
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS workspace_state (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workspace_quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        reason TEXT NOT NULL,
        detected_at TEXT NOT NULL
      );
    `)
  }
  return { database, path }
}

function parseWorkspace(payload: unknown): Workspace | null {
  if (typeof payload !== 'string') return null
  if (Buffer.byteLength(payload, 'utf8') > 24 * 1024 * 1024) return null
  try {
    const value = normalizeWorkspace(JSON.parse(payload))
    return validWorkspaceShape(value) ? value : null
  } catch {
    return null
  }
}

export function readWorkspace(forceEmpty = false): { workspace: Workspace; path: string; recoveryAvailable: boolean; recoveryReason: string | null } {
  if (forceEmpty) selectWorkspaceSlot(true)
  const { database, path } = db()
  const workspaceId = runtimeState().workspaceId
  const saved = database.prepare('SELECT payload FROM workspace_state WHERE id = ?').get(workspaceId) as { payload?: unknown } | undefined
  const parsed = parseWorkspace(saved?.payload)
  if (parsed) {
    const recovery = readLatestQuarantine()
    return { workspace: parsed, path, recoveryAvailable: recovery !== null, recoveryReason: recovery?.reason ?? null }
  }
  if (typeof saved?.payload === 'string') {
    const reason = 'The saved workspace was not valid Papelle v1 data.'
    database.exec('BEGIN IMMEDIATE')
    try {
      database.prepare('INSERT INTO workspace_quarantine (workspace_id, payload, reason, detected_at) VALUES (?, ?, ?, ?)').run(workspaceId, saved.payload, reason, new Date().toISOString())
      database.prepare('DELETE FROM workspace_state WHERE id = ?').run(workspaceId)
      database.exec('COMMIT')
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
    return { workspace: createEmptyWorkspace(), path, recoveryAvailable: true, recoveryReason: reason }
  }
  const workspace = workspaceId === 'empty-session' ? createEmptyWorkspace() : createSampleWorkspace()
  writeWorkspace(workspace)
  return { workspace, path, recoveryAvailable: false, recoveryReason: null }
}

export function writeWorkspace(workspace: Workspace): void {
  const { database } = db()
  const normalized = normalizeWorkspace(workspace)
  if (!validWorkspaceShape(normalized)) throw new TypeError('workspace contains invalid Papelle data')
  const payload = JSON.stringify(normalized)
  if (Buffer.byteLength(payload, 'utf8') > 24 * 1024 * 1024) throw new Error('workspace is larger than the 24 MiB Papelle safety limit')
  database.prepare(`
    INSERT INTO workspace_state (id, payload, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(runtimeState().workspaceId, payload, new Date().toISOString())
}

export function resetStoredWorkspace(withSampleData: boolean): Workspace {
  const workspace = withSampleData ? createSampleWorkspace() : createEmptyWorkspace()
  writeWorkspace(workspace)
  return workspace
}

export function closeStore(): void {
  database?.close()
  database = undefined
  openPath = ''
}

export function readLatestQuarantine(): { payload: string; reason: string; detectedAt: string } | null {
  const { database } = db()
  const row = database.prepare('SELECT payload, reason, detected_at AS detectedAt FROM workspace_quarantine WHERE workspace_id = ? ORDER BY id DESC LIMIT 1').get(runtimeState().workspaceId) as { payload: string; reason: string; detectedAt: string } | undefined
  return row ?? null
}
