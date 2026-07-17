/**
 * `useWindowDrag()` — pointerdown handler for a custom (frameless) titlebar.
 *
 * With `decorations: false` and/or `titleBarStyle: 'hidden'` (see
 * `WindowConfig`), the OS has no native titlebar left to drag the window by,
 * so the renderer must opt a region back in explicitly:
 *
 * ```tsx
 * import { useWindowDrag } from 'murasaki'
 *
 * function Titlebar() {
 *   const drag = useWindowDrag()
 *   return (
 *     <header {...drag} style={{ WebkitUserSelect: 'none' }}>
 *       My App
 *     </header>
 *   )
 * }
 * ```
 *
 * Skips interactive targets — buttons, inputs, links, selects, textareas, or
 * anything marked `data-murasaki-no-drag` — so titlebar controls (window
 * buttons, search fields, etc.) keep working underneath the draggable region,
 * and only starts a drag on the primary mouse button. A silent no-op outside
 * the native renderer or when the native drag itself cannot start (see
 * `appWindow.startDragging()`'s doc comment in `murasaki/native`) — this
 * never throws.
 */
import type { PointerEvent as ReactPointerEvent } from 'react'
import { appWindow } from '../native/index.js'

const NO_DRAG_SELECTOR = 'button, input, a, select, textarea, [data-murasaki-no-drag]'

export function useWindowDrag(): { onPointerDown: (event: ReactPointerEvent) => void } {
  return {
    onPointerDown(event: ReactPointerEvent) {
      if (event.button !== 0) return
      const target = event.target
      if (target instanceof Element && target.closest(NO_DRAG_SELECTOR)) return
      appWindow.startDragging()
    },
  }
}
