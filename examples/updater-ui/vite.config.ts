import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { murasaki } from 'murasaki/vite-plugin'
import config from './murasaki.config'

export default defineConfig({
  plugins: murasaki({ config, srcDir: resolve(__dirname, 'src') }),
})
