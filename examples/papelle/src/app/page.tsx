import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Metadata } from 'murasaki'
import { useAppMenu, useContextMenu } from 'murasaki'
import { CheckCircle2, ChevronDown, Cloud, Download, FilePlus2, Languages, Menu, Upload, WifiOff, XCircle } from 'lucide-react'
import papelleIcon from '../assets/icon.png'
import { BlockEditor } from '../components/BlockEditor'
import { DatabaseViews } from '../components/DatabaseViews'
import { Inspector } from '../components/Inspector'
import { Sidebar } from '../components/Sidebar'
import type { Locale, Page, Workspace } from '../domain/types'
import { backlinksForPage, createEmptyWorkspace, createSampleWorkspace, markdownFromPage, pageFromMarkdown, restoreTrashedPages, searchWorkspace, trashPageTree } from '../domain/workspace.js'
import { t } from '../i18n'
import { connectSync, type SyncSession, type SyncState } from '../lib/sync'
import { loadQuarantinedWorkspace, loadWorkspace, saveWorkspace } from '../backend/workspace'

export const metadata: Metadata = { title: 'Papelle', description: 'A local-first knowledge workspace.' }

type Surface = 'document' | 'database' | 'settings'

function downloadText(name: string, contents: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/markdown;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function SettingsPanel({ workspace, databasePath, recoveryAvailable, onClose, onReset, onRestoreTrash, onDownloadRecovery }: { workspace: Workspace; databasePath: string | null; recoveryAvailable: boolean; onClose(): void; onReset(sample: boolean): void; onRestoreTrash(): void; onDownloadRecovery(): void }) {
  const labels = t(workspace.locale)
  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <header><div><span className="section-kicker">Papelle</span><h1 id="settings-title">{labels.settings}</h1></div><button onClick={onClose}>{labels.close}</button></header>
      <div className="settings-grid">
        <article><h2>{labels.storage}</h2><p>{databasePath ?? 'SQLite'}</p><dl><div><dt>{labels.pagesCount}</dt><dd>{workspace.pages.length}</dd></div><div><dt>{labels.sampleState}</dt><dd>{workspace.sampleData ? labels.on : labels.off}</dd></div><div><dt>{labels.format}</dt><dd>SQLite + JSON v1</dd></div></dl></article>
        <article><h2>{labels.sampleData}</h2><p>{labels.resetBody}</p><div className="settings-actions"><button className="primary" onClick={() => onReset(true)}>{labels.resetSample}</button><button className="danger" onClick={() => onReset(false)}>{labels.clearAll}</button></div></article>
        <article><h2>{labels.trash}</h2><p>{workspace.trash.length ? `${workspace.trash.length}` : labels.trashEmpty}</p><button disabled={!workspace.trash.length} onClick={onRestoreTrash}>{labels.restoreTrash}</button></article>
        <article><h2>{labels.collaboration}</h2><p>{labels.collaborationHelp}</p></article>
        <article><h2>{labels.launchFlags}</h2><p><code>pnpm --filter papelle dev -- --no-sample-data</code></p><p className="muted">{labels.launchHelp}</p></article>
        {recoveryAvailable ? <article className="recovery-card"><h2>{labels.recovery}</h2><p>{labels.recoveryBody}</p><button onClick={onDownloadRecovery}>{labels.recoveryDownload}</button></article> : null}
      </div>
    </section>
  )
}

