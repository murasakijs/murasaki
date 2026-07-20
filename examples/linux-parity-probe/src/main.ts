import { defineMain, emitMainEvent } from 'murasaki/main'

/**
 * node-main-lifecycle probe: `ready()` runs, logs to the structured JSONL
 * logger (proves diagnostics-and-logging's non-crash path too), and emits a
 * live `probe.heartbeat` main event every 500ms. The renderer subscribes
 * (see src/lib/mainActions.ts / src/app/layout.tsx) and separately calls the
 * 'use main' `ping()` typed function.
 */
let heartbeat: ReturnType<typeof setInterval> | undefined

export default defineMain({
  async ready({ log, paths, signal }) {
    log.info('linux-parity-probe: main ready', { dataDir: paths.data, logsDir: paths.logs })
    let tick = 0
    heartbeat = setInterval(() => {
      tick += 1
      emitMainEvent('probe.heartbeat', { tick, emittedAt: new Date() })
    }, 500)
    signal.addEventListener(
      'abort',
      () => {
        if (heartbeat) clearInterval(heartbeat)
        heartbeat = undefined
      },
      { once: true },
    )
  },
  async shutdown({ log }) {
    log.info('linux-parity-probe: main shutdown')
  },
})
