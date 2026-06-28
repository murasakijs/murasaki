// Terminal keyboard shortcuts (raw mode stdin).
//
//   o   open the window
//   r   restart (close + open)
//   q   quit
//   Ctrl+C   quit

export type ShortcutHandlers = {
  onOpen: () => void
  onRestart: () => void
  onQuit: () => void
}

export function setupShortcuts(handlers: ShortcutHandlers): void {
  if (!process.stdin.isTTY) return
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (key) => {
    const k = key.toString()
    if (k === 'o' || k === 'O') handlers.onOpen()
    else if (k === 'r' || k === 'R') handlers.onRestart()
    else if (k === 'q' || k === 'Q' || k === '\x03' /* Ctrl+C */) handlers.onQuit()
  })
}

export function teardownStdin(): void {
  try {
    process.stdin.setRawMode(false)
  } catch {}
}
