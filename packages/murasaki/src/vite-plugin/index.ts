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
        return {
          server: { port: opts.config.devPort ?? 5178, strictPort: true },
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
