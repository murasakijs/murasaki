import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { emptyData, initialSession } from '@/data/sample'
import type { AppData, AuthSession, Locale, ModuleId, PendingCommand, SessionState, StateEnvelope, SyncState, Tenant, User } from '@/domain/types'
import { canAccess, canMutate } from '@/domain/workflow'
import { translate, type TranslationKey } from '@/lib/i18n'

interface OrgliaContextValue {
  data: AppData
  revision: number
  session: SessionState
  auth: AuthSession | null
  authenticated: boolean
  authLoading: boolean
  currentUser: User
  currentTenant: Tenant
  syncState: SyncState
  syncMessage: string
  toast: string
  login: (email: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  retryPending: () => Promise<void>
  dismissSyncError: () => void
  t: (key: TranslationKey) => string
  setModule: (id: ModuleId) => void
  setSelected: (id?: string) => void
  setLocale: (locale: Locale) => void
  setFilter: (key: keyof SessionState['filters'], value: string) => void
  moveWidget: (id: string, direction: -1 | 1) => void
  toggleWidgetSize: (id: string) => void
  allowed: (moduleId: ModuleId) => boolean
  mutable: (area: string) => boolean
  convert: (opportunityId: string) => Promise<void>
  receive: (sku: string, quantity: number) => Promise<void>
  allocate: (orderId: string) => Promise<void>
  book: (orderId: string) => Promise<void>
  decide: (requestId: string, decision: 'approve' | 'return' | 'reject', comment: string) => Promise<void>
  createRequest: (input: { title: string; amount: number; reason: string }) => Promise<void>
  editRequest: (requestId: string, input: { title: string; amount: number; reason: string }) => Promise<void>
  resubmitRequest: (requestId: string) => Promise<void>
  commentApproval: (requestId: string, comment: string) => Promise<void>
  suggestShifts: () => Promise<void>
  assignShift: (shiftId: string, assigned: string) => Promise<void>
  publishSchedule: () => Promise<void>
  incidentAction: (incidentId: string, action: 'escalate' | 'resolve', comment: string) => Promise<void>
  createPostmortem: (incidentId: string, input: { summary: string; rootCause: string; actions: string }) => Promise<void>
  reset: (withSample?: boolean) => Promise<void>
}

const OrgliaContext = createContext<OrgliaContextValue | null>(null)
const PREFS_KEY = 'orglia:preferences:v2'
const placeholderTenant: Tenant = { id: '', name: '', region: '' }
const placeholderUser: User = { id: '', tenantId: '', name: '', email: '', role: 'viewer', team: '' }

function readPreferences(): SessionState {
  if (typeof window === 'undefined') return initialSession
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<SessionState>
    return { ...initialSession, ...stored, filters: { ...initialSession.filters, ...stored.filters }, widgetSizes: { ...initialSession.widgetSizes, ...stored.widgetSizes } }
  } catch { return initialSession }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error ?? `Request failed (${response.status})`) as Error & { status: number; code?: string }
    error.status = response.status; error.code = payload.code
    throw error
  }
  return payload as T
}

