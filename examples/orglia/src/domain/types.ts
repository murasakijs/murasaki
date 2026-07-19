export type Locale = 'ja' | 'en'
export type ModuleId = 'overview' | 'projects' | 'crm' | 'orders' | 'inventory' | 'approvals' | 'shifts' | 'incidents' | 'analytics' | 'admin'
export type Role = 'admin' | 'manager' | 'sales' | 'operations' | 'approver' | 'viewer'
export type SyncState = 'loading' | 'ready' | 'saving' | 'offline' | 'conflict' | 'error'

export interface Tenant { id: string; name: string; region: string }
export interface User { id: string; name: string; email: string; role: Role; tenantId: string; team: string }
export interface Customer { id: string; tenantId: string; name: string; industry: string; ownerId: string; rank: string; email: string; phone: string }
export interface Opportunity { id: string; tenantId: string; customerId: string; title: string; amount: number; probability: number; stage: string; ownerId: string; due: string; nextAction: string; sku: string; quantity: number; projectId?: string; orderId?: string; createdAt: string }
export interface Order { id: string; tenantId: string; customerId: string; opportunityId: string; projectId: string; amount: number; status: 'pending' | 'allocated' | 'booked'; sku: string; quantity: number; ownerId: string; due: string; createdAt: string; allocatedAt?: string; bookedAt?: string }
export interface StockItem { sku: string; tenantId: string; name: string; onHand: number; reserved: number; reorderPoint: number; location: string }
export interface Project { id: string; tenantId: string; name: string; customerId: string; opportunityId: string; ownerId: string; status: 'on-track' | 'risk' | 'delayed'; progress: number; due: string }
export interface ApprovalStep { label: string; role: Role; status: 'pending' | 'approved' | 'returned' | 'rejected'; actorId?: string; at?: string; comment?: string }
export interface ApprovalComment { id: string; actorId: string; body: string; at: string }
export interface ApprovalRequest { id: string; tenantId: string; title: string; amount: number; applicantId: string; status: 'draft' | 'pending' | 'approved' | 'returned' | 'rejected'; risk: 'low' | 'medium' | 'high'; steps: ApprovalStep[]; reason: string; updatedAt: string; comments: ApprovalComment[] }
export type ShiftSlot = 'early' | 'day' | 'late' | 'off'
export interface Shift { id: string; tenantId: string; person: string; team: string; skills: string[]; wish: ShiftSlot; assigned: ShiftSlot; unavailable: ShiftSlot[]; conflict: 'unavailable' | 'wish' | null; published: boolean }
export interface IncidentEvent { at: string; body: string; actor: string }
export interface Postmortem { summary: string; rootCause: string; actions: string; createdAt: string; actorId: string }
export interface Incident { id: string; tenantId: string; title: string; severity: 1 | 2 | 3 | 4; ownerId: string; due: string; status: 'open' | 'escalated' | 'resolved'; timeline: IncidentEvent[]; postmortem: Postmortem | null }
export interface AuditEvent { id: string; sequence: number; tenantId: string; at: string; actorId: string; actor: string; action: string; entity: string; summary: string; before: unknown; after: unknown; previousHash: string; hash: string }
export interface RevenueTarget { month: string; target: number }
export interface AppData {
  tenants: Tenant[]
  users: User[]
  customers: Customer[]
  opportunities: Opportunity[]
  orders: Order[]
  inventory: StockItem[]
  projects: Project[]
  approvals: ApprovalRequest[]
  shifts: Shift[]
  incidents: Incident[]
  audit: AuditEvent[]
  revenueTargets: RevenueTarget[]
  sampleData: boolean
}

export interface SessionState {
  locale: Locale
  activeModule: ModuleId
  selectedId?: string
  filters: { period: 'month' | 'quarter' | 'year'; team: string; region: string }
  widgetOrder: string[]
  widgetSizes: Record<string, 'single' | 'wide'>
}

export interface AuthSession { user: User; tenant: Tenant; expiresAt: string }
export interface StateEnvelope { data: AppData; revision: number }
export interface PendingCommand { type: string; payload: Record<string, unknown> }
