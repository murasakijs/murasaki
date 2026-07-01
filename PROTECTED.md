# Protected assets — DO NOT LOSE during v1.0 rewrite

Extracted for safety while `murasaki` and `create-murasaki` are rewritten
from scratch (Plan: `/Users/ichi/.claude/plans/eager-humming-sundae.md`).

Everything below must reappear verbatim in the new codebase.

---

## 1. `create-murasaki` — CLI banner (butterfly + wordmark)

Verbatim copy of `create-murasaki/index.mjs` lines **12–100** (as of v0.24.1
tag). The rewrite must reintroduce the block wholesale, unchanged.

### 1a. ANSI truecolor palette (Oomurasaki)

```js
// ── ANSI truecolor (Oomurasaki palette) ────────────────────────────────
const BRIGHT = '\x1b[38;2;168;85;247m'
const DEEP   = '\x1b[38;2;91;33;182m'
const CREAM  = '\x1b[38;2;250;245;232m'
const DARK   = '\x1b[38;2;59;7;100m'
const DIM    = '\x1b[38;2;136;136;153m'
const GREEN  = '\x1b[38;2;76;175;80m'
const RED    = '\x1b[38;2;239;68;68m'
const BOLD   = '\x1b[1m'
const RESET  = '\x1b[0m'

const BG_BRIGHT = '\x1b[48;2;168;85;247m'
const BG_DEEP   = '\x1b[48;2;91;33;182m'
const BG_CREAM  = '\x1b[48;2;250;245;232m'
const BG_DARK   = '\x1b[48;2;59;7;100m'

const noColor = process.env.NO_COLOR || !process.stdout.isTTY
const c = (code) => (noColor ? '' : code)
```

### 1b. Butterfly grid (19 col × 12 row)

```js
// ── H4 butterfly grid (19 col × 12 row) ────────────────────────────────
const GRID = [
  '.....b.......b.....',
  '......b.....b......',
  '...bbbb.....bbbb...',
  '..bbbbbb...bbbbbb..',
  '.bbbbcbbb.bbbcbbbb.',
  '.bbbbbbbb.bbbbbbbb.',
  '..bbbbbbb.bbbbbbb..',
  '...bbbbb...bbbbb...',
  '...................',
  '.....ddd...ddd.....',
  '....ddddd.ddddd....',
  '.....dddd.dddd.....',
]
const FG_OF = { b: BRIGHT, d: DEEP, c: CREAM, k: DARK }
const BG_OF = { b: BG_BRIGHT, d: BG_DEEP, c: BG_CREAM, k: BG_DARK }
const GRID_WIDTH = GRID[0].length

function renderButterflyLines() {
  const out = []
  for (let r = 0; r < GRID.length; r += 2) {
    const top = GRID[r] || '.'.repeat(GRID_WIDTH)
    const bot = GRID[r + 1] || '.'.repeat(GRID_WIDTH)
    let line = ''
    for (let col = 0; col < GRID_WIDTH; col++) {
      const tCh = top[col]
      const bCh = bot[col]
      const tFg = FG_OF[tCh]
      const bFg = FG_OF[bCh]
      if (!tFg && !bFg) line += ' '
      else if (tFg && !bFg) line += c(tFg) + '▀' + c(RESET)
      else if (!tFg && bFg) line += c(bFg) + '▄' + c(RESET)
      else if (tCh === bCh) line += c(tFg) + '█' + c(RESET)
      else line += c(tFg) + c(BG_OF[bCh]) + '▀' + c(RESET)
    }
    out.push(line)
  }
  return out
}
```

### 1c. Wordmark (figlet standard "murasaki") — keep verbatim, the `i` dot has to line up with `|_|`

```js
// figlet -f standard murasaki  (kept verbatim so the "i" dot lines up with |_|)
const WORDMARK_LINES = [
  '                                     _    _ ',
  ' _ __ ___  _   _ _ __ __ _ ___  __ _| | _(_)',
  "| '_ ` _ \\| | | | '__/ _` / __|/ _` | |/ / |",
  '| | | | | | |_| | | | (_| \\__ \\ (_| |   <| |',
  '|_| |_| |_|\\__,_|_|  \\__,_|___/\\__,_|_|\\_\\_|',
]

function colorize(line, color, opts = {}) {
  return (opts.bold ? c(BOLD) : '') + c(color) + line + c(RESET)
}

