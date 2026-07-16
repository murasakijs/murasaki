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

  /** Same-origin renderer route loaded into this window. Defaults to `/`. */
  route?: string
  /** Whether the window is initially visible. The primary window defaults to true. */
  visible?: boolean
  /**
   * Native renderer command allowlist. The primary window falls back to the
   * top-level list; a secondary window with no list remains deny-all.
   */
  capabilities?: NativeCapability[]
}

/** A declaratively-created non-primary application window. */
export type SecondaryWindowConfig = Omit<WindowConfig, 'console'>

/** Fully-resolved window declaration written to bundle metadata. */
export interface ResolvedWindowConfig extends WindowConfig {
  label: string
  primary: boolean
  route: string
  visible: boolean
  capabilities: NativeCapability[]
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
   * Declarative secondary windows keyed by their stable native label.
   * `main` is reserved for the primary `window` declaration.
   */
  windows?: Record<string, SecondaryWindowConfig>

  /**
   * Native commands exposed to trusted renderer code through `murasaki/native`.
   * Default is deny-all; grant only the capabilities the app uses.
   */
  capabilities?: NativeCapability[]

  /** Long-lived Node main process (`src/main.ts` by default when present). */
  main?: false | {
    /** Entry relative to the project root. Default `src/main.ts`. */
    entry?: string
    /** End-to-end limit for `beforeQuit` plus `shutdown` before host exit. Default 10s. */
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

  /** Code-signing. Murasaki signs with YOUR certificate/provider — it ships none.
   * Secrets (notarization credentials and PFX passwords) are read from env vars, never here. */
  sign?: {
    /** Signing identity, e.g. "Developer ID Application: Name (TEAMID)". Defaults to
     *  $MURASAKI_SIGN_IDENTITY, then the first "Developer ID Application" in your keychain. */
    identity?: string
    /** Path to a custom entitlements .plist. Defaults to a Node-friendly hardened-runtime set. */
    entitlements?: string
    /** Windows Authenticode signing for the application executable, portable ZIP payload,
     * NSIS setup executable, and MSI installer. */
    windows?: WindowsSigningConfig
  }
}

/** Canonical runtime allowlist. Keep native permission dispatch in sync with this list. */
export const NATIVE_CAPABILITIES = [
  'app:quit',
  'dialog:openFile',
  'dialog:openDirectory',
  'dialog:saveFile',
  'clipboard:readText',
  'clipboard:writeText',
  'menu:application',
  'menu:context',
  'notification:show',
  'shell:openExternal',
  'shell:showItemInFolder',
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
  'tray:create',
  'tray:remove',
  'tray:setTooltip',
] as const

export type NativeCapability = (typeof NATIVE_CAPABILITIES)[number]

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
  validateArtifactComponent(candidate.productName, 'productName')
  if (candidate.version !== undefined) {
    if (typeof candidate.version !== 'string' || candidate.version.trim().length === 0) {
      throw new TypeError('version must be a non-empty string')
    }
    validateArtifactComponent(candidate.version, 'version')
  }
  validateMainConfig((config as { main?: unknown }).main)
  validateSecurityConfig(candidate.security)
  validateDevPort(candidate.devPort)
  validateUpdaterConfig(candidate.updater)
  validateSignConfig(candidate.sign)
  resolveWindowDeclarations(candidate)
}

// productName and version are interpolated into bundle/installer paths before
// destructive cleanup. Keep each value a portable single path component so a
// typo cannot make `resolve(...); rm(...)` target a parent/sibling directory.
const UNSAFE_ARTIFACT_COMPONENT_RE = /[<>:"/\\|?*\u0000-\u001F\u007F]/

function validateArtifactComponent(value: string, field: string): void {
  if (UNSAFE_ARTIFACT_COMPONENT_RE.test(value)) {
    throw new TypeError(`${field} must be a portable file name without reserved path or control characters`)
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
  for (const field of ['identity', 'entitlements'] as const) {
    if (sign[field] !== undefined
      && (typeof sign[field] !== 'string' || sign[field].trim().length === 0)) {
      throw new TypeError(`sign.${field} must be a non-empty string`)
    }
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
  config: Pick<MurasakiConfig, 'window' | 'windows' | 'capabilities' | 'updater'>,
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
    return resolveWindowDeclaration(label, declaration, false, capabilities)
  })
  return [primary, ...secondary]
}

function resolveWindowDeclaration(
  label: string,
  declaration: WindowConfig,
  primary: boolean,
  capabilities: NativeCapability[],
): ResolvedWindowConfig {
  if (!WINDOW_LABEL_RE.test(label)) {
    throw new TypeError(
      `window label ${JSON.stringify(label)} must be 1-64 characters using letters, numbers, dot, underscore, or hyphen`,
    )
  }
  validateWindowDeclaration(declaration, label)
  const minimumSize = resolveMinimumSize(declaration, label)
  return {
    ...declaration,
    ...minimumSize,
    label,
    primary,
    route: resolveWindowRoute(declaration.route, label),
    visible: declaration.visible ?? primary,
    capabilities: [...capabilities],
  }
}

function validateWindowDeclaration(declaration: WindowConfig, label: string): void {
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
}

function resolveCapabilities(value: unknown, path: string): NativeCapability[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array of known native capabilities`)
  }
  const unique: NativeCapability[] = []
  const seen = new Set<NativeCapability>()
  for (const capability of value) {
    if (typeof capability !== 'string' || !NATIVE_CAPABILITY_SET.has(capability)) {
      throw new TypeError(`${path} contains unknown native capability ${JSON.stringify(capability)}`)
    }
    const known = capability as NativeCapability
    // Preserve first occurrence/order for backwards compatibility while
    // ensuring metadata never contains duplicate grants.
    if (!seen.has(known)) {
      seen.add(known)
      unique.push(known)
    }
  }
  return unique
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
