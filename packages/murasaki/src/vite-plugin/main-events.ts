import type { Plugin } from 'vite'
import { stringifyWire } from '../runtime/wire.js'
import { subscribeMainEvents } from '../main/index.js'

const EVENTS_PATH = '/__murasaki/main/events'

/** Development SSE transport for Node Main -> renderer application events. */
export function mainEventsPlugin(): Plugin {
  return {
    name: 'murasaki:main-events',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://murasaki.local')
        if (url.pathname !== EVENTS_PATH) return next()
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }
        const channel = url.searchParams.get('channel') ?? ''
        if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(channel)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'invalid main event channel' }))
          return
        }
        res.statusCode = 200
        res.setHeader('content-type', 'text/event-stream')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('connection', 'keep-alive')
        res.write(': connected\n\n')
        let writes = Promise.resolve()
        const unsubscribe = subscribeMainEvents((event) => {
          if (event.channel !== channel) return
          writes = writes.then(async () => {
            if (!res.destroyed) {
              const payload = await stringifyWire(event.value)
              res.write(`data: ${JSON.stringify({ payload })}\n\n`)
            }
          }).catch(() => {})
        })
        const heartbeat = setInterval(() => {
          if (!res.destroyed) res.write(': heartbeat\n\n')
        }, 15_000)
        heartbeat.unref?.()
        req.on('close', () => {
          clearInterval(heartbeat)
          unsubscribe()
        })
      })
    },
  }
}
