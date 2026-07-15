import { useEffect, useMemo, useState } from 'react'
import { useAction } from 'murasaki'
import type { Metadata } from 'murasaki'
import { Check, ChevronDown, Copy, RefreshCw, Server, Trash2 } from 'lucide-react'
import { runHealthCheck } from '@/lib/health-action'

export const metadata: Metadata = { title: 'Local Signal' }

type ApiHealth = { status: string; service: string; runtime: string; timestamp: string }
type Service = { name: string; endpoint: string; status: 'Healthy' | 'Degraded' | 'Offline'; tone: 'green' | 'amber' | 'red' }
const services: Service[] = [
  { name: 'Web app', endpoint: 'localhost:3000', status: 'Healthy', tone: 'green' },
  { name: 'API', endpoint: 'localhost:4317', status: 'Degraded', tone: 'amber' },
  { name: 'Worker', endpoint: 'localhost:8787', status: 'Offline', tone: 'red' },
]

type RequestEntry = [string, string, string, string, string, string]

const seedRequests: RequestEntry[] = [
  ['10:24:31.123', 'API', 'GET /api/health', '200 OK', '187ms', 'green'],
  ['10:24:22.887', 'API', 'POST /actions/check', '503 Service Unavailable', '1.24s', 'red'],
  ['10:24:12.532', 'Web app', 'GET /api/health', '200 OK', '92ms', 'green'],
  ['10:24:02.311', 'API', 'GET /api/health', '200 OK', '163ms', 'green'],
  ['10:23:52.104', 'Worker', 'GET /api/health', 'ECONNREFUSED', '1.01s', 'red'],
]

export default function SignalPage() {
  const [selected, setSelected] = useState(services[1])
  const [api, setApi] = useState<ApiHealth | null>(null)
  const [requests, setRequests] = useState<RequestEntry[]>(seedRequests)
  const [copied, setCopied] = useState(false)
  const [state, action, isPending] = useAction(runHealthCheck, { data: null, error: null, isPending: false })

  useEffect(() => {
    void fetch('/api/health').then((response) => response.json()).then((data: ApiHealth) => setApi(data))
  }, [])

  useEffect(() => {
    if (!state.data) return
    const time = new Date(state.data.checkedAt).toLocaleTimeString('en-US', { hour12: false })
    setSelected((current) => ({ ...current, status: 'Healthy', tone: 'green' }))
    setRequests((current) => [[time, 'API', 'POST /actions/check', '200 OK', `${state.data?.duration ?? 0}ms`, 'green'], ...current])
  }, [state.data])

  const responseBody = useMemo(() => JSON.stringify(api ?? {
    status: 'loading', service: 'murasaki-showcase', runtime: 'Node runtime bundled', timestamp: '—',
  }, null, 2), [api])

  const copyEndpoint = async () => {
    await navigator.clipboard.writeText(selected.endpoint)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }

  return (
    <main className="signal-app">
      <aside className="signal-sidebar">
        <div className="signal-brand"><span className="signal-glyph" aria-hidden>∿</span><strong>Local Signal</strong></div>
        <div className="sidebar-label">SERVICES</div>
        <div className="service-list">
          {services.map((service) => {
            const visible = service.name === selected.name ? selected : service
            return (
              <button key={service.name} className={`service-row ${service.name === selected.name ? 'is-selected' : ''}`} onClick={() => setSelected(service)}>
                <i className={`status-dot status-dot--${visible.tone}`} />
                <span><strong>{visible.name}</strong><small>{visible.endpoint}</small></span>
                <em className={`status-text status-text--${visible.tone}`}>{visible.status}</em>
              </button>
            )
          })}
        </div>
        <div className="runtime-lockup"><i /> Node runtime bundled</div>
      </aside>

      <section className="signal-main">
        <header className="signal-header">
          <div><div className="signal-heading"><i className={`status-dot status-dot--${selected.tone}`} /><h1>{selected.name}</h1><span className={`status-text status-text--${selected.tone}`}>{selected.status}</span></div><code>{selected.endpoint}</code></div>
          <form action={action}><button className="health-button" disabled={isPending}>{isPending ? <RefreshCw className="is-spinning" size={17} /> : <RefreshCw size={17} />} {isPending ? 'Checking…' : 'Run health check'}</button></form>
        </header>

        <div className="signal-tabs"><span className="is-active">Overview</span><span>Details</span></div>

        <section className="service-detail">
          <div className="detail-meta">
            <h2>Service details</h2>
            <dl>
              <div><dt>Endpoint URL</dt><dd><code>{selected.endpoint}</code><button onClick={() => void copyEndpoint()} aria-label="Copy endpoint">{copied ? <Check size={15} /> : <Copy size={15} />}</button></dd></div>
              <div><dt>Runtime</dt><dd><code>{state.data?.node ?? api?.runtime ?? 'Node runtime bundled'}</code></dd></div>
              <div><dt>Health check</dt><dd><code>GET /api/health</code></dd></div>
              <div><dt>Status</dt><dd><span className={`status-text status-text--${selected.tone}`}>{selected.status}</span></dd></div>
            </dl>
          </div>
          <div className="response-panel">
            <div className="response-title"><h2>Last response</h2><span><strong>200 OK</strong>{state.data ? `${state.data.duration}ms` : '187ms'}</span></div>
            <pre>{responseBody}</pre>
          </div>
        </section>

        <section className="request-panel">
          <div className="request-title"><h2>Request timeline</h2><button onClick={() => setRequests([])}>Clear log <Trash2 size={14} /></button></div>
          <div className="request-head"><span>Time</span><span>Service</span><span>Method &amp; path</span><span>Status</span><span>Duration</span><span /></div>
          <div className="request-list">
            {requests.length ? requests.map((request, index) => (
              <div className="request-row" key={`${request[0]}-${index}`}>
                <code>{request[0]}</code><span>{request[1]}</span><code className="request-path">{request[2]}</code><code className={`request-status request-status--${request[5]}`}>{request[3]}</code><code>{request[4]}</code><ChevronDown size={15} />
              </div>
            )) : <div className="request-empty"><Server size={18} /> Run a health check to add a request.</div>}
          </div>
        </section>

        <footer className="signal-footer"><span>API Route: <code>src/api/health/route.ts</code></span><span>Server Action: <code>src/lib/health-action.ts</code></span></footer>
      </section>
    </main>
  )
}
