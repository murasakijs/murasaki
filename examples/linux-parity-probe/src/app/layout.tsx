import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { App, useRouter } from 'murasaki'
import { appWindow } from 'murasaki/native'
import { runProbeOrchestrator } from '@/lib/probeOrchestrator'
import './globals.css'

let started = false

/**
 * Root layout — mounted once per native window and never unmounted across
 * client-side navigation (see react/app-router.tsx), so it is the right
 * place to run the whole sequential renderer self-test exactly once for the
 * PRIMARY window's lifetime. The secondary "probe" window boots the same
 * bundle at its own route and runs this same effect too — it bails out
 * immediately once it learns its own label isn't "main" (see
 * src/app/window-probe/page.tsx for that window's own self-test).
 */
export default function Layout({ children }: { children: ReactNode }) {
  const router = useRouter()

  useEffect(() => {
    if (started) return
    started = true
    void (async () => {
      const label = await appWindow.getLabel().catch(() => 'main')
      if (label !== 'main') return
      await runProbeOrchestrator(router)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <App>{children}</App>
}
