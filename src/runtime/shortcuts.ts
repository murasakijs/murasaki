// Terminal single-key shortcuts (Next.js / Turbopack-style).
//
//   r   restart window (clean reload, drops state)
//   q   quit
//   Ctrl+C   quit
//
// Why no separate "reload"? HMR auto-reloads on save; an explicit reload
// shortcut adds clutter without value. `r` = restart drops state so it's
// the only manual command worth a key.
//
// Implementation note: process.stdin.unref() must be called BEFORE adding
// the 'data' listener. Without it, the attached stdin handle prevents the
// macOS Cocoa close button from completing, leaving the window in
// "not responding" state.

export type ShortcutHandlers = {
  onRestart: () => void
  onQuit: () => void
}

let stdinAttached = false

export function setupShortcuts(handlers: ShortcutHandlers): void {
  // Signals — always wired, never depend on stdin polling.
  const sig = () => handlers.onQuit()
  process.on('SIGINT', sig)
  process.on('SIGTERM', sig)

  if (!process.stdin.isTTY) return

  process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')
  process.stdin.unref() // CRITICAL: see file header
  process.stdin.resume()
  stdinAttached = true

  process.stdin.on('data', (key) => {
    const k = key.toString().toLowerCase()
    if (k === 'r') handlers.onRestart()
    else if (k === 'q' || k === '\x03' /* Ctrl+C */) handlers.onQuit()
  })
}

export function teardownStdin(): void {
  if (!stdinAttached) return
  try {
    process.stdin.setRawMode(false)
  } catch {}
  try {
    process.stdin.pause()
  } catch {}
  stdinAttached = false
}
