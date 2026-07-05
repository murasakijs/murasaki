import { useState } from 'react'
import { Link, ContextMenuTrigger, useContextMenu } from 'murasaki'
import type { Metadata } from 'murasaki'
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@murasakijs/ui'
import { Plus, Zap } from 'lucide-react'
import { Action } from '@/lib/action'
import { useCounter } from '@/lib/counter'
import XLogo from '@/assets/x-logo.svg?react'

export const metadata: Metadata = {
  title: 'Murasaki App',
  description: 'A desktop app built with murasaki',
}

/**
 * "Hello, Murasaki 🦋" — the greeting stays.
 *
 * Two native context menus (NSMenu / HMENU / GtkMenu, never an HTML popup):
 *  - the app-wide menu in src/app/layout.tsx
 *  - the card-scoped menu below — its reusable actions come from
 *    src/lib/action.ts as <Action.increment /> (the counter lives in a store so
 *    the action is shareable); "Call API route" posts to the API route at
 *    src/api/action-demo/route.ts.
 *
 * The top bar's X link is a plain <a href>: murasaki opens off-origin links in
 * the user's default browser instead of loading them inside the app window.
 */
export default function Page() {
  const count = useCounter((s) => s.count)
  const increment = useCounter((s) => s.increment)
  const [greeting, setGreeting] = useState<string | null>(null)

  // Calls the API route at src/api/action-demo/route.ts (runs on the server).
  const callApi = async () => {
    const res = await fetch('/api/action-demo', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Murasaki' }),
    })
    const data = (await res.json()) as { greeting: string }
    setGreeting(data.greeting)
  }

  useContextMenu('card', [
    { label: 'Increment', shortcut: 'command,I', action: <Action.increment /> },
    { label: 'Reset counter', action: <Action.reset /> },
    { separator: true },
    { label: 'Call API route', action: callApi },
  ])

  return (
    <>
      <header className="fixed inset-x-0 top-0 flex items-center justify-between px-6 py-4 text-sm">
        <span className="font-medium tracking-tight text-muted-foreground">murasaki</span>
        <nav className="flex items-center gap-5">
          <span className="text-muted-foreground/60">Web (coming soon)</span>
          <a
            href="https://x.com/murasaki_js"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-foreground/80 transition-colors hover:text-murasaki-bright"
          >
            <XLogo className="h-3.5 w-3.5 fill-current" />
            <span>murasaki_js</span>
          </a>
        </nav>
      </header>

      <main className="mx-auto max-w-md text-center">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Hello, Murasaki <span aria-hidden>🦋</span>
        </h1>
        <p className="mt-3 text-muted-foreground">
          Right-click the card for its own menu — or anywhere else for the app menu.
        </p>

        <ContextMenuTrigger id="card">
          <Card className="mt-8 text-center">
            <CardHeader>
              <CardTitle>Try it out</CardTitle>
              <CardDescription>
                Right-click this card, or edit{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 text-sm">src/app/page.tsx</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4 text-center">
              <Button onClick={increment}>
                <Plus className="h-4 w-4" /> Clicked {count} times
              </Button>
              <Button variant="outline" onClick={callApi}>
                <Zap className="h-4 w-4" /> Call API route
              </Button>
              {greeting && <p className="text-sm text-muted-foreground">{greeting}</p>}
            </CardContent>
          </Card>
        </ContextMenuTrigger>

        <p className="mt-6">
          <Link href="/about" className="text-murasaki-bright hover:underline">
            About this app
          </Link>
        </p>
      </main>
    </>
  )
}
