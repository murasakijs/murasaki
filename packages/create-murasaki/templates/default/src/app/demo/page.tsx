import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@murasakijs/ui'
import { Plus, Zap } from 'lucide-react'
import type { Metadata } from 'murasaki'
import { ContextMenuTrigger, Link, useContextMenu } from 'murasaki'
import { useState } from 'react'
import { Action } from '@/lib/action'
import { useCounter } from '@/lib/counter'

export const metadata: Metadata = {
  title: 'Demo · Murasaki App',
}

/**
 * Two native context menus (NSMenu / HMENU / GtkMenu, never an HTML popup):
 *  - the app-wide menu in src/app/layout.tsx
 *  - the card-scoped menu below — its reusable actions come from
 *    src/lib/action.ts as <Action.increment /> (the counter lives in a store so
 *    the action is shareable); "Call API route" posts to the API route at
 *    src/api/action-demo/route.ts.
 */
export default function DemoPage() {
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
    <main className="mx-auto max-w-md text-center">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Demo</h1>
      <p className="mt-3 text-muted-foreground">
        Right-click the card — with <code>inherit</code> its menu also shows the app-wide items — or
        right-click anywhere else for just the app menu.
      </p>

      <ContextMenuTrigger id="card" inherit>
        <Card className="mt-8 text-center">
          <CardHeader>
            <CardTitle>Try it out</CardTitle>
            <CardDescription>
              Right-click this card, or edit{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-sm">src/app/demo/page.tsx</code>.
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

      <p className="mt-6 text-xs text-muted-foreground">
        The counter uses the store in{' '}
        <code className="rounded bg-muted px-1.5 py-0.5">src/lib/counter.ts</code>; "Call API route"
        posts to{' '}
        <code className="rounded bg-muted px-1.5 py-0.5">src/api/action-demo/route.ts</code>.
      </p>

      <p className="mt-6">
        <Link href="/" className="text-murasaki-bright hover:underline">
          ← Back home
        </Link>
      </p>
    </main>
  )
}
