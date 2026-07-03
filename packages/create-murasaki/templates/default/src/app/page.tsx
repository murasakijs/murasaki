import { useState } from 'react'
import {
  Link,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  Action,
} from 'murasaki'
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
 * Two context menus, both native (NSMenu / HMENU / GtkMenu), no HTML popup:
 *  - the app-wide menu in src/app/layout.tsx (right-click the heading, the
 *    empty space, or the About link)
 *  - the card-scoped menu below (right-click inside the card) — it overrides
 *    the app menu within the card and runs your own actions via Action.Run.
 */
export default function Page() {
  const [count, setCount] = useState(0)
  const [greeting, setGreeting] = useState<string | null>(null)

  return (
    <main className="mx-auto max-w-md text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        Hello, Murasaki <span aria-hidden>🦋</span>
      </h1>
      <p className="mt-3 text-muted-foreground">
        Right-click the card for its own menu — or anywhere else for the app menu.
      </p>

      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Card className="mt-8 text-left">
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

        <ContextMenuContent>
          <ContextMenuItem label="Increment" shortcut="command,I">
            <Action.Run action={() => setCount((n) => n + 1)} />
          </ContextMenuItem>
          <ContextMenuItem label="Reset counter">
            <Action.Run action={() => setCount(0)} />
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem label="Call server action">
            <Action.Run action={async () => setGreeting(await greet('Murasaki'))} />
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <p className="mt-6">
        <Link href="/about" className="text-murasaki-bright hover:underline">
          About this app
        </Link>
      </p>
    </main>
  )
}
