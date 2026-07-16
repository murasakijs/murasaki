import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { MurasakiConfig } from '../config.js'
import { MainRuntime } from '../runtime/main-runtime.js'

interface Options {
  config: MurasakiConfig
  projectRoot: string
}

/** Starts and hot-reloads the first-class `src/main.ts` Node lifecycle in dev. */
export function mainProcessPlugin({ config, projectRoot }: Options): Plugin {
  const entry = config.main === false
    ? null
    : resolve(projectRoot, config.main?.entry ?? 'src/main.ts')

  let closeRuntime: (() => Promise<void>) | undefined
  return {
    name: 'murasaki:main-process',
    apply: 'serve',
    configureServer(server) {
      if (!entry || !existsSync(entry)) return

      let runtime = createRuntime(config, projectRoot)
      let transition = Promise.resolve()
      const start = async () => {
        await runtime.start(() => server.ssrLoadModule(entry))
      }
      const stop = async () => {
        await runtime.shutdown({ reason: 'dev-reload', force: true })
      }
      closeRuntime = async () => {
        await transition
        await stop()
      }

      server.watcher.on('change', (file) => {
        if (resolve(file) !== entry) return
        transition = transition
          .then(stop)
          .then(() => {
            const module = server.moduleGraph.getModuleById(entry)
            if (module) server.moduleGraph.invalidateModule(module)
            runtime = createRuntime(config, projectRoot)
            return start()
          })
          .catch((error) => {
            server.config.logger.error(`murasaki main reload failed: ${String(error)}`)
          })
      })

      server.httpServer?.once('close', () => {
        transition = transition.then(stop).catch(() => {})
      })

      // Post-configure hook: Vite waits for this before accepting requests,
      // so the renderer never races main.ready().
      return async () => {
        await start()
      }
    },
    async closeBundle() {
      await closeRuntime?.()
    },
  }
}

function createRuntime(config: MurasakiConfig, projectRoot: string): MainRuntime {
  return new MainRuntime({
    appId: config.appId,
    productName: config.productName,
    version: config.version,
    projectRoot,
    resourcesPath: projectRoot,
    isPackaged: false,
    shutdownTimeoutMs: config.main === false ? undefined : config.main?.shutdownTimeoutMs,
  })
}
