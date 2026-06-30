// Native bridge exposed to the WebView under `window.murasaki`.
//
// Each function here becomes callable from client code via
//   await window.murasaki.<name>(args)
// (the underlying transport is @webviewjs/webview's `webview.expose`).
//
// macOS-first; Windows/Linux paths are best-effort. All values & arguments
// must be JSON-serializable.

import { spawn } from 'node:child_process'
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  readdir as fsReaddir,
  stat as fsStat,
  writeFile as fsWriteFile,
} from 'node:fs/promises'

type NotifyOptions = {
  title: string
  body?: string
  sound?: boolean
}

type OpenFileOptions = {
  /** Window title for the dialog */
  title?: string
  /** Allow selecting multiple files */
  multiple?: boolean
  /** Allow selecting folders instead of files */
  directory?: boolean
}

type SaveFileOptions = {
  title?: string
  /** Suggested filename (and extension) */
  defaultName?: string
}

type DirEntry = {
  name: string
  isDirectory: boolean
  isFile: boolean
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

  // ── File system ────────────────────────────────────────────────────
  /** Read a UTF-8 file. */
  async fsReadFile(path: string): Promise<string> {
    return fsReadFile(path, 'utf8')
  },

  /** Write a UTF-8 file (creates or overwrites). */
  async fsWriteFile(path: string, content: string): Promise<void> {
    return fsWriteFile(path, content, 'utf8')
  },

  /** Check if a path exists. */
  async fsExists(path: string): Promise<boolean> {
    try {
      await fsStat(path)
      return true
    } catch {
      return false
    }
  },

  /** Create a directory (recursive). */
  async fsMkdir(path: string): Promise<void> {
    await fsMkdir(path, { recursive: true })
  },

  /** List a directory's contents. */
  async fsReadDir(path: string): Promise<DirEntry[]> {
    const entries = await fsReaddir(path, { withFileTypes: true })
    return entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory(),
      isFile: e.isFile(),
    }))
  },

  // ── File dialogs ──────────────────────────────────────────────────
  /** Open a file picker. Returns selected paths (empty if cancelled). */
  async openFile(opts: OpenFileOptions = {}): Promise<string[]> {
    if (process.platform === 'darwin') return openFileMac(opts)
    if (process.platform === 'win32') return openFileWindows(opts)
    return openFileLinux(opts)
  },

  /** Save dialog. Returns selected path (empty if cancelled). */
  async saveFile(opts: SaveFileOptions = {}): Promise<string> {
    if (process.platform === 'darwin') return saveFileMac(opts)
    if (process.platform === 'win32') return saveFileWindows(opts)
    return saveFileLinux(opts)
  },

  /** Murasaki version (debug/probe). */
  version: '0.7.0',
}

// ── Tray icons ───────────────────────────────────────────────────
// Keeps track of created TrayIcon native handles by id so client code
// can update / destroy them later.
type TrayHandle = {
  setTitle?: (t?: string | null) => void
  [Symbol.dispose]?: () => void
}
const trays = new Map<string, TrayHandle>()
let nextTrayId = 0

type TrayCreateOptions = {
  id?: string
  title?: string
  tooltip?: string
  /** Absolute path to a PNG/ICO/etc. icon file. */
  iconPath?: string
  /** Treat the icon as a template (macOS menu-bar style: gets tinted black/white). */
  iconIsTemplate?: boolean
}

type TrayUpdateOptions = {
  title?: string
}

export function createTrayBridge(appRef: unknown) {
  const app = appRef as {
    createTrayIcon?: (opts: Record<string, unknown>) => TrayHandle
  }
  return {
    /** Create a tray icon. Returns its id. */
    async trayCreate(opts: TrayCreateOptions = {}): Promise<string> {
      const id = opts.id ?? `tray${++nextTrayId}`
      if (trays.has(id)) return id
      const payload: Record<string, unknown> = {
        id,
        title: opts.title,
        tooltip: opts.tooltip,
      }
      if (opts.iconPath) {
        payload.icon = { iconPath: opts.iconPath, iconAsTemplate: opts.iconIsTemplate ?? true }
      }
      try {
        const handle = app.createTrayIcon?.(payload)
        if (handle) trays.set(id, handle)
      } catch {
        // Backend may refuse if no display server (Linux headless etc.)
      }
      return id
    },

    /** Update a tray's title (the only field most platforms allow runtime updates on). */
    async trayUpdate(id: string, opts: TrayUpdateOptions): Promise<void> {
      const t = trays.get(id)
      if (!t) return
      if (opts.title !== undefined) {
        try {
          t.setTitle?.(opts.title)
        } catch {}
      }
    },

    /** Destroy and forget a tray icon. */
    async trayDestroy(id: string): Promise<void> {
      const t = trays.get(id)
      if (!t) return
      try {
        t[Symbol.dispose]?.()
      } catch {}
      trays.delete(id)
    },

    /** Currently registered tray ids. */
    async trayList(): Promise<string[]> {
      return [...trays.keys()]
    },
  }
}

