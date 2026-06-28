// Quit handler. We previously had `o`/`r`/`q` keypress shortcuts via stdin
// raw mode, but attaching any listener to stdin caused the OS close button
// to hang (stdin polling conflicted with the Cocoa main loop).
//
// Now: just listen for SIGINT/SIGTERM (Ctrl+C, kill signal). The OS close
// button + Ctrl+C cover quit. Future work: bring back o/r via the native
// menu API (webview's Menu/Tray surface), which doesn't touch stdin.

export type ShortcutHandlers = {
  onOpen: () => void
  onRestart: () => void
  onQuit: () => void
}

export function setupShortcuts(handlers: ShortcutHandlers): void {
  const quit = () => handlers.onQuit()
  process.on('SIGINT', quit)
  process.on('SIGTERM', quit)
}

export function teardownStdin(): void {
  // no-op (we never touched stdin)
}
