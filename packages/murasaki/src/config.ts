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

/** A custom URL scheme registered by packaged macOS/Windows applications. */
export interface ProtocolConfig {
  /** RFC 3986 scheme, for example `my-app` in `my-app://open/42`. */
  scheme: string
  /** Human-readable handler name shown by the operating system. */
  name?: string
}

/** A document type the packaged application can open. */
export interface FileAssociationConfig {
  /** Extensions without a leading dot, for example `['note', 'mnote']`. */
  extensions: string[]
  /** Human-readable document type name. Defaults to `<productName> document`. */
  name?: string
  /** Optional document description used by Windows. */
  description?: string
  /** macOS document role. Defaults to `viewer`. */
  role?: 'viewer' | 'editor' | 'shell' | 'none'
  /** Optional MIME type used in Windows registration metadata. */
  mimeType?: string
}

/**
 * `true` enables the updater with every default inferred (GitHub repo from
 * `package.json#repository`, public key from `.murasaki/update-key.pub`,
 * stable channel, 6h re-check) — a complete, working config for a normal OSS
 * app. `false`/omitted disables it entirely. The object form only needs to
 * override what doesn't fit those defaults.
 *
 * There is deliberately no `provider` field — GitHub vs. self-hosted is
 * inferred from whether `repo` or `endpoint` is set (see `resolveUpdater`),
 * so it can't drift out of sync with the rest of the config.
 */
export type UpdaterConfig =
  | boolean
  | {
      /** GitHub "owner/repo". Defaults to `repository` in package.json. */
      repo?: string
      /** Self-hosted manifest URL (points at latest.json). Mutually exclusive with `repo`. */
      endpoint?: string
      /** Release channel. Default 'stable' (GitHub: ignores prereleases). */
      channel?: string
      /** Check once at launch. Default true. */
      checkOnStart?: boolean
      /** Re-check on a timer, e.g. '6h'. `false` disables. Default '6h'. */
      checkInterval?: string | false
      /** Ed25519 public key (base64, raw 32 bytes). Defaults to .murasaki/update-key.pub. */
      publicKey?: string
    }

/** The fully-resolved shape `resolveUpdater()` produces from a `UpdaterConfig`. */
export interface ResolvedUpdater {
  /** Absolute URL of latest.json. Derived from repo or endpoint. */
  manifestUrl: string
  /** base64 raw-32-byte Ed25519 public key. */
  publicKey: string
  channel: string
  checkOnStart: boolean
  /** milliseconds, or false */
  checkIntervalMs: number | false
}

/**
 * `resolveUpdater()` — which resolves a `UpdaterConfig` down to a
 * `ResolvedUpdater` per contract §3 — lives in `resolve-updater.ts`, not
 * here. It does filesystem/env I/O (reads `package.json`,
 * `.murasaki/update-key.pub`), and this module must stay free of any Node
 * builtin imports: `index.ts`'s client-facing barrel re-exports
 * `defineConfig`/`UpdaterConfig` from here, so anything this file imports
 * is reachable from a browser bundle.
 */

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

  /**
   * Native commands exposed to trusted renderer code through `murasaki/native`.
   * Default is deny-all; grant only the capabilities the app uses.
   */
  capabilities?: NativeCapability[]

  /** Long-lived Node main process (`src/main.ts` by default when present). */
  main?: false | {
    /** Entry relative to the project root. Default `src/main.ts`. */
    entry?: string
    /** Maximum graceful cleanup time before the native host exits. Default 10s. */
    shutdownTimeoutMs?: number
  }

  /** Production packaging for Node-side code and non-code assets. */
  bundle?: {
    /**
     * Additional npm packages to keep external from the server/main bundle
     * and copy into the packaged app. Static bare imports are detected and
     * staged automatically; list packages here when they are loaded through
     * a computed import/require or by a plugin at runtime.
     */
    external?: string[]
    /**
     * Bare npm packages that should be compiled into dist/server instead of
     * staged in node_modules. Framework packages are bundled by default. Do
     * not use this for native add-ons or packages with runtime data files.
     */
    noExternal?: string[]
    /**
     * Files/directories copied into the packaged resources directory. The
     * string form copies to its basename; the object form chooses a relative
     * destination. Useful for Prisma schemas, migrations, models, and other
     * data that JavaScript bundlers cannot discover.
     */
    resources?: Array<string | { from: string; to?: string }>
  }

  /** Client/server build orchestration and public client environment prefixes. */
  build?: {
    /** Command run before the client and Node bundles (for workspace packages, codegen, etc.). */
    before?: string
    /** Variables with these prefixes may be embedded in renderer code. Default `VITE_` and `NEXT_PUBLIC_`. */
    envPrefix?: string[]
  }

  /**
   * Auto-update config. `true` is a complete, working setup for a normal OSS
   * app (GitHub repo inferred from `package.json`, public key from
   * `.murasaki/update-key.pub`). See `UpdaterConfig`/`resolveUpdater`.
   */
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

  /**
   * Custom URL schemes registered by packaged macOS apps and Windows
   * installers. Open requests are delivered to `defineMain({ openRequested })`.
   */
  protocols?: ProtocolConfig[]

  /**
   * File extensions registered by packaged macOS apps and Windows installers.
   * Open requests are delivered to `defineMain({ openRequested })`.
   */
  fileAssociations?: FileAssociationConfig[]

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

export type NativeCapability =
  | 'dialog:openFile'
  | 'dialog:openDirectory'
  | 'dialog:saveFile'
  | 'clipboard:readText'
  | 'clipboard:writeText'
  | 'notification:show'
  | 'shell:openExternal'
  | 'shell:showItemInFolder'
  | 'window:setTitle'
  | 'window:setSize'
  | 'window:minimize'
  | 'window:toggleMaximize'
  | 'window:show'
  | 'window:hide'
  | 'window:focus'
  | 'window:close'
  | 'window:setAlwaysOnTop'
  | 'window:isVisible'
  | 'window:isFocused'
  | 'window:isMaximized'
  | 'window:isMinimized'
  | 'tray:create'
  | 'tray:remove'
  | 'tray:setTooltip'

export function defineConfig(config: MurasakiConfig): MurasakiConfig {
  return config
}
