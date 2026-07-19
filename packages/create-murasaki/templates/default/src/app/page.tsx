import { buttonVariants, Card } from '@murasakijs/ui'
import { ArrowRight, BookOpen } from 'lucide-react'
import type { Metadata } from 'murasaki'
import { Link } from 'murasaki'
import GithubLogo from '@/assets/github-logo.svg?react'
import XLogo from '@/assets/x-logo.svg?react'

export const metadata: Metadata = {
  title: 'Murasaki App',
  description: 'A desktop app built with murasaki',
}

/**
 * "Hello, Murasaki 🦋" — the greeting stays.
 *
 * This is the informational landing page. The interactive demos (counter,
 * native context menus, API routes) live at /demo — see src/app/demo/page.tsx.
 *
 * The resource cards below are plain <a href>: murasaki opens off-origin links
 * in the user's default browser instead of loading them inside the app window.
 */
export default function Page() {
  return (
    <main className="mx-auto max-w-2xl text-center">
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        Hello, Murasaki <span aria-hidden>🦋</span>
      </h1>
      <p className="mt-3 text-muted-foreground">
        The Next.js developer experience — file-based routing, server actions and native menus — in
        a lightweight Rust shell.
      </p>
      <p className="mt-1 text-sm text-muted-foreground/60">
        Edit <code className="rounded bg-muted px-1.5 py-0.5">src/app/page.tsx</code> and save to
        reload.
      </p>

      <div className="mt-10 grid grid-cols-3 gap-4">
        <a href="https://murasaki.ichi10.com" rel="noreferrer" className="group">
          <Card className="flex h-full flex-col items-center gap-2 p-5 text-center transition-colors group-hover:border-murasaki-bright">
            <BookOpen className="h-5 w-5 text-murasaki-bright" />
            <span className="text-sm font-medium text-foreground">Docs</span>
            <span className="text-xs text-muted-foreground">Guides &amp; API reference</span>
          </Card>
        </a>
        <a href="https://github.com/murasakijs/murasaki" rel="noreferrer" className="group">
          <Card className="flex h-full flex-col items-center gap-2 p-5 text-center transition-colors group-hover:border-murasaki-bright">
            <GithubLogo className="h-5 w-5 fill-murasaki-bright" />
            <span className="text-sm font-medium text-foreground">GitHub</span>
            <span className="text-xs text-muted-foreground">Star &amp; contribute</span>
          </Card>
        </a>
        <a href="https://x.com/murasaki_js" rel="noreferrer" className="group">
          <Card className="flex h-full flex-col items-center gap-2 p-5 text-center transition-colors group-hover:border-murasaki-bright">
            <XLogo className="h-5 w-5 fill-murasaki-bright" />
            <span className="text-sm font-medium text-foreground">murasaki_js</span>
            <span className="text-xs text-muted-foreground">Follow along on X</span>
          </Card>
        </a>
      </div>

      <div className="mt-10">
        <Link href="/demo" className={buttonVariants({ size: 'lg' })}>
          Try the interactive demo <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </main>
  )
}
