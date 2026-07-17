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

export interface MessageDialogOptions {
  title?: string
  message: string
  level?: 'info' | 'warning' | 'error'
  buttons?: 'ok' | 'okCancel' | 'yesNo'
}

export type MessageDialogResult = 'ok' | 'cancel' | 'yes' | 'no'

export interface ClipboardImageData {
  width: number
  height: number
  pngBase64: string
}

export type SystemPermissionName =
  | 'camera'
  | 'microphone'
  | 'screenRecording'
  | 'accessibility'

export type SystemPermissionStatus =
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'notDetermined'
  | 'notGranted'
  | 'unsupported'

export interface TrayOptions {
  /** Tooltip shown by the host OS. */
  tooltip?: string
  /** 8-bit RGB/RGBA PNG. Defaults to `config.icon`. */
  icon?: string
  /** macOS: render the icon as a monochrome template image. */
  template?: boolean
  /** Native status-item/system-tray menu. Clickable entries require unique ids. */
  menu?: TrayMenuItem[]
  /** Show the native menu on left click. Host default is true. */
  menuOnLeftClick?: boolean
  /** Show the native menu on right click. Host default is true. */
  menuOnRightClick?: boolean
}

export type TrayMenuItem =
  | {
      id: string
      label: string
      enabled?: boolean
      accelerator?: string
    }
  | {
      label: string
      enabled?: boolean
      submenu: TrayMenuItem[]
    }
  | { separator: true }

export interface TrayClickEvent {
  button: 'left' | 'right' | 'middle'
  double: boolean
}

