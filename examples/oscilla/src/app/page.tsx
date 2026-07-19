'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { subscribeMainEvent } from 'murasaki/main-client'
import { secureStorage } from 'murasaki/native'
import {
  configureMock, executeRequest, followDockerContainer, getDockerContainers,
  getRuntimeSnapshot, importDocument, resetWorkspace, runScenario, saveWorkspace,
  importLocalLog, stopDockerLogs, stopLocalLog,
} from '../backend/workbench'
import type {
  EnvironmentName, LogLevel, MockMode, Protocol, RequestDraft, ResponseRecord, RuntimeSnapshot,
  ScenarioDefinition, ScenarioResult, ScenarioStep, TimelineEvent, WorkspaceState, WorkspaceView,
} from '../lib/types'

type Locale = 'en' | 'ja'
type RuntimePush = Pick<RuntimeSnapshot, 'health' | 'docker' | 'localLog' | 'mockMode'>

const copy = {
  en: {
    request: 'Request', collections: 'Collections', scenarios: 'Scenarios', mock: 'Mock Server', environments: 'Environments', history: 'History', settings: 'Settings',
    send: 'Send', sending: 'Sending…', import: 'Import', reset: 'Reset', online: 'LIVE', offline: 'OFFLINE', response: 'Response', timeline: 'Timeline',
    localLogs: 'Local logs', dockerLogs: 'Docker logs', allTraffic: 'All traffic', level: 'Level', service: 'Service', requestId: 'Request ID', all: 'All',
    body: 'Body', headers: 'Headers', auth: 'Auth', params: 'Params', steps: 'Steps', assertions: 'Assertions', runScenario: 'Run scenario',
    normal: 'Normal', delayed: 'Delayed', error: 'Error', attach: 'Attach', detach: 'Detach', discover: 'Discover', selectLog: 'Select log file', connecting: 'Connecting…',
    vault: 'OS credential vault', saveToken: 'Save token', loadToken: 'Load token', saved: 'Credential stored in OS vault', explicitSample: 'EXPLICIT SAMPLE',
    empty: 'No sample data (--no-sample-data)', noResponse: 'Send a request to inspect its response.', clearFilters: 'Clear filters',
    resetConfirm: 'Reset persisted workspace, history, scenarios, imports, and mock configuration?', saveRequest: 'Save request', newRequest: 'New request',
    workspaceSaved: 'Workspace saved', addScenario: 'Add scenario', addStep: 'Add step', saveScenario: 'Save scenario', remove: 'Remove',
    importedDocs: 'Imported documents', variables: 'Variables', baseUrl: 'Base URL', runtime: 'Runtime status', persisted: 'Persisted workspace',
    chooseRequest: 'Choose request', expectedStatus: 'Expected status', extractVariable: 'Extract variable', jsonPath: 'JSON path', noItems: 'Nothing here yet.',
    scenarioName: 'Scenario name', openApiPersisted: 'OpenAPI documents persisted', totalRequests: 'total requests', retainedEvents: 'retained snapshot events', prettify: 'Prettify', characters: 'chars', starting: 'Starting…', runtimeConnected: 'Local runtime connected', following: 'Following live output', importedLog: 'Imported snapshot', notAttached: 'Not attached',
  },
  ja: {
    request: 'リクエスト', collections: 'コレクション', scenarios: 'シナリオ', mock: 'モックサーバー', environments: '環境', history: '履歴', settings: '設定',
    send: '送信', sending: '送信中…', import: '取込', reset: 'リセット', online: '稼働中', offline: '停止中', response: 'レスポンス', timeline: 'タイムライン',
    localLogs: 'ローカルログ', dockerLogs: 'Dockerログ', allTraffic: 'すべての通信', level: 'レベル', service: 'サービス', requestId: 'リクエストID', all: 'すべて',
    body: '本文', headers: 'ヘッダー', auth: '認証', params: 'パラメータ', steps: 'ステップ', assertions: '検証', runScenario: 'シナリオ実行',
    normal: '正常', delayed: '遅延', error: 'エラー', attach: '接続', detach: '切断', discover: '検索', selectLog: 'ログファイル選択', connecting: '接続中…',
    vault: 'OS資格情報保管庫', saveToken: 'トークン保存', loadToken: 'トークン読込', saved: 'OS保管庫へ保存しました', explicitSample: '明示サンプル',
    empty: 'サンプルなし（--no-sample-data）', noResponse: 'リクエストを送信するとレスポンスを確認できます。', clearFilters: '絞込解除',
    resetConfirm: '保存済みワークスペース、履歴、シナリオ、取込内容、モック設定をリセットしますか？', saveRequest: 'リクエスト保存', newRequest: '新規リクエスト',
    workspaceSaved: 'ワークスペースを保存しました', addScenario: 'シナリオ追加', addStep: 'ステップ追加', saveScenario: 'シナリオ保存', remove: '削除',
    importedDocs: '取込ドキュメント', variables: '変数', baseUrl: 'ベースURL', runtime: 'ランタイム状態', persisted: '保存済みワークスペース',
    chooseRequest: 'リクエスト選択', expectedStatus: '期待ステータス', extractVariable: '抽出変数', jsonPath: 'JSONパス', noItems: '項目はありません。',
    scenarioName: 'シナリオ名', openApiPersisted: '保存済みOpenAPIドキュメント', totalRequests: '件のリクエスト', retainedEvents: '件の保存済みイベント', prettify: '整形', characters: '文字', starting: '起動中…', runtimeConnected: 'ローカルランタイム接続済み', following: 'ライブ出力を追跡中', importedLog: 'スナップショット取込済み', notAttached: '未接続',
  },
} as const

