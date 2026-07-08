/**
 * Reads the `window.__MURASAKI__` global the Rust webview injects before any
 * page script runs (see `crates/native/src/webview.rs`). Absent outside the
 * native shell (e.g. a plain browser tab), so every reader here is optional.
 */

export interface MurasakiHost {
  platform: 'win32' | 'darwin' | 'linux'
  titleBarStyle: 'custom' | 'native'
}

export function getHost(): MurasakiHost | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as any).__MURASAKI__
}

export function getPlatform(): MurasakiHost['platform'] | undefined {
  return getHost()?.platform
}

export function getTitleBarStyle(): MurasakiHost['titleBarStyle'] | undefined {
  return getHost()?.titleBarStyle
}
