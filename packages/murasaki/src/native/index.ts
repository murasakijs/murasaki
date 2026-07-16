/** Native capabilities available to trusted Murasaki renderer code. */

export interface DialogFilter {
  name: string
  extensions: string[]
}

export interface OpenFileOptions {
  title?: string
  defaultPath?: string
  filters?: DialogFilter[]
  multiple?: boolean
}

export interface SaveFileOptions {
  title?: string
  defaultPath?: string
  defaultName?: string
  filters?: DialogFilter[]
}

export interface NotificationOptions {
  title: string
  body?: string
  icon?: string
  sound?: boolean
}

export interface TrayOptions {
  /** Tooltip shown by the host OS. */
  tooltip?: string
  /** 8-bit RGB/RGBA PNG. Defaults to `config.icon`. */
  icon?: string
  /** macOS: render the icon as a monochrome template image. */
  template?: boolean
}

export interface TrayClickEvent {
  button: 'left' | 'right' | 'middle'
  double: boolean
}

interface NativeResponse {
  requestId: string
  response: { ok: true; value: unknown } | { ok: false; error?: { message?: string } }
}

let requestSequence = 0

function invokeNative<T>(method: string, args: unknown = {}): Promise<T> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error(`${method} is only available in the Murasaki renderer`))
  }
  const bridge = (window as Window & { ipc?: { postMessage?(message: string): void } }).ipc
  if (!bridge || typeof bridge.postMessage !== 'function') {
    return Promise.reject(new Error('Murasaki native bridge is unavailable'))
  }
  const postMessage = bridge.postMessage.bind(bridge)

  const requestId = `${Date.now().toString(36)}-${(++requestSequence).toString(36)}`
  return new Promise<T>((resolveOk, rejectFail) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      rejectFail(new Error(`${method} timed out`))
    }, 120_000)
    const onResponse = (event: Event) => {
      const detail = (event as CustomEvent<NativeResponse>).detail
      if (!detail || detail.requestId !== requestId) return
      cleanup()
      if (detail.response.ok) {
        resolveOk(detail.response.value as T)
      } else {
        rejectFail(new Error(detail.response.error?.message ?? `${method} failed`))
      }
    }
    const cleanup = () => {
      window.clearTimeout(timeout)
      window.removeEventListener('murasaki:nativeresponse', onResponse)
    }
    window.addEventListener('murasaki:nativeresponse', onResponse)
    postMessage(JSON.stringify({ kind: 'nativeCall', requestId, method, args }))
  })
}

export const dialog = {
  openFile(options: OpenFileOptions = {}): Promise<string[]> {
    return invokeNative('dialog.openFile', options)
  },
  openDirectory(options: Omit<OpenFileOptions, 'multiple' | 'filters'> = {}): Promise<string | null> {
    return invokeNative('dialog.openDirectory', options)
  },
  saveFile(options: SaveFileOptions = {}): Promise<string | null> {
    return invokeNative('dialog.saveFile', options)
  },
}

export const clipboard = {
  readText(): Promise<string> {
    return invokeNative('clipboard.readText')
  },
  writeText(text: string): Promise<void> {
    return invokeNative('clipboard.writeText', { text })
  },
}

export const notification = {
  show(options: NotificationOptions): Promise<void> {
    return invokeNative('notification.show', options)
  },
}

export const shell = {
  openExternal(target: string): Promise<void> {
    return invokeNative('shell.openExternal', { target })
  },
  showItemInFolder(target: string): Promise<void> {
    return invokeNative('shell.showItemInFolder', { target })
  },
}

export const appWindow = {
  setTitle(title: string): Promise<void> {
    return invokeNative('window.setTitle', { title })
  },
  setSize(width: number, height: number): Promise<void> {
    return invokeNative('window.setSize', { width, height })
  },
  minimize(): Promise<void> {
    return invokeNative('window.minimize')
  },
  toggleMaximize(): Promise<void> {
    return invokeNative('window.toggleMaximize')
  },
}

export const tray = {
  create(options: TrayOptions = {}): Promise<void> {
    return invokeNative('tray.create', options)
  },
  remove(): Promise<void> {
    return invokeNative('tray.remove')
  },
  setTooltip(text: string): Promise<void> {
    return invokeNative('tray.setTooltip', { text })
  },
  onClick(listener: (event: TrayClickEvent) => void): () => void {
    if (typeof window === 'undefined') return () => {}
    const handler = (event: Event) => listener((event as CustomEvent<TrayClickEvent>).detail)
    window.addEventListener('murasaki:trayclick', handler)
    return () => window.removeEventListener('murasaki:trayclick', handler)
  },
}