function Icon({ name }: { name: 'pulse' | 'request' | 'layers' | 'scenario' | 'server' | 'clock' | 'settings' | 'send' | 'import' }) {
  const paths = {
    pulse: <path d="M2 12h4l2-7 4 14 3-10 2 6h5" />, request: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 13h5" /></>,
    layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
    scenario: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 6h6a4 4 0 0 1 4 4v6M6 8v8h8" /></>,
    server: <><rect x="3" y="4" width="18" height="6" rx="1" /><rect x="3" y="14" width="18" height="6" rx="1" /><path d="M7 7h.01M7 17h.01M11 7h7M11 17h7" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, settings: <><circle cx="12" cy="12" r="3" /><path d="M19 15.5 21 17l-4 4-1.5-2a8 8 0 0 1-3.5 1L11 23H7l-1-3a8 8 0 0 1-2-2l-3 1v-5l3-1a8 8 0 0 1 0-3L1 9V4l3 1a8 8 0 0 1 2-2l1-3h4l1 3a8 8 0 0 1 3.5 1L17 2l4 4-2 1.5a8 8 0 0 1 0 8Z" /></>,
    send: <path d="m3 11 18-8-8 18-2-8-8-2Zm8 2 4-4" />, import: <><path d="M12 3v12m0 0 4-4m-4 4-4-4" /><path d="M4 19h16" /></>,
  }
  return <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}

function formatBody(body: string) { try { return JSON.stringify(JSON.parse(body), null, 2) } catch { return body } }
function emptyRequest(): RequestDraft { return { id: `request-${Date.now()}`, name: 'Untitled request', protocol: 'REST', method: 'GET', url: '', headers: {}, body: '' } }

