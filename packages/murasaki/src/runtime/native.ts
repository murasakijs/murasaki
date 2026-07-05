/**
 * Thin wrapper around `@murasakijs/native`. Keeps a single import surface
 * so higher layers (CLI, react/updater) never touch the prebuild directly.
 */
export interface WindowOptions {
  title?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  resizable?: boolean
  transparent?: boolean
  vibrancy?: 'hud' | 'sidebar' | 'popover' | null
  /** macOS only. Resolved path to a PNG icon shown in the standard "About
   * <app>" panel. */
  icon?: string
  /** Populates the "Version" field of the native "About <app>" panel. */
  version?: string
  /** Populates the description field of the native "About <app>" panel. */
  description?: string
  /** Populates the copyright field of the native "About <app>" panel. */
  copyright?: string
  /** Populates the homepage/website field of the native "About <app>" panel. */
  homepage?: string
  /** Populates the authors field of the native "About <app>" panel. */
  authors?: string[]
}

export interface WebviewOptions {
  url?: string
  html?: string
  devtools?: boolean
  transparent?: boolean
  /** Production only: serves this directory via the native custom protocol
   * (`murasaki://localhost/…`), taking priority over `url`/`html`. */
  serveDir?: string
}

export interface NativeWebview {
  loadUrl(url: string): void
  loadHtml(html: string): void
  evaluate(js: string): void
  onIpcMessage(cb: (msg: string) => void): void
  showContextMenu(menu: unknown, position?: { x: number; y: number }): void
  openDevtools(): void
}

export interface NativeWindow {
  createWebview(opts: WebviewOptions): NativeWebview
  setTitle(t: string): void
  setSize(w: number, h: number): void
  close(): void
}

interface NativeModule {
  Application: new () => {
    createWindow(opts: WindowOptions): NativeWindow
    createWebview(windowOpts: WindowOptions, webviewOpts: WebviewOptions): NativeWebview
    run(): void
    exit(): void
    onQuit(cb: () => void): void
    setIconPath(path: string): void
  }
  showNotification: (opts: {
    title: string
    body?: string
    icon?: string
  }) => void
  openFileDialog: (opts?: unknown) => string[]
  openDirectoryDialog: (opts?: unknown) => string | null
  saveFileDialog: (opts?: unknown) => string | null
  clipboardRead: () => string
  clipboardWrite: (s: string) => void
  shellOpenExternal: (url: string) => void
  version: () => string
}

let cached: NativeModule | null = null

export async function loadNative(): Promise<NativeModule> {
  if (cached) return cached
  const mod = (await import('@murasakijs/native')) as unknown as NativeModule
  cached = mod
  return mod
}
