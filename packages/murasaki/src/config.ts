import type { PluginOption } from 'vite'

export type MurasakiBuildTarget =
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'win32-x64'
  | 'win32-arm64'
  | 'linux-x64'
  | 'linux-arm64'

export type BundleResource = string | {
  from: string
  to?: string
  /**
   * Marks an app-owned executable sidecar for platform code signing. Required
   * for executable files shipped through `bundle.resources`; ordinary data
   * files must leave this false/undefined.
   */
  executable?: boolean
}

export interface BundleConfig {
  /** Packages staged in the packaged app instead of compiled into server code. */
  external?: string[]
  /** JavaScript packages forced into the compiled server bundle. */
  noExternal?: string[]
  /**
   * Files/directories copied into packaged resources. Executable sidecars
   * must use the object form with `executable: true` so macOS/Windows signing
   * can seal them before the outer application artifact.
   */
  resources?: BundleResource[]
}

export interface WebviewProxyConfig {
  /** `http` uses HTTP CONNECT; `socks5` uses SOCKSv5. */
  protocol: 'http' | 'socks5'
  /** Hostname or IP literal only. URLs, credentials, and paths are rejected. */
  host: string
  /** TCP port from 1 through 65535. */
  port: number
}

/** `webview:download`-granted downloads' confinement directory. */
export interface WebviewDownloadsConfig {
  /**
   * Absolute directory downloads are confined to. Defaults to the OS user
   * Downloads folder when omitted (resolved natively per-OS).
   */
  directory?: string
}

/** Application-wide native WebView session and network configuration. */
export interface WebviewConfig {
  /** Complete custom User-Agent header value. */
  userAgent?: string
  /** Use a non-persistent private session instead of the app profile. */
  incognito?: boolean
  /** Unauthenticated proxy applied to every application WebView. */
  proxy?: WebviewProxyConfig
  /** Confines `webview:download`-granted downloads to a directory. */
  downloads?: WebviewDownloadsConfig
  /**
   * Trusted, project-root-relative JavaScript file paths injected into every
   * page before load (in this declaration order), via
   * `with_initialization_script_for_main_only`. Not capability-gated —
   * config is already fully trusted, unlike renderer-triggered commands.
   * Each file is bounded to 256 KiB and the combined total to 1 MiB,
   * enforced when the project is loaded (see `resolveInitScripts`).
   */
  initScripts?: string[]
  /**
   * Enables OS page-zoom hotkeys/gestures. Effective on Windows (WebView2)
   * only; no-op on macOS/Linux.
   */
  hotkeysZoom?: boolean
}

/** Local crash report capture (Node, native, and prod renderer domains). Murasaki never transmits these. */
export interface DiagnosticsConfig {
  /**
   * Capture uncaught exceptions/rejections (Node Main), native panics and
   * unexpected exits, and prod renderer errors as local crash report files.
   * Default `true`.
   */
  crashReports?: boolean
  /** Newest crash reports retained per app. Default 20; out-of-range values are clamped to 1-100. */
  keepReports?: number
}

export type MurasakiPluginCommand = 'dev' | 'build' | 'bundle'

export type MurasakiDeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly MurasakiDeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: MurasakiDeepReadonly<T[Key]> }
      : T

/** Immutable build configuration exposed to a trusted build-time plugin hook. */
export type MurasakiPluginHookConfig = MurasakiDeepReadonly<Omit<MurasakiConfig, 'plugins'>>

export interface MurasakiPluginHookContext {
  readonly projectRoot: string
  readonly config: MurasakiPluginHookConfig
  readonly command: MurasakiPluginCommand
  readonly target?: MurasakiBuildTarget
}

export interface MurasakiPluginHooks {
  before?: (context: MurasakiPluginHookContext) => void | Promise<void>
  after?: (context: MurasakiPluginHookContext) => void | Promise<void>
}

/**
 * A trusted, build-time Murasaki extension. This is not a native Rust ABI or
 * a runtime plugin system: installing a plugin grants it the same privileges
 * as code in murasaki.config.ts.
 */
export interface MurasakiPlugin {
  /** Stable identifier used in diagnostics and duplicate detection. */
  name: string
  /** Vite plugins appended in declaration order after Murasaki's core plugins. */
  vite?: PluginOption
  /** Deterministic additions to the application's packaging configuration. */
  bundle?: BundleConfig
  /** Serial CLI lifecycle hooks. A rejection stops the command. */
  hooks?: MurasakiPluginHooks
}

/** Type-safe identity helper for authoring a trusted build-time plugin. */
export function defineMurasakiPlugin(plugin: MurasakiPlugin): MurasakiPlugin {
  return plugin
}

export interface WindowConfig {
  title?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  /**
   * Maximum inner width/height, in logical pixels. Setting only one axis is
   * rejected — provide both or neither. Must be greater than or equal to
   * `minWidth`/`minHeight` when both are configured.
   */
  maxWidth?: number
  maxHeight?: number
  resizable?: boolean
  transparent?: boolean
  /**
   * Shows/hides the OS window chrome (titlebar + borders). Default `true`;
   * `false` produces a frameless window on every platform. Pair with
   * `useWindowDrag()` for a custom, draggable titlebar region.
   */
  decorations?: boolean
  /**
   * macOS only. `'hidden'` keeps the traffic-light buttons but hides the
   * title text and extends the WebView under the titlebar. Accepted (and
   * ignored) on Windows/Linux.
   */
  titleBarStyle?: 'default' | 'hidden'
  /** Initial borderless-fullscreen state. Exclusive fullscreen is not supported. */
  fullscreen?: boolean
  /**
   * macOS translucent window vibrancy. The native host automatically makes
   * the tao window and WebView transparent when a material is configured.
   */
  vibrancy?: 'hud' | 'sidebar' | 'popover' | null
  /**
   * Windows only — show the backend Node console window (useful for
   * CLI/debug logs). Default `false` (standalone GUI, no console).
   */
  console?: boolean

  /** Same-origin renderer route loaded into this window. Defaults to `/`. */
  route?: string
  /** Whether the window is initially visible. The primary window defaults to true. */
  visible?: boolean
  /**
   * Native renderer command allowlist. The primary window falls back to the
   * top-level list; a secondary window with no list remains deny-all.
   */
  capabilities?: NativeCapabilityGrant[]

  /**
   * Node/backend operations exposed to this renderer. Default deny-all.
   * Grants use stable resource IDs such as `main:src/backend.ts#read`,
   * `action:src/actions.ts#save`, `api:GET:/api/items/*`, `updater:*`,
   * `events:*`, or `diagnostics:renderer-error`. A single trailing `*` is a
   * prefix wildcard; no other wildcard placement is accepted.
   */
  backendCapabilities?: BackendCapability[]
}

/** A declaratively-created non-primary application window. */
export type SecondaryWindowConfig = Omit<WindowConfig, 'console'> & {
  /** Create this window during application launch. Defaults to true. */
  createOnLaunch?: boolean
}

