import { AlertTriangle, Check, PackagePlus, RotateCcw } from 'lucide-react'
import { Button, Panel, Status, Timeline } from '@/components/ui'
import { copy } from '@/lib/i18n'
import { useOrglia } from '@/state/OrgliaStore'

export function ContextPanel() {
  const { data, session, currentTenant, currentUser, receive, allocate, book, mutable, t } = useOrglia()
  const defaults = {
    crm: data.opportunities.find((item) => item.tenantId === currentTenant.id)?.id,
    approvals: data.approvals.find((item) => item.tenantId === currentTenant.id)?.id,
    incidents: data.incidents.find((item) => item.tenantId === currentTenant.id)?.id,
    projects: data.projects.find((item) => item.tenantId === currentTenant.id)?.id,
  } as const
  const selectedId = session.selectedId ?? defaults[session.activeModule as keyof typeof defaults] ?? data.orders.find((order) => order.tenantId === currentTenant.id)?.id
  const order = data.orders.find((item) => item.id === selectedId)
  const opportunity = data.opportunities.find((item) => item.id === selectedId)
  const approval = data.approvals.find((item) => item.id === selectedId)
  const incident = data.incidents.find((item) => item.id === selectedId)
  const project = data.projects.find((item) => item.id === selectedId)

  if (order) {
    const customer = data.customers.find((item) => item.id === order.customerId)
    const stock = data.inventory.find((item) => item.sku === order.sku && item.tenantId === order.tenantId)
    const available = (stock?.onHand ?? 0) - (stock?.reserved ?? 0)
    const entries = data.audit.filter((event) => event.entity === order.id).map((event) => ({ at: event.at.slice(0, 16).replace('T', ' '), actor: event.actor, body: event.summary }))
    return <div className="context-content">
      <div className="context-kicker">{copy(session.locale, '受注詳細', 'Order details')}</div><div className="context-heading"><h2>{order.id}</h2><Status tone={order.status === 'booked' ? 'positive' : order.status === 'allocated' ? 'info' : 'warning'}>{order.status}</Status></div>
      <dl className="detail-list"><div><dt>{t('customer')}</dt><dd>{customer?.name}</dd></div><div><dt>{t('amount')}</dt><dd>¥{order.amount.toLocaleString()}</dd></div><div><dt>{t('due')}</dt><dd>{order.due}</dd></div><div><dt>{t('owner')}</dt><dd>{data.users.find((user) => user.id === order.ownerId)?.name}</dd></div><div><dt>SKU</dt><dd>{order.sku}</dd></div><div><dt>{t('inventory')}</dt><dd>{available} / {copy(session.locale, '必要', 'required')} {order.quantity}</dd></div></dl>
      {available < order.quantity && order.status === 'pending' && <div className="callout callout--warning"><AlertTriangle/><div><strong>{copy(session.locale, '在庫不足', 'Stock shortage')}</strong><p>{copy(session.locale, `${order.quantity - available}点不足しています。入荷後に引当できます。`, `${order.quantity - available} more units are required before allocation.`)}</p></div></div>}
      <div className="context-actions">
        {order.status === 'pending' && available < order.quantity && <Button variant="secondary" icon={<PackagePlus/>} disabled={!mutable('operations')} onClick={() => receive(order.sku, order.quantity - available)}>{copy(session.locale, '不足分を入荷', 'Receive shortage')}</Button>}
        {order.status === 'pending' && <Button variant="primary" icon={<Check/>} disabled={!mutable('operations')} onClick={() => allocate(order.id)}>{copy(session.locale, '在庫を引当', 'Allocate stock')}</Button>}
        {order.status === 'allocated' && <Button variant="primary" icon={<Check/>} disabled={!mutable('sales')} onClick={() => book(order.id)}>{copy(session.locale, '売上を計上', 'Book revenue')}</Button>}
      </div>
      <Panel className="context-timeline"><h3>{copy(session.locale, 'タイムライン', 'Timeline')}</h3><Timeline entries={entries.length ? entries : [{ at: '—', actor: 'System', body: 'No events' }]} /></Panel>
    </div>
  }
  if (opportunity) {
    const customer = data.customers.find((item) => item.id === opportunity.customerId)
    return <div className="context-content"><div className="context-kicker">{copy(session.locale, '案件詳細', 'Opportunity details')}</div><div className="context-heading"><h2>{opportunity.id}</h2><Status tone="info">{opportunity.stage}</Status></div><form className="detail-form"><label>{copy(session.locale, '件名', 'Title')}<input value={opportunity.title} readOnly/></label><label>{t('customer')}<input value={customer?.name ?? ''} readOnly/></label><div><label>{copy(session.locale, '確度', 'Probability')}<input value={`${opportunity.probability}%`} readOnly/></label><label>{t('amount')}<input value={`¥${opportunity.amount.toLocaleString()}`} readOnly/></label></div><label>{copy(session.locale, '次のアクション', 'Next action')}<input value={opportunity.nextAction} readOnly/></label><label>{t('due')}<input value={opportunity.due} readOnly/></label></form><Panel className="context-timeline"><h3>{copy(session.locale, '関連する監査イベント', 'Related audit events')}</h3><Timeline entries={data.audit.filter((event) => event.entity === opportunity.id || event.entity === opportunity.orderId).map((event) => ({ at: event.at, actor: event.actor, body: event.summary }))}/></Panel></div>
  }
  if (approval) return <div className="context-content"><div className="context-kicker">{copy(session.locale, '申請詳細', 'Approval details')}</div><div className="context-heading"><h2>{approval.id}</h2><Status tone="warning">{approval.status}</Status></div><h3>{approval.title}</h3><dl className="detail-list"><div><dt>{copy(session.locale, '申請者', 'Applicant')}</dt><dd>{data.users.find((item) => item.id === approval.applicantId)?.name}</dd></div><div><dt>{t('amount')}</dt><dd>¥{approval.amount.toLocaleString()}</dd></div><div><dt>{copy(session.locale, '理由', 'Reason')}</dt><dd>{approval.reason}</dd></div></dl><Timeline entries={approval.steps.map((step) => ({ at: step.at ?? copy(session.locale, '未処理', 'Pending'), actor: step.actorId ? data.users.find((item) => item.id === step.actorId)?.name ?? step.actorId : step.label, body: `${step.label}: ${step.status}` }))}/></div>
  if (incident) return <div className="context-content"><div className="context-kicker">Incident</div><div className="context-heading"><h2>{incident.id}</h2><Status tone={incident.severity <= 2 ? 'danger' : 'warning'}>S{incident.severity}</Status></div><h3>{incident.title}</h3><dl className="detail-list"><div><dt>{t('status')}</dt><dd>{incident.status}</dd></div><div><dt>{t('due')}</dt><dd>{incident.due}</dd></div><div><dt>{t('owner')}</dt><dd>{data.users.find((user) => user.id === incident.ownerId)?.name}</dd></div></dl><Timeline entries={incident.timeline}/></div>
  if (project) return <div className="context-content"><div className="context-kicker">Project</div><div className="context-heading"><h2>{project.id}</h2><Status tone={project.status === 'on-track' ? 'positive' : 'danger'}>{project.status}</Status></div><h3>{project.name}</h3><div className="large-progress"><span style={{ width: `${project.progress}%` }}/></div><p>{project.progress}% complete</p></div>
  return <div className="context-empty"><RotateCcw/><h2>{t('details')}</h2><p>{t('noData')}</p><small>{currentUser.name}</small></div>
}
