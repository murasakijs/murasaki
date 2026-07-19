import { randomUUID } from 'node:crypto'

export class CommandError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}

const allowed = (role, roles) => role === 'admin' || roles.includes(role)
const deny = () => { throw new CommandError(403, 'FORBIDDEN', 'Your role cannot perform this action') }
const required = (value, name, max = 500) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new CommandError(400, 'INVALID_INPUT', `${name} is required`)
  return value.trim()
}
const MAX_MONEY = 1_000_000_000_000
const MAX_INVENTORY = 1_000_000_000
const positiveNumber = (value, name, max = MAX_MONEY) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) {
    throw new CommandError(400, 'INVALID_INPUT', `${name} must be a positive number no greater than ${max}`)
  }
  return value
}
const identifier = (prefix) => `${prefix}-${randomUUID().slice(0, 8)}`
const snapshot = (value) => value == null ? null : structuredClone(value)

export function executeCommand(data, command, identity, options = {}) {
  const { type, payload = {} } = command ?? {}
  const role = identity.role
  const tenantId = identity.tenantId
  const actorId = identity.userId
  const now = new Date().toISOString()
  const event = (action, entity, summary, before, after) => ({ action, entity, summary, before: snapshot(before), after: snapshot(after) })
  const own = (item) => item?.tenantId === tenantId

  if (type === 'opportunity.convert') {
    if (!allowed(role, ['sales', 'manager'])) deny()
    const opportunity = data.opportunities.find((item) => item.id === payload.opportunityId && own(item))
    if (!opportunity) throw new CommandError(404, 'NOT_FOUND', 'Opportunity not found')
    if (opportunity.orderId) throw new CommandError(409, 'INVALID_STATE', 'Opportunity already has an order')
    const before = snapshot(opportunity)
    const projectId = opportunity.projectId ?? identifier('prj')
    const orderId = identifier('ord')
    const project = data.projects.find((item) => item.id === projectId) ?? { id: projectId, tenantId, name: opportunity.title, customerId: opportunity.customerId, opportunityId: opportunity.id, ownerId: identity.userId, status: 'on-track', progress: 0, due: opportunity.due }
    const order = { id: orderId, tenantId, customerId: opportunity.customerId, opportunityId: opportunity.id, projectId, amount: opportunity.amount, status: 'pending', sku: opportunity.sku, quantity: opportunity.quantity, ownerId: opportunity.ownerId, due: opportunity.due, createdAt: now }
    data.opportunities = data.opportunities.map((item) => item.id === opportunity.id ? { ...item, stage: 'won', probability: 100, projectId, orderId, nextAction: 'inventory-allocation' } : item)
    if (!data.projects.some((item) => item.id === projectId)) data.projects.push(project)
    data.orders.push(order)
    return { data, events: [event('opportunity.converted', opportunity.id, 'Opportunity created a linked project and order', before, { opportunity: data.opportunities.find((item) => item.id === opportunity.id), project, order })] }
  }

  if (type === 'inventory.receive') {
    if (!allowed(role, ['operations', 'manager'])) deny()
    const quantity = positiveNumber(payload.quantity, 'quantity', MAX_INVENTORY)
    if (!Number.isInteger(quantity)) throw new CommandError(400, 'INVALID_INPUT', 'quantity must be an integer')
    const item = data.inventory.find((entry) => entry.sku === payload.sku && own(entry))
    if (!item) throw new CommandError(404, 'NOT_FOUND', 'Stock item not found')
    if (!Number.isSafeInteger(item.onHand) || item.onHand < 0 || item.onHand + quantity > MAX_INVENTORY) {
      throw new CommandError(409, 'INVENTORY_LIMIT', `onHand cannot exceed ${MAX_INVENTORY}`)
    }
    const before = snapshot(item); item.onHand += quantity
    return { data, events: [event('inventory.received', item.sku, `Received ${quantity} units`, before, item)] }
  }

  if (type === 'order.allocate') {
    if (!allowed(role, ['operations', 'manager'])) deny()
    const order = data.orders.find((item) => item.id === payload.orderId && own(item))
    if (!order) throw new CommandError(404, 'NOT_FOUND', 'Order not found')
    if (order.status !== 'pending') throw new CommandError(409, 'INVALID_STATE', 'Only pending orders can be allocated')
    const stock = data.inventory.find((item) => item.sku === order.sku && own(item))
    if (!stock || stock.onHand - stock.reserved < order.quantity) throw new CommandError(409, 'INSUFFICIENT_STOCK', 'Insufficient stock')
    const before = { order: snapshot(order), stock: snapshot(stock) }
    order.status = 'allocated'; order.allocatedAt = now; stock.reserved += order.quantity
    return { data, events: [event('inventory.allocated', order.id, `Allocated ${order.quantity} units of ${stock.sku}`, before, { order, stock })] }
  }

  if (type === 'order.book') {
    if (!allowed(role, ['sales', 'manager'])) deny()
    const order = data.orders.find((item) => item.id === payload.orderId && own(item))
    if (!order) throw new CommandError(404, 'NOT_FOUND', 'Order not found')
    if (order.status !== 'allocated') throw new CommandError(409, 'INVALID_STATE', 'Allocation is required before revenue booking')
    const before = snapshot(order); order.status = 'booked'; order.bookedAt = now
    const project = data.projects.find((item) => item.id === order.projectId && own(item))
    if (project) project.progress = Math.max(project.progress, 25)
    return { data, events: [event('revenue.booked', order.id, `Booked revenue of ${order.amount}`, before, order)] }
  }

  if (type === 'approval.create') {
    if (role === 'viewer') deny()
    const title = required(payload.title, 'title', 120)
    const reason = required(payload.reason, 'reason', 1000)
    const amount = positiveNumber(payload.amount, 'amount')
    const request = { id: identifier('apr'), tenantId, title, reason, amount, applicantId: actorId, status: 'pending', risk: amount >= 1_000_000 ? 'high' : amount >= 250_000 ? 'medium' : 'low', updatedAt: now, steps: [{ label: 'manager-approval', role: 'manager', status: 'pending' }, { label: 'finance-approval', role: 'approver', status: 'pending' }], comments: [] }
    data.approvals.unshift(request)
    return { data, events: [event('approval.created', request.id, 'Created approval request', null, request)] }
  }

  if (type === 'approval.decide') {
    const request = data.approvals.find((item) => item.id === payload.requestId && own(item))
    if (!request) throw new CommandError(404, 'NOT_FOUND', 'Approval request not found')
    if (request.status !== 'pending') throw new CommandError(409, 'INVALID_STATE', 'Request is not pending')
    const step = request.steps.find((item) => item.status === 'pending')
    if (!step) throw new CommandError(409, 'INVALID_STATE', 'No pending approval step')
    if (role !== 'admin' && role !== step.role) deny()
    const decision = payload.decision
    if (!['approve', 'return', 'reject'].includes(decision)) throw new CommandError(400, 'INVALID_INPUT', 'Unknown decision')
    const comment = decision === 'approve' ? (typeof payload.comment === 'string' ? payload.comment.trim().slice(0, 1000) : '') : required(payload.comment, 'comment', 1000)
    const before = snapshot(request)
    step.status = decision === 'approve' ? 'approved' : decision === 'return' ? 'returned' : 'rejected'
    step.actorId = actorId; step.at = now; step.comment = comment || undefined
    request.status = decision === 'return' ? 'returned' : decision === 'reject' ? 'rejected' : request.steps.every((item) => item.status === 'approved') ? 'approved' : 'pending'
    request.updatedAt = now
    if (comment) request.comments.push({ id: identifier('cmt'), actorId, body: comment, at: now })
    return { data, events: [event(`approval.${decision === 'approve' ? 'approved' : decision === 'return' ? 'returned' : 'rejected'}`, request.id, `${decision} at ${step.label}`, before, request)] }
  }

  if (type === 'approval.edit') {
    const request = data.approvals.find((item) => item.id === payload.requestId && own(item))
    if (!request) throw new CommandError(404, 'NOT_FOUND', 'Approval request not found')
    if (request.applicantId !== actorId && role !== 'admin') deny()
    if (!['returned', 'draft'].includes(request.status)) throw new CommandError(409, 'INVALID_STATE', 'Only returned or draft requests can be edited')
    const before = snapshot(request)
    request.title = required(payload.title, 'title', 120); request.reason = required(payload.reason, 'reason', 1000); request.amount = positiveNumber(payload.amount, 'amount')
    request.risk = request.amount >= 1_000_000 ? 'high' : request.amount >= 250_000 ? 'medium' : 'low'; request.status = 'draft'; request.updatedAt = now
    return { data, events: [event('approval.edited', request.id, 'Edited returned approval request', before, request)] }
  }

  if (type === 'approval.resubmit') {
    const request = data.approvals.find((item) => item.id === payload.requestId && own(item))
    if (!request) throw new CommandError(404, 'NOT_FOUND', 'Approval request not found')
    if (request.applicantId !== actorId && role !== 'admin') deny()
    if (!['returned', 'draft'].includes(request.status)) throw new CommandError(409, 'INVALID_STATE', 'Only returned or draft requests can be resubmitted')
    const before = snapshot(request)
    request.steps = request.steps.map((step) => ['returned', 'rejected'].includes(step.status) ? { label: step.label, role: step.role, status: 'pending' } : step)
    request.status = 'pending'; request.updatedAt = now
    return { data, events: [event('approval.resubmitted', request.id, 'Resubmitted approval request', before, request)] }
  }

  if (type === 'approval.comment') {
    const request = data.approvals.find((item) => item.id === payload.requestId && own(item))
    if (!request) throw new CommandError(404, 'NOT_FOUND', 'Approval request not found')
    if (!allowed(role, ['manager', 'approver']) && request.applicantId !== actorId) deny()
    const comment = { id: identifier('cmt'), actorId, body: required(payload.comment, 'comment', 1000), at: now }
    request.comments.push(comment); request.updatedAt = now
    return { data, events: [event('approval.commented', request.id, 'Added approval comment', null, comment)] }
  }

  if (type === 'shift.propose') {
    if (!allowed(role, ['operations', 'manager'])) deny()
    const counts = { early: 0, day: 0, late: 0 }
    const before = snapshot(data.shifts.filter(own))
    for (const shift of data.shifts.filter(own)) {
      if (shift.published) throw new CommandError(409, 'INVALID_STATE', 'Published shifts cannot be changed')
      const candidates = ['early', 'day', 'late'].filter((slot) => !shift.unavailable.includes(slot)).sort((a, b) => counts[a] - counts[b])
      const assigned = shift.wish !== 'off' && candidates.includes(shift.wish) ? shift.wish : candidates[0]
      shift.assigned = assigned; counts[assigned] += 1
      shift.conflict = shift.unavailable.includes(assigned) ? 'unavailable' : assigned !== shift.wish ? 'wish' : null
    }
    return { data, events: [event('shift.proposed', tenantId, 'Generated a constraint-aware shift proposal', before, data.shifts.filter(own))] }
  }

  if (type === 'shift.assign') {
    if (!allowed(role, ['operations', 'manager'])) deny()
    const shift = data.shifts.find((item) => item.id === payload.shiftId && own(item))
    if (!shift) throw new CommandError(404, 'NOT_FOUND', 'Shift not found')
    if (shift.published) throw new CommandError(409, 'INVALID_STATE', 'Published shifts cannot be edited')
    if (!['early', 'day', 'late', 'off'].includes(payload.assigned)) throw new CommandError(400, 'INVALID_INPUT', 'Unknown shift slot')
    const before = snapshot(shift); shift.assigned = payload.assigned
    shift.conflict = shift.unavailable.includes(shift.assigned) ? 'unavailable' : shift.assigned !== shift.wish ? 'wish' : null
    return { data, events: [event('shift.assigned', shift.id, `Assigned ${shift.assigned}`, before, shift)] }
  }

  if (type === 'shift.publish') {
    if (!allowed(role, ['operations', 'manager'])) deny()
    const shifts = data.shifts.filter(own)
    if (!shifts.length) throw new CommandError(409, 'INVALID_STATE', 'No shifts to publish')
    if (shifts.some((item) => item.published)) throw new CommandError(409, 'INVALID_STATE', 'Schedule is already published')
    if (shifts.some((item) => item.conflict === 'unavailable')) throw new CommandError(409, 'CONSTRAINT_VIOLATION', 'Resolve unavailable assignments before publishing')
    for (const slot of ['early', 'day', 'late']) if (shifts.filter((item) => item.assigned === slot).length < 1) throw new CommandError(409, 'STAFFING_GAP', `At least one person is required for ${slot}`)
    const before = snapshot(shifts); for (const shift of shifts) shift.published = true
    return { data, events: [event('shift.published', tenantId, 'Published the validated shift schedule', before, shifts)] }
  }

  if (type === 'incident.escalate') {
    if (!allowed(role, ['operations', 'manager'])) deny()
    const incident = data.incidents.find((item) => item.id === payload.incidentId && own(item))
    if (!incident) throw new CommandError(404, 'NOT_FOUND', 'Incident not found')
    if (incident.status !== 'open') throw new CommandError(409, 'INVALID_STATE', 'Only open incidents can be escalated')
    const before = snapshot(incident); incident.status = 'escalated'; incident.timeline.push({ at: now, actor: identity.name, body: required(payload.comment, 'comment', 1000) })
    return { data, events: [event('incident.escalated', incident.id, 'Escalated incident', before, incident)] }
  }

  if (type === 'incident.resolve') {
    if (!allowed(role, ['operations', 'manager'])) deny()
    const incident = data.incidents.find((item) => item.id === payload.incidentId && own(item))
    if (!incident) throw new CommandError(404, 'NOT_FOUND', 'Incident not found')
    if (!['open', 'escalated'].includes(incident.status)) throw new CommandError(409, 'INVALID_STATE', 'Only active incidents can be resolved')
    const before = snapshot(incident); incident.status = 'resolved'; incident.timeline.push({ at: now, actor: identity.name, body: required(payload.comment, 'resolution', 1000) })
    return { data, events: [event('incident.resolved', incident.id, 'Resolved incident', before, incident)] }
  }

  if (type === 'incident.postmortem') {
    if (!allowed(role, ['operations', 'manager'])) deny()
    const incident = data.incidents.find((item) => item.id === payload.incidentId && own(item))
    if (!incident) throw new CommandError(404, 'NOT_FOUND', 'Incident not found')
    if (incident.status !== 'resolved') throw new CommandError(409, 'INVALID_STATE', 'Resolve the incident before creating a postmortem')
    if (incident.postmortem) throw new CommandError(409, 'INVALID_STATE', 'Postmortem already exists')
    const before = snapshot(incident)
    incident.postmortem = { summary: required(payload.summary, 'summary', 1000), rootCause: required(payload.rootCause, 'rootCause', 1000), actions: required(payload.actions, 'actions', 1000), createdAt: now, actorId }
    return { data, events: [event('incident.postmortem.created', incident.id, 'Created incident postmortem', before, incident)] }
  }

  if (type === 'admin.reset') {
    if (role !== 'admin') deny()
    if (typeof options.resetData !== 'function') throw new Error('Reset factory is unavailable')
    const before = { sampleData: data.sampleData, recordCount: countRecords(data) }
    const next = options.resetData(payload.sample !== false)
    const actor = next.users.find((item) => item.id === actorId)
    if (!actor) next.users.push(data.users.find((item) => item.id === actorId))
    return { data: next, events: [event('tenant.reset', tenantId, payload.sample === false ? 'Reset tenant without sample records' : 'Reset tenant with sample records', before, { sampleData: next.sampleData, recordCount: countRecords(next) })] }
  }

  throw new CommandError(400, 'UNKNOWN_COMMAND', 'Unknown command')
}

function countRecords(data) {
  return ['customers', 'opportunities', 'orders', 'inventory', 'projects', 'approvals', 'shifts', 'incidents'].reduce((sum, key) => sum + (data[key]?.length ?? 0), 0)
}