/** Fully-resolved window declaration written to bundle metadata. */
export interface ResolvedWindowConfig extends WindowConfig {
  label: string
  primary: boolean
  route: string
  visible: boolean
  createOnLaunch: boolean
  capabilities: NativeCapabilityGrant[]
  backendCapabilities: BackendCapability[]
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

export interface MacOSCapturePermissionConfig {
  /** Text macOS shows in its consent dialog and System Settings. */
  usageDescription: string
  /** Ask as the native host starts. Prefer an in-context request when possible. */
  requestOnLaunch?: boolean
}

export interface MacOSPromptPermissionConfig {
  /** Ask as the native host starts. */
  requestOnLaunch?: boolean
}

/**
 * Core Location consent. Unlike `MacOSPromptPermissionConfig`, this requires
 * a purpose string (Core Location refuses to prompt without one).
 */
export interface MacOSLocationPermissionConfig {
  /** Text macOS shows in its consent dialog and System Settings. */
  usageDescription: string
  /**
   * `'whenInUse'` (default) writes only `NSLocationWhenInUseUsageDescription`.
   * `'always'` additionally writes `NSLocationAlwaysAndWhenInUseUsageDescription`
   * (Apple requires the when-in-use key present even for an always request)
   * and requests always-authorization instead of when-in-use.
   */
  mode?: 'whenInUse' | 'always'
  /** Ask as the native host starts. Prefer an in-context request when possible. */
  requestOnLaunch?: boolean
}

/**
 * A macOS TCC purpose string with no meaningful launch-time request: the OS
 * itself decides when to prompt (per-target automation, or the first actual
 * local-network access), so there is no `requestOnLaunch` — see
 * `appleEvents`/`localNetwork` below.
 */
export interface MacOSDeclarationOnlyPermissionConfig {
  /** Text macOS shows in its consent dialog and System Settings. */
  usageDescription: string
}

/** macOS TCC permissions supported by Murasaki's native host. */
export interface MacOSSystemPermissionsConfig {
  camera?: MacOSCapturePermissionConfig
  microphone?: MacOSCapturePermissionConfig
  screenRecording?: MacOSPromptPermissionConfig
  accessibility?: MacOSPromptPermissionConfig
  /** Listen Event access (global keyboard/mouse taps), e.g. for a global shortcut library. */
  inputMonitoring?: MacOSPromptPermissionConfig
  location?: MacOSLocationPermissionConfig
  /**
   * Full Disk Access has no TCC request API — macOS only lets a user grant it
   * from System Settings. `requestOnLaunch` therefore means something
   * different here than for the other permissions above: if the heuristic
   * status isn't `granted`, the native host opens the Full Disk Access pane
   * in System Settings instead of showing an in-app consent prompt.
   */
  fullDiskAccess?: MacOSPromptPermissionConfig
  /** Photos library (read-write). Writes `NSPhotoLibraryUsageDescription`. */
  photos?: MacOSCapturePermissionConfig
  /** Writes `NSContactsUsageDescription`. */
  contacts?: MacOSCapturePermissionConfig
  /**
   * Calendar events (EventKit). Writes `NSCalendarsUsageDescription` and,
   * since the native host's launch-time request uses the macOS 14+ full-access
   * API when running on 14+ (falling back to the deprecated pre-14 API
   * otherwise), also writes `NSCalendarsFullAccessUsageDescription` so a
   * single build stays correct on both.
   */
  calendar?: MacOSCapturePermissionConfig
  /**
   * Reminders (EventKit). Writes `NSRemindersUsageDescription` and (see
   * `calendar` above for why) `NSRemindersFullAccessUsageDescription`.
   */
  reminders?: MacOSCapturePermissionConfig
  /** Writes `NSSpeechRecognitionUsageDescription`. */
  speechRecognition?: MacOSCapturePermissionConfig
  /**
   * CoreBluetooth has no explicit request call — consent is determined
   * implicitly the first time the native host stands up a Bluetooth central
   * manager. Writes `NSBluetoothAlwaysUsageDescription`.
   */
  bluetooth?: MacOSCapturePermissionConfig
  /**
   * Automation (sending Apple Events to another app). Writes
   * `NSAppleEventsUsageDescription`. Declaration-only: consent is granted per
   * TARGET app and only resolvable at send time, so there is no generic
   * `status()`/`requestOnLaunch` — a runtime `systemPermission.request('appleEvents')`
   * call only opens System Settings' Automation pane as guidance (like
   * `fullDiskAccess`) and `status()` always reports `unknown`.
   */
  appleEvents?: MacOSDeclarationOnlyPermissionConfig
  /**
   * Writes `NSLocalNetworkUsageDescription`. Declaration-only: macOS has no
   * query/request API at all for this — it prompts automatically the first
   * time the app actually attempts local-network traffic. `status()`/
   * `request()` both always report `unknown`.
   */
  localNetwork?: MacOSDeclarationOnlyPermissionConfig
}

/** Host-OS consent declarations. Separate from renderer native capabilities. */
export interface SystemPermissionsConfig {
  macOS?: MacOSSystemPermissionsConfig
}

/** Windows Authenticode settings used by `bundle --sign` and `installer --sign`. */
export interface WindowsSigningConfig {
  /** PFX/P12 certificate file. The optional password is read only from
   * `MURASAKI_WINDOWS_CERTIFICATE_PASSWORD`, never from this config. */
  certificateFile?: string
  /** Subject-name selector for a certificate already imported into the Windows `My` store. */
  certificateSubjectName?: string
  /** 40-character SHA-1 thumbprint selector for a certificate in the Windows `My` store. */
  certificateSha1?: string
  /** Certificate-store scope. Defaults to the current user's store. */
  certificateStore?: 'currentUser' | 'localMachine'
  /** RFC 3161 timestamp URL. `false` disables timestamping. Defaults to the
   * Microsoft Artifact Signing timestamp service for Artifact Signing and
   * DigiCert's timestamp service otherwise. */
  timestampUrl?: string | false
  /** Explicit path to `signtool.exe`. Normally auto-detected from PATH or the Windows SDK. */
  signToolPath?: string
  /** Microsoft Artifact Signing (formerly Trusted Signing) SignTool provider.
   * Authentication remains outside config (Azure CLI, workload identity, or managed identity). */
  artifactSigning?: {
    /** Path to `Azure.CodeSigning.Dlib.dll`. */
    dlib: string
    /** Path to Artifact Signing's non-secret account/profile metadata JSON. */
    metadata: string
  }
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
      /**
       * Self-hosted manifest URL (points at latest.json). Mutually exclusive
       * with `repo`. Must be `https:` — `http:` is only accepted for
       * loopback hosts (`127.0.0.1`, `localhost`, `[::1]`), for local
       * testing. Enforced here and again at fetch time in the runtime
       * engine.
       */
      endpoint?: string
      /** Release channel. Default 'stable' (GitHub: ignores prereleases). */
      channel?: string
      /** Check once at launch. Default true. */
      checkOnStart?: boolean
      /** Re-check on a timer, e.g. '6h'. `false` disables. Default '6h'. */
      checkInterval?: string | false
      /** Ed25519 public key (base64, raw 32 bytes). Defaults to .murasaki/update-key.pub. */
      publicKey?: string
      /**
       * Additional pinned Ed25519 public keys (base64, raw 32 bytes each;
       * at most 4) for key rotation. Merged with `publicKey` into one
       * deduplicated pinned set — verification tries every pinned key
       * until one succeeds. See the auto-update guide's rotation runbook.
       */
      publicKeys?: string[]
      /**
       * Maximum accepted age, in days, of a manifest's `generatedAt`
       * timestamp — an anti-freeze/replay guard: a manifest older than this
       * is rejected outright. Default 90, minimum 1.
       */
      maxManifestAgeDays?: number
      /**
       * Compatibility escape hatch for manifests created before `generatedAt`
       * existed. Default false: production rejects a missing timestamp because
       * an old, still-validly-signed manifest can otherwise be replayed.
       */
      allowLegacyManifestsWithoutGeneratedAt?: boolean
    }

/** The fully-resolved shape `resolveUpdater()` produces from a `UpdaterConfig`. */
export interface ResolvedUpdater {
  /** Absolute URL of latest.json. Derived from repo or endpoint. */
  manifestUrl: string
  /** base64 raw-32-byte Ed25519 public key — the primary pinned key (back-compat; also `publicKeys[0]`). */
  publicKey: string
  /** Every pinned Ed25519 public key (base64 raw 32 bytes), deduplicated — the union of `publicKey` and `publicKeys`. Verification tries each until one succeeds. */
  publicKeys: string[]
  channel: string
  checkOnStart: boolean
  /** milliseconds, or false */
  checkIntervalMs: number | false
  /** Maximum accepted age, in days, of a manifest's `generatedAt`. */
  maxManifestAgeDays: number
  /** Whether a signed legacy manifest may omit `generatedAt`. */
  allowLegacyManifestsWithoutGeneratedAt: boolean
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
   * Declarative secondary windows keyed by their stable native label.
   * `main` is reserved for the primary `window` declaration.
   */
  windows?: Record<string, SecondaryWindowConfig>

  /**
   * Native commands exposed to trusted renderer code through `murasaki/native`.
   * Default is deny-all; grant only the capabilities the app uses.
   */
  capabilities?: NativeCapabilityGrant[]

  /** Primary-window backend grants. Secondary windows remain deny-all unless declared. */
  backendCapabilities?: BackendCapability[]

  /**
   * Host operating-system permissions. On macOS, camera/microphone usage
   * descriptions are embedded into Info.plist and selected permissions can
   * be requested at launch. Windows desktop consent remains usage-driven.
   */
  systemPermissions?: SystemPermissionsConfig

  /** Long-lived Node main process (`src/main.ts` by default when present). */
  main?: false | {
    /** Entry relative to the project root. Default `src/main.ts`. */
    entry?: string
    /** End-to-end limit for `beforeQuit` plus `shutdown` before host exit. Default 10s. */
    shutdownTimeoutMs?: number
  }

  /** Production packaging for Node-side code and non-code assets. */
  bundle?: BundleConfig

  /** Trusted build-time extensions. Plugin objects are never written to app metadata. */
  plugins?: MurasakiPlugin[]

  /** Application-wide native WebView session and network settings. */
  webview?: WebviewConfig

  /** Client/server build orchestration and public client environment prefixes. */
  build?: {
    /** Command run before the client and Node bundles (for workspace packages, codegen, etc.). */
    before?: string
    /** Variables with these prefixes may be embedded in renderer code. Default `MURASAKI_PUBLIC_`. */
    envPrefix?: string[]
  }

  /** Local crash report capture. See `DiagnosticsConfig`. */
  diagnostics?: DiagnosticsConfig

  /** Renderer security policy applied to framework- and user-owned HTML. */
  security?: {
    /**
     * Content Security Policy injected as a single `<meta http-equiv>` tag.
     * A string completely replaces Murasaki's environment-specific default;
     * `false` opts out of framework injection. A user-owned CSP meta tag is
     * normalized to the start of `<head>`; setting both sources is an error.
     */
    csp?: string | false
  }

  /**
   * Auto-update config. `true` is a complete, working setup for a normal OSS
   * app (GitHub repo inferred from `package.json`, public key from
   * `.murasaki/update-key.pub`). Enabling it also grants the primary renderer
   * `app:quit` for the verified restart handshake. See
   * `UpdaterConfig`/`resolveUpdater`.
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
  targets?: MurasakiBuildTarget[]

  /**
   * Square app-icon source (PNG; 1024px recommended). On macOS with full
   * Xcode installed, Murasaki compiles an AppIcon asset catalog so the OS
   * applies the current platform mask and appearances. A legacy `.icns` is
   * retained for older macOS/tooling; Windows/Linux assets are generated from
   * the same source.
   */
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
    /** DMG window content size in points. Defaults to `width: 640, height: 420` to match the default background. */
    window?: { width: number; height: number }
    /** Icon size in the DMG window. Default 128. */
    iconSize?: number

