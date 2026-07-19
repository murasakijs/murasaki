import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'com.murasaki.examples.orglia',
  productName: 'Orglia',
  version: '0.1.0',
  description: 'Self-hosted integrated operations workspace',
  icon: 'src/assets/orglia-icon.png',
  locales: ['ja', 'en'],
  targets: ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'],
  main: { shutdownTimeoutMs: 8_000 },
  backendCapabilities: [
    'api:POST:/api/login',
    'api:POST:/api/logout',
    'api:GET:/api/native-demo',
    'api:GET:/api/session',
    'api:GET:/api/state',
    'api:POST:/api/commands',
  ],
  window: {
    title: 'Orglia — Integrated Operations',
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
  },
})
