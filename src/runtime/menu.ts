// Native application menu — replaces the old stdin keypress shortcuts.
//
// Setting the menu via app.setMenu() goes through Cocoa/Win32 native UI
// (not stdin), so it doesn't conflict with the close-button pipeline.
//
// Standard macOS bar:
//   Murasaki | File | Edit | View
// Accelerators land on the page automatically (Cmd+R reload etc).

import type { Application } from '@webviewjs/webview'

export type MenuHandlers = {
  onReload: () => void
  onRestart: () => void
  onQuit: () => void
}

export function setupAppMenu(app: Application, handlers: MenuHandlers): void {
  try {
    ;(app as { setMenu?: (config: unknown) => void }).setMenu?.({
      items: [
        {
          // First item is conventionally the app's own menu on macOS.
          label: 'Murasaki',
          submenu: {
            items: [
              { role: 'about' },
              { role: 'separator' },
              { role: 'services' },
              { role: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'showAll' },
              { role: 'separator' },
              { role: 'quit' },
            ],
          },
        },
        {
          // Use "Develop" to avoid mixing dev commands into a standard "View" bar.
          label: 'Develop',
          submenu: {
            items: [
              {
                id: 'murasaki:reload',
                label: 'Reload',
                accelerator: 'CmdOrCtrl+R',
              },
              {
                id: 'murasaki:restart',
                // Cmd+Shift+R is "hard reload" in Safari/Chrome — avoid the clash.
                label: 'Restart Window',
                accelerator: 'CmdOrCtrl+Alt+R',
              },
            ],
          },
        },
        {
          label: 'View',
          submenu: {
            items: [{ role: 'fullscreen' }],
          },
        },
        {
          label: 'Edit',
          submenu: {
            items: [
              { role: 'undo' },
              { role: 'redo' },
              { role: 'separator' },
              { role: 'cut' },
              { role: 'copy' },
              { role: 'paste' },
              { role: 'selectAll' },
            ],
          },
        },
        {
          label: 'Window',
          submenu: {
            items: [{ role: 'minimize' }, { role: 'zoom' }],
          },
        },
      ],
    })
  } catch {
    // Older webview versions may not support setMenu — fail silent.
  }

  try {
    ;(app as { on?: (event: string, fn: (payload: unknown) => void) => void }).on?.(
      'custom-menu-click',
      (payload) => {
        const id = (payload as { customMenuEvent?: { id?: string } })?.customMenuEvent?.id
        if (!id) return
        if (id === 'murasaki:reload') handlers.onReload()
        else if (id === 'murasaki:restart') handlers.onRestart()
      },
    )
  } catch {}

  // Catch Cmd+Q / role: 'quit' that goes through application-close-requested,
  // so a clean quit + handler-side shutdown still happens.
  // (The existing application-close-requested handler in window.ts already
  //  calls handlers.onQuit equivalent path.)
}