    /** Windows NSIS (`.exe`)/MSI (`.msi`) installer options. */
    windows?: {
      /**
       * `'perUser'` installs to `%LOCALAPPDATA%\Programs\<productName>` with
       * no admin prompt (the NSIS installer's default — the friendlier
       * choice for an unsigned app). `'perMachine'` installs to
       * `Program Files` and requires admin. Built-in self-update is intentionally
       * incompatible with `perMachine`, because a non-elevated running app cannot
       * transactionally replace files under Program Files. Default `'perUser'`.
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

  /** Code-signing. Murasaki signs with YOUR certificate/provider — it ships none.
   * Secrets (notarization credentials and PFX passwords) are read from env vars, never here. */
  sign?: {
    /** Signing identity, e.g. "Developer ID Application: Name (TEAMID)". Defaults to
     *  $MURASAKI_SIGN_IDENTITY, then the first "Developer ID Application" in your keychain. */
    identity?: string
    /** Path to a custom entitlements .plist for the main app executable.
     * Defaults to the minimum host entitlements derived from `systemPermissions`.
     * A configured path must exist; Murasaki never silently falls back. */
    entitlements?: string
    /** Path to a custom entitlements .plist for the bundled Node helper.
     * Defaults to the JIT/library-loading hardened-runtime permissions.
     * App Sandbox/inherit rights are rejected by the current architecture. */
    helperEntitlements?: string
    /**
     * Reserved for a future macOS App Sandbox process architecture. `true` is
     * currently rejected fail-closed: the bundled Node runtime requires
     * hardened-runtime/JIT entitlements that Apple does not permit on an
     * `app-sandbox` + `inherit` child. Default `false`.
     */
    appSandbox?: boolean
    /** Windows Authenticode signing for the application executable, portable ZIP payload,
     * NSIS setup executable, and MSI installer. */
    windows?: WindowsSigningConfig
  }
}

/** Canonical runtime allowlist. Keep native permission dispatch in sync with this list. */
export const NATIVE_CAPABILITIES = [
  'app:quit',
  'app:isElevated',
  'autostart:read',
  'autostart:write',
  'dialog:openFile',
  'dialog:openDirectory',
  'dialog:saveFile',
  'dialog:message',
  'clipboard:readText',
  'clipboard:writeText',
  'clipboard:readImage',
  'clipboard:writeImage',
  'clipboard:writeHtml',
  'menu:application',
  'menu:context',
  'notification:show',
  'shell:openExternal',
  'shell:showItemInFolder',
  'shell:trashItem',
  'shell:openPath',
  'shell:runElevated',
  'secureStorage:get',
  'secureStorage:set',
  'secureStorage:delete',
  'systemPermission:status',
  'systemPermission:request',
  'window:setTitle',
  'window:setSize',
  'window:minimize',
  'window:toggleMaximize',
  'window:show',
  'window:hide',
  'window:focus',
  'window:close',
  'window:setAlwaysOnTop',
  'window:isVisible',
  'window:isFocused',
  'window:isMaximized',
  'window:isMinimized',
  'window:getLabel',
  'window:open',
  'window:list',
  'window:manage',
  'globalShortcut:register',
  'globalShortcut:unregister',
  'tray:create',
  'tray:remove',
  'tray:setTooltip',
  'tray:setIcon',
  'tray:setMenu',
  'webview:download',
  'webview:dragDrop',
  'webview:zoom',
  'webview:print',
  'webview:readCookies',
  'webview:writeCookies',
] as const

export type NativeCapability = (typeof NATIVE_CAPABILITIES)[number]

export interface ElevatedExecutionScope {
  /** Exact absolute path to the executable that may receive elevation. */
  executable: string
  /** Exact argv sequence. Omit for an executable that accepts no arguments. */
  args?: string[]
}

/**
 * Optional value-level constraints for a renderer-native permission.
 *
 * String grants remain backwards compatible and unrestricted. Use the object
 * form when a command accepts an external target so a compromised renderer
 * cannot turn one permission into arbitrary URL/path/window access.
 */
export interface NativeCapabilityScope {
  /** Exact URLs, or an absolute URL ending in `/**` for a path subtree. */
  urls?: string[]
  /** Exact absolute paths, or an absolute directory ending in `/**`. */
  paths?: string[]
  /** Exact executable + argv pairs accepted by `shell:runElevated`. */
  executions?: ElevatedExecutionScope[]
  /** Declarative native window labels. */
  windows?: string[]
  /** Host permissions that may be queried/requested. */
  permissions?: SystemPermissionName[]
  /** Exact secure-storage keys, or a key prefix ending in `*`. */
  keys?: string[]
}

export interface ScopedNativeCapability {
  permission: NativeCapability
  /** Values this permission may operate on. Omitted means unrestricted. */
  allow?: NativeCapabilityScope
  /** Values denied before the allow list is considered. */
  deny?: NativeCapabilityScope
}

export type NativeCapabilityGrant = NativeCapability | ScopedNativeCapability

/** A renderer-to-Node/API authority resource ID. See `WindowConfig.backendCapabilities`. */
export type BackendCapability = string

const NATIVE_CAPABILITY_SET: ReadonlySet<string> = new Set(NATIVE_CAPABILITIES)

/** Default end-to-end bound for Node main quit hooks. */
export const DEFAULT_MAIN_SHUTDOWN_TIMEOUT_MS = 10_000

/**
 * Keep native-host shutdown waits bounded. Five minutes is deliberately well
 * above normal cleanup while still preventing a malformed config from
 * turning application exit into an effectively unbounded socket wait.
 */
export const MAX_MAIN_SHUTDOWN_TIMEOUT_MS = 300_000

export function validateMainShutdownTimeoutMs(
  value: unknown,
): asserts value is number | undefined {
  if (value === undefined) return
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > MAX_MAIN_SHUTDOWN_TIMEOUT_MS) {
    throw new TypeError(
      `main.shutdownTimeoutMs must be a positive safe integer no greater than ${MAX_MAIN_SHUTDOWN_TIMEOUT_MS}`,
    )
  }
}

export function defineConfig(config: MurasakiConfig): MurasakiConfig {
  validateConfig(config)
  return config
}

/**
 * Runtime validation used by every CLI config loader as well as defineConfig().
 * Config files are executable JavaScript, so their exports cannot be trusted to
 * have passed TypeScript checking (and users are not required to call
 * defineConfig()).
 */
export function validateConfig(config: unknown): asserts config is MurasakiConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new TypeError('murasaki config must export an object')
  }
  const candidate = config as MurasakiConfig
  for (const field of ['appId', 'productName'] as const) {
    if (typeof candidate[field] !== 'string' || candidate[field].trim().length === 0) {
      throw new TypeError(`${field} must be a non-empty string`)
    }
  }
  validateAppId(candidate.appId)
  validateArtifactComponent(candidate.productName, 'productName')
  if (candidate.version !== undefined) {
    if (typeof candidate.version !== 'string' || candidate.version.trim().length === 0) {
      throw new TypeError('version must be a non-empty string')
    }
    validateArtifactComponent(candidate.version, 'version')
    validateSemanticVersion(candidate.version, 'version')
  }
  validateMainConfig((config as { main?: unknown }).main)
  validateBundleConfig((config as { bundle?: unknown }).bundle, 'bundle')
  validatePlugins((config as { plugins?: unknown }).plugins)
  validateWebviewConfig((config as { webview?: unknown }).webview)
  validateBuildConfig((config as { build?: unknown }).build)
  validateDiagnosticsConfig(candidate.diagnostics)
  validateSecurityConfig(candidate.security)
  validateSystemPermissionsConfig(candidate.systemPermissions)
  validateDevPort(candidate.devPort)
  validateUpdaterConfig(candidate.updater)
  validateInstallerConfig(candidate.installer, candidate.updater)
  validateSignConfig(candidate.sign)
  resolveWindowDeclarations(candidate)
}

function validateInstallerConfig(value: unknown, updater: MurasakiConfig['updater']): void {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('installer must be an object')
  }
  const installer = value as Record<string, unknown>
  rejectUnknownFields(installer, ['background', 'window', 'iconSize', 'windows'], 'installer')
  if (installer.background !== undefined
    && (typeof installer.background !== 'string' || installer.background.trim().length === 0)) {
    throw new TypeError('installer.background must be a non-empty string')
  }
  if (installer.iconSize !== undefined
    && (!Number.isSafeInteger(installer.iconSize)
      || (installer.iconSize as number) < 16
      || (installer.iconSize as number) > 2_048)) {
    throw new TypeError('installer.iconSize must be an integer between 16 and 2048')
  }
  if (installer.window !== undefined) {
    if (!installer.window || typeof installer.window !== 'object' || Array.isArray(installer.window)) {
      throw new TypeError('installer.window must be an object')
    }
    const window = installer.window as Record<string, unknown>
    rejectUnknownFields(window, ['width', 'height'], 'installer.window')
    for (const field of ['width', 'height'] as const) {
      if (!Number.isSafeInteger(window[field])
        || (window[field] as number) < 128
        || (window[field] as number) > 8_192) {
        throw new TypeError(`installer.window.${field} must be an integer between 128 and 8192`)
      }
    }
  }
  if (installer.windows === undefined) return
  if (!installer.windows || typeof installer.windows !== 'object' || Array.isArray(installer.windows)) {
    throw new TypeError('installer.windows must be an object')
  }
  const windows = installer.windows as Record<string, unknown>
  rejectUnknownFields(
    windows,
    ['installMode', 'publisher', 'upgradeCode', 'icon', 'banner', 'sidebar', 'license'],
    'installer.windows',
  )
  if (windows.installMode !== undefined
    && windows.installMode !== 'perUser'
    && windows.installMode !== 'perMachine') {
    throw new TypeError('installer.windows.installMode must be perUser or perMachine')
  }
  for (const field of ['publisher', 'icon', 'banner', 'sidebar', 'license'] as const) {
    if (windows[field] !== undefined
      && (typeof windows[field] !== 'string' || (windows[field] as string).trim().length === 0)) {
      throw new TypeError(`installer.windows.${field} must be a non-empty string`)
    }
  }
  if (windows.upgradeCode !== undefined
    && (typeof windows.upgradeCode !== 'string'
      || !/^\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?$/.test(windows.upgradeCode))) {
    throw new TypeError('installer.windows.upgradeCode must be a GUID')
  }
  if (updater && windows.installMode === 'perMachine') {
    throw new TypeError(
      'updater is incompatible with installer.windows.installMode "perMachine"; '
        + 'use perUser self-update or disable updater and ship managed MSI upgrades',
    )
  }
}

