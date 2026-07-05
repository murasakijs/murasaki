import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'app.murasaki.example',
  productName: 'Murasaki App',
  version: '0.1.0',
  description: 'A desktop app built with murasaki',
  copyright: '© 2026 Murasaki App',
  icon: 'src/assets/icon.png',
  window: {
    title: 'Murasaki App',
    width: 1000,
    height: 700,
  },
})
