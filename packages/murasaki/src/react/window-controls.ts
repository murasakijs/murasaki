/**
 * Window-control helpers — post `{ kind: 'windowControl', action, direction? }`
 * over the built-in IPC channel (see `rpc.ts`'s `post`). The Rust webview
 * handles these directly (no round-trip to Node — see
 * `crates/native/src/webview.rs`'s `handle_window_control`).
 *
 * Safe to call with no native shell present (e.g. previewing the app in a
 * plain browser tab): `post` no-ops when `window.ipc` is absent.
 */
import { post } from './rpc.js'

export type ResizeDirection =
  | 'north'
  | 'south'
  | 'east'
  | 'west'
  | 'northEast'
  | 'northWest'
  | 'southEast'
  | 'southWest'

export function minimizeWindow(): void {
  post({ kind: 'windowControl', action: 'minimize' })
}

export function toggleMaximizeWindow(): void {
  post({ kind: 'windowControl', action: 'maximize' })
}

export function closeWindow(): void {
  post({ kind: 'windowControl', action: 'close' })
}

export function startWindowDrag(): void {
  post({ kind: 'windowControl', action: 'startDrag' })
}

export function startWindowResize(direction: ResizeDirection): void {
  post({ kind: 'windowControl', action: 'startResize', direction })
}
