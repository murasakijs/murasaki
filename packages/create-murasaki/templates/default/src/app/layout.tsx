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
        <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground">
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
