import { describe, expect, it } from 'vitest'
import { canAccess, canMutate } from './workflow'

describe('client permission affordances mirror the server policy', () => {
  it('does not expose administration or mutations to viewers', () => {
    expect(canAccess('viewer', 'admin')).toBe(false)
    expect(canMutate('viewer', 'request')).toBe(false)
  })

  it('limits operational and approval actions to their roles', () => {
    expect(canMutate('operations', 'operations')).toBe(true)
    expect(canMutate('operations', 'sales')).toBe(false)
    expect(canMutate('approver', 'approval')).toBe(true)
  })
})
