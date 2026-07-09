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
  /**
   * Windows only — show the backend Node console window (useful for
   * CLI/debug logs). Default `false` (standalone GUI, no console).
   */
  console?: boolean
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

  /** `murasaki installer` styling/options — macOS `.dmg` fields plus Windows `.exe`/`.msi` fields below. */
  installer?: {
    /** Path (relative to project root) to a custom DMG background PNG. Overrides murasaki's default. */
    background?: string
    /** DMG window content size in points. Default { width: 640, height: 420 } (matches the default background). */
    window?: { width: number; height: number }
    /** Icon size in the DMG window. Default 128. */
    iconSize?: number

    /** Windows NSIS (`.exe`)/MSI (`.msi`) installer options. */
    windows?: {
      /**
       * `'perUser'` installs to `%LOCALAPPDATA%\Programs\<productName>` with
       * no admin prompt (the NSIS installer's default — the friendlier
       * choice for an unsigned app). `'perMachine'` installs to
       * `Program Files` and requires admin. The MSI installer is always
       * per-machine (WiX/Windows Installer convention) regardless of this
       * setting. Default `'perUser'`.
       */
      installMode?: 'perUser' | 'perMachine'
      /** Publisher name shown in the installer UI and Add/Remove Programs. Defaults to `authors.join(', ')`, then `copyright`, then `productName`. */
      publisher?: string
      /**
       * MSI UpgradeCode (a GUID) — must stay stable across versions for
       * upgrades to replace rather than duplicate-install. Defaults to a
       * GUID deterministically derived from `appId` (SHA-256-based), so you
       * normally don't need to set this yourself.
       */
      upgradeCode?: string

      /**
       * Installer/uninstaller icon (`.ico`). Applied to the NSIS installer
       * (`MUI_ICON`/`MUI_UNICON`) and the MSI's Add/Remove Programs entry
       * (`ARPPRODUCTICON`). Defaults to the app icon already generated from
       * top-level `icon` (`<bundle>/resources/icon.ico`); if that's also
       * unset, both installers fall back to their own default icon.
       */
      icon?: string
      /**
       * Wizard header/banner image. Path (relative to project root) to a
       * BMP: 150×57 for the NSIS installer (`MUI_HEADERIMAGE_BITMAP`), 493×58
       * for the MSI (`WixUIBannerBmp`) — the same file is handed to both, so
       * pick whichever size matters more, or provide one sized for the
       * installer you care about. Unset uses each installer's plain default.
       */
      banner?: string
      /**
       * Welcome/finish page side image. Path (relative to project root) to a
       * BMP: 164×314 for the NSIS installer (`MUI_WELCOMEFINISHPAGE_BITMAP`),
       * 493×312 for the MSI (`WixUIDialogBmp`) — same file handed to both.
       * Unset uses each installer's plain default.
       */
      sidebar?: string
      /**
       * License shown on a license-acceptance page. Path (relative to
       * project root) to a `.txt`/`.rtf` for the NSIS installer
       * (`MUI_PAGE_LICENSE` — added only when this is set) and a `.rtf` for
       * the MSI (`WixUILicenseRtf` — the MSI wizard always has a license
       * page, so a minimal placeholder is used when this is unset).
       */
      license?: string
    }
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
