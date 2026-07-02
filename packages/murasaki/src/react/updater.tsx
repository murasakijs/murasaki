import { useCallback, useEffect, useState } from 'react'
import { post, subscribe } from './rpc.js'

export interface UpdateState {
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'ready'
    | 'error'
  current: string
  latest?: string
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
    const off = subscribe((msg: any) => {
      if (msg && msg.kind === 'update') {
        setState((s) => ({ ...s, ...msg }))
      }
    })
    return off
  }, [])

  return {
    ...state,
    check: useCallback(() => post({ kind: 'update.check' }), []),
    download: useCallback(() => post({ kind: 'update.download' }), []),
    install: useCallback(() => post({ kind: 'update.install' }), []),
    dismiss: useCallback(
      () => setState((s) => ({ ...s, status: 'idle' })),
      [],
    ),
  }
}

export function UpdateButton() {
  const u = useUpdate()
  useEffect(() => {
    u.check()
  }, [])
  if (u.status !== 'available' && u.status !== 'ready') return null
  const label =
    u.status === 'ready'
      ? `Restart to update to ${u.latest}`
      : `Update to ${u.latest}`
  return (
    <button
      onClick={() => (u.status === 'ready' ? u.install() : u.download())}
      className="rounded-md bg-violet-600 text-white px-3 py-1.5 text-sm hover:bg-violet-700"
    >
      {label}
    </button>
  )
}

declare global {
  const __MURASAKI_VERSION__: string
  const __MURASAKI_APP_ID__: string
  const __MURASAKI_PRODUCT_NAME__: string
}