function validateBuildConfig(value: unknown): void {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('build must be an object')
  }
  const build = value as Record<string, unknown>
  if (build.before !== undefined
    && (typeof build.before !== 'string' || build.before.trim().length === 0)) {
    throw new TypeError('build.before must be a non-empty string')
  }
  if (build.envPrefix === undefined) return
  if (!Array.isArray(build.envPrefix)
    || build.envPrefix.length === 0
    || build.envPrefix.some((prefix) => typeof prefix !== 'string' || prefix.length === 0)
    || new Set(build.envPrefix).size !== build.envPrefix.length) {
    throw new TypeError('build.envPrefix must be a non-empty array of unique non-empty strings')
  }
}

const MAX_USER_AGENT_BYTES = 512
const MAX_PROXY_HOST_BYTES = 253
/** A sane ceiling on the number of declared init scripts. Per-file (256 KiB)
 * and combined-total (1 MiB) byte bounds are enforced where file contents are
 * actually read (see `resolveInitScripts` in `cli/init-scripts.ts`), since
 * this module stays free of Node builtins and cannot read files itself. */
const MAX_INIT_SCRIPTS = 64

function validateWebviewConfig(value: unknown): void {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('webview must be an object')
  }
  const webview = value as Record<string, unknown>
  rejectUnknownFields(
    webview,
    ['userAgent', 'incognito', 'proxy', 'downloads', 'initScripts', 'hotkeysZoom'],
    'webview',
  )

  if (webview.userAgent !== undefined) {
    if (typeof webview.userAgent !== 'string'
      || webview.userAgent.length === 0
      || webview.userAgent !== webview.userAgent.trim()
      || new TextEncoder().encode(webview.userAgent).byteLength > MAX_USER_AGENT_BYTES
      || [...webview.userAgent].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint < 0x20 || codePoint === 0x7f
      })) {
      throw new TypeError(
        `webview.userAgent must be a trimmed, non-empty header value no greater than ${MAX_USER_AGENT_BYTES} UTF-8 bytes without control characters`,
      )
    }
  }
  if (webview.incognito !== undefined && typeof webview.incognito !== 'boolean') {
    throw new TypeError('webview.incognito must be a boolean')
  }
  if (webview.hotkeysZoom !== undefined && typeof webview.hotkeysZoom !== 'boolean') {
    throw new TypeError('webview.hotkeysZoom must be a boolean')
  }
  if (webview.initScripts !== undefined) {
    if (!Array.isArray(webview.initScripts)
      || webview.initScripts.length > MAX_INIT_SCRIPTS
      || webview.initScripts.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
      throw new TypeError(
        `webview.initScripts must be an array of at most ${MAX_INIT_SCRIPTS} non-empty file paths`,
      )
    }
  }
  if (webview.downloads !== undefined) {
    if (!webview.downloads || typeof webview.downloads !== 'object' || Array.isArray(webview.downloads)) {
      throw new TypeError('webview.downloads must be an object')
    }
    const downloads = webview.downloads as Record<string, unknown>
    rejectUnknownFields(downloads, ['directory'], 'webview.downloads')
    if (downloads.directory !== undefined && !validAbsolutePath(downloads.directory)) {
      throw new TypeError(
        'webview.downloads.directory must be a non-empty absolute path without traversal segments',
      )
    }
  }
  if (webview.proxy !== undefined) {
    if (!webview.proxy || typeof webview.proxy !== 'object' || Array.isArray(webview.proxy)) {
      throw new TypeError('webview.proxy must be an object')
    }
    const proxy = webview.proxy as Record<string, unknown>
    rejectUnknownFields(proxy, ['protocol', 'host', 'port'], 'webview.proxy')
    if (proxy.protocol !== 'http' && proxy.protocol !== 'socks5') {
      throw new TypeError('webview.proxy.protocol must be http or socks5')
    }
    if (typeof proxy.host !== 'string' || !validProxyHost(proxy.host)) {
      throw new TypeError(
        'webview.proxy.host must be a hostname or IP literal without a scheme, credentials, path, query, or fragment',
      )
    }
    if (!Number.isSafeInteger(proxy.port) || (proxy.port as number) < 1 || (proxy.port as number) > 65_535) {
      throw new TypeError('webview.proxy.port must be an integer between 1 and 65535')
    }
  }
}

/** @internal One normalized app-level value shared by dev and bundle metadata.
 * `initScripts` is deliberately excluded — its file contents are resolved by
 * the Node-only `resolveInitScripts` (see `cli/init-scripts.ts`), since this
 * module stays free of Node builtins (see the module doc comment above
 * `resolveUpdater`'s reference). */
export function resolveWebviewNetworkConfig(
  config: Pick<MurasakiConfig, 'webview'>,
): WebviewConfig | undefined {
  validateWebviewConfig(config.webview)
  if (!config.webview) return undefined
  return {
    ...(config.webview.userAgent !== undefined
      ? { userAgent: config.webview.userAgent }
      : {}),
    ...(config.webview.incognito !== undefined
      ? { incognito: config.webview.incognito }
      : {}),
    ...(config.webview.proxy
      ? { proxy: { ...config.webview.proxy } }
      : {}),
    ...(config.webview.downloads
      ? { downloads: { ...config.webview.downloads } }
      : {}),
    ...(config.webview.hotkeysZoom !== undefined
      ? { hotkeysZoom: config.webview.hotkeysZoom }
      : {}),
  }
}

const DEFAULT_KEEP_CRASH_REPORTS = 20
const MIN_KEEP_CRASH_REPORTS = 1
const MAX_KEEP_CRASH_REPORTS = 100

function validateDiagnosticsConfig(value: unknown): void {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('diagnostics must be an object')
  }
  const diagnostics = value as Record<string, unknown>
  rejectUnknownFields(diagnostics, ['crashReports', 'keepReports'], 'diagnostics')
  if (diagnostics.crashReports !== undefined && typeof diagnostics.crashReports !== 'boolean') {
    throw new TypeError('diagnostics.crashReports must be a boolean')
  }
  if (diagnostics.keepReports !== undefined && !Number.isSafeInteger(diagnostics.keepReports)) {
    throw new TypeError('diagnostics.keepReports must be a safe integer')
  }
}

/**
 * Fully-resolved `diagnostics` defaults shared by dev (`main-process.ts`
 * passes `config.diagnostics` through as-is) and bundle metadata
 * (`cli/bundle.ts`'s `metaJson` writes this resolved shape so
 * `prod-server.mjs` and the native launcher never re-derive the defaults).
 * Unlike most numeric config here, an out-of-range `keepReports` is clamped
 * rather than rejected, matching `MainRuntimeOptions.diagnostics`'s runtime
 * behavior.
 */
export function resolveDiagnosticsConfig(
  config: Pick<MurasakiConfig, 'diagnostics'>,
): { crashReports: boolean; keepReports: number } {
  validateDiagnosticsConfig(config.diagnostics)
  const raw = config.diagnostics
  const keepReports = raw?.keepReports === undefined
    ? DEFAULT_KEEP_CRASH_REPORTS
    : Math.min(MAX_KEEP_CRASH_REPORTS, Math.max(MIN_KEEP_CRASH_REPORTS, raw.keepReports))
  return { crashReports: raw?.crashReports ?? true, keepReports }
}

/** Absolute, traversal-free path check shared by `webview.downloads.directory`
 * — same absoluteness/`..`-segment rules as capability path scopes (see
 * `validateCapabilityPathPattern`), without that function's wildcard support. */
function validAbsolutePath(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false
  const absolute = value.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(value)
    || /^\\\\[^\\]+\\[^\\]+/.test(value)
  const segments = value.split(/[\\/]+/)
  return absolute && !segments.includes('..')
}

function validProxyHost(host: string): boolean {
  if (host.length === 0
    || host !== host.trim()
    || new TextEncoder().encode(host).byteLength > MAX_PROXY_HOST_BYTES
    || !/^[\x21-\x7e]+$/.test(host)
    || /[/\\@?#]/.test(host)) {
    return false
  }
  const bracketedIpv6 = host.startsWith('[') && host.endsWith(']')
  if (host.includes(':') && !bracketedIpv6) return false
  if (!bracketedIpv6 && !host.split('.').every((label) =>
    label.length >= 1
    && label.length <= 63
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label))) {
    return false
  }
  try {
    const parsed = new URL(`http://${host}/`)
    return parsed.username === ''
      && parsed.password === ''
      && parsed.port === ''
      && parsed.pathname === '/'
      && parsed.hostname.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.includes(field)) throw new TypeError(`${path} contains unknown field ${field}`)
  }
}

const PLUGIN_NAME_RE = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/

