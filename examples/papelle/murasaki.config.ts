import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'app.papelle.desktop',
  productName: 'Papelle',
  version: '0.1.0',
  description: 'A local-first knowledge workspace built with Murasaki.',
  copyright: '© 2026 Papelle contributors',
  homepage: 'https://murasaki.ichi10.com',
  authors: ['Murasaki examples'],
  icon: 'src/assets/icon.png',
  locales: ['en', 'ja'],
  systemPermissions: {
    macOS: {
      localNetwork: { usageDescription: 'Papelle connects to a self-hosted workspace on your local network.' },
    },
  },
  main: { entry: 'src/main.ts', shutdownTimeoutMs: 12_000 },
  fileAssociations: [
    { extensions: ['md', 'markdown'], name: 'Markdown document', role: 'editor', mimeType: 'text/markdown' },
  ],
  protocols: [{ scheme: 'papelle', name: 'Papelle link' }],
  capabilities: [
    'menu:application',
    'menu:context',
    'clipboard:readText',
    'clipboard:writeText',
    'window:minimize',
    'window:toggleMaximize',
  ],
  backendCapabilities: [
    'main:src/backend/workspace.ts#loadWorkspace',
    'main:src/backend/workspace.ts#saveWorkspace',
    'main:src/backend/workspace.ts#resetWorkspace',
    'main:src/backend/workspace.ts#loadQuarantinedWorkspace',
  ],
  security: {
    // The hash is Vite React Refresh's fixed development preamble. Production
    // ships no matching inline script, so arbitrary inline execution stays off.
    csp: "default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; script-src 'self' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self' ws://127.0.0.1:* ws://localhost:* wss: https:; worker-src 'self' blob:; manifest-src 'self'; form-action 'self'",
  },
  window: {
    title: 'Papelle',
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
  },
})
