/**
 * `useUpdate()` — the client half of the check/download/install flow
 * described in the frozen updater contract (`/__murasaki/update/*`, §0/§6/§7).
 * Headless — no styling. `<UpdateButton />` (styled, shadcn-idiom) lives
 * alongside it in `./update-button.js`, built on top of `@murasakijs/ui`.
 *
 * Transport: `/__murasaki/update/events` (SSE) is the single source of
 * truth for `UpdateState` — it pushes the full state on every transition,
 * and the current state immediately on connect, so this hook just mirrors
 * whatever the server says. `check()`/`download()`/`install()` are POSTs
 * that kick off work server-side; their results are observed via the SSE
 * stream, not their HTTP responses.
 *
 * This is the *only* transport now. The previous `window.ipc.postMessage({
 * kind: 'update.check' })` path is dead in both dev and prod — see the
 * contract's §0 and the comment at the top of `crates/native/src/webview.rs`
 * for why (nothing ever wires up the napi round-trip that would have carried
 * it).
 */
import { useCallback, useEffect, useState } from 'react'
import { quit } from './rpc.js'

const EVENTS_URL = '/__murasaki/update/events'
const CHECK_URL = '/__murasaki/update/check'
const DOWNLOAD_URL = '/__murasaki/update/download'
const INSTALL_URL = '/__murasaki/update/install'

export interface UpdateState {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'ready'
    | 'error'
  /** Running app version. */
  current: string
  latest?: string
  notes?: string
  mandatory?: boolean
  /** 0..1, only meaningful while `status === 'downloading'`. */
  progress?: number
  error?: string
}

export function useUpdate(): UpdateState & {
  check(): void
  download(): void
  install(): void
  dismiss(): void
} {
  const [state, setState] = useState<UpdateState>({
    status: 'idle',
    current:
      typeof __MURASAKI_VERSION__ === 'string' ? __MURASAKI_VERSION__ : '0.0.0',
  })

  useEffect(() => {
    const source = new EventSource(EVENTS_URL)
    source.onmessage = (ev) => {
      try {
        setState(JSON.parse(ev.data) as UpdateState)
      } catch {
        // Malformed frame — ignore, the next one will resync.
      }
    }
    return () => source.close()
  }, [])

  const check = useCallback(() => {
    fetch(CHECK_URL, { method: 'POST' }).catch((err) => {
      setState((s) => ({ ...s, status: 'error', error: errorMessage(err) }))
    })
  }, [])

  const download = useCallback(() => {
    fetch(DOWNLOAD_URL, { method: 'POST' }).catch((err) => {
      setState((s) => ({ ...s, status: 'error', error: errorMessage(err) }))
    })
  }, [])

  const install = useCallback(() => {
    fetch(INSTALL_URL, { method: 'POST' })
      .then((res) => {
        // The backend has spawned the detached apply-helper and deliberately
        // does NOT quit the app itself (contract §7 step 3) — that's on the
        // client. On failure the engine has already pushed an 'error' state
        // over SSE, so there's nothing further to do here.
        if (res.ok) return quit()
      })
      .catch((err) => {
        setState((s) => ({ ...s, status: 'error', error: errorMessage(err) }))
      })
  }, [])

  const dismiss = useCallback(
    () => setState((s) => ({ ...s, status: 'idle' })),
    [],
  )

  return { ...state, check, download, install, dismiss }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

declare global {
  const __MURASAKI_VERSION__: string
  const __MURASAKI_APP_ID__: string
  const __MURASAKI_PRODUCT_NAME__: string
}
