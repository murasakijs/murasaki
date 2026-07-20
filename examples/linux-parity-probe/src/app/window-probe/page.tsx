import { useEffect } from 'react'
import { appWindow, windows } from 'murasaki/native'

let started = false

/**
 * native-window / multi-window / capability-permissions probe: this is the
 * secondary "probe" window's own route. It confirms its own label, waits to
 * become visible (opened by the primary via windows.open('probe')), then
 * deliberately calls an ungranted native command (window:manage-gated
 * appWindow.isVisible()) and fetches a backend route it has no
 * backendCapabilities grant for — both must be rejected. Results are
 * reported to src/api/probe/window/route.ts, which validates everything
 * server-side before printing the PASS markers.
 */
export default function WindowProbePage() {
  useEffect(() => {
    if (started) return
    started = true
    void (async () => {
      const label = await appWindow.getLabel()
      let after = await windows.list()
      for (let attempt = 0; attempt < 100; attempt++) {
        if (after.find((window) => window.label === 'probe')?.visible) break
        await new Promise((resolve) => setTimeout(resolve, 50))
        after = await windows.list()
      }
      const labels = after.map((window) => window.label).sort()
      const probe = after.find((window) => window.label === 'probe')

      let capabilityDenied = false
      try {
        await appWindow.isVisible()
      } catch {
        capabilityDenied = true
      }

      let backendDenied = false
      try {
        const response = await fetch('/api/probe/hello')
        backendDenied = response.status === 403
      } catch {
        backendDenied = false
      }

      await fetch('/api/probe/window', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          stage: 'secondary',
          label,
          labels,
          visible: probe?.visible === true,
          capabilityDenied,
          backendDenied,
        }),
      })
    })().catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      console.error('linux-parity-probe: secondary window self-test failed', message)
      void fetch('/api/probe/window', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stage: 'error', message }),
      })
    })
  }, [])

  return <div data-probe="WINDOW_PROBE_RENDERED" />
}
