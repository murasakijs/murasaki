/**
 * file-routing probe: the router's own Suspense fallback for this route
 * (never actually shown by ./page.tsx's current implementation — see its
 * comment — but its presence here still proves the file convention is
 * discovered, bundled, and wired into the route without error).
 */
export default function LoadingFallback() {
  return <div data-probe-loading="LOADING_FALLBACK_SHOWN">loading…</div>
}
