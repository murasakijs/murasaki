'use client'

/**
 * The built-in "VS Code-style" custom title bar. Wired automatically into
 * every route by `<App>` (see `./app.tsx`) — it self-hides everywhere it
 * doesn't apply, so mounting it unconditionally is safe.
 *
 * Hidden on real macOS: the OS already draws its own native menu bar there.
 * `?titlebar` forces it on in dev regardless of platform/host, so it can be
 * previewed on a Mac (including in a plain browser tab, where
 * `window.__MURASAKI__` is absent entirely).
 *
 * The menu model below uses English labels for this first cut — localizing
 * it through the existing `menu-locales.json` / `menu-i18n.ts` machinery is a
 * deliberate fast-follow, not done here.
 */
import type { CSSProperties } from 'react'
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
  TitleBar,
} from '@murasakijs/ui'
import { getPlatform, getTitleBarStyle } from './platform.js'
import {
  closeWindow,
  minimizeWindow,
  startWindowDrag,
  startWindowResize,
  toggleMaximizeWindow,
  type ResizeDirection,
} from './window-controls.js'

type MenuEntry = { label: string; onSelect: () => void } | { separator: true }

interface MenuModel {
  label: string
  items: MenuEntry[]
}

const MENU_MODEL: MenuModel[] = [
  {
    label: 'File',
    items: [{ label: 'Exit', onSelect: () => closeWindow() }],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', onSelect: () => document.execCommand('undo') },
      { label: 'Redo', onSelect: () => document.execCommand('redo') },
      { separator: true },
      { label: 'Cut', onSelect: () => document.execCommand('cut') },
      { label: 'Copy', onSelect: () => document.execCommand('copy') },
      { label: 'Paste', onSelect: () => document.execCommand('paste') },
      { label: 'Select All', onSelect: () => document.execCommand('selectAll') },
    ],
  },
  {
    label: 'View',
    items: [{ label: 'Reload', onSelect: () => location.reload() }],
  },
  {
    label: 'Window',
    items: [{ label: 'Minimize', onSelect: () => minimizeWindow() }],
  },
]

/** 4px edges + 8px corners, matching tao's `ResizeDirection`. */
const RESIZE_EDGES: Array<{ direction: ResizeDirection; style: CSSProperties }> = [
  { direction: 'north', style: { top: 0, left: 8, right: 8, height: 4, cursor: 'n-resize' } },
  { direction: 'south', style: { bottom: 0, left: 8, right: 8, height: 4, cursor: 's-resize' } },
  { direction: 'west', style: { top: 8, bottom: 8, left: 0, width: 4, cursor: 'w-resize' } },
  { direction: 'east', style: { top: 8, bottom: 8, right: 0, width: 4, cursor: 'e-resize' } },
  { direction: 'northWest', style: { top: 0, left: 0, width: 8, height: 8, cursor: 'nw-resize' } },
  { direction: 'northEast', style: { top: 0, right: 0, width: 8, height: 8, cursor: 'ne-resize' } },
  { direction: 'southWest', style: { bottom: 0, left: 0, width: 8, height: 8, cursor: 'sw-resize' } },
  { direction: 'southEast', style: { bottom: 0, right: 0, width: 8, height: 8, cursor: 'se-resize' } },
]

function ResizeEdges() {
  return (
    <>
      {RESIZE_EDGES.map(({ direction, style }) => (
        <div
          key={direction}
          onMouseDown={() => startWindowResize(direction)}
          style={{ position: 'fixed', zIndex: 2147483647, ...style }}
        />
      ))}
    </>
  )
}

export function WindowChrome() {
  const forcePreview =
    process.env.NODE_ENV !== 'production' &&
    typeof location !== 'undefined' &&
    new URLSearchParams(location.search).has('titlebar')

  const shown = forcePreview || (getTitleBarStyle() === 'custom' && getPlatform() !== 'darwin')
  if (!shown) return null

  return (
    <>
      <TitleBar
        onMinimize={minimizeWindow}
        onToggleMaximize={toggleMaximizeWindow}
        onClose={closeWindow}
        onStartDrag={() => startWindowDrag()}
        platform={getPlatform()}
      >
        <Menubar>
          {MENU_MODEL.map((menu) => (
            <MenubarMenu key={menu.label}>
              <MenubarTrigger>{menu.label}</MenubarTrigger>
              <MenubarContent>
                {menu.items.map((item, i) =>
                  'separator' in item ? (
                    <MenubarSeparator key={`sep-${i}`} />
                  ) : (
                    <MenubarItem key={item.label} onSelect={item.onSelect}>
                      {item.label}
                    </MenubarItem>
                  ),
                )}
              </MenubarContent>
            </MenubarMenu>
          ))}
        </Menubar>
      </TitleBar>
      <ResizeEdges />
    </>
  )
}
