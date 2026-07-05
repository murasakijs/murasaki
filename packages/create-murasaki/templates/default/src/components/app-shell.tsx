import type { ReactNode } from 'react'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, Action } from 'murasaki'

/**
 * The app shell — the full-window frame every route renders into, plus the
 * app-wide right-click menu.
 *
 * A bare <ContextMenu> (no `for`) is the whole-window default: right-click
 * anywhere a page doesn't override shows it. Note {children} is a plain child of
 * the frame — it is NOT wrapped by the menu. You write the menu like this and
 * murasaki pops the real OS menu (NSMenu / HMENU / GtkMenu), not an HTML popup.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <ContextMenu>
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
      </ContextMenu>

      <div className="flex min-h-screen w-full items-center justify-center bg-background text-foreground">
        {children}
      </div>
    </>
  )
}
