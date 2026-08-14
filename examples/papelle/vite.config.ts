import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { murasaki } from 'murasaki/vite-plugin'
import config from './murasaki.config'

export default defineConfig({
  plugins: murasaki({ config, srcDir: resolve(__dirname, 'src') }),
  build: {
    rollupOptions: {
      output: {
        // Vite 8's default bundler (Rolldown) dropped the object form of
        // manualChunks — only the function form remains supported.
        manualChunks(id) {
          if (id.includes('node_modules/lucide-react/')) return 'icons'
          if (id.includes('node_modules/murasaki/')) return 'murasaki-runtime'
        },
      },
    },
  },
})
