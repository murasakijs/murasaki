/**
 * murasaki — desktop apps with Next.js DX.
 *
 * The public surface. Import from `"murasaki"` in user code.
 */

export { defineConfig, resolveWindowDeclarations } from './config.js'
export type {
  MurasakiConfig,
  FileAssociationConfig,
  MacOSCapturePermissionConfig,
  MacOSPromptPermissionConfig,
  MacOSSystemPermissionsConfig,
  NativeCapability,
  ProtocolConfig,
  ResolvedWindowConfig,
  SecondaryWindowConfig,
  SystemPermissionsConfig,
  UpdaterConfig,
  WindowsSigningConfig,
  WindowConfig,
} from './config.js'

export { defineAction, callAction, useAction } from './react/actions.js'
export type { ActionState, ActionResult } from './react/actions.js'

export type { RouteHandler } from './vite-plugin/api-routes.js'

export { Link, useRouter, usePathname, useParams } from './react/router.js'
export type { LinkProps } from './react/router.js'

export { AppRouter } from './react/app-router.js'
export type { RouteEntry } from './react/app-router.js'

export type { Middleware, MiddlewareContext, MiddlewareResult } from './react/middleware.js'

export { applyMetadata } from './react/metadata.js'
export type { GenerateMetadata, GenerateMetadataContext, Metadata } from './react/metadata.js'

export {
  ThemeProvider,
  useTheme,
  T,
} from './react/theme.js'

export {
  installClientRpc,
  useGlobalContextMenu,
  quit,
} from './react/rpc.js'

export { App } from './react/app.js'
export type { AppProps } from './react/app.js'

export {
  useContextMenu,
  ContextMenuTrigger,
  Action,
  createActions,
} from './react/context-menu.js'
export type {
  ContextMenuTriggerProps,
  ContextMenuItemSpec,
  ContextMenuEntry,
  ContextMenuRole,
  ContextMenuAction,
  ActionNavigateProps,
  ActionRunProps,
} from './react/context-menu.js'

export { useAppMenu } from './react/app-menu.js'
export type {
  AppMenu,
  AppMenuRole,
  AppMenuItemSpec,
  AppMenuEntry,
  AppMenuItemRole,
  AppMenuAction,
} from './react/app-menu.js'

export { useUpdate } from './react/updater.js'
export type { UpdateState } from './react/updater.js'

export { UpdateButton } from './react/update-button.js'
export type { UpdateButtonProps } from './react/update-button.js'
