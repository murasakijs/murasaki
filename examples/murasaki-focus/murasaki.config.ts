import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'js.murasaki.examples.focus',
  productName: 'Murasaki Focus',
  version: '0.47.2',
  description: 'A persistent focus timer built with Murasaki.',
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
  window: { title: 'Murasaki Focus', width: 1160, height: 760, minWidth: 920, minHeight: 640 },
})
