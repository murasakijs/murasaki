/**
 * Thin wrapper around `@murasakijs/native`. Keeps a single import surface
 * so higher layers (CLI, react/updater) never touch the prebuild directly.
 */

/**
 * Localized labels for the standard menu bar — macOS's App/Edit/Window and
 * Windows's/Linux's File/Edit/Window — see `../menu-i18n.ts` for the
 * resolver. All fields optional since any left unset fall back to an
 * English default on the native side.
 */
export interface MenuLabels {
  about?: string
  services?: string
  hide?: string
  hideOthers?: string
  showAll?: string
  quit?: string
  edit?: string
  undo?: string
  redo?: string
  cut?: string
  copy?: string
  paste?: string
  selectAll?: string
  window?: string
  minimize?: string
  zoom?: string
}

export interface WindowOptions {
  /** Stable declarative window label (`main` for the primary window). */
  label?: string
  /** Whether this is the primary application window. Exactly one window is primary. */
  primary?: boolean
  title?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  /** Both axes must be present together; a solitary axis is rejected. */
  maxWidth?: number
  maxHeight?: number
  resizable?: boolean
  transparent?: boolean
  /** Initial native visibility. Secondary declarative windows default false. */
  visible?: boolean
  /** Shows/hides native window chrome on every platform. Default true. */
  decorations?: boolean
  /** macOS only. Accepted (and ignored) on Windows/Linux. */
  titleBarStyle?: 'default' | 'hidden'
  /** Initial borderless-fullscreen state. */
  fullscreen?: boolean
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
  /** Localized labels for the standard menu bar (macOS App/Edit/Window,
   * Windows File/Edit/Window). */
  menuLabels?: MenuLabels
}

export interface WebviewOptions {
  url?: string
  html?: string
  devtools?: boolean
  transparent?: boolean
  /** Stable application id used to isolate the native WebView profile. */
  appId?: string
  /** Complete custom User-Agent value for the native WebView. */
  userAgent?: string
  /** Use a non-persistent private session. */
  incognito?: boolean
  /** Unauthenticated application-wide HTTP CONNECT or SOCKSv5 proxy. */
  proxy?: {
    protocol: 'http' | 'socks5'
    host: string
    port: number
  }
  /** Native renderer command allowlist. Omitted means deny-all. */
  capabilities?: string[]
  /** Versioned JSON value-scope policy. `capabilities` remains the legacy
   * permission-name projection for older native binaries. */
  capabilityPolicy?: string
  /** Default PNG path used by the renderer tray API. */
  trayIcon?: string
  /** Production only: serves this directory via the native custom protocol
   * (`murasaki://localhost/…`), taking priority over `url`/`html`. */
  serveDir?: string
  /** Confines `webview:download`-granted downloads to this directory.
   * Omitted/absent `directory` resolves to the OS user Downloads folder. */
  downloads?: { directory?: string }
  /** Trusted JavaScript file contents (already read from disk), applied in
   * declaration order before every page load. Not capability-gated. */
  initScripts?: string[]
  /** Enables OS page-zoom hotkeys/gestures. Effective on Windows only. */
  hotkeysZoom?: boolean
}

/** Immutable native window template configured before the application loop starts. */
export interface RuntimeWindowTemplate {
  window: WindowOptions
  webview: WebviewOptions
  createOnLaunch: boolean
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
    configureWindows(templates: RuntimeWindowTemplate[]): void
    configureShutdown?(port: number, runtimeToken: string, timeoutMs: number): void
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
