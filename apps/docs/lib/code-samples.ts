// Real murasaki code for the landing page's code showcase — pulled verbatim
// (trimmed for brevity only) from the docs, never invented. Each `id` pairs
// up by array position with `homeContent[lang].codeShowcase.tabs`.
export interface CodeSample {
  id: string;
  lang: "ts" | "tsx";
  code: string;
}

export const codeSamples: CodeSample[] = [
  {
    id: "actions",
    lang: "ts",
    // content/docs/guides/server-actions.mdx — "Define an action"
    code: `'use server'
import { defineAction } from 'murasaki'
import type { ActionState } from 'murasaki'

export const greet = defineAction(
  async (_prev: ActionState<string>, formData: FormData): Promise<ActionState<string>> => {
    const name = formData.get('name')
    return { data: \`Hello, \${name}!\`, error: null, isPending: false }
  },
)`,
  },
  {
    id: "page",
    lang: "tsx",
    // content/docs/guides/server-actions.mdx — "Call it from a page"
    code: `import { useAction } from 'murasaki'
import { greet } from '../actions'

export default function Home() {
  const [state, run, isPending] = useAction(greet, {
    data: null,
    error: null,
    isPending: false,
  })

  return (
    <form action={run}>
      <input name="name" />
      <button disabled={isPending}>Greet</button>
      {state.data && <p>{state.data}</p>}
    </form>
  )
}`,
  },
  {
    id: "route",
    lang: "ts",
    // content/docs/guides/api-routes.mdx
    code: `// GET /api/hello
import type { RouteHandler } from 'murasaki'

export const GET: RouteHandler = async (request) => {
  return Response.json({ message: \`Hello from Node \${process.version}\` })
}

export const POST: RouteHandler = async (request) => {
  const body = await request.json()
  return Response.json({ received: body })
}`,
  },
  {
    id: "config",
    lang: "ts",
    // content/docs/building/configuration.mdx
    code: `import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'app.murasaki.example',
  productName: 'Murasaki App',
  version: '0.1.0',
  icon: 'assets/icon.png',
  window: {
    title: 'Murasaki App',
    width: 1000,
    height: 700,
  },
})`,
  },
];

// The native-window deep-dive section's standalone snippet (components/home/
// native-deepdive.tsx) — pulled verbatim (trimmed only) from content/docs/
// guides/context-menu.mdx's "The whole-window menu" example.
export const contextMenuSample: CodeSample = {
  id: "context-menu",
  lang: "tsx",
  code: `import { useContextMenu, Action } from 'murasaki'

useContextMenu([
  { label: 'Reload', shortcut: 'command,R', action: <Action.Reload /> },
  { separator: true },
  { label: 'Copy', action: <Action.Copy /> },
])`,
};

// The landing page's proof-by-demo snippet (components/home/lp-native-demo
// .tsx) — the real useAppMenu API from content/docs/guides/app-menu.mdx,
// matching the live window mock rendered beside it.
export const appMenuSample: CodeSample = {
  id: "app-menu",
  lang: "tsx",
  code: `import { useAppMenu, Action } from 'murasaki'

useAppMenu([
  { label: 'File', items: [{ role: 'close' }] },
  { role: 'editMenu' },
  {
    label: 'View',
    items: [
      { label: 'Reload', shortcut: 'command,R', action: <Action.Reload /> },
    ],
  },
])`,
};
