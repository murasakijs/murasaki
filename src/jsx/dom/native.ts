// Client-side React-style hooks for native APIs.
//
// All of these proxy to the Node side via window.murasaki.*, which the
// dev runner exposes through @webviewjs/webview's webview.expose().
//
// Safe to import server-side — every hook detects the missing bridge
// and degrades to no-op (notify/openExternal/clipboardWrite) or empty
// value (clipboardRead → '').

export type NotifyOptions = {
  title: string
  body?: string
  sound?: boolean
}

type Bridge = {
  notify(opts: NotifyOptions): Promise<void>
  clipboardWrite(text: string): Promise<void>
  clipboardRead(): Promise<string>
  openExternal(target: string): Promise<void>
}

declare global {
  interface Window {
    murasaki?: Bridge
  }
}

function bridge(): Bridge | null {
  if (typeof window === 'undefined') return null
  return window.murasaki ?? null
}

/**
 * Returns a function that shows an OS notification.
 *
 *   const notify = useNotification()
 *   notify({ title: 'Hello', body: 'from murasaki' })
 */
export function useNotification() {
  return async (opts: NotifyOptions): Promise<void> => {
    const b = bridge()
    if (!b) return
    try {
      await b.notify(opts)
    } catch (e) {
      console.warn('[murasaki] notify failed:', e)
    }
  }
}

/**
 * Returns { read, write } for the system clipboard.
 *
 *   const clipboard = useClipboard()
 *   clipboard.write('hello')
 *   const text = await clipboard.read()
 */
export function useClipboard() {
  return {
    async read(): Promise<string> {
      const b = bridge()
      if (!b) return ''
      try {
        return await b.clipboardRead()
      } catch (e) {
        console.warn('[murasaki] clipboard.read failed:', e)
        return ''
      }
    },
    async write(text: string): Promise<void> {
      const b = bridge()
      if (!b) return
      try {
        await b.clipboardWrite(text)
      } catch (e) {
        console.warn('[murasaki] clipboard.write failed:', e)
      }
    },
  }
}

/**
 * Returns { openExternal } — opens URLs / files in the system default app.
 *
 *   const shell = useShell()
 *   shell.openExternal('https://murasaki.dev')
 */
export function useShell() {
  return {
    async openExternal(target: string): Promise<void> {
      const b = bridge()
      if (!b) return
      try {
        await b.openExternal(target)
      } catch (e) {
        console.warn('[murasaki] openExternal failed:', e)
      }
    },
  }
}
