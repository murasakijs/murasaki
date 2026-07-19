import { resolve } from 'node:path'
import { murasaki } from 'murasaki/vite-plugin'
import config from './murasaki.config'

export default {
  plugins: murasaki({ config, srcDir: resolve(import.meta.dirname, 'src') }),
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'ui-vendor': ['@murasakijs/ui', 'lucide-react'],
          'murasaki-runtime': ['murasaki'],
        },
      },
    },
  },
}
