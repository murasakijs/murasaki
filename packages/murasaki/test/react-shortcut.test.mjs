// Coverage for src/react/shortcut.ts's `parseShortcut` — pure, dependency-free
// aside from an optional `navigator` read (per its own doc comment), so this
// file drives it directly with a controlled `navigator.platform` rather than
// going through a rendered component.
import assert from 'node:assert/strict'
import test from 'node:test'

import { parseShortcut } from '../dist/react/shortcut.js'

/** Runs `body` with `globalThis.navigator.platform` temporarily set (parseShortcut's only ambient dependency). */
function withPlatform(platform, body) {
  const hadNavigator = 'navigator' in globalThis
  const original = hadNavigator ? globalThis.navigator : undefined
  Object.defineProperty(globalThis, 'navigator', {
    value: { platform, userAgent: '' },
    configurable: true,
  })
  try {
    body()
  } finally {
    if (hadNavigator) {
      Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true })
    } else {
      delete globalThis.navigator
    }
  }
}

function keyEvent(fields) {
  return { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: '', ...fields }
}

test('parseShortcut: "command" resolves to metaKey on Mac, ctrlKey elsewhere, but always accelerates as CmdOrCtrl', () => {
  withPlatform('MacIntel', () => {
    const { accelerator, matches } = parseShortcut('command,R')
    assert.equal(accelerator, 'CmdOrCtrl+R')
    assert.equal(matches(keyEvent({ metaKey: true, key: 'r' })), true)
    assert.equal(matches(keyEvent({ ctrlKey: true, key: 'r' })), false, 'ctrl alone does not satisfy "command" on Mac')
  })

  withPlatform('Win32', () => {
    const { accelerator, matches } = parseShortcut('command,R')
    assert.equal(accelerator, 'CmdOrCtrl+R')
    assert.equal(matches(keyEvent({ ctrlKey: true, key: 'r' })), true)
    assert.equal(matches(keyEvent({ metaKey: true, key: 'r' })), false, 'meta alone does not satisfy "command" off Mac')
  })
})

test('parseShortcut: "cmd" and "mod" are synonyms for "command"', () => {
  withPlatform('Win32', () => {
    assert.equal(parseShortcut('cmd,S').accelerator, 'CmdOrCtrl+S')
    assert.equal(parseShortcut('mod,S').accelerator, 'CmdOrCtrl+S')
    assert.equal(parseShortcut('cmd,S').matches(keyEvent({ ctrlKey: true, key: 's' })), true)
  })
})

test('parseShortcut: literal "ctrl"/"control" always means ctrlKey, even on Mac', () => {
  withPlatform('MacIntel', () => {
    const { accelerator, matches } = parseShortcut('control,K')
    assert.equal(accelerator, 'Ctrl+K')
    assert.equal(matches(keyEvent({ ctrlKey: true, key: 'k' })), true)
    assert.equal(matches(keyEvent({ metaKey: true, key: 'k' })), false)
  })
})

test('parseShortcut: "option"/"alt" both map to altKey', () => {
  const a = parseShortcut('option,T')
  const b = parseShortcut('alt,T')
  assert.equal(a.accelerator, 'Alt+T')
  assert.equal(b.accelerator, 'Alt+T')
  assert.equal(a.matches(keyEvent({ altKey: true, key: 't' })), true)
})

test('parseShortcut: multiple modifiers combine, in the order given', () => {
  const { accelerator, matches } = parseShortcut('ctrl,shift,delete')
  assert.equal(accelerator, 'Ctrl+Shift+Delete')
  assert.equal(matches(keyEvent({ ctrlKey: true, shiftKey: true, key: 'Delete' })), true)
  assert.equal(matches(keyEvent({ ctrlKey: true, key: 'Delete' })), false, 'missing shift fails')
  assert.equal(matches(keyEvent({ ctrlKey: true, shiftKey: true, altKey: true, key: 'Delete' })), false, 'extra alt fails')
})

