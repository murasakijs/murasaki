/**
 * `subscribeDownloads()` — wraps both `murasaki:downloadstarted` and
 * `murasaki:downloadcompleted` `CustomEvent`s (dispatched from
 * `crates/native/src/webview.rs`'s download handlers) behind one typed
 * callback. Requires the `webview:download` capability; without it, no
 * download handler is installed natively and neither event ever fires.
 *
 * There is no reliable id correlating a `started` event with the
 * `completed` event that follows it — wry's download-completed handler only
 * reports url/path/success (see `capabilities.json`'s `webview-session-network`
 * limitations) — so concurrent same-URL downloads may be ambiguous to tell
 * apart from `completed` alone.
 */

/** A `murasaki:downloadstarted`/`murasaki:downloadcompleted` event, unified
 * behind one discriminated union for {@link subscribeDownloads}. */
export type DownloadEvent =
  | { type: 'started'; id: string; url: string; path: string }
  | { type: 'completed'; url: string; path: string | null; success: boolean }

/** Subscribes to native download lifecycle events. Requires `webview:download`;
 * a silent no-op (returns an inert unsubscribe) outside the native renderer. */
export function subscribeDownloads(handler: (event: DownloadEvent) => void): () => void {
  if (typeof window === 'undefined') return () => {}

  const onStarted = (event: Event) => {
    const detail = (event as CustomEvent<{ id: string; url: string; path: string }>).detail
    handler({ type: 'started', ...detail })
  }
  const onCompleted = (event: Event) => {
    const detail = (event as CustomEvent<{ url: string; path: string | null; success: boolean }>).detail
    handler({ type: 'completed', ...detail })
  }

  window.addEventListener('murasaki:downloadstarted', onStarted)
  window.addEventListener('murasaki:downloadcompleted', onCompleted)
  return () => {
    window.removeEventListener('murasaki:downloadstarted', onStarted)
    window.removeEventListener('murasaki:downloadcompleted', onCompleted)
  }
}