export default function Page() {
  const [locale, setLocale] = useState<Locale>('en'); const t = copy[locale]
  const [runtime, setRuntime] = useState<RuntimeSnapshot | null>(null)
  const [workspace, setWorkspaceState] = useState<WorkspaceState | null>(null)
  const [draft, setDraft] = useState<RequestDraft>(emptyRequest)
  const [view, setView] = useState<WorkspaceView>('request')
  const [environment, setEnvironment] = useState<EnvironmentName>('dev')
  const [response, setResponse] = useState<ResponseRecord | null>(null)
  const [editorTab, setEditorTab] = useState<'Body' | 'Headers' | 'Auth' | 'Params'>('Body')
  const [timelineTab, setTimelineTab] = useState<'all' | 'APP' | 'LOCAL' | 'DOCKER'>('all')
  const [levelFilter, setLevelFilter] = useState<'all' | LogLevel>('all')
  const [serviceFilter, setServiceFilter] = useState(''); const [requestFilter, setRequestFilter] = useState('')
  const [token, setToken] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false)
  const [scenarioId, setScenarioId] = useState(''); const [scenarioResults, setScenarioResults] = useState<ScenarioResult[]>([])
  const [dockerContainer, setDockerContainer] = useState(''); const [dockerContainers, setDockerContainers] = useState<string[]>([])
  const importRef = useRef<HTMLInputElement>(null)
  const localLogRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    void getRuntimeSnapshot().then((snapshot) => {
      if (!active) return
      setRuntime(snapshot); setWorkspaceState(snapshot.workspace)
      const selected = snapshot.workspace.requests.find((item) => item.id === snapshot.workspace.activeRequestId) ?? snapshot.workspace.requests[0]
      setDraft(selected ?? emptyRequest()); setScenarioId(snapshot.workspace.scenarios[0]?.id ?? '')
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : String(error)))
    const timelineUnsubscribe = subscribeMainEvent<TimelineEvent>('oscilla.timeline', (event) => setRuntime((current) => current ? { ...current, events: [...current.events.slice(-499), event] } : current))
    const runtimeUnsubscribe = subscribeMainEvent<RuntimePush>('oscilla.runtime', (push) => setRuntime((current) => current ? { ...current, ...push } : current))
    const workspaceUnsubscribe = subscribeMainEvent<WorkspaceState>('oscilla.workspace', (next) => setWorkspaceState(next))
    return () => { active = false; timelineUnsubscribe(); runtimeUnsubscribe(); workspaceUnsubscribe() }
  }, [])

  const activeEnvironment = workspace?.environments.find((item) => item.name === environment) ?? { name: environment, baseUrl: '' }
  const scenario = workspace?.scenarios.find((item) => item.id === scenarioId) ?? workspace?.scenarios[0]
  const filteredEvents = useMemo(() => (runtime?.events ?? []).filter((event) => {
    if (timelineTab !== 'all' && event.source !== timelineTab) return false
    if (levelFilter !== 'all' && event.level !== levelFilter) return false
    if (serviceFilter && !event.service.toLowerCase().includes(serviceFilter.toLowerCase())) return false
    return !requestFilter || event.requestId.toLowerCase().includes(requestFilter.toLowerCase())
  }), [runtime?.events, timelineTab, levelFilter, serviceFilter, requestFilter])

  async function persist(next: WorkspaceState, notice: string = t.workspaceSaved) {
    setWorkspaceState(next)
    try { const snapshot = await saveWorkspace(next); setRuntime(snapshot); setWorkspaceState(snapshot.workspace); setMessage(notice) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }

  async function saveDraft() {
    if (!workspace) return
    const exists = workspace.requests.some((item) => item.id === draft.id)
    const requests = exists ? workspace.requests.map((item) => item.id === draft.id ? draft : item) : [...workspace.requests, draft]
    await persist({ ...workspace, requests, activeRequestId: draft.id })
  }

  async function send() {
    if (!workspace) return
    setBusy(true); setMessage('')
    try { setResponse(await executeRequest({ ...draft, environment, baseUrl: activeEnvironment.baseUrl, bearerToken: token, variables: { ...workspace.variables, baseUrl: activeEnvironment.baseUrl } })) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function importFile(file: File) {
    try {
      const snapshot = await importDocument(await file.text())
      setRuntime(snapshot); setWorkspaceState(snapshot.workspace)
      const selected = snapshot.workspace.requests.find((item) => item.id === snapshot.workspace.activeRequestId)
      if (selected) setDraft(selected)
      setView('collections'); setMessage(`${file.name}: ${snapshot.workspace.requests.length} ${t.totalRequests}`)
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { if (importRef.current) importRef.current.value = '' }
  }

  function chooseRequest(request: RequestDraft) { setDraft(request); setView('request'); if (workspace) void persist({ ...workspace, activeRequestId: request.id }, request.name) }

  function updateScenario(next: ScenarioDefinition) {
    if (!workspace) return
    setWorkspaceState({ ...workspace, scenarios: workspace.scenarios.map((item) => item.id === next.id ? next : item) })
  }

  function requestForStep(requestId: string): ScenarioStep['request'] {
    const request = workspace?.requests.find((item) => item.id === requestId) ?? emptyRequest()
    return { ...request, environment, baseUrl: activeEnvironment.baseUrl, variables: { ...(workspace?.variables ?? {}), baseUrl: activeEnvironment.baseUrl } }
  }

  function addScenario() {
    if (!workspace) return
    const next: ScenarioDefinition = { id: `scenario-${Date.now()}`, name: 'New scenario', steps: [] }
    setWorkspaceState({ ...workspace, scenarios: [...workspace.scenarios, next] }); setScenarioId(next.id); setView('scenarios')
  }

  function addStep() {
    if (!scenario || !workspace?.requests[0]) return
    updateScenario({ ...scenario, steps: [...scenario.steps, { id: `step-${Date.now()}`, name: workspace.requests[0].name, request: requestForStep(workspace.requests[0].id), assertions: [{ kind: 'status', operator: 'eq', expected: 200 }] }] })
  }

  async function executeScenarioFlow() {
    if (!scenario) return
    setBusy(true); setScenarioResults([])
    try { setScenarioResults(await runScenario(scenario.steps)) } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  async function selectLocalLog(file: File) {
    try {
      if (file.size > 1024 * 1024) throw new Error('Log snapshot exceeds the 1 MiB import limit')
      const localLog = await importLocalLog(file.name, await file.text())
      setRuntime((current) => current ? { ...current, localLog } : current)
    } catch (error) { setMessage(`Local log unavailable: ${error instanceof Error ? error.message : String(error)}`) }
    finally { if (localLogRef.current) localLogRef.current.value = '' }
  }

  async function reset() {
    if (!window.confirm(t.resetConfirm)) return
    try { const snapshot = await resetWorkspace(); setRuntime(snapshot); setWorkspaceState(snapshot.workspace); setDraft(snapshot.workspace.requests[0] ?? emptyRequest()); setScenarioId(snapshot.workspace.scenarios[0]?.id ?? ''); setResponse(null); setScenarioResults([]); setMessage(t.workspaceSaved) }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }

  const navItems: Array<[WorkspaceView, Parameters<typeof Icon>[0]['name'], keyof typeof t]> = [
    ['request', 'request', 'request'], ['collections', 'layers', 'collections'], ['scenarios', 'scenario', 'scenarios'], ['mock', 'server', 'mock'],
    ['environments', 'settings', 'environments'], ['history', 'clock', 'history'], ['settings', 'settings', 'settings'],
  ]

  return <main className="oscilla-shell">
    <header className="topbar">
      <div className="brand"><strong>OSCILLA</strong><span>API Workbench</span></div><div className="signal-logo" aria-hidden="true"><Icon name="pulse" /></div>
      <div className={`runtime-status ${runtime?.health.ready ? 'ready' : 'offline'}`}><span className={runtime?.health.ready ? 'live-dot' : 'offline-dot'} /><b>{runtime?.health.ready ? t.online : t.offline}</b><span>{runtime?.health.ready ? t.runtimeConnected : runtime?.health.message ?? t.starting}</span><span className="sparkline">⌁⌁⌁∿⌁∿⌁</span></div>
      <label className="top-control">{t.environments}<select value={environment} onChange={(event) => setEnvironment(event.target.value as EnvironmentName)}>{workspace?.environments.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
      <div className="locale-toggle" aria-label="Language"><button aria-pressed={locale === 'en'} className={locale === 'en' ? 'active' : ''} onClick={() => setLocale('en')}>EN</button><button aria-pressed={locale === 'ja'} className={locale === 'ja' ? 'active' : ''} onClick={() => setLocale('ja')}>日本語</button></div>
      <button className="quiet-button" onClick={() => void reset()}>↻ {t.reset}</button>
    </header>

    <aside className="nav-rail" aria-label="Primary"><div className="rail-mark"><Icon name="pulse" /></div>{navItems.map(([itemView, icon, label]) => <button key={itemView} className={`nav-item ${view === itemView ? 'active' : ''}`} aria-current={view === itemView ? 'page' : undefined} onClick={() => setView(itemView)}><Icon name={icon} /><span>{t[label]}</span></button>)}<div className="db-status"><span className="db-icon">◉</span><b>SQLite</b><span className={runtime?.health.database === 'connected' ? 'live-dot' : 'offline-dot'} /><small>{runtime?.sqlitePath.split(/[\\/]/).pop() ?? 'connecting…'}</small></div></aside>

    {view === 'request' ? <section className="request-workspace">
      <div className="request-header"><div className="request-name"><small>{t.request.toUpperCase()}</small><input aria-label="Request name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />{runtime && <em>{runtime.sampleData ? t.explicitSample : t.empty}</em>}</div>
        <div className="protocol-tabs" role="tablist" aria-label="Protocol">{(['REST', 'GraphQL', 'WebSocket'] as Protocol[]).map((protocol) => <button id={`protocol-${protocol}`} aria-controls="protocol-panel" role="tab" aria-selected={draft.protocol === protocol} className={draft.protocol === protocol ? 'active' : ''} onClick={() => setDraft({ ...draft, protocol, method: protocol === 'GraphQL' ? 'POST' : draft.method })} key={protocol}>{protocol}</button>)}</div>
        <div className="request-id"><span>{t.requestId}</span><code>{response?.requestId ?? 'pending'}</code></div>
        <input ref={importRef} className="visually-hidden" type="file" accept=".json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file) }} />
        <button className="icon-button" onClick={() => importRef.current?.click()}><Icon name="import" /><span>{t.import}</span></button><button className="icon-button" onClick={() => { const next = emptyRequest(); setDraft(next); setResponse(null) }}>{t.newRequest}</button><button className="icon-button" onClick={() => void saveDraft()}>{t.saveRequest}</button><button className="send-button" disabled={busy || !draft.url || !runtime?.health.ready} onClick={() => void send()}><Icon name="send" />{busy ? t.sending : t.send}</button>
      </div>
      <div className="url-row" id="protocol-panel" role="tabpanel"><select aria-label="HTTP method" value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value })} disabled={draft.protocol !== 'REST'}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => <option key={method}>{method}</option>)}</select><input aria-label="Request URL" value={draft.url} onChange={(event) => setDraft({ ...draft, url: event.target.value })} placeholder={draft.protocol === 'WebSocket' ? 'ws://127.0.0.1:8080/socket' : 'https://api.example.com/v1/resource'} /></div>
      <div className="editor-tabs" role="tablist" aria-label="Request editor sections">{(['Params', 'Headers', 'Auth', 'Body'] as const).map((tab) => <button id={`editor-tab-${tab}`} aria-controls="request-editor-panel" role="tab" aria-selected={editorTab === tab} className={editorTab === tab ? 'active' : ''} onClick={() => setEditorTab(tab)} key={tab}>{t[tab.toLowerCase() as 'params' | 'headers' | 'auth' | 'body']}{tab === 'Headers' ? ` (${Object.keys(draft.headers).length})` : ''}</button>)}<span>application/json</span></div>
      <div className="editor-grid"><section id="request-editor-panel" role="tabpanel" className="request-editor" aria-label="Request editor">
        {editorTab === 'Body' && <textarea aria-label={t.body} spellCheck={false} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />}
        {editorTab === 'Headers' && <textarea aria-label={t.headers} spellCheck={false} value={JSON.stringify(draft.headers, null, 2)} onChange={(event) => { try { setDraft({ ...draft, headers: JSON.parse(event.target.value) as Record<string, string> }) } catch { /* keep last valid */ } }} />}
        {editorTab === 'Auth' && <div className="auth-editor"><label>{t.vault}<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="Bearer token" /></label><div><button onClick={() => void secureStorage.set(`oscilla.auth.${environment}`, token).then(() => setMessage(t.saved)).catch((error: unknown) => setMessage(String(error)))}>{t.saveToken}</button><button onClick={() => void secureStorage.get(`oscilla.auth.${environment}`).then((value) => setToken(value ?? '')).catch((error: unknown) => setMessage(String(error)))}>{t.loadToken}</button></div></div>}
        {editorTab === 'Params' && <div className="empty-editor"><label>{t.baseUrl}<input value={activeEnvironment.baseUrl} readOnly /></label><p>{Object.entries(workspace?.variables ?? {}).map(([key, value]) => `${key}=${value}`).join(' · ') || t.noItems}</p></div>}
        <footer><span>JSON</span><button onClick={() => setDraft({ ...draft, body: formatBody(draft.body) })}>⌁ {t.prettify}</button><span>{draft.body.length} {t.characters}</span></footer>
      </section><section className="response-editor" aria-label={t.response}><div className="response-meta">{response ? <><strong className={response.ok ? 'success' : 'danger'}>{response.status} {response.statusText}</strong><span>{response.latencyMs} ms</span><span>{(response.sizeBytes / 1024).toFixed(2)} KB</span></> : <strong>{t.response}</strong>}</div><div className="response-tabs"><b>{t.body}</b><span>{t.headers} ({response ? Object.keys(response.headers).length : 0})</span><span>{t.timeline}</span></div><pre>{response ? formatBody(response.body) : t.noResponse}</pre><div className="amplitude" aria-hidden="true"><span>1.0</span><i /><span>0</span><i /><span>-1.0</span></div></section></div>
    </section> : <section className="request-workspace tool-workspace">{view === 'collections' && <><ToolHeader title={t.collections} detail={`${workspace?.requests.length ?? 0} requests`} /><div className="tool-scroll"><div className="tool-grid">{workspace?.collections.map((collection) => <section className="tool-card" key={collection.id}><h2>{collection.name}</h2>{collection.requestIds.map((id) => { const request = workspace.requests.find((item) => item.id === id); return request ? <button className="request-row" key={id} onClick={() => chooseRequest(request)}><code>{request.method}</code><span>{request.name}</span><small>{request.url}</small></button> : null })}</section>)}</div><h2 className="section-heading">{t.importedDocs}</h2>{workspace?.importedDocuments.map((document) => <div className="document-row" key={document.id}><b>{document.kind.toUpperCase()}</b><span>{document.title}</span><small>{new Date(document.importedAt).toLocaleString(locale)}</small><code>{document.requestIds.length} requests</code></div>)}</div></>}
      {view === 'scenarios' && <><ToolHeader title={t.scenarios} detail={t.persisted} actions={<><button onClick={addScenario}>{t.addScenario}</button><button disabled={!scenario || !workspace} onClick={() => scenario && workspace && void persist({ ...workspace, scenarios: workspace.scenarios.map((item) => item.id === scenario.id ? scenario : item) })}>{t.saveScenario}</button></>} /><div className="scenario-author"><label>{t.scenarios}<select value={scenario?.id ?? ''} onChange={(event) => setScenarioId(event.target.value)}>{workspace?.scenarios.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>{scenario && <><label>{t.scenarioName}<input value={scenario.name} onChange={(event) => updateScenario({ ...scenario, name: event.target.value })} /></label><div className="author-steps">{scenario.steps.map((step, index) => <div className="author-step" key={step.id}><b>{index + 1}</b><label>{t.chooseRequest}<select value={step.request.id} onChange={(event) => { const request = requestForStep(event.target.value); const steps = scenario.steps.map((item, itemIndex) => itemIndex === index ? { ...item, name: request.name, request } : item); updateScenario({ ...scenario, steps }) }}>{workspace?.requests.map((request) => <option value={request.id} key={request.id}>{request.name}</option>)}</select></label><label>{t.expectedStatus}<input type="number" value={step.assertions.find((item) => item.kind === 'status')?.expected ?? 200} onChange={(event) => { const expected = Number(event.target.value); updateScenario({ ...scenario, steps: scenario.steps.map((item, itemIndex) => itemIndex === index ? { ...item, assertions: [{ kind: 'status', operator: 'eq', expected }] } : item) }) }} /></label><label>{t.extractVariable}<input value={step.extract?.variable ?? ''} onChange={(event) => updateScenario({ ...scenario, steps: scenario.steps.map((item, itemIndex) => itemIndex === index ? { ...item, extract: event.target.value ? { variable: event.target.value, path: item.extract?.path ?? '$.id' } : undefined } : item) })} /></label><label>{t.jsonPath}<input value={step.extract?.path ?? ''} onChange={(event) => updateScenario({ ...scenario, steps: scenario.steps.map((item, itemIndex) => itemIndex === index ? { ...item, extract: item.extract ? { ...item.extract, path: event.target.value } : undefined } : item) })} /></label><button onClick={() => updateScenario({ ...scenario, steps: scenario.steps.filter((_, itemIndex) => itemIndex !== index) })}>{t.remove}</button></div>)}</div><button className="add-step" onClick={addStep}>{t.addStep}</button></>}</div></>}
      {view === 'environments' && <><ToolHeader title={t.environments} detail={t.persisted} actions={<button disabled={!workspace} onClick={() => workspace && void persist(workspace)}>{t.workspaceSaved}</button>} /><div className="tool-scroll"><div className="environment-list">{workspace?.environments.map((item) => <label key={item.name}><b>{item.name}</b><span>{t.baseUrl}</span><input value={item.baseUrl} onChange={(event) => setWorkspaceState(workspace ? { ...workspace, environments: workspace.environments.map((environmentItem) => environmentItem.name === item.name ? { ...environmentItem, baseUrl: event.target.value } : environmentItem) } : workspace)} /></label>)}</div><h2 className="section-heading">{t.variables}</h2><textarea className="variables-editor" aria-label={t.variables} value={JSON.stringify(workspace?.variables ?? {}, null, 2)} onChange={(event) => { try { if (workspace) setWorkspaceState({ ...workspace, variables: JSON.parse(event.target.value) as Record<string, string> }) } catch { /* keep last valid */ } }} /></div></>}
      {view === 'mock' && <><ToolHeader title={t.mock} detail={runtime?.mockUrl ?? t.starting} /><div className="feature-state"><h2>{runtime?.health.mock === 'running' ? t.online : t.offline}</h2><p>{runtime?.health.ready ? t.runtimeConnected : runtime?.health.message}</p><p>{workspace?.importedDocuments.filter((item) => item.kind === 'openapi').length ?? 0} {t.openApiPersisted}</p></div></>}
      {view === 'history' && <><ToolHeader title={t.history} detail={`${runtime?.events.length ?? 0} ${t.retainedEvents}`} /><div className="feature-state"><h2>{t.timeline}</h2><p>SQLite: 5,000 · UI: 500</p><button onClick={() => document.querySelector('.timeline-panel')?.scrollIntoView()}>{t.timeline}</button></div></>}
      {view === 'settings' && <><ToolHeader title={t.settings} detail={t.runtime} /><div className="runtime-grid"><RuntimeFact label="Node Main" value={runtime?.health.ready ? t.online : t.offline} /><RuntimeFact label="SQLite" value={runtime?.health.database ?? 'starting'} /><RuntimeFact label={t.mock} value={runtime?.health.mock ?? 'starting'} /><RuntimeFact label={t.localLogs} value={runtime?.localLog.message ?? t.offline} /><RuntimeFact label={t.dockerLogs} value={runtime?.docker.message ?? t.offline} /><RuntimeFact label="Platform" value={navigator.platform} /></div></>}
    </section>}

    <aside className="scenario-panel"><div className="panel-title"><span>{t.scenarios.toUpperCase()}</span><select aria-label={t.scenarios} value={scenario?.id ?? ''} onChange={(event) => setScenarioId(event.target.value)}>{workspace?.scenarios.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div><div className="scenario-tabs"><b>{t.steps}</b><span>{t.assertions} ({scenario?.steps.flatMap((step) => step.assertions).length ?? 0})</span></div><ol className="steps">{scenario?.steps.map((step, index) => { const result = scenarioResults.find((item) => item.stepId === step.id); return <li key={step.id}><span className={`status-mark ${!result ? 'pending' : result.passed ? 'pass' : 'fail'}`} aria-label={!result ? 'pending' : result.passed ? 'pass' : 'fail'}>{!result ? '›' : result.passed ? '✓' : '!'}</span><span className="step-number">{index + 1}</span><div><strong>{step.name}</strong><code>{step.request.method} {step.request.url}</code>{step.extract && <small>{step.extract.path} → {step.extract.variable}</small>}</div><output>{result?.response?.status ?? '—'}</output></li> })}</ol><button className="scenario-run" disabled={busy || !scenario?.steps.length} onClick={() => void executeScenarioFlow()}>{busy ? t.sending : t.runScenario}</button>
      <section className="mock-control"><div className="mock-heading"><b>{t.mock.toUpperCase()}</b><span>{runtime?.health.mock === 'running' ? t.online : t.offline}</span></div><div className="mode-buttons">{(['normal', 'delayed', 'error'] as MockMode[]).map((mode) => <button className={runtime?.mockMode === mode ? `active ${mode}` : mode} aria-pressed={runtime?.mockMode === mode} onClick={() => void configureMock(mode).then((snapshot) => { setRuntime(snapshot); setWorkspaceState(snapshot.workspace) }).catch((error: unknown) => setMessage(String(error)))} key={mode}>{t[mode]}</button>)}</div><dl><div><dt>URL</dt><dd>{runtime?.mockUrl ?? t.starting}</dd></div><div><dt>{t.delayed}</dt><dd>{runtime?.mockMode === 'delayed' ? '1200 ms' : '0 ms'}</dd></div></dl></section>
      <section className="log-control"><div><b>{t.localLogs.toUpperCase()}</b><input ref={localLogRef} className="visually-hidden" type="file" accept=".log,.txt,.out,.jsonl,text/plain,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void selectLocalLog(file) }} /><button onClick={() => localLogRef.current?.click()}>{t.selectLog}</button></div><small className={runtime?.localLog.connected ? 'connected' : ''}>{runtime?.localLog.connected ? `${t.importedLog}: ${runtime.localLog.target ?? ''}` : t.notAttached}</small>{runtime?.localLog.connected && <button onClick={() => void stopLocalLog().then((localLog) => setRuntime((current) => current ? { ...current, localLog } : current))}>{t.detach}</button>}</section>
      <section className="docker-control"><div><b>{t.dockerLogs.toUpperCase()}</b><button onClick={() => void getDockerContainers().then((items) => { setDockerContainers(items); if (items[0]) setDockerContainer(items[0]) })}>{t.discover}</button></div><div className="docker-input"><input aria-label={t.dockerLogs} list="docker-containers" value={dockerContainer} onChange={(event) => setDockerContainer(event.target.value)} placeholder="container" /><datalist id="docker-containers">{dockerContainers.map((name) => <option key={name}>{name}</option>)}</datalist>{runtime?.docker.connected ? <button onClick={() => void stopDockerLogs().then((docker) => setRuntime((current) => current ? { ...current, docker } : current))}>{t.detach}</button> : <button disabled={!dockerContainer || runtime?.docker.connecting} onClick={() => void followDockerContainer(dockerContainer).then((docker) => setRuntime((current) => current ? { ...current, docker } : current))}>{runtime?.docker.connecting ? t.connecting : t.attach}</button>}</div><small className={runtime?.docker.connected ? 'connected' : ''}>{runtime?.docker.connected ? `${t.following}: ${runtime.docker.target ?? ''}` : runtime?.docker.connecting ? t.connecting : runtime?.docker.message === 'Not attached' ? t.notAttached : runtime?.docker.message ?? t.notAttached}</small></section>
    </aside>

    <section className="timeline-panel"><div className="timeline-tabs" role="tablist" aria-label={t.timeline}>{([['all', t.allTraffic], ['APP', 'APP'], ['LOCAL', t.localLogs], ['DOCKER', t.dockerLogs]] as const).map(([tab, label]) => <button role="tab" aria-selected={timelineTab === tab} className={timelineTab === tab ? 'active' : ''} onClick={() => setTimelineTab(tab)} key={tab}>{label}</button>)}<span><i className={runtime?.health.ready ? 'live-dot' : 'offline-dot'} /> {runtime?.health.ready ? t.online : t.offline} · {runtime?.events.length ?? 0}</span></div><div className="pulse-chart" aria-label={t.timeline}><div className="chart-labels"><span>HTTP</span><span>APP</span><span>LOCAL</span><span>ERROR</span></div><div className="chart-grid">{(runtime?.events ?? []).slice(-48).map((event) => <i key={event.id} className={`${event.source.toLowerCase()} ${event.level}`} title={event.summary} />)}</div></div><div className="filters"><label>{t.level}<select value={levelFilter} onChange={(event) => setLevelFilter(event.target.value as 'all' | LogLevel)}><option value="all">{t.all}</option><option value="info">INFO</option><option value="warn">WARN</option><option value="error">ERROR</option></select></label><label>{t.service}<input value={serviceFilter} onChange={(event) => setServiceFilter(event.target.value)} /></label><label>{t.requestId}<input value={requestFilter} onChange={(event) => setRequestFilter(event.target.value)} /></label><button onClick={() => { setLevelFilter('all'); setServiceFilter(''); setRequestFilter('') }}>{t.clearFilters}</button></div><div className="log-table" role="table" aria-label={t.timeline}><div className="log-head" role="row">{['TIME', 'LEVEL', 'SOURCE', 'SERVICE', 'REQUEST ID', 'MESSAGE'].map((heading) => <span role="columnheader" key={heading}>{heading}</span>)}</div>{filteredEvents.slice(-80).reverse().map((event) => <div className="log-row" role="row" key={event.id}><span role="cell">{new Date(event.occurredAt).toLocaleTimeString(locale, { hour12: false, fractionalSecondDigits: 3 })}</span><span role="cell" className={event.level}>● {event.level.toUpperCase()}</span><span role="cell">{event.source}</span><span role="cell">{event.service}</span><code role="cell">{event.requestId}</code><span role="cell">{event.summary}</span></div>)}</div></section>
    <footer className="statusbar"><span>{t.environments}: <b>{environment}</b></span><span>SQLite: <b>{runtime?.health.database === 'connected' ? t.online : t.offline}</b></span><span>{t.mock}: <b>{runtime?.health.mock === 'running' ? t.online : t.offline}</b></span><span>{t.runtime}: <b>{runtime?.health.ready ? t.online : t.offline}</b></span><span role="status">{message || (runtime?.health.ready ? t.runtimeConnected : runtime?.health.message) || t.starting}</span></footer>
  </main>
}

function ToolHeader({ title, detail, actions }: { title: string; detail: string; actions?: React.ReactNode }) { return <header className="tool-header"><div><small>OSCILLA</small><h1>{title}</h1><p>{detail}</p></div><div>{actions}</div></header> }
function RuntimeFact({ label, value }: { label: string; value: string }) { return <div className="runtime-fact"><small>{label}</small><strong>{value}</strong></div> }
