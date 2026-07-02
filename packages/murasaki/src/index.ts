/**
 * murasaki — desktop apps with Next.js DX.
 *
 * The public surface. Import from `"murasaki"` in user code.
 */

export { defineConfig } from './config.js'
export type {
  MurasakiConfig,
  UpdaterConfig,
  WindowConfig,
} from './config.js'

export { defineAction, callAction, useAction } from './react/actions.js'
export type { ActionState, ActionResult } from './react/actions.js'

export { Link, useRouter, usePathname } from './react/router.js'
export type { LinkProps } from './react/router.js'

export type { Metadata } from './react/metadata.js'

export {
  ThemeProvider,
  useTheme,
  T,
} from './react/theme.js'

export {
  installClientRpc,
  useGlobalContextMenu,
} from './react/rpc.js'

export {
  UpdateButton,
  useUpdate,
} from './react/updater.js'
