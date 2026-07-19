import { ArrowDownToLine, RefreshCw } from 'lucide-react'
import { useMemo } from 'react'
import { useOrglia } from '@/state/OrgliaStore'
import { Button, Metric, Panel, SectionHeader, Status, WorkflowRail } from '@/components/ui'
import { copy } from '@/lib/i18n'

const safeCell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`
function downloadCsv(rows: string[][]) {
  const csv = rows.map((row) => row.map(safeCell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = `orglia-operations-${new Date().toISOString().slice(0, 10)}.csv`; link.rel = 'noopener'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function OverviewView({ onOpenContext }: { onOpenContext: () => void }) {
  const { data, session, currentTenant, setSelected, setModule, setFilter, refresh, t } = useOrglia()
  const scoped = useMemo(() => ({
    customers: data.customers.filter((item) => item.tenantId === currentTenant.id), opportunities: data.opportunities.filter((item) => item.tenantId === currentTenant.id),
    orders: data.orders.filter((item) => item.tenantId === currentTenant.id), inventory: data.inventory.filter((item) => item.tenantId === currentTenant.id),
    approvals: data.approvals.filter((item) => item.tenantId === currentTenant.id && item.status === 'pending'), shifts: data.shifts.filter((item) => item.tenantId === currentTenant.id),
    incidents: data.incidents.filter((item) => item.tenantId === currentTenant.id && item.status !== 'resolved'), projects: data.projects.filter((item) => item.tenantId === currentTenant.id),
  }), [currentTenant.id, data])
  const bookedRevenue = scoped.orders.filter((order) => order.status === 'booked').reduce((sum, order) => sum + order.amount, 0)
  const weightedPipeline = scoped.opportunities.filter((item) => !item.orderId).reduce((sum, item) => sum + item.amount * item.probability / 100, 0)
  const userName = (id: string) => data.users.find((item) => item.id === id)?.name ?? id
  const operations = [
    ...scoped.orders.map((item) => ({ type: copy(session.locale, '受注', 'Order'), id: item.id, subject: item.id, related: data.customers.find((customer) => customer.id === item.customerId)?.name ?? '', status: item.status, module: 'orders' as const })),
    ...scoped.approvals.map((item) => ({ type: copy(session.locale, '申請', 'Approval'), id: item.id, subject: item.title, related: userName(item.applicantId), status: item.status, module: 'approvals' as const })),
    ...scoped.incidents.map((item) => ({ type: copy(session.locale, '障害', 'Incident'), id: item.id, subject: item.title, related: `Severity ${item.severity}`, status: item.status, module: 'incidents' as const })),
    ...scoped.projects.map((item) => ({ type: copy(session.locale, 'プロジェクト', 'Project'), id: item.id, subject: item.name, related: `${item.progress}%`, status: item.status, module: 'projects' as const })),
  ].slice(0, 8)
  const revenue = data.revenueTargets.map((point) => ({ ...point, actual: scoped.orders.filter((order) => order.status === 'booked' && order.bookedAt?.startsWith(point.month)).reduce((sum, order) => sum + order.amount, 0) }))
  const max = Math.max(1, ...revenue.flatMap((item) => [item.actual, item.target]))
  const formatMoney = (value: number) => new Intl.NumberFormat(session.locale === 'ja' ? 'ja-JP' : 'en-US', { style: 'currency', currency: 'JPY', notation: 'compact', maximumFractionDigits: 1 }).format(value)

  return <div className="page overview-page">
    <div className="page-title"><div><p>{currentTenant.name}</p><h1>{t('overview')}</h1></div><div className="button-row"><label className="inline-field">{copy(session.locale, '期間', 'Period')}<select value={session.filters.period} onChange={(event) => setFilter('period', event.target.value)}><option value="month">{copy(session.locale, '今月', 'Month')}</option><option value="quarter">{copy(session.locale, '四半期', 'Quarter')}</option><option value="year">{copy(session.locale, '年度', 'Year')}</option></select></label><Button icon={<ArrowDownToLine/>} disabled={!operations.length} onClick={() => downloadCsv([[copy(session.locale, '種別', 'Type'), copy(session.locale, '件名', 'Subject'), copy(session.locale, '関連', 'Related'), t('status')], ...operations.map((row) => [row.type, row.subject, row.related, row.status])])}>{t('export')}</Button><Button icon={<RefreshCw/>} onClick={() => void refresh()}>{t('refresh')}</Button></div></div>
    <WorkflowRail locale={session.locale} active="order" counts={{ customer: String(scoped.customers.length), opportunity: String(scoped.opportunities.length), project: String(scoped.projects.length), order: String(scoped.orders.length), allocation: String(scoped.orders.filter((order) => order.status !== 'pending').length), revenue: formatMoney(bookedRevenue) }} onSelect={(stage) => setModule(stage === 'customer' || stage === 'opportunity' ? 'crm' : stage === 'project' ? 'projects' : stage === 'order' ? 'orders' : stage === 'allocation' ? 'inventory' : 'analytics')} />
    <Panel className="metric-strip">
      <Metric label={t('pendingApproval')} value={String(scoped.approvals.length)} note={`${scoped.approvals.filter((item) => item.risk === 'high').length} high risk`} tone="amber" />
      <Metric label={t('shiftGap')} value={String(scoped.shifts.filter((item) => item.conflict).length)} note={copy(session.locale, '制約・希望差異', 'constraint / wish mismatch')} tone="cyan" />
      <Metric label={t('incidents')} value={String(scoped.incidents.length)} note={`${scoped.incidents.filter((item) => item.severity <= 2).length} critical`} tone="red" />
      <Metric label={copy(session.locale, '要注意プロジェクト', 'At-risk projects')} value={String(scoped.projects.filter((item) => item.status !== 'on-track').length)} note={copy(session.locale, '実データから集計', 'from live records')} tone="blue" />
      <Metric label={copy(session.locale, '売上計上済', 'Booked revenue')} value={formatMoney(bookedRevenue)} note={`${scoped.orders.filter((item) => item.status === 'booked').length} orders`} tone="indigo" />
      <Metric label={copy(session.locale, '加重パイプライン', 'Weighted pipeline')} value={formatMoney(weightedPipeline)} note={`${scoped.opportunities.filter((item) => !item.orderId).length} open`} tone="violet" />
    </Panel>
    <div className="overview-grid">
      <Panel className="chart-panel"><SectionHeader title={copy(session.locale, '売上推移', 'Revenue trend')} description={copy(session.locale, '受注の売上計上日から集計', 'Calculated from order booking dates')}/><div className="legend"><span><i className="legend-actual"/>{copy(session.locale, '実績', 'Actual')}</span><span><i className="legend-target"/>{copy(session.locale, '目標', 'Target')}</span></div><div className="bar-chart" role="img" aria-label={copy(session.locale, '売上実績と目標', 'Revenue actual and target')}>{revenue.map((point) => <div className="bar-chart__column" key={point.month}><div className="bar-chart__plot"><span className="bar-target" style={{ height: `${point.target / max * 100}%` }}/><span className="bar-actual" style={{ height: `${point.actual / max * 100}%` }}/></div><small>{point.month}</small></div>)}</div></Panel>
      <Panel className="operations-panel"><SectionHeader title={copy(session.locale, '業務キュー', 'Operations queue')} description={`${operations.length} ${copy(session.locale, '件', 'records')}`}/><div className="table-wrap"><table><caption className="sr-only">{copy(session.locale, '業務一覧', 'Operations')}</caption><thead><tr><th>{copy(session.locale, '種別', 'Type')}</th><th>{copy(session.locale, '件名', 'Subject')}</th><th>{copy(session.locale, '関連', 'Related')}</th><th>{t('status')}</th></tr></thead><tbody>{operations.map((row) => <tr key={`${row.module}-${row.id}`}><td>{row.type}</td><td><button className="row-link" onClick={() => { setModule(row.module); setSelected(row.id); onOpenContext() }}>{row.subject}</button></td><td>{row.related}</td><td><Status tone={row.status === 'resolved' || row.status === 'booked' || row.status === 'on-track' ? 'positive' : row.status === 'escalated' || row.status === 'delayed' ? 'danger' : 'warning'}>{row.status}</Status></td></tr>)}</tbody></table></div></Panel>
    </div>
  </div>
}
