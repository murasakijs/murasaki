const now = () => new Date().toISOString()

const block = (id, type, text, extra = {}) => ({ id, type, text, updatedAt: now(), ...extra })

export function createEmptyWorkspace(locale = 'en') {
  return {
    version: 1,
    locale,
    selectedPageId: null,
    pages: [],
    database: [],
    databaseView: 'table',
    sampleData: false,
    updatedAt: now(),
    revision: 0,
    trash: [],
  }
}

export function createSampleWorkspace(locale = 'en') {
  return {
    version: 1,
    locale,
    selectedPageId: 'project-atlas',
    sampleData: true,
    databaseView: 'table',
    updatedAt: now(),
    revision: 0,
    trash: [],
    pages: [
      {
        id: 'project-atlas', parentId: 'work', title: 'Project Atlas', icon: '◫',
        tags: ['project', 'planning'], favorite: true, updatedAt: now(), sample: true,
        blocks: [
          block('atlas-intro', 'paragraph', 'Project Atlas is our initiative to build a lightweight, local-first knowledge base for teams and individuals.'),
          block('atlas-goals', 'heading', 'Goals'),
          block('atlas-check-1', 'check', 'Define core workflows and data model', { checked: true }),
          block('atlas-check-2', 'check', 'Build a fast, local-first editor experience', { checked: true }),
          block('atlas-check-3', 'check', 'Design offline-first sync and export', { checked: false }),
          block('atlas-note', 'callout', 'All data stays on your device by default. Sync is optional and self-hosted.'),
          block('atlas-reference', 'heading', 'Reference'),
          block('atlas-paper', 'attachment', 'Papelle app icon', {
            attachment: { id: 'papelle-icon', name: 'papelle-icon.png', mime: 'image/png', size: 1081344, dataUrl: '/src/assets/icon.png' },
          }),
          block('atlas-milestones', 'heading', 'Milestones'),
        ],
      },
      {
        id: 'daily-notes', parentId: 'personal', title: 'Daily Notes', icon: '☼',
        tags: ['journal'], favorite: true, updatedAt: now(), sample: true,
        blocks: [block('daily-title', 'heading', 'Today'), block('daily-body', 'paragraph', 'Capture ideas here, then connect them to a project with [[Project Atlas]].')],
      },
      {
        id: 'offline-first', parentId: 'research', title: 'Offline-First Principles', icon: '⌁',
        tags: ['research', 'design'], favorite: false, updatedAt: now(), sample: true,
        blocks: [block('offline-body', 'paragraph', 'Project Atlas should remain useful without a network connection.'), block('offline-link', 'paragraph', 'Related: [[Project Atlas]]')],
      },
      {
        id: 'work', parentId: null, title: 'Work', icon: '□', tags: [], favorite: false, updatedAt: now(), blocks: [], sample: true,
      },
      {
        id: 'personal', parentId: null, title: 'Personal', icon: '○', tags: [], favorite: false, updatedAt: now(), blocks: [], sample: true,
      },
      {
        id: 'research', parentId: 'work', title: 'Research', icon: '◇', tags: ['research'], favorite: false, updatedAt: now(), blocks: [], sample: true,
      },
    ],
    database: [
      { id: 'db-1', title: 'Research & discovery', owner: 'Aki', due: '2026-07-22', status: 'Done', tags: ['research'], updatedAt: now(), sample: true },
      { id: 'db-2', title: 'Editor prototype', owner: 'Jamie', due: '2026-07-26', status: 'In progress', tags: ['design'], updatedAt: now(), sample: true },
      { id: 'db-3', title: 'Offline sync spike', owner: 'Sora', due: '2026-07-29', status: 'Not started', tags: ['sync'], updatedAt: now(), sample: true },
      { id: 'db-4', title: 'Markdown round-trip', owner: 'Minho', due: '2026-08-02', status: 'In progress', tags: ['interop'], updatedAt: now(), sample: true },
    ],
  }
}

export function markdownFromPage(page) {
  const body = page.blocks.map((item) => {
    if (item.type === 'heading') return `## ${item.text}`
    if (item.type === 'check') return `- [${item.checked ? 'x' : ' '}] ${item.text}`
    if (item.type === 'callout') return `> ${item.text}`
    if (item.type === 'attachment') return item.attachment ? `[${item.attachment.name}](${item.attachment.name})` : item.text
    return item.text
  }).join('\n\n')
  return `# ${page.title}\n\n${body}\n`
}

