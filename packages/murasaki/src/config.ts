export interface WindowConfig {
  title?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  resizable?: boolean
  transparent?: boolean
  /**
   * macOS translucent window vibrancy. NOTE: declared but not yet applied by
   * the native binding — setting it is a no-op today (support is planned).
   */
  vibrancy?: 'hud' | 'sidebar' | 'popover' | null
}

export type UpdaterConfig =
  | {
      provider: 'github'
      repo: string
      channel?: string
      checkOnStart?: boolean
      checkInterval?: string
    }
  | {
      provider: 'custom'
      endpoint: string
      publicKey?: string
      checkOnStart?: boolean
      checkInterval?: string
    }

export interface MurasakiConfig {
  appId: string
  productName: string
  version?: string

  /** Short description shown in the native "About <app>" panel. */
  description?: string

  /** Copyright notice shown in the native "About <app>" panel. */
  copyright?: string

  /** Homepage URL shown in the native "About <app>" panel. */
  homepage?: string

  /** Author names shown in the native "About <app>" panel (Windows/Linux only). */
  authors?: string[]

  window?: WindowConfig
  updater?: UpdaterConfig

  /**
   * BCP-47 UI languages your app supports, e.g. ['en', 'ja']. Feeds the macOS
   * bundle's CFBundleLocalizations (so macOS localizes its injected menus and
   * standard dialogs) and constrains murasaki's native default menu: it follows
   * the system language when that language is in this list, otherwise falls back
   * to the first entry. Defaults to every language murasaki ships menu
   * translations for (en, ja, zh-Hans, ko, es, fr, de).
   */
  locales?: string[]

  /** Vite server port during `murasaki dev`. Defaults to 5178. */
  devPort?: number

  /** Build targets. Defaults to the host platform. */
  targets?: Array<
    | 'darwin-arm64'
    | 'darwin-x64'
    | 'win32-x64'
    | 'win32-arm64'
    | 'linux-x64'
    | 'linux-arm64'
  >

  /** Icon source (PNG). `murasaki icon` fans this out to .icns/.ico/set. */
  icon?: string

  /** `murasaki installer` DMG styling. Omit to use murasaki's default background. */
  installer?: {
    /** Path (relative to project root) to a custom DMG background PNG. Overrides murasaki's default. */
    background?: string
    /** DMG window content size in points. Default { width: 640, height: 420 } (matches the default background). */
    window?: { width: number; height: number }
    /** Icon size in the DMG window. Default 128. */
    iconSize?: number
  }

  /**
   * macOS code-signing. murasaki signs with YOUR certificate — it ships none.
   * Secrets (notarization credentials) are read from env vars, never here.
   */
  sign?: {
    /** Signing identity, e.g. "Developer ID Application: Name (TEAMID)". Defaults to
     *  $MURASAKI_SIGN_IDENTITY, then the first "Developer ID Application" in your keychain. */
    identity?: string
    /** Path to a custom entitlements .plist. Defaults to a Node-friendly hardened-runtime set. */
    entitlements?: string
  }
}

export function defineConfig(config: MurasakiConfig): MurasakiConfig {
  return config
}
