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
 * The app shell — the full-window frame every route renders into, plus the
 * app-wide right-click menu. It lives here (not in layout.tsx) so the layout
 * stays a one-liner and this file is the obvious home for app-wide chrome.
 *
 * The <ContextMenu> here is the default menu: right-click anywhere a page
 * doesn't override shows it. A page can override it within its own region —
 * see the card-scoped menu in src/app/page.tsx. You write it like shadcn's
 * <ContextMenu>, but murasaki pops the real OS menu (NSMenu / HMENU / GtkMenu).
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="flex min-h-screen w-full items-center justify-center bg-background text-foreground">
          {children}
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