// ── Window methods (need a closure over the active window) ────────
// window.ts merges this into the namespace exposed via webview.expose().
export function createWindowBridge(getWin: () => unknown) {
  type Win = {
    setMinimized?: (v: boolean) => void
    setMaximized?: (v: boolean) => void
    setFullscreen?: (kind?: string | null) => void
    setTitle?: (t: string) => void
    setSize?: (w: number, h: number, logical?: boolean) => unknown
    setPosition?: (x: number, y: number, logical?: boolean) => void
    setResizable?: (v: boolean) => void
    center?: () => void
    focus?: () => void
    hide?: () => void
    show?: () => void
    isMaximized?: () => boolean
    isMinimized?: () => boolean
    isVisible?: () => boolean
  }
  const w = () => getWin() as Win | null
  return {
    windowMinimize: async (): Promise<void> => {
      w()?.setMinimized?.(true)
    },
    windowMaximize: async (): Promise<void> => {
      w()?.setMaximized?.(true)
    },
    windowUnmaximize: async (): Promise<void> => {
      w()?.setMaximized?.(false)
    },
    windowSetFullscreen: async (full: boolean): Promise<void> => {
      w()?.setFullscreen?.(full ? 'normal' : null)
    },
    windowSetTitle: async (title: string): Promise<void> => {
      w()?.setTitle?.(title)
    },
    windowSetSize: async (width: number, height: number): Promise<void> => {
      w()?.setSize?.(width, height, true)
    },
    windowSetPosition: async (x: number, y: number): Promise<void> => {
      w()?.setPosition?.(x, y, true)
    },
    windowSetResizable: async (resizable: boolean): Promise<void> => {
      w()?.setResizable?.(resizable)
    },
    windowCenter: async (): Promise<void> => {
      w()?.center?.()
    },
    windowFocus: async (): Promise<void> => {
      w()?.focus?.()
    },
    windowHide: async (): Promise<void> => {
      w()?.hide?.()
    },
    windowShow: async (): Promise<void> => {
      w()?.show?.()
    },
    windowIsMaximized: async (): Promise<boolean> => {
      return w()?.isMaximized?.() ?? false
    },
    windowIsMinimized: async (): Promise<boolean> => {
      return w()?.isMinimized?.() ?? false
    },
    windowIsVisible: async (): Promise<boolean> => {
      return w()?.isVisible?.() ?? true
    },
  }
}

// ── Dialog helpers (per-platform) ──────────────────────────────────
async function openFileMac(opts: OpenFileOptions): Promise<string[]> {
  const what = opts.directory ? 'choose folder' : 'choose file'
  const withMultiple = opts.multiple ? ' with multiple selections allowed' : ''
  const withTitle = opts.title ? ` with prompt "${escapeAppleScript(opts.title)}"` : ''
  // AppleScript: returns POSIX path(s); on cancel, throws — we catch.
  const script = opts.multiple
    ? `set theFiles to ${what}${withTitle}${withMultiple}
       set thePaths to {}
       repeat with f in theFiles
         set end of thePaths to POSIX path of f
       end repeat
       set AppleScript's text item delimiters to "\\n"
       return thePaths as text`
    : `POSIX path of (${what}${withTitle})`
  try {
    const out = await runCapture('osascript', ['-e', script])
    return out
      .trim()
      .split('\n')
      .filter((p) => p.length > 0)
  } catch {
    return []
  }
}

async function saveFileMac(opts: SaveFileOptions): Promise<string> {
  const withTitle = opts.title ? ` with prompt "${escapeAppleScript(opts.title)}"` : ''
  const withDefault = opts.defaultName
    ? ` default name "${escapeAppleScript(opts.defaultName)}"`
    : ''
  const script = `POSIX path of (choose file name${withTitle}${withDefault})`
  try {
    return (await runCapture('osascript', ['-e', script])).trim()
  } catch {
    return ''
  }
}

async function openFileWindows(_opts: OpenFileOptions): Promise<string[]> {
  // Best-effort: minimal PowerShell. Production-ready dialogs are a TODO.
  const ps = `Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.OpenFileDialog
$d.Multiselect = $true
if ($d.ShowDialog() -eq 'OK') { $d.FileNames -join "\`n" }`
  try {
    const out = await runCapture('powershell', ['-Command', ps])
    return out
      .trim()
      .split('\n')
      .filter((p) => p.length > 0)
  } catch {
    return []
  }
}

async function saveFileWindows(_opts: SaveFileOptions): Promise<string> {
  const ps = `Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.SaveFileDialog
if ($d.ShowDialog() -eq 'OK') { $d.FileName }`
  try {
    return (await runCapture('powershell', ['-Command', ps])).trim()
  } catch {
    return ''
  }
}

async function openFileLinux(opts: OpenFileOptions): Promise<string[]> {
  const args = ['--file-selection']
  if (opts.multiple) args.push('--multiple', '--separator=\n')
  if (opts.directory) args.push('--directory')
  if (opts.title) args.push(`--title=${opts.title}`)
  try {
    const out = await runCapture('zenity', args)
    return out
      .trim()
      .split('\n')
      .filter((p) => p.length > 0)
  } catch {
    return []
  }
}

async function saveFileLinux(opts: SaveFileOptions): Promise<string> {
  const args = ['--file-selection', '--save', '--confirm-overwrite']
  if (opts.title) args.push(`--title=${opts.title}`)
  if (opts.defaultName) args.push(`--filename=${opts.defaultName}`)
  try {
    return (await runCapture('zenity', args)).trim()
  } catch {
    return ''
  }
}