test('parseShortcut: named keys map to their KeyboardEvent.key / muda-accelerator spellings', () => {
  const table = [
    ['enter', 'Enter', 'Enter'],
    ['esc', 'Escape', 'Escape'],
    ['escape', 'Escape', 'Escape'],
    ['space', ' ', 'Space'],
    ['tab', 'Tab', 'Tab'],
    ['backspace', 'Backspace', 'Backspace'],
    ['delete', 'Delete', 'Delete'],
    ['del', 'Delete', 'Delete'],
    ['up', 'ArrowUp', 'Up'],
    ['down', 'ArrowDown', 'Down'],
    ['left', 'ArrowLeft', 'Left'],
    ['right', 'ArrowRight', 'Right'],
    ['home', 'Home', 'Home'],
    ['end', 'End', 'End'],
    ['pageup', 'PageUp', 'PageUp'],
    ['pagedown', 'PageDown', 'PageDown'],
  ]
  for (const [token, eventKey, acceleratorKey] of table) {
    const { accelerator, matches } = parseShortcut(`shift,${token}`)
    assert.equal(accelerator, `Shift+${acceleratorKey}`, `accelerator for "${token}"`)
    assert.equal(matches(keyEvent({ shiftKey: true, key: eventKey })), true, `matches for "${token}"`)
  }
})

test('parseShortcut: function keys (f1..f12) pass through uppercased, and only within range', () => {
  assert.equal(parseShortcut('f1').accelerator, 'F1')
  assert.equal(parseShortcut('f12').accelerator, 'F12')
  assert.equal(parseShortcut('f1').matches(keyEvent({ key: 'F1' })), true)
  // f13 doesn't match the function-key regex (only f1-f9, f10-f12) — falls
  // through to the generic multi-char passthrough instead.
  assert.equal(parseShortcut('f13').accelerator, 'f13')
})

test('parseShortcut: a single-character key is matched case-insensitively', () => {
  const { accelerator, matches } = parseShortcut('command,a')
  assert.equal(accelerator, 'CmdOrCtrl+A')
  withPlatform('MacIntel', () => {
    const macMatch = parseShortcut('command,a').matches
    assert.equal(macMatch(keyEvent({ metaKey: true, key: 'a' })), true)
    assert.equal(macMatch(keyEvent({ metaKey: true, key: 'A' })), true)
  })
})

test('parseShortcut: no modifiers at all — bare key, and any stray modifier on the event fails to match', () => {
  const { accelerator, matches } = parseShortcut('a')
  assert.equal(accelerator, 'A')
  assert.equal(matches(keyEvent({ key: 'a' })), true)
  assert.equal(matches(keyEvent({ key: 'a', metaKey: true })), false, 'an unexpected modifier on the event breaks the match')
})

test('parseShortcut: mixed case and stray whitespace in the spec are normalized', () => {
  withPlatform('Win32', () => {
    const a = parseShortcut('Command, R')
    const b = parseShortcut('  command , r ')
    assert.equal(a.accelerator, 'CmdOrCtrl+R')
    assert.equal(b.accelerator, 'CmdOrCtrl+R')
    assert.equal(a.matches(keyEvent({ ctrlKey: true, key: 'r' })), true)
  })
})

test('parseShortcut: "+" as the literal key name maps to the muda "Plus" accelerator', () => {
  withPlatform('Win32', () => {
    const { accelerator, matches } = parseShortcut('command,+')
    assert.equal(accelerator, 'CmdOrCtrl+Plus')
    // resolveKeyboardKey has no special-case for "+", so the matcher expects
    // the literal character.
    assert.equal(matches(keyEvent({ ctrlKey: true, key: '+' })), true)
  })
})

test('parseShortcut: an empty spec degrades to an empty accelerator and a key that (almost) never matches', () => {
  const { accelerator, matches } = parseShortcut('')
  assert.equal(accelerator, '')
  assert.equal(matches(keyEvent({ key: '' })), true)
  assert.equal(matches(keyEvent({ key: 'a' })), false)
})

// NOTE: possible bug — `parseShortcut` assumes its spec ends in a real,
// non-modifier key token. Its "find the key" scan (`while (keyIndex > 0 &&
// MODIFIER_TOKENS.has(tokens[keyIndex])) keyIndex--`) stops as soon as
// `keyIndex` reaches 0 *even if that token is itself a modifier name* — so a
// spec made up entirely of modifier tokens ends up treating the FIRST token
// as if it were the literal key, rather than erroring or ignoring the spec.
// The result is a silently-nonsensical accelerator/matcher, not a thrown
// error — documented here as observed behavior with entirely-modifier input.
test('parseShortcut: a spec with no real key token treats the first modifier-looking token as the key (documented quirk)', () => {
  const single = parseShortcut('command')
  assert.equal(single.accelerator, 'command')
  assert.equal(single.matches(keyEvent({ key: 'command' })), true)

  const double = parseShortcut('command,shift')
  // "shift" is correctly recognized as a modifier; "command" — despite being
  // a modifier keyword — is what's left over and gets treated as the key.
  assert.equal(double.accelerator, 'Shift+command')
  assert.equal(double.matches(keyEvent({ shiftKey: true, key: 'command' })), true)
})