function validatePlugins(value: unknown): void {
  if (value === undefined) return
  if (!Array.isArray(value)) throw new TypeError('plugins must be an array')
  const names = new Set<string>()
  for (let index = 0; index < value.length; index++) {
    const plugin = value[index]
    const path = `plugins[${index}]`
    if (!plugin || typeof plugin !== 'object' || Array.isArray(plugin)) {
      throw new TypeError(`${path} must be a Murasaki plugin object`)
    }
    const candidate = plugin as Record<string, unknown>
    if (typeof candidate.name !== 'string'
      || candidate.name.length > 128
      || !PLUGIN_NAME_RE.test(candidate.name)) {
      throw new TypeError(
        `${path}.name must be a stable lowercase identifier (letters, digits, dot, dash, underscore)`,
      )
    }
    if (names.has(candidate.name)) {
      throw new TypeError(`plugins contains duplicate plugin name ${JSON.stringify(candidate.name)}`)
    }
    names.add(candidate.name)
    validateVitePluginOption(candidate.vite, `${path}.vite`)
    validateBundleConfig(candidate.bundle, `${path}.bundle`)
    if (candidate.hooks !== undefined) {
      if (!candidate.hooks || typeof candidate.hooks !== 'object' || Array.isArray(candidate.hooks)) {
        throw new TypeError(`${path}.hooks must be an object`)
      }
      const hooks = candidate.hooks as Record<string, unknown>
      for (const phase of ['before', 'after'] as const) {
        if (hooks[phase] !== undefined && typeof hooks[phase] !== 'function') {
          throw new TypeError(`${path}.hooks.${phase} must be a function`)
        }
      }
    }
  }
}

function validateVitePluginOption(value: unknown, path: string): void {
  if (value === undefined || value === null || value === false) return
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateVitePluginOption(entry, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== 'object') {
    throw new TypeError(`${path} must be a Vite PluginOption`)
  }
  const candidate = value as { name?: unknown; then?: unknown }
  if (typeof candidate.then === 'function') return
  if (typeof candidate.name !== 'string' || candidate.name.trim().length === 0) {
    throw new TypeError(`${path} Vite plugin must have a non-empty name`)
  }
}

function validateBundleConfig(value: unknown, path: string): void {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  const bundle = value as Record<string, unknown>
  for (const field of ['external', 'noExternal'] as const) {
    const entries = bundle[field]
    if (entries === undefined) continue
    if (!Array.isArray(entries)
      || entries.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
      throw new TypeError(`${path}.${field} must be an array of non-empty strings`)
    }
  }
  const resources = bundle.resources
  if (resources === undefined) return
  if (!Array.isArray(resources)) {
    throw new TypeError(`${path}.resources must be an array`)
  }
  resources.forEach((resource, index) => {
    const resourcePath = `${path}.resources[${index}]`
    if (typeof resource === 'string') {
      if (resource.trim().length === 0) throw new TypeError(`${resourcePath} must not be empty`)
      return
    }
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
      throw new TypeError(`${resourcePath} must be a path or { from, to?, executable? } object`)
    }
    const item = resource as Record<string, unknown>
    if (typeof item.from !== 'string' || item.from.trim().length === 0) {
      throw new TypeError(`${resourcePath}.from must be a non-empty string`)
    }
    if (item.to !== undefined
      && (typeof item.to !== 'string' || item.to.trim().length === 0)) {
      throw new TypeError(`${resourcePath}.to must be a non-empty string`)
    }
    if (item.executable !== undefined && typeof item.executable !== 'boolean') {
      throw new TypeError(`${resourcePath}.executable must be a boolean`)
    }
  })
}

function validateSystemPermissionsConfig(value: unknown): void {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('systemPermissions must be an object')
  }
  const macOS = (value as { macOS?: unknown }).macOS
  if (macOS === undefined) return
  if (!macOS || typeof macOS !== 'object' || Array.isArray(macOS)) {
    throw new TypeError('systemPermissions.macOS must be an object')
  }
  const permissions = macOS as Record<string, unknown>
  for (const name of [
    'camera',
    'microphone',
    'photos',
    'contacts',
    'calendar',
    'reminders',
    'speechRecognition',
    'bluetooth',
  ] as const) {
    const permission = permissions[name]
    if (permission === undefined) continue
    if (!permission || typeof permission !== 'object' || Array.isArray(permission)) {
      throw new TypeError(`systemPermissions.macOS.${name} must be an object`)
    }
    const capture = permission as Record<string, unknown>
    if (typeof capture.usageDescription !== 'string'
      || capture.usageDescription.trim().length === 0) {
      throw new TypeError(
        `systemPermissions.macOS.${name}.usageDescription must be a non-empty string`,
      )
    }
    if (capture.requestOnLaunch !== undefined
      && typeof capture.requestOnLaunch !== 'boolean') {
      throw new TypeError(
        `systemPermissions.macOS.${name}.requestOnLaunch must be a boolean`,
      )
    }
  }
  // Declaration-only kinds: a purpose string only, no meaningful launch-time
  // request (see MacOSDeclarationOnlyPermissionConfig's doc comment).
  for (const name of ['appleEvents', 'localNetwork'] as const) {
    const permission = permissions[name]
    if (permission === undefined) continue
    if (!permission || typeof permission !== 'object' || Array.isArray(permission)) {
      throw new TypeError(`systemPermissions.macOS.${name} must be an object`)
    }
    const declarationOnly = permission as Record<string, unknown>
    if (typeof declarationOnly.usageDescription !== 'string'
      || declarationOnly.usageDescription.trim().length === 0) {
      throw new TypeError(
        `systemPermissions.macOS.${name}.usageDescription must be a non-empty string`,
      )
    }
  }
  for (const name of ['screenRecording', 'accessibility', 'inputMonitoring', 'fullDiskAccess'] as const) {
    const permission = permissions[name]
    if (permission === undefined) continue
    if (!permission || typeof permission !== 'object' || Array.isArray(permission)) {
      throw new TypeError(`systemPermissions.macOS.${name} must be an object`)
    }
    const prompt = permission as Record<string, unknown>
    if (prompt.requestOnLaunch !== undefined
      && typeof prompt.requestOnLaunch !== 'boolean') {
      throw new TypeError(
        `systemPermissions.macOS.${name}.requestOnLaunch must be a boolean`,
      )
    }
  }
  const location = permissions.location
  if (location !== undefined) {
    if (!location || typeof location !== 'object' || Array.isArray(location)) {
      throw new TypeError('systemPermissions.macOS.location must be an object')
    }
    const config = location as Record<string, unknown>
    if (typeof config.usageDescription !== 'string'
      || config.usageDescription.trim().length === 0) {
      throw new TypeError(
        'systemPermissions.macOS.location.usageDescription must be a non-empty string',
      )
    }
    if (config.mode !== undefined
      && config.mode !== 'whenInUse' && config.mode !== 'always') {
      throw new TypeError(
        "systemPermissions.macOS.location.mode must be 'whenInUse' or 'always'",
      )
    }
    if (config.requestOnLaunch !== undefined
      && typeof config.requestOnLaunch !== 'boolean') {
      throw new TypeError(
        'systemPermissions.macOS.location.requestOnLaunch must be a boolean',
      )
    }
  }
}

export type SystemPermissionName =
  | 'camera'
  | 'microphone'
  | 'screenRecording'
  | 'accessibility'
  | 'inputMonitoring'
  | 'location'
  | 'fullDiskAccess'
  | 'photos'
  | 'contacts'
  | 'calendar'
  | 'reminders'
  | 'speechRecognition'
  | 'bluetooth'
  | 'appleEvents'
  | 'localNetwork'

/**
 * Resolve only the permissions explicitly opted into launch-time prompts.
 * `appleEvents`/`localNetwork` are declaration-only (see
 * `MacOSDeclarationOnlyPermissionConfig`) and have no `requestOnLaunch` field
 * at all, so they are never included here — only reachable through a runtime
 * `systemPermission.request()` call.
 */
export function resolveStartupSystemPermissions(
  config: Pick<MurasakiConfig, 'systemPermissions'>,
): SystemPermissionName[] {
  const macOS = config.systemPermissions?.macOS
  if (!macOS) return []
  // Excludes 'appleEvents'/'localNetwork' (see the doc comment above) —
  // narrowing the array element type keeps `macOS[name]` below resolved to
  // config shapes that all actually declare `requestOnLaunch`.
  const names: Exclude<SystemPermissionName, 'appleEvents' | 'localNetwork'>[] = [
    'camera',
    'microphone',
    'screenRecording',
    'accessibility',
    'inputMonitoring',
    'location',
    'fullDiskAccess',
    'photos',
    'contacts',
    'calendar',
    'reminders',
    'speechRecognition',
    'bluetooth',
  ]
  return names.filter((name) => macOS[name]?.requestOnLaunch === true)
}

// productName and version are interpolated into bundle/installer paths before
// destructive cleanup. Keep each value a portable single path component so a
// typo cannot make `resolve(...); rm(...)` target a parent/sibling directory.
const UNSAFE_ARTIFACT_COMPONENT_RE = /[<>:"/\\|?*\u0000-\u001F\u007F]/
const WINDOWS_RESERVED_BASENAME_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

function validateAppId(value: string): void {
  const bytes = new TextEncoder().encode(value).byteLength
  if (bytes > 255
    || !/^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/.test(value)) {
    throw new TypeError(
      'appId must be a reverse-DNS identifier using letters, digits, dots, and hyphens (for example com.example.app)',
    )
  }
}

function validateArtifactComponent(value: string, field: string): void {
  if (UNSAFE_ARTIFACT_COMPONENT_RE.test(value)
    || value !== value.trim()
    || value === '.'
    || value === '..'
    || value.endsWith('.')
    || WINDOWS_RESERVED_BASENAME_RE.test(value)
    || Array.from(value).length > 120) {
    throw new TypeError(
      `${field} must be a portable file name (1–120 characters, no reserved path/control characters, device names, or trailing dot/space)`,
    )
  }
}

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

function validateSemanticVersion(value: string, field: string): void {
  const match = SEMVER_RE.exec(value)
  if (!match
    || [match[1], match[2], match[3]].some((part) => !Number.isSafeInteger(Number(part)))
    || (match[4]?.split('.').some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0')) ?? false)) {
    throw new TypeError(`${field} must be a valid semantic version (for example 1.2.3 or 1.2.3-beta.1)`)
  }
}

function validateMainConfig(main: unknown): void {
  if (main === undefined || main === false) return
  if (!main || typeof main !== 'object' || Array.isArray(main)) {
    throw new TypeError('main must be false or a main process configuration object')
  }
  const candidate = main as { entry?: unknown; shutdownTimeoutMs?: unknown }
  if (candidate.entry !== undefined
    && (typeof candidate.entry !== 'string' || candidate.entry.trim().length === 0)) {
    throw new TypeError('main.entry must be a non-empty string')
  }
  validateMainShutdownTimeoutMs(candidate.shutdownTimeoutMs)
}

function validateDevPort(value: unknown): void {
  if (value === undefined) return
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 65_535) {
    throw new TypeError('devPort must be an integer between 1 and 65535')
  }
}

/**
 * Loopback hosts allowed to use `http:` for `updater.endpoint` (local testing
 * only). `runtime/updater.ts` keeps an independent copy of this same check as
 * its fetch-time defense-in-depth half — it can't import this one instead:
 * that module compiles to a single standalone `updater-engine.mjs` with no
 * non-`node:` imports (see its top doc comment), copied alone into a packaged
 * app's resources dir.
 */
function isLoopbackUpdaterHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
}

