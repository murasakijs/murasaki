import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'js.murasaki.examples.violetnotes',
  productName: 'Violet Notes',
  version: '0.47.2',
  description: 'A local-first notes app built with Murasaki.',
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
  window: { title: 'Violet Notes', width: 1280, height: 820, minWidth: 920, minHeight: 640 },
})