export default function PapellePage() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [surface, setSurface] = useState<Surface>('document')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [databasePath, setDatabasePath] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [syncState, setSyncState] = useState<SyncState>('offline')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [recoveryAvailable, setRecoveryAvailable] = useState(false)
  const [pageMoved, setPageMoved] = useState<string[] | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const initialized = useRef(false)
  const sync = useRef<SyncSession | undefined>(undefined)
  const workspaceRef = useRef<Workspace | null>(null)

  workspaceRef.current = workspace
  const locale: Locale = workspace?.locale ?? 'en'
  const labels = t(locale)
  const selectedPage = workspace?.pages.find((page) => page.id === workspace.selectedPageId) ?? null

  const mutate = useCallback((recipe: (current: Workspace) => Workspace) => {
    setWorkspace((current) => current ? { ...recipe(current), updatedAt: new Date().toISOString() } : current)
  }, [])

  const createPage = useCallback((parentId?: string) => {
    const createdAt = new Date().toISOString()
    const page: Page = {
      id: crypto.randomUUID(), parentId: parentId ?? null, title: labels.untitledPage, icon: '◇', tags: [], favorite: false, sample: false,
      updatedAt: createdAt, blocks: [{ id: crypto.randomUUID(), type: 'paragraph', text: '', updatedAt: createdAt }],
    }
    mutate((current) => ({ ...current, pages: [...current.pages, page], selectedPageId: page.id }))
    setSurface('document')
  }, [labels.untitledPage, mutate])

  const deleteSelectedPage = useCallback(() => {
    const current = workspaceRef.current
    if (!current?.selectedPageId || !window.confirm(t(locale).deletePageConfirm)) return
    const previousTrash = new Set(current.trash.map((page) => page.id))
    const next = trashPageTree(current, current.selectedPageId)
    setPageMoved(next.trash.filter((page) => !previousTrash.has(page.id)).map((page) => page.id))
    mutate(() => next)
  }, [locale, mutate])

  const duplicateSelectedPage = useCallback(() => {
    mutate((current) => {
      const source = current.pages.find((page) => page.id === current.selectedPageId)
      if (!source) return current
      const copy = { ...structuredClone(source), id: crypto.randomUUID(), title: `${source.title}${locale === 'ja' ? '' : ' '}${labels.copySuffix}`, favorite: false, sample: false, updatedAt: new Date().toISOString(), blocks: source.blocks.map((block) => ({ ...structuredClone(block), id: crypto.randomUUID(), updatedAt: new Date().toISOString() })) }
      return { ...current, pages: [...current.pages, copy], selectedPageId: copy.id }
    })
  }, [labels.copySuffix, locale, mutate])

  const exportSelected = useCallback(() => {
    const page = workspaceRef.current?.pages.find((candidate) => candidate.id === workspaceRef.current?.selectedPageId)
    if (!page) return
    downloadText(`${page.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-') || 'page'}.md`, markdownFromPage(page))
  }, [])

  const importMarkdown = useCallback(async (file?: File) => {
    if (!file) return
    if (file.size > 2 * 1024 * 1024) return window.alert(labels.importTooLarge)
    const page = pageFromMarkdown(await file.text(), crypto.randomUUID())
    mutate((current) => ({ ...current, pages: [...current.pages, { ...page, sample: false }], selectedPageId: page.id }))
    setSurface('document')
    if (importRef.current) importRef.current.value = ''
  }, [labels.importTooLarge, mutate])

  useContextMenu('papelle-page-row', [
    { label: labels.duplicate, action: duplicateSelectedPage },
    { separator: true },
    { label: labels.delete, action: deleteSelectedPage, disabled: !selectedPage },
  ])

  useAppMenu([
    { label: labels.fileMenu, items: [
      { label: labels.newPage, action: createPage },
      { label: labels.import, action: () => importRef.current?.click() },
      { label: labels.export, action: exportSelected },
    ] },
    { role: 'editMenu' },
    { label: labels.viewMenu, items: [
      { label: labels.editor, action: () => setSurface('document') },
      { label: labels.database, action: () => setSurface('database') },
      { label: labels.settings, action: () => setSurface('settings') },
    ] },
    { role: 'windowMenu' },
  ])

  useEffect(() => {
    let cancelled = false
    void loadWorkspace().then((result) => {
      if (cancelled) return
      setWorkspace(result.workspace)
      setDatabasePath(result.databasePath)
      setRecoveryAvailable(result.recoveryAvailable)
      if (result.recoveryReason) setLoadError(result.recoveryReason)
      initialized.current = true
    }).catch((error: unknown) => {
      if (cancelled) return
      setLoadError(error instanceof Error ? error.message : String(error))
      setWorkspace(createSampleWorkspace())
      initialized.current = true
    })
    return () => { cancelled = true }
  }, [])

  const workspaceLoaded = workspace !== null

  useEffect(() => {
    if (!workspace || !initialized.current || sync.current) return
    const url = import.meta.env.MURASAKI_PUBLIC_SYNC_URL
    const room = import.meta.env.MURASAKI_PUBLIC_SYNC_ROOM
    const token = import.meta.env.MURASAKI_PUBLIC_SYNC_TOKEN
    if (!url || !room || !token) return
    const session = connectSync(url, room, token, setWorkspace, setSyncState)
    sync.current = session
    // Seed the client before the server handshake arrives so the first remote
    // snapshot is merged with local SQLite state instead of replacing it.
    session.publish(workspace)
    return () => {
      session.close()
      if (sync.current === session) sync.current = undefined
    }
  }, [workspaceLoaded])

  useEffect(() => {
    if (!workspace || !initialized.current) return
    setSaving(true)
    setSaveFailed(false)
    const timer = window.setTimeout(() => {
      void saveWorkspace(workspace).then(() => {
        setSaving(false)
        setLoadError(null)
        sync.current?.publish(workspace)
      }).catch((error: unknown) => {
        setSaving(false)
        setSaveFailed(true)
        setLoadError(error instanceof Error ? error.message : String(error))
      })
    }, 450)
    return () => window.clearTimeout(timer)
  }, [workspace])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault(); searchRef.current?.focus()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'n') {
        event.preventDefault(); createPage()
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault(); if (workspaceRef.current) { setSaving(true); void saveWorkspace(workspaceRef.current).then(() => { setSaving(false); setSaveFailed(false) }).catch((error: unknown) => { setSaving(false); setSaveFailed(true); setLoadError(error instanceof Error ? error.message : String(error)) }) }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createPage])

  useEffect(() => { document.documentElement.lang = locale }, [locale])

  const confirmReset = async (sample: boolean) => {
    const confirmed = window.confirm(labels.resetConfirm)
    if (!confirmed) return
    const next = sample ? createSampleWorkspace(locale) : createEmptyWorkspace(locale)
    next.trash = [...workspace!.trash, ...workspace!.pages]
    await saveWorkspace(next)
    setWorkspace(next)
    setPageMoved(null)
    setSurface(next.selectedPageId ? 'document' : 'settings')
  }

  const downloadRecovery = async () => {
    const recovery = await loadQuarantinedWorkspace()
    if (recovery) downloadText(`papelle-recovery-${recovery.detectedAt.slice(0, 10)}.json`, recovery.payload)
  }

  const filteredPages = useMemo(() => workspace ? searchWorkspace(workspace, query) : [], [query, workspace])
  const backlinks = useMemo(() => workspace && selectedPage ? backlinksForPage(workspace, selectedPage) : [], [selectedPage, workspace])
  const workspaceBytes = useMemo(() => workspace ? new TextEncoder().encode(JSON.stringify(workspace)).byteLength : 0, [workspace])

  if (!workspace) return <main className="loading-screen"><img src={papelleIcon} alt="" /><strong>Papelle</strong><span>{labels.opening}</span></main>

  return (
    <main className="app-shell">
      <header className="titlebar">
        <div className="brand"><button className="icon-button" aria-label={labels.menu} aria-expanded={sidebarOpen} onClick={() => setSidebarOpen((value) => !value)}><Menu size={19} /></button><img src={papelleIcon} alt="" /><strong>Papelle</strong></div>
        <div className="breadcrumbs"><span>{surface === 'database' ? labels.databases : surface === 'settings' ? labels.settings : labels.pages}</span>{selectedPage && surface === 'document' ? <><i>/</i><strong>{selectedPage.title}</strong><ChevronDown size={14} /></> : null}</div>
        <div className="titlebar-actions">
          <span className={`save-state ${saving ? 'is-saving' : ''} ${saveFailed ? 'is-error' : ''}`} role="status">{saveFailed ? labels.saveFailed : saving ? labels.saving : labels.saved}{saveFailed ? <XCircle size={15} /> : <CheckCircle2 size={15} />}</span>
          <span className={`sync-state state-${syncState}`} role="status">{syncState === 'connected' ? <Cloud size={15} /> : <WifiOff size={15} />}{syncState === 'connected' ? labels.connected : syncState === 'connecting' ? labels.reconnecting : syncState === 'error' ? labels.syncError : labels.offline}</span>
          <button className="locale-button" onClick={() => mutate((current) => ({ ...current, locale: current.locale === 'en' ? 'ja' : 'en' }))}><Languages size={16} />{locale === 'en' ? 'EN / 日本語' : '日本語 / EN'}</button>
        </div>
      </header>

      <div className="workspace-shell">
        <Sidebar locale={locale} pages={filteredPages} selectedPageId={workspace.selectedPageId} query={query} open={sidebarOpen} onQueryChange={setQuery} onSelect={(id) => { mutate((current) => ({ ...current, selectedPageId: id })); setSurface('document'); setSidebarOpen(false) }} onNewPage={createPage} onShowDatabase={() => { setSurface('database'); setSidebarOpen(false) }} onShowSettings={() => { setSurface('settings'); setSidebarOpen(false) }} searchRef={searchRef} />

        <section className="main-surface">
          {loadError ? <div className="error-banner" role="alert">{labels.persistenceWarning}: {loadError}</div> : null}
          {pageMoved ? <div className="undo-banner page-undo" role="status">{labels.deleteMoved}<button onClick={() => { mutate((current) => restoreTrashedPages(current, pageMoved)); setPageMoved(null) }}>{labels.undo}</button></div> : null}
          {surface === 'database' ? <DatabaseViews locale={locale} items={workspace.database} view={workspace.databaseView} onView={(view) => mutate((current) => ({ ...current, databaseView: view }))} onChange={(database) => mutate((current) => ({ ...current, database, sampleData: current.pages.some((page) => page.sample) || database.some((item) => item.sample) }))} />
            : surface === 'settings' ? <SettingsPanel workspace={workspace} databasePath={databasePath} recoveryAvailable={recoveryAvailable} onClose={() => setSurface(workspace.selectedPageId ? 'document' : 'settings')} onReset={(sample) => void confirmReset(sample)} onRestoreTrash={() => { mutate(restoreTrashedPages); setPageMoved(null) }} onDownloadRecovery={() => void downloadRecovery()} />
              : selectedPage ? <><div className="document-toolbar"><span className="sample-chip">{selectedPage.sample ? labels.sampleData : labels.personalData}</span><div><button onClick={() => importRef.current?.click()}><Upload size={15} />{labels.import}</button><button onClick={exportSelected}><Download size={15} />{labels.export}</button></div></div><BlockEditor locale={locale} page={selectedPage} pages={workspace.pages} workspaceBytes={workspaceBytes} onOpenPage={(id) => mutate((current) => ({ ...current, selectedPageId: id }))} onChange={(page) => mutate((current) => ({ ...current, pages: current.pages.map((item) => item.id === page.id ? page : item), sampleData: current.pages.some((item) => item.id === page.id ? page.sample : item.sample) || current.database.some((item) => item.sample) }))} /></>
                : <section className="empty-state"><img src={papelleIcon} alt="" /><h1>{labels.emptyTitle}</h1><p>{labels.emptyBody}</p><div><button className="primary" onClick={() => createPage()}><FilePlus2 size={16} />{labels.newPage}</button><button onClick={() => importRef.current?.click()}><Upload size={16} />{labels.import}</button></div></section>}
        </section>

        {surface === 'document' && selectedPage ? <Inspector locale={locale} page={selectedPage} backlinks={backlinks} onSelect={(id) => mutate((current) => ({ ...current, selectedPageId: id }))} onChange={(page) => mutate((current) => ({ ...current, pages: current.pages.map((item) => item.id === page.id ? page : item) }))} /> : null}
      </div>
      <input ref={importRef} type="file" accept=".md,.markdown,text/markdown,text/plain" hidden onChange={(event) => void importMarkdown(event.target.files?.[0])} />
    </main>
  )
}
