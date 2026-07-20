import type { RouteHandler } from 'murasaki'

/**
 * diagnostics-and-logging probe: deliberately throws asynchronously, outside
 * the request/response chain (`setImmediate`, after this handler has already
 * returned), so it reaches Node's `uncaughtException` handler exactly like a
 * real bug would — see main-runtime.ts's crash-report writer.
 *
 * Invoked directly by .github/scripts/linux-feature-probe.sh (authenticated
 * curl) as its own LAST, independent step — deliberately NOT chained after
 * the renderer's own multi-window check. On Linux that check can itself
 * crash the whole packaged process (see src/api/probe/window/route.ts's
 * comment); if this trigger were sequenced after it in the same run, that
 * earlier crash would silently prevent diagnostics-and-logging from ever
 * being exercised. The script instead launches a fresh, dedicated instance
 * for this specific check, keeping its evidence independent of whether
 * multi-window currently works.
 */
export const POST: RouteHandler = async () => {
  setImmediate(() => {
    throw new Error(
      'linux-parity-probe: intentional Node Main crash for diagnostics-and-logging verification',
    )
  })
  return Response.json({ scheduled: true }, { status: 202 })
}