/** Resolved process-wide shortcut identity returned by registration/events. */
export interface GlobalShortcutRegistration {
  id: string
  /** Platform-resolved canonical accelerator (for example `Control+Shift+KeyK`). */
  accelerator: string
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

/** One OS display, as returned by `appWindow.getMonitors()`. Geometry is in
 * physical pixels — divide by `scaleFactor` for logical/CSS pixels. */
export interface WindowMonitorInfo {
  name: string | null
  isPrimary: boolean
  isCurrent: boolean
  x: number
  y: number
  width: number
  height: number
  scaleFactor: number
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
  /** Native message box. Defaults to an info-level dialog with a single OK button. */
  showMessage(options: MessageDialogOptions): Promise<MessageDialogResult> {
    return invokeNative('dialog.showMessage', options)
  },
}

export const clipboard = {
  readText(): Promise<string> {
    return invokeNative('clipboard.readText')
  },
  writeText(text: string): Promise<void> {
    return invokeNative('clipboard.writeText', { text })
  },
  /** Reads the clipboard's image, PNG-encoded, or null when it holds no image. */
  readImage(): Promise<ClipboardImageData | null> {
    return invokeNative('clipboard.readImage')
  },
  /** Writes a PNG (base64-encoded) to the clipboard as an image. */
  writeImage(image: { pngBase64: string }): Promise<void> {
    return invokeNative('clipboard.writeImage', image)
  },
  /** Writes HTML, with an optional plain-text fallback, to the clipboard. */
  writeHtml(html: { html: string; altText?: string }): Promise<void> {
    return invokeNative('clipboard.writeHtml', html)
  },
}

export const notification = {
  /** Shows a system notification and returns a generated id for local bookkeeping.
   * Upstream notify-rust cannot deliver click/action callbacks on macOS or Windows,
   * so this id does not correlate with any later event. */
  show(options: NotificationOptions): Promise<string> {
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
  /** Moves an existing absolute, non-traversing path to the OS trash/recycle bin. */
  trashItem(path: string): Promise<void> {
    return invokeNative('shell.trashItem', { path })
  },
  /** Opens an existing local file/directory with the OS default handler. Paths
   * only — URLs and UNC/device paths are rejected; use `shell.openExternal` for URLs. */
  openPath(path: string): Promise<void> {
    return invokeNative('shell.openPath', { path })
  },
}

/** OS credential storage, namespaced by `config.appId`. */
export const secureStorage = {
  /** Read a UTF-8 string, or null when the key does not exist. */
  get(key: string): Promise<string | null> {
    return invokeNative('secureStorage.get', { key })
  },
  /** Create or replace a UTF-8 string value. */
  set(key: string, value: string): Promise<void> {
    return invokeNative('secureStorage.set', { key, value })
  },
  /** Delete a value. Deleting an absent key succeeds. */
  delete(key: string): Promise<void> {
    return invokeNative('secureStorage.delete', { key })
  },
}

/** Host OS consent, separate from Murasaki renderer capabilities. */
export const systemPermission = {
  status(permission: SystemPermissionName): Promise<SystemPermissionStatus> {
    return invokeNative('systemPermission.status', { permission })
  },
  request(permission: SystemPermissionName): Promise<SystemPermissionStatus> {
    return invokeNative('systemPermission.request', { permission })
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
  /**
   * Starts an OS window drag from a custom (frameless) titlebar region. Call
   * on primary-button pointerdown — see `useWindowDrag()` for the typical
   * caller. Resolves silently even when the native drag could not start (for
   * example outside an active mouse-down); that failure is not surfaced.
   */
  startDragging(): Promise<void> {
    return invokeNative<void>('window.startDragging').catch(() => undefined)
  },
  /** Enters/exits borderless fullscreen on the window's current monitor. */
  setFullscreen(fullscreen: boolean): Promise<void> {
    return invokeNative('window.setFullscreen', { fullscreen })
  },
  isFullscreen(): Promise<boolean> {
    return invokeNative('window.isFullscreen')
  },
  /** Sets the maximum inner size. Both `width`/`height` omitted or `null`
   * clears the bound; a single axis is rejected — provide both or neither. */
  setMaxSize(size: { width?: number | null; height?: number | null } = {}): Promise<void> {
    return invokeNative('window.setMaxSize', size)
  },
  /** Every OS display visible to this window, in physical pixels. */
  getMonitors(): Promise<{ monitors: WindowMonitorInfo[] }> {
    return invokeNative('window.getMonitors')
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

/** Process-wide keyboard shortcuts owned by the renderer that registers them. */
export const globalShortcut = {
  /** Register a modifier + known-key chord. The optional id must be process-unique. */
  register(accelerator: string, id?: string): Promise<GlobalShortcutRegistration> {
    return invokeNative('globalShortcut.register', { accelerator, ...(id === undefined ? {} : { id }) })
  },
  /** Unregister one shortcut owned by this renderer. */
  unregister(id: string): Promise<void> {
    return invokeNative('globalShortcut.unregister', { id })
  },
  /** Unregister every shortcut owned by this renderer. */
  unregisterAll(): Promise<void> {
    return invokeNative('globalShortcut.unregisterAll')
  },
  /** Subscribe to presses for shortcuts owned by this renderer. */
  onTriggered(listener: (event: GlobalShortcutRegistration) => void): () => void {
    if (typeof window === 'undefined') return () => {}
    const handler = (event: Event) => {
      listener((event as CustomEvent<GlobalShortcutRegistration>).detail)
    }
    window.addEventListener('murasaki:globalshortcut', handler)
    return () => window.removeEventListener('murasaki:globalshortcut', handler)
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
  setIcon(icon: string): Promise<void> {
    return invokeNative('tray.setIcon', { icon })
  },
  setMenu(items: TrayMenuItem[]): Promise<void> {
    return invokeNative('tray.setMenu', { items })
  },
  onClick(listener: (event: TrayClickEvent) => void): () => void {
    if (typeof window === 'undefined') return () => {}
    const handler = (event: Event) => listener((event as CustomEvent<TrayClickEvent>).detail)
    window.addEventListener('murasaki:trayclick', handler)
    return () => window.removeEventListener('murasaki:trayclick', handler)
  },
  onMenuItem(listener: (id: string) => void): () => void {
    if (typeof window === 'undefined') return () => {}
    const handler = (event: Event) => listener((event as CustomEvent<string>).detail)
    window.addEventListener('murasaki:traymenuclick', handler)
    return () => window.removeEventListener('murasaki:traymenuclick', handler)
  },
}
