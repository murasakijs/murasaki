import { AdminView, AnalyticsView, ApprovalsView, CrmView, IncidentsView, InventoryView, OrdersView, ProjectsView, ShiftsView } from './ModuleViews'
import { OverviewView } from './OverviewView'
import { useOrglia } from '@/state/OrgliaStore'

export function FeatureView({ onOpenContext }: { onOpenContext: () => void }) {
  const { session } = useOrglia()
  const props = { onOpenContext }
  switch (session.activeModule) {
    case 'overview': return <OverviewView {...props} />
    case 'projects': return <ProjectsView {...props} />
    case 'crm': return <CrmView {...props} />
    case 'orders': return <OrdersView {...props} />
    case 'inventory': return <InventoryView />
    case 'approvals': return <ApprovalsView {...props} />
    case 'shifts': return <ShiftsView />
    case 'incidents': return <IncidentsView {...props} />
    case 'analytics': return <AnalyticsView />
    case 'admin': return <AdminView />
  }
}
