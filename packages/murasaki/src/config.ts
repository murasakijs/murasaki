export interface WindowConfig {
  title?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  resizable?: boolean
  transparent?: boolean
  vibrancy?: 'hud' | 'sidebar' | 'popover' | null
}

export type UpdaterConfig =
  | {
      provider: 'github'
      repo: string
      channel?: string
      checkOnStart?: boolean
      checkInterval?: string
    }
  | {
      provider: 'custom'
      endpoint: string
      publicKey?: string
      checkOnStart?: boolean
      checkInterval?: string
    }

export interface MurasakiConfig {
  appId: string
  productName: string
  version?: string

  window?: WindowConfig
  updater?: UpdaterConfig

  /** Vite server port during `murasaki dev`. Defaults to 5178. */
  devPort?: number

  /** Build targets. Defaults to the host platform. */
  targets?: Array<
    | 'darwin-arm64'
    | 'darwin-x64'
    | 'win32-x64'
    | 'win32-arm64'
    | 'linux-x64'
    | 'linux-arm64'
  >

  /** Icon source (PNG). `murasaki icon` fans this out to .icns/.ico/set. */
  icon?: string
}

export function defineConfig(config: MurasakiConfig): MurasakiConfig {
  return config
}
