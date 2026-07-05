import { useEffect, useSyncExternalStore } from 'react'
import type { CSSProperties, JSX } from 'react'

/** A single captured runtime error, dev-only. */
export interface DevError {
  error: Error
  componentStack?: string
  id: number
}

let errors: DevError[] = []
let nextId = 1
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

/**
 * Records a dev-only runtime error for `<DevErrorOverlay>` to display. Fed
 * by three capture paths: `ErrorBoundary.componentDidCatch` (render
 * errors), `window.onerror` (uncaught exceptions), and
 * `unhandledrejection` (promises rejected with no `.catch`). No-op in
 * production builds.
 */
export function reportDevError(error: Error, componentStack?: string): void {
  if (process.env.NODE_ENV === 'production') return

  const last = errors.at(-1)
  const sameAsLast =
    last && (last.error.stack ?? last.error.message) === (error.stack ?? error.message)
  if (sameAsLast) return // dedupe StrictMode double-invoke / repeat-render spam

  errors = [...errors, { error, componentStack, id: nextId++ }]
  notify()
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

function getSnapshot(): DevError[] {
  return errors
}

function dismissAll(): void {
  errors = []
  notify()
}

const styles = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 2147483647,
    background: 'rgba(20,10,30,0.85)',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    overflowY: 'auto',
    padding: '5vh 24px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    width: '100%',
    maxWidth: 720,
    background: '#1a1223',
    color: '#f5f2fa',
    borderRadius: 12,
    border: '1px solid rgba(168,85,247,0.35)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    padding: 24,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  wordmark: {
    color: '#A855F7',
    fontWeight: 700,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  badge: {
    fontSize: 12,
    color: '#c9b8dd',
    background: 'rgba(168,85,247,0.15)',
    padding: '2px 8px',
    borderRadius: 999,
  },
  name: {
    color: '#A855F7',
    fontWeight: 700,
    fontSize: 20,
    margin: '0 0 4px',
  },
  message: {
    color: '#f5f2fa',
    fontSize: 15,
    margin: '0 0 16px',
    userSelect: 'text',
  },
  label: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: '#8f7ba3',
    margin: '16px 0 6px',
  },
  pre: {
    margin: 0,
    padding: 12,
    background: '#120b1a',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: 12,
    lineHeight: 1.5,
    color: '#c9b8dd',
    overflowX: 'auto',
    overflowY: 'auto',
    maxHeight: 240,
    whiteSpace: 'pre',
  },
  footer: {
    display: 'flex',
    gap: 8,
    marginTop: 20,
    justifyContent: 'flex-end',
  },
  buttonPrimary: {
    background: '#A855F7',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  buttonSecondary: {
    background: 'transparent',
    color: '#c9b8dd',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 8,
    padding: '8px 16px',
    fontSize: 13,
    cursor: 'pointer',
  },
} as const

/**
 * Dev-only full-screen overlay that surfaces uncaught runtime errors —
 * render errors (via `ErrorBoundary.componentDidCatch`), uncaught
 * exceptions (`window.onerror`), and unhandled promise rejections.
 * Dismiss with Esc, or reload the app; renders `null` and does nothing in
 * production builds.
 */
export function DevErrorOverlay(): JSX.Element | null {
  if (process.env.NODE_ENV === 'production') return null

  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    const onError = (e: ErrorEvent) =>
      reportDevError(e.error instanceof Error ? e.error : new Error(e.message))
    const onRejection = (e: PromiseRejectionEvent) =>
      reportDevError(e.reason instanceof Error ? e.reason : new Error(String(e.reason)))
    const onKey = (e: KeyboardEvent) => {
      // Don't treat the Esc that cancels an IME composition as "dismiss overlay"
      // — mid-composition keydowns come through with keyCode 229 / isComposing.
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Escape') dismissAll()
    }

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  if (list.length === 0) return null

  // Always show the most recent error; the badge just signals there are more.
  const active = list.at(-1)!

  return (
    <div style={styles.backdrop as CSSProperties}>
      <div style={styles.card as CSSProperties}>
        <div style={styles.header as CSSProperties}>
          <span style={styles.wordmark as CSSProperties}>murasaki</span>
          {list.length > 1 && (
            <span style={styles.badge as CSSProperties}>
              +{list.length - 1} more {list.length === 2 ? 'error' : 'errors'}
            </span>
          )}
        </div>

        <p style={styles.name as CSSProperties}>{active.error.name || 'Error'}</p>
        <p style={styles.message as CSSProperties}>{active.error.message}</p>

        <p style={styles.label as CSSProperties}>Stack</p>
        <pre style={styles.pre as CSSProperties}>{active.error.stack}</pre>

        {active.componentStack && (
          <>
            <p style={styles.label as CSSProperties}>Component stack</p>
            <pre style={styles.pre as CSSProperties}>{active.componentStack}</pre>
          </>
        )}

        <div style={styles.footer as CSSProperties}>
          <button
            type="button"
            style={styles.buttonSecondary as CSSProperties}
            onClick={dismissAll}
          >
            Dismiss (Esc)
          </button>
          <button
            type="button"
            style={styles.buttonPrimary as CSSProperties}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  )
}