const MAX_PINNED_PUBLIC_KEYS = 4

/** `true` iff `value` base64-decodes to exactly 32 bytes — a raw Ed25519 key/seed's length, not a full cryptographic validation (that happens when the runtime actually verifies/signs with it). */
function isRawEd25519KeyBase64(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length === 0) return false
  try {
    return atob(trimmed).length === 32
  } catch {
    return false
  }
}

function validateUpdaterConfig(value: unknown): void {
  if (value === undefined || typeof value === 'boolean') return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('updater must be a boolean or an updater configuration object')
  }
  const updater = value as Record<string, unknown>
  for (const field of ['repo', 'endpoint', 'channel', 'publicKey'] as const) {
    const candidate = updater[field]
    if (candidate !== undefined
      && (typeof candidate !== 'string' || candidate.trim().length === 0)) {
      throw new TypeError(`updater.${field} must be a non-empty string`)
    }
  }
  if (typeof updater.channel === 'string'
    && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(updater.channel)) {
    throw new TypeError('updater.channel must be a safe 1-64 character release-channel name')
  }
  if (updater.repo !== undefined && updater.endpoint !== undefined) {
    throw new TypeError('updater.repo and updater.endpoint are mutually exclusive')
  }
  if (typeof updater.endpoint === 'string') {
    let endpoint: URL
    try {
      endpoint = new URL(updater.endpoint)
    } catch {
      throw new TypeError('updater.endpoint must be an absolute HTTP or HTTPS URL')
    }
    if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
      throw new TypeError('updater.endpoint must be an absolute HTTP or HTTPS URL')
    }
    if (endpoint.username || endpoint.password) {
      throw new TypeError('updater.endpoint must not contain embedded credentials')
    }
    if (endpoint.protocol === 'http:' && !isLoopbackUpdaterHost(endpoint.hostname)) {
      throw new TypeError(
        'updater.endpoint must use https: (http: is only allowed for loopback hosts — ' +
          '127.0.0.1, localhost, [::1] — for local testing)',
      )
    }
  }
  if (updater.publicKeys !== undefined) {
    if (!Array.isArray(updater.publicKeys)
      || updater.publicKeys.length === 0
      || updater.publicKeys.length > MAX_PINNED_PUBLIC_KEYS
      || updater.publicKeys.some((key) => typeof key !== 'string' || !isRawEd25519KeyBase64(key))) {
      throw new TypeError(
        `updater.publicKeys must be an array of 1 to ${MAX_PINNED_PUBLIC_KEYS} base64-encoded 32-byte Ed25519 public keys`,
      )
    }
  }
  if (updater.maxManifestAgeDays !== undefined
    && (!Number.isSafeInteger(updater.maxManifestAgeDays) || (updater.maxManifestAgeDays as number) < 1)) {
    throw new TypeError('updater.maxManifestAgeDays must be a positive safe integer (days), at least 1')
  }
  if (updater.allowLegacyManifestsWithoutGeneratedAt !== undefined
    && typeof updater.allowLegacyManifestsWithoutGeneratedAt !== 'boolean') {
    throw new TypeError('updater.allowLegacyManifestsWithoutGeneratedAt must be a boolean')
  }
  if (updater.checkOnStart !== undefined && typeof updater.checkOnStart !== 'boolean') {
    throw new TypeError('updater.checkOnStart must be a boolean')
  }
  if (updater.checkInterval !== undefined && updater.checkInterval !== false) {
    if (typeof updater.checkInterval !== 'string'
      || !/^[1-9]\d*(m|h|d)$/.test(updater.checkInterval)) {
      throw new TypeError(
        'updater.checkInterval must look like "30m", "6h", or "1d" (or false)',
      )
    }
    const amount = Number.parseInt(updater.checkInterval, 10)
    const unit = updater.checkInterval.at(-1)
    const multiplier = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000
    if (!Number.isSafeInteger(amount * multiplier)) {
      throw new TypeError('updater.checkInterval is too large')
    }
  }
}

function validateSignConfig(value: unknown): void {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('sign must be an object')
  }
  const sign = value as Record<string, unknown>
  for (const field of ['identity', 'entitlements', 'helperEntitlements'] as const) {
    if (sign[field] !== undefined
      && (typeof sign[field] !== 'string' || sign[field].trim().length === 0)) {
      throw new TypeError(`sign.${field} must be a non-empty string`)
    }
  }
  if (sign.appSandbox !== undefined && typeof sign.appSandbox !== 'boolean') {
    throw new TypeError('sign.appSandbox must be a boolean')
  }
  if (sign.appSandbox === true) {
    throw new TypeError(
      'sign.appSandbox is not supported by the current bundled-Node architecture; '
        + 'use the default hardened-runtime signing until a separately sandboxed helper is available',
    )
  }
  if (sign.windows === undefined) return
  if (!sign.windows || typeof sign.windows !== 'object' || Array.isArray(sign.windows)) {
    throw new TypeError('sign.windows must be an object')
  }
  const windows = sign.windows as Record<string, unknown>
  for (const field of [
    'certificateFile',
    'certificateSubjectName',
    'signToolPath',
  ] as const) {
    if (windows[field] !== undefined
      && (typeof windows[field] !== 'string' || windows[field].trim().length === 0)) {
      throw new TypeError(`sign.windows.${field} must be a non-empty string`)
    }
  }
  if (windows.certificateSha1 !== undefined
    && (typeof windows.certificateSha1 !== 'string'
      || !/^[0-9a-f]{40}$/i.test(windows.certificateSha1.replace(/\s/g, '')))) {
    throw new TypeError('sign.windows.certificateSha1 must be a 40-character SHA-1 thumbprint')
  }
  if (windows.certificateStore !== undefined
    && windows.certificateStore !== 'currentUser'
    && windows.certificateStore !== 'localMachine') {
    throw new TypeError('sign.windows.certificateStore must be currentUser or localMachine')
  }
  if (windows.timestampUrl !== undefined && windows.timestampUrl !== false) {
    if (typeof windows.timestampUrl !== 'string') {
      throw new TypeError('sign.windows.timestampUrl must be an HTTP(S) URL or false')
    }
    let timestampUrl: URL
    try {
      timestampUrl = new URL(windows.timestampUrl)
    } catch {
      throw new TypeError('sign.windows.timestampUrl must be an HTTP(S) URL or false')
    }
    if (timestampUrl.protocol !== 'https:' && timestampUrl.protocol !== 'http:') {
      throw new TypeError('sign.windows.timestampUrl must be an HTTP(S) URL or false')
    }
  }

  const certificateSelectors = [
    windows.certificateFile,
    windows.certificateSubjectName,
    windows.certificateSha1,
  ].filter((selector) => selector !== undefined)
  if (certificateSelectors.length > 1) {
    throw new TypeError(
      'sign.windows certificateFile, certificateSubjectName, and certificateSha1 are mutually exclusive',
    )
  }

  if (windows.artifactSigning !== undefined) {
    if (!windows.artifactSigning
      || typeof windows.artifactSigning !== 'object'
      || Array.isArray(windows.artifactSigning)) {
      throw new TypeError('sign.windows.artifactSigning must be an object')
    }
    const artifactSigning = windows.artifactSigning as Record<string, unknown>
    for (const field of ['dlib', 'metadata'] as const) {
      if (typeof artifactSigning[field] !== 'string'
        || artifactSigning[field].trim().length === 0) {
        throw new TypeError(`sign.windows.artifactSigning.${field} must be a non-empty string`)
      }
    }
    if (certificateSelectors.length > 0) {
      throw new TypeError(
        'sign.windows.artifactSigning is mutually exclusive with certificate file/store selectors',
      )
    }
  }
}