export function OrgliaProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData)
  const [revision, setRevision] = useState(0)
  const [session, setSession] = useState<SessionState>(readPreferences)
  const [auth, setAuth] = useState<AuthSession | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [syncState, setSyncState] = useState<SyncState>('loading')
  const [syncMessage, setSyncMessage] = useState('')
  const [pending, setPending] = useState<PendingCommand | null>(null)
  const [toast, setToast] = useState('')

  const currentTenant = auth?.tenant ?? placeholderTenant
  const currentUser = auth?.user ?? placeholderUser
  const t = useCallback((key: TranslationKey) => translate(session.locale, key), [session.locale])

  const acceptState = useCallback((state: StateEnvelope) => {
    setData(state.data); setRevision(state.revision); setSyncState('ready'); setSyncMessage('')
  }, [])

  useEffect(() => {
    try { localStorage.removeItem('orglia:data:v1'); localStorage.removeItem('orglia:session:v1') } catch { /* storage can be disabled */ }
    api<{ session: AuthSession; state: StateEnvelope }>('/api/session')
      .then((payload) => { setAuth(payload.session); acceptState(payload.state) })
      .catch((error: Error & { status?: number }) => {
        if (error.status !== 401) { setSyncState(navigator.onLine ? 'error' : 'offline'); setSyncMessage(error.message) }
        else setSyncState('ready')
      })
      .finally(() => setAuthLoading(false))
  }, [acceptState])

  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(session)) } catch { /* preferences remain in memory */ }
    document.documentElement.lang = session.locale
    document.title = session.locale === 'ja' ? 'Orglia — 統合業務ワークスペース' : 'Orglia — Integrated operations workspace'
  }, [session])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 3600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const refresh = useCallback(async () => {
    if (!auth) return
    try { acceptState(await api<StateEnvelope>('/api/state')); setPending(null) }
    catch (error) { setSyncState(navigator.onLine ? 'error' : 'offline'); setSyncMessage(error instanceof Error ? error.message : 'Sync failed') }
  }, [acceptState, auth])

  useEffect(() => {
    if (!auth) return
    const timer = window.setInterval(() => { if (navigator.onLine && syncState === 'ready') void refresh() }, 15_000)
    const offline = () => { setSyncState('offline'); setSyncMessage(t('offline')) }
    const online = () => void refresh()
    window.addEventListener('offline', offline); window.addEventListener('online', online)
    return () => { window.clearInterval(timer); window.removeEventListener('offline', offline); window.removeEventListener('online', online) }
  }, [auth, refresh, syncState, t])

  const runCommand = useCallback(async (command: PendingCommand, retryRevision = revision) => {
    if (!auth) return
    if (!navigator.onLine) { setPending(command); setSyncState('offline'); setSyncMessage(t('offline')); return }
    setSyncState('saving'); setSyncMessage('')
    try {
      const state = await api<StateEnvelope>('/api/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-orglia-request': '1' }, body: JSON.stringify({ revision: retryRevision, ...command }) })
      acceptState(state); setPending(null); setToast(t('saved'))
    } catch (error) {
      const apiError = error as Error & { status?: number; code?: string }
      if (apiError.status === 409 && apiError.code === 'REVISION_CONFLICT') {
        try { const latest = await api<StateEnvelope>('/api/state'); setData(latest.data); setRevision(latest.revision) } catch { /* keep conflict visible */ }
        setPending(command); setSyncState('conflict'); setSyncMessage(t('conflict'))
      } else {
        setPending(apiError.status && apiError.status < 500 ? null : command)
        setSyncState(navigator.onLine ? 'error' : 'offline'); setSyncMessage(apiError.message)
      }
    }
  }, [acceptState, auth, revision, t])

  const login = useCallback(async (email: string, password: string) => {
    setSyncState('loading'); setSyncMessage('')
    try {
      const payload = await api<{ session: AuthSession; state: StateEnvelope }>('/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-orglia-request': '1' }, body: JSON.stringify({ email, password }) })
      setAuth(payload.session); acceptState(payload.state); setAuthLoading(false); return true
    } catch (error) { setSyncState('error'); setSyncMessage(error instanceof Error ? error.message : 'Login failed'); setAuthLoading(false); return false }
  }, [acceptState])

  const logout = useCallback(async () => {
    const clearLocalSession = () => {
      setAuth(null); setData(emptyData); setRevision(0); setPending(null); setSession((current) => ({ ...initialSession, locale: current.locale })); setSyncState('ready')
    }
    try {
      await api('/api/logout', { method: 'POST', headers: { 'x-orglia-request': '1' } })
      clearLocalSession()
    } catch (error) {
      const apiError = error as Error & { status?: number }
      // A 401 proves the server session is already gone. Network/5xx failures
      // do not: retain the authenticated UI so it cannot silently reappear on
      // the next /api/session refresh after a false local sign-out.
      if (apiError.status === 401) clearLocalSession()
      else {
        setSyncState(navigator.onLine ? 'error' : 'offline')
        setSyncMessage(apiError.message || 'Sign out failed')
      }
    }
  }, [])

  const value = useMemo<OrgliaContextValue>(() => ({
    data, revision, session, auth, authenticated: Boolean(auth), authLoading, currentUser, currentTenant, syncState, syncMessage, toast, login, logout, refresh,
    async retryPending() { if (pending) await runCommand(pending, revision); else await refresh() },
    dismissSyncError() { setPending(null); setSyncState('ready'); setSyncMessage('') },
    t,
    setModule(id) {
      if (!canAccess(currentUser.role, id)) { setToast(t('restricted')); return }
      setSession((current) => ({ ...current, activeModule: id, selectedId: undefined }))
    },
    setSelected(id) { setSession((current) => ({ ...current, selectedId: id })) },
    setLocale(locale) { setSession((current) => ({ ...current, locale })) },
    setFilter(key, fieldValue) { setSession((current) => ({ ...current, filters: { ...current.filters, [key]: fieldValue } as SessionState['filters'] })) },
    moveWidget(id, direction) {
      setSession((current) => { const next = [...current.widgetOrder]; const index = next.indexOf(id); const target = index + direction; if (index < 0 || target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return { ...current, widgetOrder: next } })
    },
    toggleWidgetSize(id) { setSession((current) => ({ ...current, widgetSizes: { ...current.widgetSizes, [id]: current.widgetSizes[id] === 'wide' ? 'single' : 'wide' } })) },
    allowed: (id) => canAccess(currentUser.role, id),
    mutable: (area) => canMutate(currentUser.role, area),
    convert: (opportunityId) => runCommand({ type: 'opportunity.convert', payload: { opportunityId } }),
    receive: (sku, quantity) => runCommand({ type: 'inventory.receive', payload: { sku, quantity } }),
    allocate: (orderId) => runCommand({ type: 'order.allocate', payload: { orderId } }),
    book: (orderId) => runCommand({ type: 'order.book', payload: { orderId } }),
    decide: (requestId, decision, comment) => runCommand({ type: 'approval.decide', payload: { requestId, decision, comment } }),
    createRequest: (input) => runCommand({ type: 'approval.create', payload: input }),
    editRequest: (requestId, input) => runCommand({ type: 'approval.edit', payload: { requestId, ...input } }),
    resubmitRequest: (requestId) => runCommand({ type: 'approval.resubmit', payload: { requestId } }),
    commentApproval: (requestId, comment) => runCommand({ type: 'approval.comment', payload: { requestId, comment } }),
    suggestShifts: () => runCommand({ type: 'shift.propose', payload: {} }),
    assignShift: (shiftId, assigned) => runCommand({ type: 'shift.assign', payload: { shiftId, assigned } }),
    publishSchedule: () => runCommand({ type: 'shift.publish', payload: {} }),
    incidentAction: (incidentId, action, comment) => runCommand({ type: `incident.${action}`, payload: { incidentId, comment } }),
    createPostmortem: (incidentId, input) => runCommand({ type: 'incident.postmortem', payload: { incidentId, ...input } }),
    reset: (withSample = true) => runCommand({ type: 'admin.reset', payload: { sample: withSample } }),
  }), [auth, authLoading, currentTenant, currentUser, data, login, logout, pending, refresh, revision, runCommand, session, syncMessage, syncState, t, toast])

  return <OrgliaContext.Provider value={value}>{children}</OrgliaContext.Provider>
}

export function useOrglia() {
  const context = useContext(OrgliaContext)
  if (!context) throw new Error('useOrglia must be used inside OrgliaProvider')
  return context
}
