import { Hash, Link2, Star, X } from 'lucide-react'
import { useState } from 'react'
import type { Locale, Page } from '../domain/types'
import { t } from '../i18n'

export function Inspector({ locale, page, backlinks, onSelect, onChange }: { locale: Locale; page: Page; backlinks: Page[]; onSelect(id: string): void; onChange(page: Page): void }) {
  const labels = t(locale)
  const [tag, setTag] = useState('')
  const update = (patch: Partial<Page>) => onChange({ ...page, ...patch, updatedAt: new Date().toISOString() })
  const addTag = () => { const next = tag.trim().replace(/^#/, ''); if (next && !page.tags.includes(next)) update({ tags: [...page.tags, next] }); setTag('') }
  return <aside className="inspector" aria-label={labels.pageTags}>
    <section><h2><Link2 size={16} />{labels.backlinks}<span>{backlinks.length}</span></h2>{backlinks.length ? backlinks.map((item) => <button className="backlink" key={item.id} onClick={() => onSelect(item.id)}>{item.icon}<span>{item.title}</span></button>) : <p className="muted">{labels.noBacklinks}</p>}</section>
    <section><h2><Hash size={16} />{labels.pageTags}</h2><div className="tag-cloud">{page.tags.map((item) => <span className="tag" key={item}># {item}<button onClick={() => update({ tags: page.tags.filter((candidate) => candidate !== item) })} aria-label={`${labels.removeTag}: ${item}`}><X size={11} /></button></span>)}</div><div className="tag-entry"><input value={tag} onChange={(event) => setTag(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addTag() }} aria-label={labels.addTag} /><button onClick={addTag}>{labels.addTag}</button></div></section>
    <section><button className={`favorite-toggle ${page.favorite ? 'is-active' : ''}`} aria-pressed={page.favorite} onClick={() => update({ favorite: !page.favorite })}><Star size={16} />{labels.favorite}</button></section>
    {page.sample ? <aside className="sample-note"><strong>{labels.sampleData}</strong><p>{labels.sampleDescription}</p></aside> : null}
  </aside>
}
