import { resolve } from 'node:path'
import { murasaki } from 'murasaki/vite-plugin'
import config from './murasaki.config'

export default {
  cacheDir: resolve(__dirname, '.murasaki/vite-cache'),
  resolve: {
    // Murasaki's renderer barrel eagerly references its optional UpdateButton UI
    // dependency. Oscilla does not use that component; keep this standalone
    // example runnable without pulling the entire shared UI kit into its bundle.
    alias: { '@murasakijs/ui': resolve(__dirname, 'src/lib/murasaki-ui-bridge.tsx') },
  },
  plugins: murasaki({ config, srcDir: resolve(__dirname, 'src') }),
  optimizeDeps: {
    noDiscovery: true,
    include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
}