export function pageFromMarkdown(source, id = `page-${Date.now()}`) {
  const lines = source.replace(/\r/g, '').split('\n')
  const firstHeading = lines.find((line) => /^#\s+/.test(line))
  const title = firstHeading ? firstHeading.replace(/^#\s+/, '').trim() : 'Imported page'
  const blocks = []
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line || line === firstHeading) continue
    if (/^##\s+/.test(line)) blocks.push(block(`${id}-${blocks.length}`, 'heading', line.replace(/^##\s+/, '')))
    else if (/^- \[[ xX]\]\s+/.test(line)) blocks.push(block(`${id}-${blocks.length}`, 'check', line.replace(/^- \[[ xX]\]\s+/, ''), { checked: /^- \[[xX]\]/.test(line) }))
    else if (/^>\s?/.test(line)) blocks.push(block(`${id}-${blocks.length}`, 'callout', line.replace(/^>\s?/, '')))
    else blocks.push(block(`${id}-${blocks.length}`, 'paragraph', line))
  }
  return { id, parentId: null, title, icon: '◇', tags: ['imported'], favorite: false, sample: false, updatedAt: now(), blocks }
}

export function backlinksForPage(workspace, page) {
  const token = `[[${page.title}]]`.toLocaleLowerCase()
  return workspace.pages.filter((candidate) => candidate.id !== page.id && candidate.blocks.some((item) => item.text.toLocaleLowerCase().includes(token)))
}

export function searchWorkspace(workspace, query) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return workspace.pages
  return workspace.pages.filter((page) => `${page.title} ${page.tags.join(' ')} ${page.blocks.map((item) => item.text).join(' ')}`.toLocaleLowerCase().includes(needle))
}

