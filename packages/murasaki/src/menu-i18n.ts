import { execSync } from 'node:child_process'
import localesData from './menu-locales.json' with { type: 'json' }

/**
 * Localized labels for the native default application menu (the macOS
 * App/Edit/Window bar built in crates/native/src/menu.rs).
 *
 * muda hardcodes English labels for its predefined items and doesn't use
 * macOS's own localized strings, so the menu is always English regardless of
 * the system language. murasaki resolves these labels for the user's language
 * and hands them to the native side, which applies them when building the menu.
 *
 * The default menu is macOS-only (build_default_app_menu is `#[cfg(macos)]`),
 * so these labels only take effect there.
 */
export interface MenuLabels {
  about: string
  services: string
  hide: string
  hideOthers: string
  showAll: string
  quit: string
  edit: string
  undo: string
  redo: string
  cut: string
  copy: string
  paste: string
  selectAll: string
  window: string
  minimize: string
  zoom: string
}

const LOCALES = localesData as Record<string, MenuLabels>
const FALLBACK = 'en'

/**
 * Best-effort system UI language, normalized to a shipped locale key. The
 * default menu is macOS-only, and there Node's `Intl`/`LANG` reflect the POSIX
 * region, not the UI language a user set in System Settings (a Japanese Mac
 * still reports en-US to Node) — so read AppleLanguages first. Falls back to
 * the JS runtime locale, then the POSIX env vars, then English.
 */
export function detectLocale(): string {
  const raw = macosUiLanguage() ?? runtimeLocale() ?? envLocale() ?? FALLBACK
  return normalizeLocale(raw)
}

/**
 * The user's macOS UI language (first entry of the AppleLanguages preference
 * list, e.g. "ja-JP"), or undefined off macOS or if the lookup fails.
 */
function macosUiLanguage(): string | undefined {
  if (process.platform !== 'darwin') return undefined
  try {
    // Output looks like `(\n    "ja-JP",\n    "en-US"\n)` — take the first tag.
    const out = execSync('defaults read -g AppleLanguages', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.match(/[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*/)?.[0]
  } catch {
    return undefined
  }
}

function runtimeLocale(): string | undefined {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale
  } catch {
    return undefined
  }
}

function envLocale(): string | undefined {
  const v = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG
  // "ja_JP.UTF-8" carries the language; "C"/"POSIX" mean "no locale" → skip.
  return v && v !== 'C' && v !== 'POSIX' ? v : undefined
}

function normalizeLocale(raw: string): string {
  const lc = raw.toLowerCase().replace('_', '-')
  if (lc.startsWith('ja')) return 'ja'
  if (lc.startsWith('zh')) return 'zh-CN'
  if (lc.startsWith('ko')) return 'ko'
  if (lc.startsWith('es')) return 'es'
  if (lc.startsWith('fr')) return 'fr'
  if (lc.startsWith('de')) return 'de'
  return FALLBACK
}

/**
 * Resolves the native menu labels for `productName`, localized for `locale`
 * (defaults to the detected system language). `{app}` in the about/hide/quit
 * labels is replaced with the product name.
 */
export function resolveMenuLabels(
  productName: string,
  locale: string = detectLocale(),
): MenuLabels {
  const t = LOCALES[locale] ?? LOCALES[FALLBACK]
  const fill = (s: string) => s.split('{app}').join(productName)
  return {
    about: fill(t.about),
    services: t.services,
    hide: fill(t.hide),
    hideOthers: t.hideOthers,
    showAll: t.showAll,
    quit: fill(t.quit),
    edit: t.edit,
    undo: t.undo,
    redo: t.redo,
    cut: t.cut,
    copy: t.copy,
    paste: t.paste,
    selectAll: t.selectAll,
    window: t.window,
    minimize: t.minimize,
    zoom: t.zoom,
  }
}
