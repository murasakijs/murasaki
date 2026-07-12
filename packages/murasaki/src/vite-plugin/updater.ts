import type { Plugin, ViteDevServer } from 'vite'
import type { MurasakiConfig } from '../config.js'
import { resolveUpdater } from '../resolve-updater.js'
import { createUpdateRequestHandler, createUpdaterEngine } from '../runtime/updater.js'

interface Options {
  config: MurasakiConfig
}

/**
 * Dev-time counterpart of the updater's HTTP contract
 * (`runtime/updater.ts`'s `createUpdateRequestHandler`, contract §6) — mounts
 * `/__murasaki/update/*` the same way `server-actions.ts`/`api-routes.ts`
 * mount theirs. `check` works in dev (so a manifest/key pair can be
 * validated without a full `murasaki bundle`); `download`/`install` fail
 * fast with the contract's fixed error string — there's no bundled app or
 * launcher binary to apply an update to yet.
 *
 * `resolveUpdater()` runs once at dev-server start (not per request), same
 * timing as `cli/bundle.ts`'s `metaJson()` — a broken `updater` config (e.g.
 * `repo` + `endpoint` both set) fails the same way in both: here it fails
 * `murasaki dev` startup, there it fails `murasaki bundle`. Never a silent
 * runtime no-op.
 */
export function updaterPlugin({ config }: Options): Plugin {
  return {
    name: 'murasaki:updater',
    configureServer(server: ViteDevServer) {
      const resolvedUpdater = resolveUpdater(config.updater, { projectRoot: server.config.root })
      const engine = createUpdaterEngine({
        resolvedUpdater,
        currentVersion: config.version ?? '0.0.0',
        mode: 'dev',
      })
      const handleUpdateRequest = createUpdateRequestHandler(engine)
      server.middlewares.use(async (req, res, next) => {
        const handled = await handleUpdateRequest(req, res)
        if (!handled) next()
      })
      // Stop the checkInterval timer (if any) when the dev server shuts
      // down — including a Vite-triggered restart (e.g. a config file
      // edit), which closes and re-creates the server, and thus this
      // plugin's engine, without exiting the process. Without this, each
      // restart would leak another interval on top of the previous one.
      server.httpServer?.once('close', () => engine.dispose())
    },
  }
}