export function normalizeWorkspace(value) {
  const fallback = createEmptyWorkspace(value?.locale === 'ja' ? 'ja' : 'en')
  if (!value || value.version !== 1 || !Array.isArray(value.pages) || !Array.isArray(value.database)) return fallback
  const stamp = typeof value.updatedAt === 'string' ? value.updatedAt : now()
  const normalizePage = (page) => ({ ...page, parentId: typeof page.parentId === 'string' ? page.parentId : null, sample: page.sample === true || (page.sample === undefined && value.sampleData === true), updatedAt: page.updatedAt || stamp, blocks: Array.isArray(page.blocks) ? page.blocks.map((item) => ({ ...item, updatedAt: item.updatedAt || page.updatedAt || stamp })) : [] })
  return {
    ...fallback,
    ...value,
    revision: Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    trash: Array.isArray(value.trash) ? value.trash.map(normalizePage) : [],
    pages: value.pages.map(normalizePage),
    database: value.database.map((item) => ({ ...item, sample: item.sample === true || (item.sample === undefined && value.sampleData === true), updatedAt: item.updatedAt || stamp })),
  }
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const latest = (a, b) => {
  const byTime = String(a?.updatedAt || '').localeCompare(String(b?.updatedAt || ''))
  if (byTime) return byTime > 0 ? a : b
  return JSON.stringify(a).localeCompare(JSON.stringify(b)) >= 0 ? a : b
}
const choose = (base, local, remote) => same(local, base) ? remote : same(remote, base) ? local : latest(local, remote)

function mergeById(baseItems, localItems, remoteItems, mergeItem = choose) {
  const base = new Map(baseItems.map((item) => [item.id, item]))
  const local = new Map(localItems.map((item) => [item.id, item]))
  const remote = new Map(remoteItems.map((item) => [item.id, item]))
  const baseOrder = baseItems.map((item) => item.id)
  const localOrder = localItems.map((item) => item.id)
  const remoteOrder = remoteItems.map((item) => item.id)
  const selectedOrder = same(localOrder, baseOrder) ? remoteOrder : same(remoteOrder, baseOrder) ? localOrder
    : JSON.stringify(localOrder).localeCompare(JSON.stringify(remoteOrder)) >= 0 ? localOrder : remoteOrder
  const allIds = new Set([...localOrder, ...remoteOrder])
  const order = [...selectedOrder.filter((id) => allIds.has(id)), ...[...allIds].filter((id) => !selectedOrder.includes(id)).sort()]
  return order.flatMap((id) => {
    const before = base.get(id)
    const left = local.get(id)
    const right = remote.get(id)
    if (!left && !right) return []
    if (!left) return before && same(right, before) ? [] : [right]
    if (!right) return before && same(left, before) ? [] : [left]
    return [mergeItem(before, left, right)]
  })
}

function mergePage(base, local, remote) {
  if (!base) return latest(local, remote)
  const merged = { ...remote }
  for (const key of ['parentId', 'title', 'icon', 'tags', 'favorite', 'sample']) merged[key] = choose(base[key], local[key], remote[key])
  merged.blocks = mergeById(base.blocks || [], local.blocks || [], remote.blocks || [])
  merged.updatedAt = [base.updatedAt, local.updatedAt, remote.updatedAt].sort().at(-1)
  return merged
}

function repairHierarchy(items, externalIds = []) {
  const ids = new Set(items.map((item) => item.id))
  const allowedIds = new Set([...ids, ...externalIds])
  const pages = new Map(items.map((item) => [item.id, { ...item, parentId: item.parentId && allowedIds.has(item.parentId) && item.parentId !== item.id ? item.parentId : null }]))
  for (const start of [...ids].sort()) {
    const path = []
    const positions = new Map()
    let current = start
    while (current && pages.has(current)) {
      if (positions.has(current)) {
        const cycle = path.slice(positions.get(current))
        const root = [...cycle].sort()[0]
        pages.set(root, { ...pages.get(root), parentId: null })
        break
      }
      positions.set(current, path.length)
      path.push(current)
      current = pages.get(current).parentId
    }
  }
  return items.map((item) => pages.get(item.id))
}

export function mergeWorkspaces(baseValue, localValue, remoteValue) {
  const base = normalizeWorkspace(baseValue)
  const local = normalizeWorkspace(localValue)
  const remote = normalizeWorkspace(remoteValue)
  const pages = repairHierarchy(mergeById(base.pages, local.pages, remote.pages, mergePage))
  const database = mergeById(base.database, local.database, remote.database)
  const trash = repairHierarchy(mergeById(base.trash, local.trash, remote.trash, mergePage), pages.map((page) => page.id))
  const selectedPageId = pages.some((page) => page.id === local.selectedPageId) ? local.selectedPageId : remote.selectedPageId
  return {
    ...remote,
    locale: choose(base.locale, local.locale, remote.locale),
    selectedPageId: pages.some((page) => page.id === selectedPageId) ? selectedPageId : pages[0]?.id ?? null,
    pages,
    database,
    trash,
    databaseView: choose(base.databaseView, local.databaseView, remote.databaseView),
    sampleData: pages.some((page) => page.sample) || database.some((item) => item.sample),
    updatedAt: [base.updatedAt, local.updatedAt, remote.updatedAt].sort().at(-1),
    revision: remote.revision,
  }
}

export function trashPageTree(workspaceValue, pageId) {
  const workspace = normalizeWorkspace(workspaceValue)
  const ids = new Set([pageId])
  let changed = true
  while (changed) {
    changed = false
    for (const page of workspace.pages) if (page.parentId && ids.has(page.parentId) && !ids.has(page.id)) { ids.add(page.id); changed = true }
  }
  const moved = workspace.pages.filter((page) => ids.has(page.id))
  const pages = workspace.pages.filter((page) => !ids.has(page.id))
  return { ...workspace, pages, trash: mergeById([], workspace.trash, moved), selectedPageId: pages[0]?.id ?? null, updatedAt: now() }
}

export function restoreTrashedPages(workspaceValue, pageIds) {
  const workspace = normalizeWorkspace(workspaceValue)
  const selected = pageIds ? new Set(pageIds) : null
  const restoring = selected ? workspace.trash.filter((page) => selected.has(page.id)) : workspace.trash
  const trash = selected ? workspace.trash.filter((page) => !selected.has(page.id)) : []
  return { ...workspace, pages: repairHierarchy(mergeById([], workspace.pages, restoring)), trash, updatedAt: now() }
}
