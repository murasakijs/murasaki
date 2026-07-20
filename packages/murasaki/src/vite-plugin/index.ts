import type { Plugin, PluginOption } from 'vite'
import { dirname } from 'node:path'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { validateConfig, type MurasakiConfig } from '../config.js'
import { apiRoutesPlugin } from './api-routes.js'
import { fileRouterPlugin } from './routing.js'
import { serverActionsPlugin } from './server-actions.js'
import { appShellPlugin } from './shell.js'
import { updaterPlugin } from './updater.js'
import { mainProcessPlugin } from './main-process.js'
import { runtimeSecurityPlugin } from './runtime-security.js'
import { mainModulesPlugin } from './main-modules.js'
import { mainEventsPlugin } from './main-events.js'
import { preparePlugins } from '../plugin-runtime.js'
import { DEFAULT_RENDERER_ENV_PREFIX, loadProjectEnv } from '../cli/load-env.js'
import { serializeWindowTemplates } from '../cli/window-metadata.js'

export interface MurasakiPluginOptions {
  config: MurasakiConfig
  /** Absolute path of the user project's src dir. */
  srcDir: string
}

export function murasaki(opts: MurasakiPluginOptions): PluginOption[] {
  // This is a public JavaScript API as well as an internal CLI boundary. Do
  // not rely on TypeScript or the CLI config loader having validated callers.
  validateConfig(opts.config)
  const prepared = preparePlugins(opts.config)
  const config = prepared.config
  const windows = serializeWindowTemplates(config)
  return [
    {
      name: 'murasaki:environment',
      enforce: 'pre',
      config(_inlineConfig, environment) {
        // Covers direct Vite usage as well as the official CLI. The CLI loads
        // earlier so murasaki.config.ts can read process.env; this hook makes
        // Node-side Vite modules consistent when consumers compose the plugin.
        loadProjectEnv(dirname(opts.srcDir), environment.mode)
      },
    },
    react(),
    // Import SVGs as React components via `import Icon from './x.svg?react'`,
    // so an icon inherits `currentColor` (theme-aware) — plain `.svg` imports
    // still resolve to a URL.
    svgr(),
    fileRouterPlugin({ srcDir: opts.srcDir }),
    runtimeSecurityPlugin(windows, { csp: config.security?.csp }),
    mainEventsPlugin(),
    mainModulesPlugin({ srcDir: opts.srcDir }),
    serverActionsPlugin({ srcDir: opts.srcDir }),
    apiRoutesPlugin({ srcDir: opts.srcDir }),
    mainProcessPlugin({ config }),
    updaterPlugin({ config }),
    appShellPlugin({ csp: config.security?.csp }),
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
          envPrefix: config.build?.envPrefix ?? [...DEFAULT_RENDERER_ENV_PREFIX],
          define: {
            __MURASAKI_APP_ID__: JSON.stringify(config.appId),
            __MURASAKI_PRODUCT_NAME__: JSON.stringify(config.productName),
            __MURASAKI_VERSION__: JSON.stringify(config.version ?? '0.0.0'),
          },
          resolve: {
            // Workspace links and `pnpm link` can otherwise make Vite follow
            // a component package to a second React installation. Hooks from
            // that copy cannot be rendered by the application's ReactDOM and
            // fail at runtime with an invalid/null dispatcher. Always resolve
            // React through the application root, including for linked local
            // packages and monorepo workspaces.
            dedupe: ['react', 'react-dom'],
            alias: {
              '@': opts.srcDir,
            },
          },
        }
      },
    },
    ...prepared.vite,
  ]
}
