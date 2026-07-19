import { useEffect, useId, useRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react'
import { ArrowRight, Check, CircleAlert, Clock3 } from 'lucide-react'

export function Panel({ children, className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`panel ${className}`} {...props}>{children}</section>
}

export function SectionHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <div className="section-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{actions && <div className="button-row">{actions}</div>}</div>
}

export function Button({ variant = 'secondary', icon, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' | 'quiet'; icon?: ReactNode }) {
  return <button className={`button button--${variant}`} {...props}>{icon}{children}</button>
}

export function Status({ tone = 'neutral', children }: { tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'info'; children: ReactNode }) {
  return <span className={`status status--${tone}`}>{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><CircleAlert aria-hidden="true"/><p>{children}</p></div>
}

export function WorkflowRail({ active, counts, onSelect, locale = 'ja' }: { active: string; counts: Record<string, string>; onSelect?: (stage: string) => void; locale?: 'ja' | 'en' }) {
  const stages = [
    ['customer', locale === 'ja' ? '顧客' : 'Customer', 'crm'],
    ['opportunity', locale === 'ja' ? '案件' : 'Opportunity', 'crm'],
    ['project', locale === 'ja' ? 'プロジェクト' : 'Project', 'projects'],
    ['order', locale === 'ja' ? '受注' : 'Order', 'orders'],
    ['allocation', locale === 'ja' ? '在庫引当' : 'Allocation', 'inventory'],
    ['revenue', locale === 'ja' ? '売上' : 'Revenue', 'analytics'],
  ] as const
  return <div className="workflow-rail" aria-label={locale === 'ja' ? '顧客から売上までの業務フロー' : 'Workflow from customer to revenue'}>
    {stages.map(([id, label, color], index) => <div className="workflow-node-wrap" key={id}>
      <button type="button" className={`workflow-node module-${color} ${active === id ? 'is-active' : ''}`} onClick={() => onSelect?.(id)}>
        <span className="workflow-node__icon">{index < 2 ? index + 1 : index === 4 ? <Check size={16}/> : index + 1}</span>
        <span><strong>{label}</strong><small>{counts[id]}</small></span>
      </button>
      {index < stages.length - 1 && <ArrowRight className="workflow-arrow" aria-hidden="true" />}
    </div>)}
  </div>
}

export function Timeline({ entries }: { entries: Array<{ at: string; actor: string; body: string; tone?: string }> }) {
  return <ol className="timeline">
    {entries.map((entry, index) => <li key={`${entry.at}-${index}`}>
      <span className={`timeline__dot ${entry.tone ?? ''}`}><Clock3 size={13}/></span>
      <div><time>{entry.at}</time><strong>{entry.actor}</strong><p>{entry.body}</p></div>
    </li>)}
  </ol>
}

export function Metric({ label, value, note, tone = 'blue' }: { label: string; value: string; note: string; tone?: string }) {
  return <div className={`metric metric--${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></div>
}

export function Restricted({ message }: { message: string }) {
  return <span className="restricted-note"><CircleAlert size={14}/>{message}</span>
}

export function Modal({ title, children, onClose, closeLabel = 'Close' }: { title: string; children: ReactNode; onClose: () => void; closeLabel?: string }) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef(typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null)
  useEffect(() => {
    const dialog = dialogRef.current
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])') ?? [])]
    dialog?.querySelector<HTMLElement>('[autofocus]')?.focus()
    if (!dialog?.contains(document.activeElement)) focusable()[0]?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return }
      if (event.key !== 'Tab') return
      const items = focusable(); if (!items.length) return
      const first = items[0]; const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown); returnFocusRef.current?.focus() }
  }, [onClose])
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose() }}>
    <div ref={dialogRef} className="request-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="section-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label={closeLabel}>×</button></div>
      {children}
    </div>
  </div>
}
