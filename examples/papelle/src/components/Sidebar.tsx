import { ChevronDown, Database, FileText, Folder, Hash, Plus, Search, Settings, Star } from 'lucide-react'
import { ContextMenuTrigger } from 'murasaki'
import type { Locale, Page } from '../domain/types'
import { t } from '../i18n'

interface SidebarProps {
  locale: Locale; pages: Page[]; selectedPageId: string | null; query: string; open: boolean
  onQueryChange(value: string): void; onSelect(id: string): void; onNewPage(parentId?: string): void
  onShowDatabase(): void; onShowSettings(): void; searchRef: React.RefObject<HTMLInputElement | null>
}

function PageRow({ page, selected, depth, newChildLabel, onSelect, onNewChild }: { page: Page; selected: boolean; depth: number; newChildLabel: string; onSelect(): void; onNewChild(): void }) {
  return <div className="page-row-wrap" style={{ paddingInlineStart: `${Math.min(depth, 8) * 16}px` }}>
    <ContextMenuTrigger id="papelle-page-row"><button className={`page-row ${selected ? 'is-selected' : ''}`} onContextMenu={onSelect} onClick={onSelect} aria-current={selected ? 'page' : undefined}><span className="page-icon" aria-hidden>{page.icon}</span><span>{page.title}</span></button></ContextMenuTrigger>
    <button className="new-child" onClick={onNewChild} aria-label={`${page.title}: ${newChildLabel}`} title={newChildLabel}><Plus size={12} /></button>
  </div>
}

export function Sidebar(props: SidebarProps) {
  const labels = t(props.locale)
  const favorites = props.pages.filter((page) => page.favorite)
  const children = new Map<string | null, Page[]>()
  for (const page of props.pages) children.set(page.parentId, [...(children.get(page.parentId) ?? []), page])
  const renderTree = (parentId: string | null, depth = 0): React.ReactNode => (children.get(parentId) ?? []).map((page) => <div key={page.id}><PageRow page={page} selected={page.id === props.selectedPageId} depth={depth} newChildLabel={labels.newChild} onSelect={() => props.onSelect(page.id)} onNewChild={() => props.onNewPage(page.id)} />{renderTree(page.id, depth + 1)}</div>)
  return (
    <aside className={`sidebar ${props.open ? 'is-open' : ''}`} aria-label={labels.pages}>
      <label className="search-field"><Search size={16} aria-hidden /><span className="sr-only">{labels.search}</span><input ref={props.searchRef} value={props.query} onChange={(event) => props.onQueryChange(event.target.value)} placeholder={labels.search} aria-label={labels.search} /><kbd>⌘K</kbd></label>
      <nav className="sidebar-scroll">
        <section className="nav-section"><h2><Star size={15} />{labels.favorites}<ChevronDown size={14} /></h2>{favorites.map((page) => <PageRow key={`favorite-${page.id}`} page={page} selected={page.id === props.selectedPageId} depth={0} newChildLabel={labels.newChild} onSelect={() => props.onSelect(page.id)} onNewChild={() => props.onNewPage(page.id)} />)}</section>
        <section className="nav-section"><h2><FileText size={15} />{labels.pages}<button className="icon-button mini" onClick={() => props.onNewPage()} aria-label={labels.newPage}><Plus size={14} /></button></h2>{renderTree(null)}</section>
        <section className="nav-section tags-list"><h2><Hash size={15} />{labels.tags}<ChevronDown size={14} /></h2>{[...new Set(props.pages.flatMap((page) => page.tags))].sort().map((tag) => <button key={tag} onClick={() => props.onQueryChange(tag)}># {tag}</button>)}</section>
        <section className="nav-section"><h2><Database size={15} />{labels.databases}<ChevronDown size={14} /></h2><button className="page-row" onClick={props.onShowDatabase}><span className="page-icon"><Folder size={14} /></span>{labels.database}</button></section>
      </nav>
      <button className="settings-link" onClick={props.onShowSettings}><Settings size={16} />{labels.settings}</button>
    </aside>
  )
}
