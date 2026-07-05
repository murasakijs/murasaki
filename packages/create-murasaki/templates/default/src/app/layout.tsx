import '@murasakijs/ui/styles.css'
import './globals.css'
import type { ReactNode } from 'react'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  Action,
} from 'murasaki'

/**
 * The root layout wraps every page, so the <ContextMenu> here is the app-wide
 * default: right-click anywhere a page doesn't override shows this menu.
 * You write it like shadcn's <ContextMenu>, but murasaki pops the real OS menu.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
          {/*
            Top bar. The X link is a plain <a href> — murasaki opens off-origin
            links in the user's default browser instead of loading them inside
            the app window, so external links "just work" like on the web.
          */}
          <header className="flex items-center justify-between px-6 py-4 text-sm">
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

          <div className="flex flex-1 items-center justify-center">{children}</div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem label="Reload" shortcut="command,R">
          <Action.Reload />
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem label="Copy">
          <Action.Copy />
        </ContextMenuItem>
        <ContextMenuItem label="Paste">
          <Action.Paste />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
