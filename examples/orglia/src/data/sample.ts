import type { AppData, SessionState } from '@/domain/types'

export const initialSession: SessionState = {
  locale: 'ja',
  activeModule: 'overview',
  filters: { period: 'quarter', team: 'all', region: 'all' },
  widgetOrder: ['revenue', 'pipeline', 'risk', 'activity'],
  widgetSizes: { revenue: 'wide', pipeline: 'single', risk: 'single', activity: 'wide' },
}

// Business data is never restored from localStorage or bundled into the client.
// The authenticated, tenant-scoped server response is the only source of truth.
export const emptyData: AppData = {
  tenants: [], users: [], customers: [], opportunities: [], orders: [], inventory: [], projects: [],
  approvals: [], shifts: [], incidents: [], audit: [], revenueTargets: [], sampleData: false,
}
