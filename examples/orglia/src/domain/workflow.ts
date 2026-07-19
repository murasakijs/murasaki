import type { ModuleId, Role } from './types'

const roleModules: Record<Role, ModuleId[]> = {
  admin: ['overview', 'projects', 'crm', 'orders', 'inventory', 'approvals', 'shifts', 'incidents', 'analytics', 'admin'],
  manager: ['overview', 'projects', 'crm', 'orders', 'inventory', 'approvals', 'shifts', 'incidents', 'analytics'],
  sales: ['overview', 'projects', 'crm', 'orders', 'approvals', 'analytics'],
  operations: ['overview', 'projects', 'orders', 'inventory', 'approvals', 'shifts', 'incidents', 'analytics'],
  approver: ['overview', 'approvals', 'analytics'],
  viewer: ['overview', 'analytics'],
}

export function canAccess(role: Role, moduleId: ModuleId) { return roleModules[role].includes(moduleId) }

export function canMutate(role: Role, area: string) {
  if (role === 'admin' || role === 'manager') return true
  if (area === 'sales') return role === 'sales'
  if (area === 'operations') return role === 'operations'
  if (area === 'approval') return role === 'approver'
  if (area === 'request') return role !== 'viewer'
  return false
}
