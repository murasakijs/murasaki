import type { RouteHandler } from 'murasaki'
import { windows as mainWindows } from 'murasaki/main'

/**
 * native-window / multi-window probe. Only trusted Node Main (via
 * `murasaki/main`'s `windows` manager) can create/destroy declared windows —
 * this route is the bridge the renderer orchestrator drives:
 *
 *  - POST {stage:'primary'}: asserts the secondary starts dormant, then
 *    create → destroy → re-create it, checking the generation strictly
 *    increases and the recreated window starts hidden.
 *  - POST {stage:'secondary'}: validates the secondary window's own report
 *    (own label, full window list, visible after windows.open(), and both
 *    its native-capability and backend-capability denial checks).
 *  - POST {stage:'debug'}: prints one `PROBE:multi-window:step <name>` line
 *    per lifecycle call below. Deliberately left in (not scaffolding to
 *    strip out): on packaged Linux, `windows.destroy()`/a second
 *    `windows.create()` for the same label reliably crashes the whole
 *    process with a fatal X11 BadWindow error before this route can respond
 *    — see this task's final report. These step markers are what pinpoint
 *    exactly which call the process died on when that happens; the last one
 *    seen in launcher stdout IS the diagnosis.
 *  - GET: lets the primary poll for the secondary stage's completion before
 *    triggering the (destructive) diagnostics-and-logging crash stage.
 */
let primaryReady = false
let secondaryOk = false

export const GET: RouteHandler = async () => Response.json({ secondaryOk })

export const POST: RouteHandler = async (request) => {
  const body = (await request.json()) as Record<string, unknown>

  if (body.stage === 'debug') {
    console.log(`PROBE:multi-window:step ${String(body.step)}`)
    return Response.json({ ok: true })
  }

  if (body.stage === 'error') {
    console.error(`PROBE:multi-window:FAIL secondary window reported an error: ${String(body.message)}`)
    return Response.json({ ok: false }, { status: 500 })
  }

  if (body.stage === 'primary') {
    const dormant = await mainWindows.list()
    if (dormant.map((window) => window.label).join(',') !== 'main') {
      console.error('PROBE:multi-window:FAIL secondary window was already live before the probe requested it')
      return Response.json({ ok: false }, { status: 400 })
    }

    console.log('PROBE:multi-window:step before-create-1')
    const first = await mainWindows.create('probe')
    console.log('PROBE:multi-window:step after-create-1')
    await mainWindows.destroy('probe')
    console.log('PROBE:multi-window:step after-destroy-1')
    const second = await mainWindows.create('probe')
    console.log('PROBE:multi-window:step after-create-2')
    const valid = first.label === 'probe'
      && second.label === 'probe'
      && second.generation > first.generation
      && second.visible === false
    if (!valid) {
      console.error('PROBE:multi-window:FAIL create/destroy/recreate generation check failed')
      return Response.json({ ok: false }, { status: 400 })
    }

    primaryReady = true
    return Response.json({ ok: true, generation: second.generation }, { status: 202 })
  }

  if (body.stage === 'secondary') {
    const valid = primaryReady
      && body.label === 'probe'
      && JSON.stringify(body.labels) === JSON.stringify(['main', 'probe'])
      && body.visible === true
      && body.capabilityDenied === true
      && body.backendDenied === true
    if (!valid) {
      console.error(`PROBE:multi-window:FAIL secondary validation failed: ${JSON.stringify(body)}`)
      return Response.json({ ok: false }, { status: 400 })
    }

    secondaryOk = true
    console.log('PROBE:native-window:PASS')
    console.log('PROBE:multi-window:PASS')
    return Response.json({ ok: true })
  }

  return Response.json({ ok: false, error: 'unknown stage' }, { status: 400 })
}
