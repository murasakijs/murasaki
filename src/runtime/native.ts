// Native bridge exposed to the WebView under `window.murasaki`.
//
// Each function here becomes callable from client code via
//   await window.murasaki.<name>(args)
// (the underlying transport is @webviewjs/webview's `webview.expose`).
//
// macOS-first; Windows/Linux paths are best-effort. All values & arguments
// must be JSON-serializable.

import { spawn } from 'node:child_process'

type NotifyOptions = {
  title: string
  body?: string
  sound?: boolean
}

function runSilent(cmd: string, args: string[], stdin?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} exited with code ${code}`))
    })
    if (stdin !== undefined) {
      proc.stdin.write(stdin)
      proc.stdin.end()
    }
  })
}

function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    proc.stdout.on('data', (chunk) => {
      out += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`${cmd} exited with code ${code}`))
    })
  })
}

function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export const nativeBridge = {
  /** Show an OS notification. */
  async notify(opts: NotifyOptions): Promise<void> {
    if (process.platform === 'darwin') {
      const title = escapeAppleScript(opts.title)
      const body = escapeAppleScript(opts.body ?? '')
      const sound = opts.sound ? ' sound name "default"' : ''
      const script = `display notification "${body}" with title "${title}"${sound}`
      await runSilent('osascript', ['-e', script])
      return
    }
    if (process.platform === 'win32') {
      // Best-effort PowerShell toast
      const escaped = opts.title.replace(/"/g, '\\"')
      const body = (opts.body ?? '').replace(/"/g, '\\"')
      const ps = `New-BurntToastNotification -Text "${escaped}","${body}"`
      await runSilent('powershell', ['-Command', ps])
      return
    }
    // Linux
    const args: string[] = []
    if (opts.body) args.push(opts.title, opts.body)
    else args.push(opts.title)
    await runSilent('notify-send', args)
  },

  /** Copy text to the system clipboard. */
  async clipboardWrite(text: string): Promise<void> {
    if (process.platform === 'darwin') return runSilent('pbcopy', [], text)
    if (process.platform === 'win32') return runSilent('clip', [], text)
    // Linux: try wl-copy (Wayland) then xclip (X11)
    try {
      return await runSilent('wl-copy', [], text)
    } catch {
      return runSilent('xclip', ['-selection', 'clipboard'], text)
    }
  },

  /** Read text from the system clipboard. */
  async clipboardRead(): Promise<string> {
    if (process.platform === 'darwin') return runCapture('pbpaste', [])
    if (process.platform === 'win32') {
      return runCapture('powershell', ['-Command', 'Get-Clipboard'])
    }
    try {
      return await runCapture('wl-paste', ['--no-newline'])
    } catch {
      return runCapture('xclip', ['-selection', 'clipboard', '-o'])
    }
  },

  /** Open a URL or file path in the system default handler (browser, etc). */
  async openExternal(target: string): Promise<void> {
    const cmd =
      process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'cmd'
      : 'xdg-open'
    const args = process.platform === 'win32' ? ['/c', 'start', '', target] : [target]
    return runSilent(cmd, args)
  },

  /** Murasaki version (debug/probe). */
  version: '0.3.0',
}
