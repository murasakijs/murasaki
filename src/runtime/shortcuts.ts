// Terminal single-key shortcuts (Turbopack-style).
//
//   r   reload
//   R   restart window
//   q   quit
//   Ctrl+C   quit
//
// History: an earlier attempt at stdin listening caused the OS close button
// to hang. The fix is `process.stdin.unref()` — stdin remains attached, but
// it no longer keeps the libuv loop tied to a handle that the macOS Cocoa
// close pipeline blocks on. With unref, the close button completes; with
// it set, the listener still receives keystrokes.

export type ShortcutHandlers = {
  onRestart: () => void
  onReload: () => void
  onQuit: () => void
}

let stdinAttached = false

export function setupShortcuts(handlers: ShortcutHandlers): void {
  // Signal handling first — always works, never touches stdin polling.
  const sig = () => handlers.onQuit()
  process.on('SIGINT', sig)
  process.on('SIGTERM', sig)

  // Stdin keypress shortcuts — only on a real TTY.
  if (!process.stdin.isTTY) return

  process.stdin.setRawMode(true)
  process.stdin.setEncoding('utf8')

  // CRITICAL: unref BEFORE adding the data listener. Without unref, the
  // attached stdin handle prevents the OS close button from completing the
  // window-close pipeline (observed on macOS WKWebView).
  process.stdin.unref()
  process.stdin.resume()

  stdinAttached = true

  process.stdin.on('data', (key) => {
    const k = key.toString()
    if (k === 'r') handlers.onReload()
    else if (k === 'R') handlers.onRestart()
    else if (k === 'q' || k === 'Q' || k === '\x03' /* Ctrl+C */) handlers.onQuit()
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
