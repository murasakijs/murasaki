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
import { greet } from '../api/actions'

export const metadata: Metadata = {
  title: 'Murasaki App',
  description: 'A desktop app built with murasaki',
}

/**
 * "Hello, Murasaki 🦋" — the greeting stays.
 *
 * Two native context menus (NSMenu / HMENU / GtkMenu, never an HTML popup):
 *  - the app-wide menu in src/components/app-shell.tsx (right-click the heading
 *    or the empty space around it)
 *  - the card-scoped menu below — useContextMenu('card', …) declares it (next to
 *    the state its actions touch), and <ContextMenuTrigger id="card"> applies it
 *    to the card's region. A no-id useContextMenu() would be the window default.
 *
 * The top bar's X link is a plain <a href>: murasaki opens off-origin links in
 * the user's default browser instead of loading them inside the app window.
 */
export default function Page() {
  const [count, setCount] = useState(0)
  const [greeting, setGreeting] = useState<string | null>(null)

  useContextMenu('card', [
    { label: 'Increment', shortcut: 'command,I', action: () => setCount((n) => n + 1) },
    { label: 'Reset counter', action: () => setCount(0) },
    { separator: true },
    { label: 'Call server action', action: async () => setGreeting(await greet('Murasaki')) },
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
            <svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 fill-current">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
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

        {/* Tag the region; its menu is declared above via useContextMenu('card', …). */}
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
              <Button onClick={() => setCount((n) => n + 1)}>
                Clicked {count} times
              </Button>
              <Button variant="outline" onClick={async () => setGreeting(await greet('Murasaki'))}>
                Call server action
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
