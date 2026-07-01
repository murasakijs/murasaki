// Server-side RPC — register actions the client can call. IPC uses
// wry's `window.ipc.postMessage` → `Webview.onIpcMessage` channel, and
// results/errors are returned via `webview.evaluate`.
//
// Usage on the server (e.g. in a src/actions/*.ts file):
//
//   import { defineAction } from 'murasaki'
//
//   export const greet = defineAction('greet', async (name: string) => {
//     return `Hello, ${name}!`
//   })
//
// The client then calls it via callAction<typeof greet>('greet', 'world').

type AnyFn = (...args: unknown[]) => unknown | Promise<unknown>

const actions = new Map<string, AnyFn>()

export function defineAction<
  Args extends unknown[],
  R,
>(name: string, handler: (...args: Args) => R | Promise<R>): (...args: Args) => Promise<R> {
  if (actions.has(name)) {
    // Overwriting is fine (HMR), but warn once.
    // eslint-disable-next-line no-console
    console.warn(`[murasaki] action "${name}" is being redefined`)
  }
  actions.set(name, handler as unknown as AnyFn)
  return async (...args: Args) => handler(...args) as Promise<R>
}

export function getAction(name: string): AnyFn | undefined {
  return actions.get(name)
}

export function listActions(): string[] {
  return Array.from(actions.keys())
}

/**
 * Wire the RPC dispatch pipe into a webview. Called once by
 * runtime/window.ts after the webview is created.
 */
export function attachRpc(webview: {
  onIpcMessage: (handler: (msg: { body: Buffer }) => void) => void
  evaluate: (js: string) => void
}): void {
  webview.onIpcMessage(async (msg) => {
    let payload: { id: string; name: string; args?: unknown[]; kind?: string } | null = null
    try {
      const text = Buffer.from(msg.body).toString('utf8')
      payload = JSON.parse(text)
    } catch {
      return
    }
    if (!payload || payload.kind !== 'call' || typeof payload.id !== 'string') return

    const handler = actions.get(payload.name)
    if (!handler) {
      webview.evaluate(
        `window.__murasakiRpc__.reject(${JSON.stringify(payload.id)}, ${JSON.stringify(
          `unknown action: ${payload.name}`,
        )})`,
      )
      return
    }
    try {
      const result = await handler(...((payload.args ?? []) as unknown[]))
      webview.evaluate(
        `window.__murasakiRpc__.resolve(${JSON.stringify(payload.id)}, ${JSON.stringify(result ?? null)})`,
      )
    } catch (e) {
      const message = String((e as Error)?.message ?? e)
      webview.evaluate(
        `window.__murasakiRpc__.reject(${JSON.stringify(payload.id)}, ${JSON.stringify(message)})`,
      )
    }
  })
}
