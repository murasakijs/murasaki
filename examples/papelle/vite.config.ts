import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { murasaki } from 'murasaki/vite-plugin'
import config from './murasaki.config'

export default defineConfig({
  plugins: murasaki({ config, srcDir: resolve(__dirname, 'src') }),
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          icons: ['lucide-react'],
          'murasaki-runtime': ['murasaki'],
        },
      },
    },
  },
})
