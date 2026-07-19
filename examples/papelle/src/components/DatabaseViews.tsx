import { CalendarDays, Columns3, ListTree, Plus, Trash2 } from 'lucide-react'
import type { DatabaseItem, DatabaseView, Locale } from '../domain/types'
import { t } from '../i18n'

interface DatabaseViewsProps {
  locale: Locale
  items: DatabaseItem[]
  view: DatabaseView
  onView(view: DatabaseView): void
  onChange(items: DatabaseItem[]): void
}

const statuses: DatabaseItem['status'][] = ['Not started', 'In progress', 'Done']

export function DatabaseViews({ locale, items, view, onView, onChange }: DatabaseViewsProps) {
  const labels = t(locale)
  const statusLabel = { 'Not started': labels.notStarted, 'In progress': labels.inProgress, Done: labels.done }
  const update = (id: string, patch: Partial<DatabaseItem>) => onChange(items.map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item))
  const add = () => onChange([...items, { id: crypto.randomUUID(), title: labels.milestone, owner: '', due: new Date().toISOString().slice(0, 10), status: 'Not started', tags: [], updatedAt: new Date().toISOString(), sample: false }])
  return (
    <section className="database-page" aria-labelledby="database-title">
      <header className="database-header">
        <div><span className="section-kicker">{labels.databases}</span><h1 id="database-title">{labels.database}</h1></div>
        <div className="database-actions"><button onClick={add}><Plus size={15} />{labels.addRecord}</button><div className="view-switcher" role="tablist" aria-label={labels.databaseView}>
          <button role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'is-active' : ''} onClick={() => onView('table')}><ListTree size={15} />{labels.table}</button>
          <button role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'is-active' : ''} onClick={() => onView('board')}><Columns3 size={15} />{labels.board}</button>
          <button role="tab" aria-selected={view === 'calendar'} className={view === 'calendar' ? 'is-active' : ''} onClick={() => onView('calendar')}><CalendarDays size={15} />{labels.calendar}</button>
        </div></div>
      </header>
      {view === 'table' ? (
        <div className="database-table-wrap"><table className="database-table"><thead><tr><th>{labels.milestone}</th><th>{labels.owner}</th><th>{labels.dueDate}</th><th>{labels.status}</th><th>{labels.tags}</th><th><span className="sr-only">{labels.deleteRecord}</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td><input aria-label={`${labels.milestone}: ${item.title}`} value={item.title} onChange={(event) => update(item.id, { title: event.target.value })} /></td><td><input aria-label={`${labels.owner}: ${item.title}`} value={item.owner} onChange={(event) => update(item.id, { owner: event.target.value })} /></td><td><input aria-label={`${labels.dueDate}: ${item.title}`} type="date" value={item.due} onChange={(event) => update(item.id, { due: event.target.value })} /></td><td><select aria-label={`${labels.status}: ${item.title}`} value={item.status} onChange={(event) => update(item.id, { status: event.target.value as DatabaseItem['status'] })}>{statuses.map((status) => <option key={status} value={status}>{statusLabel[status]}</option>)}</select></td><td><input aria-label={`${labels.tags}: ${item.title}`} value={item.tags.join(', ')} onChange={(event) => update(item.id, { tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) })} /></td><td><button onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))} aria-label={`${labels.deleteRecord}: ${item.title}`}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>
      ) : view === 'board' ? (
        <div className="board">{statuses.map((status) => <section className="board-column" key={status}><h2>{statusLabel[status]}<span>{items.filter((item) => item.status === status).length}</span></h2>{items.filter((item) => item.status === status).map((item) => <article className="board-card" key={item.id}><strong>{item.title}</strong><p>{item.owner} · {item.due}</p><select aria-label={`${labels.moveCard}: ${item.title}`} value={item.status} onChange={(event) => update(item.id, { status: event.target.value as DatabaseItem['status'] })}>{statuses.map((option) => <option value={option} key={option}>{statusLabel[option]}</option>)}</select></article>)}</section>)}</div>
      ) : (
        <div className="calendar-list">{[...items].sort((a, b) => a.due.localeCompare(b.due)).map((item) => <article key={item.id}><time dateTime={item.due}><span>{new Date(`${item.due}T12:00:00`).toLocaleDateString(locale, { month: 'short' })}</span><strong>{new Date(`${item.due}T12:00:00`).getDate()}</strong></time><div><h2>{item.title}</h2><p>{item.owner} · {statusLabel[item.status]}</p></div></article>)}</div>
      )}
    </section>
  )
}
