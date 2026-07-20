import { useEffect } from 'react'

/**
 * file-routing probe: the error boundary for ./page.tsx.
 *
 * Calls its own `reset()` shortly after rendering. A caught React error
 * boundary does not clear itself on a later navigation to a different route
 * — without this, every route the probe orchestrator visits after this one
 * would keep showing this same fallback instead of its own content. Real
 * apps that navigate away from a caught error need to account for this too;
 * `reset()` (or a full reload) is the only way to clear it.
 */
export default function ErrorDemoBoundary({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    const timer = setTimeout(reset, 300)
    return () => clearTimeout(timer)
  }, [reset])

  return <div data-probe="ERROR_OK">{error.message}</div>
}