const UNSAFE_CSP_VALUE_RE = /[\u0000-\u001F\u007F"<>]/

/** Shared runtime validation for defineConfig() and the Vite HTML transform. */
export function validateContentSecurityPolicy(value: unknown): asserts value is string | false | undefined {
  if (value === undefined || value === false) return
  if (typeof value !== 'string') {
    throw new TypeError('security.csp must be a string or false')
  }
  if (value.trim().length === 0) {
    throw new TypeError('security.csp must not be empty; use false to disable CSP injection')
  }
  if (UNSAFE_CSP_VALUE_RE.test(value)) {
    throw new TypeError(
      'security.csp must be a single-line policy without control characters, double quotes, <, or >',
    )
  }
}

function validateSecurityConfig(security: MurasakiConfig['security'] | unknown): void {
  if (security === undefined) return
  if (!security || typeof security !== 'object' || Array.isArray(security)) {
    throw new TypeError('security must be an object')
  }
  validateContentSecurityPolicy((security as { csp?: unknown }).csp)
}

const WINDOW_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const WINDOW_ROUTE_BASE = 'http://murasaki.local'

/** Validate and resolve primary and secondary declarative windows. */
export function resolveWindowDeclarations(
  config: Pick<MurasakiConfig, 'window' | 'windows' | 'capabilities' | 'backendCapabilities' | 'updater'>,
): ResolvedWindowConfig[] {
  if (config.window !== undefined
    && (!config.window || typeof config.window !== 'object' || Array.isArray(config.window))) {
    throw new TypeError('window must be a window configuration object')
  }
  if (config.windows !== undefined
    && (!config.windows || typeof config.windows !== 'object' || Array.isArray(config.windows))) {
    throw new TypeError('windows must be an object keyed by window label')
  }

  // Validate the legacy top-level list even when window.capabilities overrides
  // it. A stale typo must not silently become a real grant in a future release.
  const fallbackCapabilities = resolveCapabilities(config.capabilities, 'capabilities')
  const primaryCapabilities = config.window?.capabilities !== undefined
    ? resolveCapabilities(config.window.capabilities, 'window.capabilities')
    : fallbackCapabilities
  const primaryBackendCapabilities = config.window?.backendCapabilities !== undefined
    ? resolveBackendCapabilities(config.window.backendCapabilities, 'window.backendCapabilities')
    : resolveBackendCapabilities(config.backendCapabilities, 'backendCapabilities')
  // The built-in updater must be able to complete its verified
  // install -> graceful quit -> apply handshake without making every existing
  // updater app add a new permission. This implicit grant is limited to main;
  // an updater UI hosted by a secondary renderer must opt in explicitly.
  if (config.updater && !primaryCapabilities.includes('app:quit')) {
    primaryCapabilities.push('app:quit')
  }
  const primary = resolveWindowDeclaration(
    'main',
    config.window ?? {},
    true,
    primaryCapabilities,
    primaryBackendCapabilities,
  )
  const secondary = Object.entries(config.windows ?? {}).map(([label, declaration]) => {
    if (label.toLowerCase() === 'main') {
      throw new TypeError('windows.main is reserved for the primary window')
    }
    if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
      throw new TypeError(`windows.${label} must be a window configuration object`)
    }
    if ('console' in declaration) {
      throw new TypeError(`windows.${label}.console is not supported; configure the process console on window.console`)
    }
    const capabilities = declaration.capabilities !== undefined
      ? resolveCapabilities(declaration.capabilities, `windows.${label}.capabilities`)
      : []
    const backendCapabilities = declaration.backendCapabilities !== undefined
      ? resolveBackendCapabilities(
        declaration.backendCapabilities,
        `windows.${label}.backendCapabilities`,
      )
      : []
    return resolveWindowDeclaration(label, declaration, false, capabilities, backendCapabilities)
  })
  return [primary, ...secondary]
}

function resolveWindowDeclaration(
  label: string,
  declaration: WindowConfig & { createOnLaunch?: boolean },
  primary: boolean,
  capabilities: NativeCapabilityGrant[],
  backendCapabilities: BackendCapability[],
): ResolvedWindowConfig {
  if (!WINDOW_LABEL_RE.test(label)) {
    throw new TypeError(
      `window label ${JSON.stringify(label)} must be 1-64 characters using letters, numbers, dot, underscore, or hyphen`,
    )
  }
  validateWindowDeclaration(declaration, label)
  const minimumSize = resolveMinimumSize(declaration, label)
  const maximumSize = resolveMaximumSize(declaration, label)
  if (declaration.titleBarStyle === 'hidden') {
    console.warn(
      `[murasaki] window ${label} titleBarStyle: 'hidden' is macOS only and is ignored on Windows/Linux`,
    )
  }
  return {
    ...declaration,
    ...minimumSize,
    ...maximumSize,
    label,
    primary,
    route: resolveWindowRoute(declaration.route, label),
    visible: declaration.visible ?? primary,
    createOnLaunch: primary ? true : (declaration.createOnLaunch ?? true),
    capabilities: [...capabilities],
    backendCapabilities: [...backendCapabilities],
  }
}

const BACKEND_CAPABILITY_RE = /^(?:(?:main|action):(?:\*|[^\s#*]+#[A-Za-z_$][\w$]*|[^\s*]+\*)|api:(?:\*|[A-Z]+:\/api(?:\/[^\s*]*)?\*?)|updater:(?:\*|[^\s*]+\*?)|events:(?:\*|[^\s*]+\*?)|diagnostics:(?:\*|renderer-error))$/

/** Validate backend authority grants at the same trusted config boundary as native capabilities. */
export function resolveBackendCapabilities(
  value: BackendCapability[] | undefined,
  field = 'backendCapabilities',
): BackendCapability[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 256) {
    throw new TypeError(`${field} must be an array of at most 256 backend capability strings`)
  }
  const resolved: string[] = []
  for (const grant of value) {
    if (typeof grant !== 'string'
      || grant.length === 0
      || grant.length > 512
      || !BACKEND_CAPABILITY_RE.test(grant)) {
      throw new TypeError(`invalid ${field} grant: ${JSON.stringify(grant)}`)
    }
    if (!resolved.includes(grant)) resolved.push(grant)
  }
  return resolved
}

function validateWindowDeclaration(
  declaration: WindowConfig & { createOnLaunch?: boolean },
  label: string,
): void {
  for (const [name, value] of [
    ['width', declaration.width],
    ['height', declaration.height],
  ] as const) {
    if (value !== undefined
      && (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)) {
      throw new TypeError(`window ${label} ${name} must be a positive 32-bit integer`)
    }
  }
  if (declaration.title !== undefined && typeof declaration.title !== 'string') {
    throw new TypeError(`window ${label} title must be a string`)
  }
  for (const [name, value] of [
    ['resizable', declaration.resizable],
    ['transparent', declaration.transparent],
    ['visible', declaration.visible],
    ['console', declaration.console],
    ['createOnLaunch', declaration.createOnLaunch],
    ['decorations', declaration.decorations],
    ['fullscreen', declaration.fullscreen],
  ] as const) {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new TypeError(`window ${label} ${name} must be a boolean`)
    }
  }
  if (declaration.vibrancy !== undefined
    && declaration.vibrancy !== null
    && !['hud', 'sidebar', 'popover'].includes(declaration.vibrancy)) {
    throw new TypeError(`window ${label} vibrancy must be hud, sidebar, popover, or null`)
  }
  if (declaration.titleBarStyle !== undefined
    && declaration.titleBarStyle !== 'default'
    && declaration.titleBarStyle !== 'hidden') {
    throw new TypeError(`window ${label} titleBarStyle must be default or hidden`)
  }
}

function resolveCapabilities(value: unknown, path: string): NativeCapabilityGrant[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array of known native capabilities`)
  }
  const unique: NativeCapabilityGrant[] = []
  const seen = new Set<NativeCapability>()
  for (const entry of value) {
    if (typeof entry === 'string') {
      if (!NATIVE_CAPABILITY_SET.has(entry)) {
        throw new TypeError(`${path} contains unknown native capability ${JSON.stringify(entry)}`)
      }
      const known = entry as NativeCapability
      // Preserve the legacy behavior for repeated string permissions.
      if (!seen.has(known)) {
        seen.add(known)
        unique.push(known)
      }
      continue
    }
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new TypeError(`${path} entries must be a permission string or scoped permission object`)
    }
    const grant = entry as Record<string, unknown>
    if (typeof grant.permission !== 'string' || !NATIVE_CAPABILITY_SET.has(grant.permission)) {
      throw new TypeError(`${path} contains unknown native capability ${JSON.stringify(grant.permission)}`)
    }
    const known = grant.permission as NativeCapability
    if (seen.has(known)) {
      throw new TypeError(`${path} contains more than one grant for ${known}`)
    }
    for (const key of Object.keys(grant)) {
      if (!['permission', 'allow', 'deny'].includes(key)) {
        throw new TypeError(`${path} scoped capability ${known} contains unknown field ${key}`)
      }
    }
    const allow = resolveCapabilityScope(grant.allow, known, `${path}.${known}.allow`)
    const deny = resolveCapabilityScope(grant.deny, known, `${path}.${known}.deny`)
    if (allow === undefined && deny === undefined) {
      throw new TypeError(`${path} scoped capability ${known} must define allow or deny`)
    }
    seen.add(known)
    unique.push({
      permission: known,
      ...(allow ? { allow } : {}),
      ...(deny ? { deny } : {}),
    })
  }
  return unique
}

function capabilityName(grant: NativeCapabilityGrant): NativeCapability {
  return typeof grant === 'string' ? grant : grant.permission
}

/** @internal Legacy permission-name projection consumed by native menus. */
export function capabilityPermissionNames(
  grants: readonly NativeCapabilityGrant[],
): NativeCapability[] {
  return grants.map(capabilityName)
}

/** @internal Versioned value-scope policy passed unchanged to the native host. */
export function serializeCapabilityPolicy(
  grants: readonly NativeCapabilityGrant[],
): string {
  return JSON.stringify({ version: 1, grants })
}

function resolveCapabilityScope(
  value: unknown,
  permission: NativeCapability,
  path: string,
): NativeCapabilityScope | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`)
  }
  const scope = value as Record<string, unknown>
  const allowedKeys = capabilityScopeKeys(permission)
  const resolved: NativeCapabilityScope = {}
  for (const key of Object.keys(scope)) {
    if (!allowedKeys.includes(key as keyof NativeCapabilityScope)) {
      throw new TypeError(`${path}.${key} is not valid for ${permission}`)
    }
    const entries = scope[key]
    if (!Array.isArray(entries) || entries.length === 0 || entries.length > 256) {
      throw new TypeError(`${path}.${key} must be an array of 1-256 entries`)
    }
    if (key === 'executions') {
      const identities = new Set<string>()
      resolved.executions = entries.map((entry, index) => {
        const entryPath = `${path}.executions[${index}]`
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
          throw new TypeError(`${entryPath} must be an object`)
        }
        const value = entry as Record<string, unknown>
        if (Object.keys(value).some((field) => field !== 'executable' && field !== 'args')) {
          throw new TypeError(`${entryPath} contains an unknown field`)
        }
        if (typeof value.executable !== 'string' || value.executable.endsWith('/**') || value.executable.endsWith('\\**')) {
          throw new TypeError(`${entryPath}.executable must be one exact absolute path`)
        }
        validateCapabilityPathPattern(value.executable, `${entryPath}.executable`)
        const args = value.args === undefined ? [] : value.args
        if (!Array.isArray(args) || args.length > 64 || args.some((arg) => typeof arg !== 'string'
          || new TextEncoder().encode(arg).byteLength > 4096
          || /[\u0000-\u001f\u007f-\u009f]/u.test(arg))) {
          throw new TypeError(`${entryPath}.args must contain at most 64 strings of at most 4096 UTF-8 bytes without control characters`)
        }
        const result = { executable: value.executable, args: args as string[] }
        const identity = JSON.stringify(result)
        if (identities.has(identity)) throw new TypeError(`${path}.executions must contain unique executable/args pairs`)
        identities.add(identity)
        return result
      })
      continue
    }
    const unique = [...new Set(entries)]
    if (unique.length !== entries.length || unique.some((item) => typeof item !== 'string')) {
      throw new TypeError(`${path}.${key} must contain unique strings`)
    }
    if (key === 'urls') {
      unique.forEach((item) => validateCapabilityUrlPattern(
        item as string,
        `${path}.urls`,
        permission === 'webview:readCookies' || permission === 'webview:writeCookies',
      ))
      resolved.urls = unique as string[]
    } else if (key === 'paths') {
      unique.forEach((item) => validateCapabilityPathPattern(item as string, `${path}.paths`))
      resolved.paths = unique as string[]
    } else if (key === 'windows') {
      unique.forEach((item) => {
        if (!WINDOW_LABEL_RE.test(item as string)) throw new TypeError(`${path}.windows contains invalid window label ${JSON.stringify(item)}`)
      })
      resolved.windows = unique as string[]
    } else if (key === 'permissions') {
      const known = new Set<SystemPermissionName>([
        'camera',
        'microphone',
        'screenRecording',
        'accessibility',
        'inputMonitoring',
        'location',
        'fullDiskAccess',
        'photos',
        'contacts',
        'calendar',
        'reminders',
        'speechRecognition',
        'bluetooth',
        'appleEvents',
        'localNetwork',
      ])
      unique.forEach((item) => {
        if (!known.has(item as SystemPermissionName)) throw new TypeError(`${path}.permissions contains unknown system permission ${JSON.stringify(item)}`)
      })
      resolved.permissions = unique as SystemPermissionName[]
    } else if (key === 'keys') {
      unique.forEach((item) => validateCapabilityKeyPattern(item as string, `${path}.keys`))
      resolved.keys = unique as string[]
    }
  }
  if (Object.keys(resolved).length === 0) throw new TypeError(`${path} must not be empty`)
  return resolved
}

