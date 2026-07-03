import { useState } from 'react'
import { Link, useGlobalContextMenu } from 'murasaki'
import type { Metadata } from 'murasaki'
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@murasakijs/ui'
import { greet } from '../api/actions'

export const metadata: Metadata = {
  title: 'Murasaki App',
  description: 'A desktop app built with murasaki',
}

/**
 * "Hello, Murasaki 🦋" — the greeting stays.
 *
 * Right-click anywhere to see a native OS context menu (NSMenu on macOS,
 * HMENU on Windows, GtkMenu on Linux) — no HTML popup.
 */
export default function Page() {
  const [count, setCount] = useState(0)
  const [greeting, setGreeting] = useState<string | null>(null)

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
    <main className="mx-auto max-w-md text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        Hello, Murasaki <span aria-hidden>🦋</span>
      </h1>
      <p className="mt-3 text-muted-foreground">
        Right-click for a native context menu.
      </p>

      <Card className="mt-8 text-left">
        <CardHeader>
          <CardTitle>Try it out</CardTitle>
          <CardDescription>
            Edit <code className="rounded bg-muted px-1.5 py-0.5 text-sm">src/app/page.tsx</code> and
            save to reload.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 text-center">
          <Button onClick={() => setCount((n) => n + 1)}>
            Clicked {count} times
          </Button>
          <Button variant="outline" onClick={async () => setGreeting(await greet('Murasaki'))}>
            Call server action
          </Button>
          {greeting && <p className="text-sm text-muted-foreground">{greeting}</p>}
        </CardContent>
      </Card>

      <p className="mt-6">
        <Link href="/about" className="text-murasaki-bright hover:underline">
          About this app
        </Link>
      </p>
    </main>
  )
}
