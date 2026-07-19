import { timingSafeEqual } from 'node:crypto'

export const MAX_MESSAGE_BYTES = 24 * 1024 * 1024
export const MAX_CLIENTS = 32
export const MAX_ROOMS = 128
export const MAX_ROOM_CLIENTS = 24
export const MAX_BUFFERED_BYTES = 2 * 1024 * 1024
export const SAFE_ROOM = /^[a-z0-9][a-z0-9-]{0,63}$/

const text = (value, max) => typeof value === 'string' && value.length <= max
const stamp = (value) => text(value, 64) && Number.isFinite(Date.parse(value))
const id = (value) => text(value, 128) && /^[\w.-]+$/u.test(value)

function validAttachment(value) {
  const builtInPapelleIcon = value?.id === 'papelle-icon'
    && value.name === 'papelle-icon.png'
    && value.mime === 'image/png'
    && value.dataUrl === 'murasaki-asset:papelle-icon'
  return value && typeof value === 'object' && id(value.id) && text(value.name, 255) && text(value.mime, 128)
    && Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= 5 * 1024 * 1024
    && text(value.dataUrl, 7 * 1024 * 1024)
    && (/^(data:(image\/|audio\/|application\/pdf)|\/)/.test(value.dataUrl) || builtInPapelleIcon)
}

function validBlock(value) {
  return value && typeof value === 'object' && id(value.id)
    && ['heading', 'paragraph', 'check', 'callout', 'attachment'].includes(value.type)
    && text(value.text, 200_000) && (value.checked === undefined || typeof value.checked === 'boolean')
    && (value.updatedAt === undefined || stamp(value.updatedAt))
    && (value.attachment === undefined || validAttachment(value.attachment))
}

function validPage(value) {
  return value && typeof value === 'object' && id(value.id) && (value.parentId === null || id(value.parentId))
    && text(value.title, 500) && text(value.icon, 16) && Array.isArray(value.tags) && value.tags.length <= 64
    && value.tags.every((tag) => text(tag, 64)) && typeof value.favorite === 'boolean' && stamp(value.updatedAt)
    && Array.isArray(value.blocks) && value.blocks.length <= 2_000 && value.blocks.every(validBlock)
    && (value.sample === undefined || typeof value.sample === 'boolean')
}

function validPageCollection(value, hierarchy = value) {
  if (!value.every(validPage)) return false
  const ownIds = new Set(value.map((page) => page.id))
  const byId = new Map(hierarchy.map((page) => [page.id, page]))
  const ids = new Set(byId.keys())
  if (ownIds.size !== value.length || value.some((page) => page.parentId !== null && !ids.has(page.parentId))) return false
  for (const page of value) {
    const seen = new Set()
    let current = page
    while (current?.parentId !== null) {
      if (seen.has(current.parentId)) return false
      seen.add(current.parentId)
      current = byId.get(current.parentId)
    }
    if (new Set(page.blocks.map((block) => block.id)).size !== page.blocks.length) return false
  }
  return true
}

function validDatabaseItem(value) {
  return value && typeof value === 'object' && id(value.id) && text(value.title, 500) && text(value.owner, 200)
    && text(value.due, 32) && ['Not started', 'In progress', 'Done'].includes(value.status)
    && Array.isArray(value.tags) && value.tags.length <= 64 && value.tags.every((tag) => text(tag, 64))
    && (value.updatedAt === undefined || stamp(value.updatedAt)) && (value.sample === undefined || typeof value.sample === 'boolean')
}

export function validWorkspace(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || !['en', 'ja'].includes(value.locale)) return false
  if (!Number.isSafeInteger(value.revision) || value.revision < 0 || !stamp(value.updatedAt)) return false
  if (value.selectedPageId !== null && !id(value.selectedPageId)) return false
  if (!['table', 'board', 'calendar'].includes(value.databaseView) || typeof value.sampleData !== 'boolean') return false
  if (!Array.isArray(value.pages) || value.pages.length > 2_000 || !validPageCollection(value.pages)) return false
  if (!Array.isArray(value.trash) || value.trash.length > 2_000 || !validPageCollection(value.trash, [...value.pages, ...value.trash])) return false
  if (new Set([...value.pages, ...value.trash].map((page) => page.id)).size !== value.pages.length + value.trash.length) return false
  if (!Array.isArray(value.database) || value.database.length > 10_000 || !value.database.every(validDatabaseItem)) return false
  if (new Set(value.database.map((item) => item.id)).size !== value.database.length) return false
  if (value.selectedPageId !== null && !value.pages.some((page) => page.id === value.selectedPageId)) return false
  return [...value.pages, ...value.trash].reduce((total, page) => total + page.blocks.length, 0) <= 20_000
}

export function tokenMatches(actual, expected) {
  if (!text(actual, 512) || !text(expected, 512) || !expected) return false
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}