function capabilityScopeKeys(permission: NativeCapability): Array<keyof NativeCapabilityScope> {
  if (
    permission === 'shell:openExternal'
    || permission === 'webview:readCookies'
    || permission === 'webview:writeCookies'
  ) return ['urls']
  if (
    permission === 'shell:showItemInFolder'
    || permission === 'shell:trashItem'
    || permission === 'shell:openPath'
  ) return ['paths']
  if (permission === 'shell:runElevated') return ['executions']
  if (permission === 'window:open' || permission === 'window:manage') return ['windows']
  if (permission === 'systemPermission:status' || permission === 'systemPermission:request') return ['permissions']
  if (
    permission === 'secureStorage:get'
    || permission === 'secureStorage:set'
    || permission === 'secureStorage:delete'
  ) return ['keys']
  return []
}

function validateCapabilityUrlPattern(pattern: string, path: string, httpOnly = false): void {
  const wildcard = pattern.endsWith('/**')
  const candidate = wildcard ? pattern.slice(0, -2) : pattern
  if (candidate.includes('*')) {
    throw new TypeError(`${path} only supports a trailing /** wildcard`)
  }
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new TypeError(`${path} contains invalid absolute URL pattern ${JSON.stringify(pattern)}`)
  }
  if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new TypeError(`${path} supports only credential-free http, https, mailto, and tel URLs`)
  }
  if (httpOnly && !['http:', 'https:'].includes(parsed.protocol)) {
    throw new TypeError(`${path} supports only http and https URLs for WebView cookies`)
  }
  if (wildcard && !['http:', 'https:'].includes(parsed.protocol)) {
    throw new TypeError(`${path} wildcards are supported only for http and https URLs`)
  }
  if (wildcard && (parsed.search || parsed.hash)) {
    throw new TypeError(`${path} URL wildcards cannot contain a query or fragment`)
  }
}

function validateCapabilityKeyPattern(pattern: string, path: string): void {
  if (pattern.length === 0 || pattern.includes('\0') || Buffer.byteLength(pattern, 'utf8') > 256) {
    throw new TypeError(`${path} entries must be non-empty and at most 256 UTF-8 bytes without NUL`)
  }
  const candidate = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern
  if (candidate.includes('*')) {
    throw new TypeError(`${path} only supports an exact key or one trailing * prefix wildcard`)
  }
}

function validateCapabilityPathPattern(pattern: string, path: string): void {
  const wildcard = pattern.endsWith('/**') || pattern.endsWith('\\**')
  const candidate = wildcard
    ? pattern.slice(0, -3)
    : pattern
  const absolute = candidate.startsWith('/')
    || /^[A-Za-z]:[\\/]/.test(candidate)
    || /^\\\\[^\\]+\\[^\\]+/.test(candidate)
  const segments = candidate.split(/[\\/]+/)
  if (!absolute || segments.includes('..') || candidate.includes('*')) {
    throw new TypeError(`${path} contains invalid absolute path pattern ${JSON.stringify(pattern)}`)
  }
}

function resolveMinimumSize(
  declaration: WindowConfig,
  label: string,
): Pick<WindowConfig, 'minWidth' | 'minHeight'> {
  const hasWidth = declaration.minWidth !== undefined
  const hasHeight = declaration.minHeight !== undefined
  if (!hasWidth && !hasHeight) return {}
  for (const [name, value] of [
    ['minWidth', declaration.minWidth],
    ['minHeight', declaration.minHeight],
  ] as const) {
    if (value !== undefined
      && (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)) {
      throw new TypeError(`window ${label} ${name} must be a positive 32-bit integer`)
    }
  }
  // tao accepts one two-dimensional minimum. Zero leaves the unspecified axis
  // unconstrained instead of silently discarding the configured axis.
  return {
    minWidth: declaration.minWidth ?? 0,
    minHeight: declaration.minHeight ?? 0,
  }
}

/** The largest positive 32-bit integer — tao's inner-size fields are `i32`. */
const MAX_WINDOW_DIMENSION = 2_147_483_647

function resolveMaximumSize(
  declaration: WindowConfig,
  label: string,
): Pick<WindowConfig, 'maxWidth' | 'maxHeight'> {
  const hasWidth = declaration.maxWidth !== undefined
  const hasHeight = declaration.maxHeight !== undefined
  if (!hasWidth && !hasHeight) return {}
  for (const [name, value] of [
    ['maxWidth', declaration.maxWidth],
    ['maxHeight', declaration.maxHeight],
  ] as const) {
    if (value !== undefined
      && (!Number.isSafeInteger(value) || value <= 0 || value > MAX_WINDOW_DIMENSION)) {
      throw new TypeError(`window ${label} ${name} must be a positive 32-bit integer`)
    }
  }
  if (declaration.maxWidth !== undefined
    && declaration.minWidth !== undefined
    && declaration.maxWidth < declaration.minWidth) {
    throw new TypeError(`window ${label} maxWidth must be greater than or equal to minWidth`)
  }
  if (declaration.maxHeight !== undefined
    && declaration.minHeight !== undefined
    && declaration.maxHeight < declaration.minHeight) {
    throw new TypeError(`window ${label} maxHeight must be greater than or equal to minHeight`)
  }
  // tao accepts one two-dimensional maximum. An unset axis is filled with the
  // largest representable size so it stays effectively unconstrained instead
  // of silently discarding the configured axis — the mirror image of
  // resolveMinimumSize's zero sentinel above.
  return {
    maxWidth: declaration.maxWidth ?? MAX_WINDOW_DIMENSION,
    maxHeight: declaration.maxHeight ?? MAX_WINDOW_DIMENSION,
  }
}

function resolveWindowRoute(route: string | undefined, label: string): string {
  if (route === undefined) return '/'
  if (typeof route !== 'string' || route.length === 0 || route !== route.trim()
    || !route.startsWith('/') || route.startsWith('//') || route.includes('\\')) {
    throw new TypeError(`window ${label} route must be a same-origin absolute path beginning with /`)
  }
  let parsed: URL
  try {
    parsed = new URL(route, WINDOW_ROUTE_BASE)
  } catch {
    throw new TypeError(`window ${label} route must be a valid same-origin relative path`)
  }
  if (parsed.origin !== WINDOW_ROUTE_BASE) {
    throw new TypeError(`window ${label} route must stay on the application origin`)
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}
