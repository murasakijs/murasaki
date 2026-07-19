import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'app.murasaki.example',
  productName: 'Murasaki App',
  version: '0.1.0',
  description: 'A desktop app built with murasaki',
  copyright: '© 2026 Murasaki App',
  icon: 'src/assets/icon.png',
  // Locales the app ships: localizes the native menu bar and shows a language
  // picker in the Windows installer. Trim to `['en']` for English-only.
  locales: ['en', 'ja'],
  capabilities: ['menu:context', 'clipboard:readText', 'clipboard:writeText'],
  // Renderer-to-Node/API authority is separate from native capabilities and
  // deny-all by default. This starter exposes only its documented API demo.
  backendCapabilities: ['api:POST:/api/action-demo'],
  window: {
    title: 'Murasaki App',
    width: 1000,
    height: 700,
  },
})
