import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'app.murasaki.example',
  productName: 'Murasaki App',
  version: '0.1.0',
  icon: 'assets/icon.png',
  window: {
    title: 'Murasaki App',
    width: 1000,
    height: 700,
    // vibrancy: 'hud', // translucent window blur — only shows through a
    // transparent background. With an opaque UI (the default) it's invisible
    // yet still costs GPU every frame and can make the window feel laggy, so
    // it's left off. Turn it on only if you give the app a see-through look.
  },
})
