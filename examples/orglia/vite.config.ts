import { resolve } from 'node:path'
import { murasaki } from 'murasaki/vite-plugin'
import config from './murasaki.config'

export default {
  plugins: murasaki({ config, srcDir: resolve(import.meta.dirname, 'src') }),
  build: {
    rollupOptions: {
      output: {
        // Vite 8's default bundler (Rolldown) dropped the object form of
        // manualChunks — only the function form remains supported.
        manualChunks(id: string) {
          if (id.includes('node_modules/@murasakijs/ui/') || id.includes('node_modules/lucide-react/')) return 'ui-vendor'
          if (id.includes('node_modules/murasaki/')) return 'murasaki-runtime'
        },
      },
    },
  },
}
