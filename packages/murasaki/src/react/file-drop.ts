/**
 * `subscribeFileDrops()` / `useFileDrop()` — wraps the four drag-and-drop
 * `CustomEvent`s (`murasaki:dragenter`/`dragover`/`dragdrop`/`dragleave`)
 * dispatched from `crates/native/src/webview.rs`'s drag-drop handler behind
 * one typed callback. Requires the `webview:dragDrop` capability; without
 * it, no handler is installed natively and these events never fire.
 *
 * The native handler always lets the OS default proceed (it never blocks),
 * so `<input type="file">` drag-and-drop keeps working alongside this API.
 */
import { useEffect } from 'react'

/** A drag-and-drop event, unified behind one discriminated union for
 * {@link subscribeFileDrops}. */
export type FileDropEvent =
  | { type: 'enter'; paths: string[]; x: number; y: number }
  | { type: 'over'; x: number; y: number }
  | { type: 'drop'; paths: string[]; x: number; y: number }
  | { type: 'leave' }

/** Subscribes to native file drag-and-drop events. Requires `webview:dragDrop`;
 * a silent no-op (returns an inert unsubscribe) outside the native renderer. */
export function subscribeFileDrops(handler: (event: FileDropEvent) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const onEnter = (event: Event) => {
    const detail = (event as CustomEvent<{ paths: string[]; x: number; y: number }>).detail
    handler({ type: 'enter', ...detail })
  }
  const onOver = (event: Event) => {
    const detail = (event as CustomEvent<{ x: number; y: number }>).detail
    handler({ type: 'over', ...detail })
  }
  const onDrop = (event: Event) => {
    const detail = (event as CustomEvent<{ paths: string[]; x: number; y: number }>).detail
    handler({ type: 'drop', ...detail })
  }
  const onLeave = () => handler({ type: 'leave' })

  window.addEventListener('murasaki:dragenter', onEnter)
  window.addEventListener('murasaki:dragover', onOver)
  window.addEventListener('murasaki:dragdrop', onDrop)
  window.addEventListener('murasaki:dragleave', onLeave)
  return () => {
    window.removeEventListener('murasaki:dragenter', onEnter)
    window.removeEventListener('murasaki:dragover', onOver)
    window.removeEventListener('murasaki:dragdrop', onDrop)
    window.removeEventListener('murasaki:dragleave', onLeave)
  }
}

/**
 * Thin hook wrapper around `subscribeFileDrops()`: fires `onDrop` only for
 * the `drop` event (files actually released over the window).
 *
 * ```tsx
 * import { useFileDrop } from 'murasaki'
 *
 * useFileDrop(({ paths }) => importFiles(paths))
 * ```
 */
export function useFileDrop(onDrop: (event: { paths: string[]; x: number; y: number }) => void): void {
  useEffect(() => {
    return subscribeFileDrops((event) => {
      if (event.type === 'drop') onDrop({ paths: event.paths, x: event.x, y: event.y })
    })
  }, [onDrop])
}
