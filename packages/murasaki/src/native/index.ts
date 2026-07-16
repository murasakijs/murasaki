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

/** Serializable state returned for each declared native window. */
export interface WindowInfo {
  label: string
  primary: boolean
  visible: boolean
  focused: boolean
  minimized: boolean
  maximized: boolean
}

export const app = {
  /** Request graceful application shutdown through the native host. */
  quit(): Promise<void> {
    return invokeNative('app.quit')
  },
}

type NativeResult = { ok: true; value: unknown } | { ok: false; error?: { message?: string } }

let requestSequence = 0

function nativeRequestId(): string {
  const randomUUID = globalThis.crypto?.randomUUID
  if (typeof randomUUID === 'function') return randomUUID.call(globalThis.crypto)
  // Old embedded engines may not expose randomUUID. Include random entropy in
  // addition to time/sequence so duplicate module instances cannot collide.
  const random = Math.random().toString(36).slice(2)
  return `${Date.now().toString(36)}-${(++requestSequence).toString(36)}-${random}`
}

function parseNativeResult(detail: unknown, requestId: string): NativeResult | null {
  if (!detail || typeof detail !== 'object'
    || (detail as { requestId?: unknown }).requestId !== requestId) return null
  const response = (detail as { response?: unknown }).response
  if (!response || typeof response !== 'object'
    || typeof (response as { ok?: unknown }).ok !== 'boolean') {
    throw new Error('Murasaki native bridge returned a malformed response')
  }
  if ((response as { ok: boolean }).ok) {
    return { ok: true, value: (response as { value?: unknown }).value }
  }
  const error = (response as { error?: unknown }).error
  if (error !== undefined && (!error || typeof error !== 'object'
    || ('message' in error && typeof (error as { message?: unknown }).message !== 'string'))) {
    throw new Error('Murasaki native bridge returned a malformed error response')
  }
  return { ok: false, error: error as { message?: string } | undefined }
}

function invokeNative<T>(method: string, args: unknown = {}): Promise<T> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error(`${method} is only available in the Murasaki renderer`))
  }
  const bridge = (window as Window & { ipc?: { postMessage?(message: string): void } }).ipc
  if (!bridge || typeof bridge.postMessage !== 'function') {
    return Promise.reject(new Error('Murasaki native bridge is unavailable'))
  }
  const postMessage = bridge.postMessage.bind(bridge)

  const requestId = nativeRequestId()
  return new Promise<T>((resolveOk, rejectFail) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      rejectFail(new Error(`${method} timed out`))
    }, 120_000)
    const onResponse = (event: Event) => {
      let response: NativeResult | null
      try {
        response = parseNativeResult((event as CustomEvent<unknown>).detail, requestId)
      } catch (error) {
        cleanup()
        rejectFail(error)
        return
      }
      if (!response) return
      cleanup()
      if (response.ok) {
        resolveOk(response.value as T)
      } else {
        rejectFail(new Error(response.error?.message ?? `${method} failed`))
      }
    }
    const cleanup = () => {
      window.clearTimeout(timeout)
      window.removeEventListener('murasaki:nativeresponse', onResponse)
    }
    window.addEventListener('murasaki:nativeresponse', onResponse)
    try {
      postMessage(JSON.stringify({ kind: 'nativeCall', requestId, method, args }))
    } catch (error) {
      cleanup()
      rejectFail(error)
    }
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
  getLabel(): Promise<string> {
    return invokeNative('window.getLabel')
  },
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
  show(): Promise<void> {
    return invokeNative('window.show')
  },
  hide(): Promise<void> {
    return invokeNative('window.hide')
  },
  focus(): Promise<void> {
    return invokeNative('window.focus')
  },
  close(): Promise<void> {
    return invokeNative('window.close')
  },
  setAlwaysOnTop(enabled: boolean): Promise<void> {
    return invokeNative('window.setAlwaysOnTop', { enabled })
  },
  isVisible(): Promise<boolean> {
    return invokeNative('window.isVisible')
  },
  isFocused(): Promise<boolean> {
    return invokeNative('window.isFocused')
  },
  isMaximized(): Promise<boolean> {
    return invokeNative('window.isMaximized')
  },
  isMinimized(): Promise<boolean> {
    return invokeNative('window.isMinimized')
  },
}

/** Controls windows declared in `murasaki.config.*` by label. */
export const windows = {
  open(label: string): Promise<void> {
    return invokeNative('window.open', { label })
  },
  list(): Promise<WindowInfo[]> {
    return invokeNative('window.list')
  },
  show(label: string): Promise<void> {
    return invokeNative('window.showOther', { label })
  },
  hide(label: string): Promise<void> {
    return invokeNative('window.hideOther', { label })
  },
  focus(label: string): Promise<void> {
    return invokeNative('window.focusOther', { label })
  },
  close(label: string): Promise<void> {
    return invokeNative('window.closeOther', { label })
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
