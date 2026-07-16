import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'js.murasaki.examples.localsignal',
  productName: 'Local Signal',
  version: '0.47.2',
  description: 'A developer service monitor built with Murasaki Server Actions and API Routes.',
  copyright: '© 2026 Murasaki',
  homepage: 'https://murasaki.ichi10.com',
  authors: ['ichi'],
  icon: 'src/assets/icon.png',
  locales: ['en'],
  capabilities: [
    'menu:application',
    'menu:context',
    'clipboard:readText',
    'clipboard:writeText',
    'window:minimize',
    'window:toggleMaximize',
  ],
  window: { title: 'Local Signal', width: 1320, height: 820, minWidth: 1000, minHeight: 680 },
})
