// Client-side RPC — call server-registered actions from the WebView.
//
// Usage inside a page component:
//
//   import { callAction, useAction } from 'murasaki'
//   import type { greet } from './actions'   // just for the types
//
//   // one-off
//   const msg = await callAction<typeof greet>('greet', 'world')
//
//   // as a hook (state managed for you)
//   const g = useAction<typeof greet>('greet')
//   <Button onClick={() => g.call('world')}>Greet</Button>
//   {g.loading ? 'sending…' : g.data}

import { useState } from './jsx/dom/runtime.ts'

declare global {
  interface Window {
    ipc?: { postMessage: (s: string) => void }
    __murasakiRpc__?: {
      call: <T = unknown>(name: string, args: unknown[]) => Promise<T>
      resolve: (id: string, value: unknown) => void
      reject: (id: string, err: string) => void
    }
  }
}

/**
 * Idempotent client-side RPC bootstrap. The client bundle injects a
 * call to this on startup (see runtime/render.tsx NAV_SCRIPT).
 */
export function installClientRpc(): void {
  if (typeof window === 'undefined' || window.__murasakiRpc__) return
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  let counter = 0
  window.__murasakiRpc__ = {
    call<T>(name: string, args: unknown[]): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (!window.ipc?.postMessage) {
          reject(new Error('[murasaki] window.ipc is not available'))
          return
        }
        const id = `r${++counter}`
        pending.set(id, {
          resolve: resolve as (v: unknown) => void,
          reject,
        })
        window.ipc.postMessage(JSON.stringify({ kind: 'call', id, name, args }))
      })
    },
    resolve(id, value) {
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      p.resolve(value)
    },
    reject(id, err) {
      const p = pending.get(id)
      if (!p) return
      pending.delete(id)
      p.reject(new Error(err))
    },
  }
}

/**
 * Type-safe RPC call from client → server.
 *
 * `T` is the server handler function type. Pass `typeof handler` so both
 * argument types and the return type are inferred:
 *
 *   const result = await callAction<typeof greet>('greet', 'world')
 */
export function callAction<T extends (...args: never[]) => unknown>(
  name: string,
  ...args: Parameters<T>
): Promise<Awaited<ReturnType<T>>> {
  installClientRpc()
  if (!window.__murasakiRpc__) {
    return Promise.reject(new Error('[murasaki] rpc unavailable'))
  }
  return window.__murasakiRpc__.call<Awaited<ReturnType<T>>>(name, args)
}

export type ActionState<T> = {
  data: T | undefined
  error: Error | null
  loading: boolean
}

export type UseActionResult<T extends (...args: never[]) => unknown> = ActionState<
  Awaited<ReturnType<T>>
> & {
  /** Fire the action. Also returns the resolved value / rejects with the error. */
  call: (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>>
  /** Reset state back to idle. */
  reset: () => void
}

/**
 * Hook wrapper around callAction that tracks loading/error/data state.
 * The API is intentionally close to react-query's minimal shape.
 */
export function useAction<T extends (...args: never[]) => unknown>(
  name: string,
): UseActionResult<T> {
  const [state, setState] = useState<ActionState<Awaited<ReturnType<T>>>>({
    data: undefined,
    error: null,
    loading: false,
  })

  const call = async (
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>>> => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await callAction<T>(name, ...args)
      setState({ data, error: null, loading: false })
      return data
    } catch (e) {
      const err = e as Error
      setState({ data: undefined, error: err, loading: false })
      throw err
    }
  }

  const reset = () => {
    setState({ data: undefined, error: null, loading: false })
  }

  return { ...state, call, reset }
}
