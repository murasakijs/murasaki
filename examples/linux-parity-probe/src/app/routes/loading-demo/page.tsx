import { useEffect, useState } from 'react'

/**
 * file-routing probe: renders the sibling loading.tsx's fallback first, then
 * swaps to LOADING_OK after a short delay via a normal state update — this
 * route's sibling loading.tsx is also wired (see the router's own Suspense
 * boundary, ancestorChain in react/app-router.tsx), even though this page's
 * own content isn't gated on it directly.
 */
export default function LoadingDemoPage() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 250)
    return () => clearTimeout(timer)
  }, [])

  if (!ready) return <div data-probe-loading="LOADING_FALLBACK_SHOWN">loading…</div>
  return <div data-probe="LOADING_OK" />
}
