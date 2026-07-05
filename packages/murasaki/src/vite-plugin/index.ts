import type { Plugin, PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import type { MurasakiConfig } from '../config.js'
import { fileRouterPlugin } from './routing.js'
import { serverActionsPlugin } from './server-actions.js'
import { appShellPlugin } from './shell.js'

export interface MurasakiPluginOptions {
  config: MurasakiConfig
  /** Absolute path of the user project's src dir. */
  srcDir: string
}

export function murasaki(opts: MurasakiPluginOptions): PluginOption[] {
  return [
    react(),
    fileRouterPlugin({ srcDir: opts.srcDir }),
    serverActionsPlugin({ srcDir: opts.srcDir }),
    appShellPlugin(),
    {
      name: 'murasaki:core',
      config() {
        // NB: the dev-server port is NOT set here. `murasaki dev` resolves a
        // free port in the parent (cli/dev.ts) and passes it to Vite as inline
        // config via assets/dev-server.mjs. A `server.port` returned from this
        // config() hook would OVERRIDE that inline value (Vite merges plugin
        // config() over inline), pinning every run back to the default and
        // defeating the auto-free-port probe. dev-server.mjs owns the port.
        return {
          define: {
            __MURASAKI_APP_ID__: JSON.stringify(opts.config.appId),
            __MURASAKI_PRODUCT_NAME__: JSON.stringify(opts.config.productName),
            __MURASAKI_VERSION__: JSON.stringify(opts.config.version ?? '0.0.0'),
          },
          resolve: {
            alias: {
              '@': opts.srcDir,
            },
          },
        }
      },
    },
  ]
}