function renderBanner() {
  const bf = renderButterflyLines()
  const wm = WORDMARK_LINES.map((l) => colorize(l, BRIGHT, { bold: true }))
  const gap = '   '
  const total = Math.max(bf.length, wm.length)
  const wmOffset = Math.max(0, Math.floor((bf.length - wm.length) / 2))
  const blankBf = ' '.repeat(GRID_WIDTH)
  const lines = []
  for (let i = 0; i < total; i++) {
    const bfLine = bf[i] !== undefined ? bf[i] : blankBf
    const wmIdx = i - wmOffset
    const wmLine = (wmIdx >= 0 && wmIdx < wm.length) ? wm[wmIdx] : ''
    lines.push('  ' + bfLine + gap + wmLine)
  }
  return lines.join('\n')
}
```

---

## 2. `create-murasaki` — default template greeting

The scaffolded starter must render **`Hello, Murasaki 🦋`** on `/`.

Old shape (v0.24.x): `<h1>Hello, {name} 🦋</h1>` with `name` state defaulting
to `"Murasaki"`. React 19 rewrite may change the surrounding component
architecture, but this single line stays.

---

## 3. `murasaki` — public API surface (names must survive)

The rewrite is free to re-implement, but these identifiers stay so v0.25
users' code compiles unmodified against v1.0:

### 3a. Framework primitives
- `defineConfig`
- `defineAction`
- `callAction`
- `useAction` — signature may adjust to align with React 19 `useActionState`
- `Metadata` (type)
- `Link` (component)
- `installClientRpc`
- `useGlobalContextMenu`

### 3b. Theming
- `ThemeProvider`, `useTheme`
- `T` (theme-token accessor)
- `themeToCss`
- `defaultDarkTheme`, `defaultLightTheme`

### 3c. Components (35, current v0.25.4)

Layout: `View`, `Row`, `Stack`, `Text`

Desktop shell: `TitleBar`, `NoDrag`, `Sidebar`, `SidebarItem`, `Toolbar`,
`StatusBar`, `Pane`

UI: `Button`, `Card`, `Input`, `Textarea`, `Modal`, `List`, `ListItem`

Forms: `Switch`, `Checkbox`, `RadioGroup`, `Radio`

Overlay: `Tooltip`, `Tabs`, `TabList`, `Tab`, `TabPanel`, `ContextMenu`

Feedback: `Badge`, `Avatar`, `Spinner`, `Progress`, `ToastProvider`,
`useToast`, `toast`, `dismissToast`

Radix / shadcn re-implementations MAY be added under new names
(`Dialog`, `Sheet`, `Combobox`, `DropdownMenu`, `Popover`, `DataTable`,
`Skeleton`, `Command`, …), but the old names above stay as valid exports.

### 3d. Hooks (14)

React-style: `useState`, `useEffect`, `useRef`

Native bridge: `useNotification`, `useClipboard`, `useShell`, `useFs`,
`useDialog`, `useWindow`, `useTray`, `useToast`, `useAction`

Signature evolution is fine (e.g. `useFs` returning an object of promises
rather than sync methods), but the export names stay.

---

## 4. Helper functions worth stealing before the wipe

These live inside code that will otherwise be deleted. Re-home them in the
new tree rather than rewriting from scratch:

- `packages/murasaki/src/wix.ts` (from current `src/wix.ts`) — WiX v4 `.msi`
  generation. Stable, no dependency on webview stack.
- `packages/murasaki/src/appimage.ts` (from `src/appimage.ts`) — mksquashfs
  `.AppImage`. Stable.
- `makeDmg` function inside current `src/build.ts` — hdiutil drag-to-install
  layout. Move to `packages/murasaki/src/pack/dmg.ts`.
- `ensureNodeBinary` from current `src/download.ts` — cross-compile Node
  fetch + cache. Rename target to native prebuild but keep the caching
  layout under `~/.murasaki/cache/`.
- `capitalize`, `readAppName`, `readBundleId`, `readVersion`, `runOrFail`,
  `resolveNpmTarball`, `sha256` helpers from `src/build.ts` — small utility
  functions worth carrying over verbatim (they're pure and used everywhere).

---

## 5. Reference: current v0.25.4 shipping today

- `murasaki@0.25.4` on npm — legacy branch (see `v0.25-legacy` branch)
- `create-murasaki@0.24.1` on npm — has ASCII banner + `Hello, world 🦋` (default `name` state was `"world"`; the rewrite bumps that default to `"Murasaki"`)
