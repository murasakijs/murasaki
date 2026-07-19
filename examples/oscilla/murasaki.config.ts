import type { MurasakiConfig } from 'murasaki'

const config = {
  appId: 'dev.murasaki.oscilla',
  productName: 'Oscilla',
  version: '0.1.0',
  description: 'Signal-driven API development workbench',
  icon: 'src/assets/oscilla-icon.png',
  locales: ['en', 'ja'],
  targets: ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'],
  main: { shutdownTimeoutMs: 8_000 },
  backendCapabilities: [
    'main:src/backend/workbench.ts#getRuntimeSnapshot',
    'main:src/backend/workbench.ts#executeRequest',
    'main:src/backend/workbench.ts#runScenario',
    'main:src/backend/workbench.ts#configureMock',
    'main:src/backend/workbench.ts#importDocument',
    'main:src/backend/workbench.ts#saveWorkspace',
    'main:src/backend/workbench.ts#getDockerContainers',
    'main:src/backend/workbench.ts#followDockerContainer',
    'main:src/backend/workbench.ts#stopDockerLogs',
    'main:src/backend/workbench.ts#importLocalLog',
    'main:src/backend/workbench.ts#stopLocalLog',
    'main:src/backend/workbench.ts#resetWorkspace',
    'events:oscilla.runtime',
    'events:oscilla.timeline',
  ],
  window: {
    title: 'Oscilla — API Workbench',
    width: 1440,
    height: 960,
    minWidth: 1040,
    minHeight: 720,
    capabilities: ['secureStorage:get', 'secureStorage:set', 'secureStorage:delete'],
  },
} satisfies MurasakiConfig

export default config
