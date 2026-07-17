import {
  capabilityPermissionNames,
  resolveWindowDeclarations,
  serializeCapabilityPolicy,
  type MurasakiConfig,
} from '../config.js'

/** Window declaration shape shared by development and packaged native hosts. */
export interface SerializedWindowTemplate {
  label: string
  primary: boolean
  route: string
  visible: boolean
  createOnLaunch: boolean
  title?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  maxWidth?: number
  maxHeight?: number
  resizable?: boolean
  transparent?: boolean
  decorations?: boolean
  titleBarStyle?: 'default' | 'hidden'
  fullscreen?: boolean
  vibrancy?: 'hud' | 'sidebar' | 'popover' | null
  capabilities: string[]
  capabilityPolicy: string
}

/** Resolve every declared template, including windows created on demand. */
export function serializeWindowTemplates(
  config: Pick<MurasakiConfig, 'window' | 'windows' | 'capabilities' | 'updater'>,
): SerializedWindowTemplate[] {
  return resolveWindowDeclarations(config).map((declaration) => ({
    label: declaration.label,
    primary: declaration.primary,
    route: declaration.route,
    visible: declaration.visible,
    createOnLaunch: declaration.createOnLaunch,
    title: declaration.title,
    width: declaration.width,
    height: declaration.height,
    minWidth: declaration.minWidth,
    minHeight: declaration.minHeight,
    maxWidth: declaration.maxWidth,
    maxHeight: declaration.maxHeight,
    resizable: declaration.resizable,
    transparent: declaration.transparent,
    decorations: declaration.decorations,
    titleBarStyle: declaration.titleBarStyle,
    fullscreen: declaration.fullscreen,
    vibrancy: declaration.vibrancy,
    capabilities: capabilityPermissionNames(declaration.capabilities),
    capabilityPolicy: serializeCapabilityPolicy(declaration.capabilities),
  }))
}
