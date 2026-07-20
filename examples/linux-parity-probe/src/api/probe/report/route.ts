import type { RouteHandler } from 'murasaki'

const FEATURE_ID_RE = /^[a-z][a-z-]{1,63}$/
const reported = new Set<string>()

/**
 * Generic self-test result sink for the client-validated stages in
 * src/lib/probeOrchestrator.ts. Prints exactly one `PROBE:<feature>:PASS`
 * stdout line per feature (the exact marker
 * .github/scripts/linux-feature-probe.sh greps for) and, on failure, a
 * `PROBE:<feature>:FAIL <detail>` line for diagnostics.
 */
export const POST: RouteHandler = async (request) => {
  const body = (await request.json()) as { feature?: unknown; ok?: unknown; detail?: unknown }
  const feature = typeof body.feature === 'string' ? body.feature : ''
  if (!FEATURE_ID_RE.test(feature)) {
    return Response.json({ ok: false, error: 'invalid feature id' }, { status: 400 })
  }

  if (body.ok === true) {
    if (!reported.has(feature)) {
      reported.add(feature)
      console.log(`PROBE:${feature}:PASS`)
    }
    if (typeof body.detail === 'string' && body.detail.length > 0) {
      console.log(`PROBE:${feature}:note ${body.detail.slice(0, 2000)}`)
    }
  } else {
    const detail = typeof body.detail === 'string' ? body.detail.slice(0, 2000) : 'no detail'
    console.error(`PROBE:${feature}:FAIL ${detail}`)
  }

  return Response.json({ received: true })
}
