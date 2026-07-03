import { useState } from 'react'
import { Link, useGlobalContextMenu } from 'murasaki'

/**
 * "Hello, Murasaki 🦋" — the greeting stays.
 *
 * Right-click anywhere to see a native OS context menu (NSMenu on macOS,
 * HMENU on Windows, GtkMenu on Linux) — no HTML popup.
 */
export default function Page() {
  const [count, setCount] = useState(0)

  useGlobalContextMenu(
    [
      { id: 'reload', label: 'Reload', accelerator: 'CmdOrCtrl+R' },
      { role: 'separator' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll', label: 'Select All' },
      { role: 'separator' },
      { id: 'devtools', label: 'Toggle DevTools', accelerator: 'F12' },
    ],
    (id) => {
      if (id === 'reload') location.reload()
    },
  )

  return (
    <main className="text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
        Hello, Murasaki <span aria-hidden>🦋</span>
      </h1>
      <p className="mt-3 text-slate-600 dark:text-slate-400">
        Edit <code className="rounded bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-sm">src/app/page.tsx</code> and save to reload.
      </p>
      <button
        onClick={() => setCount((n) => n + 1)}
        className="mt-8 rounded-md bg-murasaki-bright text-white px-4 py-2 font-medium hover:bg-murasaki-deep transition-colors"
      >
        Clicked {count} times
      </button>
      <p className="mt-6 text-xs text-slate-500 dark:text-slate-500">
        Right-click for a native context menu.
      </p>
      <p className="mt-4">
        <Link href="/about" className="text-murasaki-bright hover:underline">
          About this app
        </Link>
      </p>
    </main>
  )
}
