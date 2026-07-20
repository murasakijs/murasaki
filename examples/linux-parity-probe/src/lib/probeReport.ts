/**
 * Shared helpers for the renderer-side self-test stages in
 * src/app/layout.tsx. Every stage validates itself client-side, then POSTs
 * its verdict here — the server-side route (src/api/probe/report/route.ts)
 * prints the `PROBE:<feature>:PASS` stdout marker that
 * .github/scripts/linux-feature-probe.sh greps for.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Polls `document.querySelector('[data-probe]')` until it matches `expected`, contains "FAIL", or times out. */
export async function waitForProbe(expected: string, timeoutMs = 5000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  let last: string | null = null
  while (Date.now() < deadline) {
    const value = document.querySelector('[data-probe]')?.getAttribute('data-probe') ?? null
    last = value
    if (value === expected || (value && value.includes('FAIL'))) return value
    await sleep(50)
  }
  return last
}

export async function report(feature: string, ok: boolean, detail?: string): Promise<void> {
  try {
    await fetch('/api/probe/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feature, ok, detail }),
    })
  } catch {
    // best-effort — the smoke script's marker wait will time out and report
    // the missing feature clearly either way.
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
