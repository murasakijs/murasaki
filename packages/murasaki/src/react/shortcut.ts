/**
 * Parses the small `"command,shift,R"`-style shortcut spec used by
 * `<ContextMenuItem shortcut="…">` into:
 *  - a muda-compatible `accelerator` string (for the native menu label), and
 *  - a `matches(e)` predicate (for firing the action straight off a
 *    `keydown`, without the menu ever opening).
 *
 * Pure and dependency-free — no DOM access beyond an optional `navigator`
 * read, so it's safe to unit test outside a browser.
 */

const MODIFIER_TOKENS = new Set(['command', 'cmd', 'control', 'ctrl', 'option', 'alt', 'shift', 'mod'])

/** `KeyboardEvent.key` for named tokens that don't map to their literal character. */
const KEYBOARD_KEY_NAMES: Record<string, string> = {
  enter: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  space: ' ',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
}

/** muda accelerator key names for the same tokens (muda's naming differs from `KeyboardEvent.key`). */
const MUDA_KEY_NAMES: Record<string, string> = {
  enter: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  '+': 'Plus',
}

const FUNCTION_KEY_RE = /^f([1-9]|1[0-2])$/

function isMac(): boolean {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  const platform = nav?.platform ?? ''
  const userAgent = nav?.userAgent ?? ''
  return /Mac/.test(platform) || /Mac/.test(userAgent)
}

function resolveKeyboardKey(token: string): string {
  if (token in KEYBOARD_KEY_NAMES) return KEYBOARD_KEY_NAMES[token]
  if (FUNCTION_KEY_RE.test(token)) return token.toUpperCase()
  return token
}

function resolveMudaKeyName(token: string): string {
  if (token in MUDA_KEY_NAMES) return MUDA_KEY_NAMES[token]
  if (FUNCTION_KEY_RE.test(token)) return token.toUpperCase()
  if (token.length === 1) return token.toUpperCase()
  return token
}

export function parseShortcut(spec: string): {
  accelerator: string
  matches: (e: KeyboardEvent) => boolean
} {
  const tokens = spec
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)

  // The last non-modifier token is the key; everything else is a modifier.
  let keyIndex = tokens.length - 1
  while (keyIndex > 0 && MODIFIER_TOKENS.has(tokens[keyIndex])) keyIndex--
  const keyToken = tokens[keyIndex] ?? ''
  const modifierTokens = tokens.filter((_, i) => i !== keyIndex)

  const mac = isMac()
  let meta = false
  let ctrl = false
  let alt = false
  let shift = false
  const acceleratorParts: string[] = []

  for (const token of modifierTokens) {
    switch (token) {
      case 'command':
      case 'cmd':
        meta = true
        acceleratorParts.push('CmdOrCtrl')
        break
      case 'mod':
        if (mac) meta = true
        else ctrl = true
        acceleratorParts.push('CmdOrCtrl')
        break
      case 'control':
      case 'ctrl':
        ctrl = true
        acceleratorParts.push('Ctrl')
        break
      case 'option':
      case 'alt':
        alt = true
        acceleratorParts.push('Alt')
        break
      case 'shift':
        shift = true
        acceleratorParts.push('Shift')
        break
    }
  }

  const resolvedKey = resolveKeyboardKey(keyToken)
  acceleratorParts.push(resolveMudaKeyName(keyToken))

  return {
    accelerator: acceleratorParts.join('+'),
    matches(e: KeyboardEvent) {
      if (Boolean(e.metaKey) !== meta) return false
      if (Boolean(e.ctrlKey) !== ctrl) return false
      if (Boolean(e.altKey) !== alt) return false
      if (Boolean(e.shiftKey) !== shift) return false
      if (resolvedKey.length === 1) return e.key.toLowerCase() === resolvedKey.toLowerCase()
      return e.key === resolvedKey
    },
  }
}
