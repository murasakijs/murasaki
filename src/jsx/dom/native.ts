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

export type OpenFileOptions = {
  title?: string
  multiple?: boolean
  directory?: boolean
}

export type SaveFileOptions = {
  title?: string
  defaultName?: string
}

export type DirEntry = {
  name: string
  isDirectory: boolean
  isFile: boolean
}

type Bridge = {
  notify(opts: NotifyOptions): Promise<void>
  clipboardWrite(text: string): Promise<void>
  clipboardRead(): Promise<string>
  openExternal(target: string): Promise<void>
  fsReadFile(path: string): Promise<string>
  fsWriteFile(path: string, content: string): Promise<void>
  fsExists(path: string): Promise<boolean>
  fsMkdir(path: string): Promise<void>
  fsReadDir(path: string): Promise<DirEntry[]>
  openFile(opts?: OpenFileOptions): Promise<string[]>
  saveFile(opts?: SaveFileOptions): Promise<string>
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

/**
 * File system access (server-side, via the native bridge).
 *
 *   const fs = useFs()
 *   const text = await fs.readFile('/path/to/file.txt')
 *   await fs.writeFile('/path/out.txt', 'hello')
 *   if (await fs.exists('/path')) { ... }
 *   const entries = await fs.readDir('/path')
 */
export function useFs() {
  return {
    async readFile(path: string): Promise<string> {
      const b = bridge()
      if (!b) return ''
      try {
        return await b.fsReadFile(path)
      } catch (e) {
        console.warn('[murasaki] fs.readFile failed:', e)
        return ''
      }
    },
    async writeFile(path: string, content: string): Promise<void> {
      const b = bridge()
      if (!b) return
      try {
        await b.fsWriteFile(path, content)
      } catch (e) {
        console.warn('[murasaki] fs.writeFile failed:', e)
      }
    },
    async exists(path: string): Promise<boolean> {
      const b = bridge()
      if (!b) return false
      try {
        return await b.fsExists(path)
      } catch {
        return false
      }
    },
    async mkdir(path: string): Promise<void> {
      const b = bridge()
      if (!b) return
      try {
        await b.fsMkdir(path)
      } catch (e) {
        console.warn('[murasaki] fs.mkdir failed:', e)
      }
    },
    async readDir(path: string): Promise<DirEntry[]> {
      const b = bridge()
      if (!b) return []
      try {
        return await b.fsReadDir(path)
      } catch (e) {
        console.warn('[murasaki] fs.readDir failed:', e)
        return []
      }
    },
  }
}

/**
 * Native file dialogs.
 *
 *   const dialog = useDialog()
 *   const paths = await dialog.openFile({ title: 'Choose…', multiple: true })
 *   const out = await dialog.saveFile({ defaultName: 'untitled.md' })
 *   const folder = await dialog.openDirectory()
 */
export function useDialog() {
  return {
    async openFile(opts: OpenFileOptions = {}): Promise<string[]> {
      const b = bridge()
      if (!b) return []
      try {
        return await b.openFile(opts)
      } catch (e) {
        console.warn('[murasaki] dialog.openFile failed:', e)
        return []
      }
    },
    async openDirectory(opts: Omit<OpenFileOptions, 'directory'> = {}): Promise<string> {
      const b = bridge()
      if (!b) return ''
      try {
        const paths = await b.openFile({ ...opts, directory: true, multiple: false })
        return paths[0] ?? ''
      } catch (e) {
        console.warn('[murasaki] dialog.openDirectory failed:', e)
        return ''
      }
    },
    async saveFile(opts: SaveFileOptions = {}): Promise<string> {
      const b = bridge()
      if (!b) return ''
      try {
        return await b.saveFile(opts)
      } catch (e) {
        console.warn('[murasaki] dialog.saveFile failed:', e)
        return ''
      }
    },
  }
}
