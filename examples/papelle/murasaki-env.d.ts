/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly MURASAKI_PUBLIC_SYNC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
