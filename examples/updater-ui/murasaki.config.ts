import { defineConfig } from 'murasaki'

export default defineConfig({
  appId: 'app.murasaki.updater-test',
  // No spaces: GitHub replaces spaces in release-asset names with dots, which
  // would break the manifest's asset URL. Keeps <productName>-<version>-setup.exe
  // matching the URL murasaki release --manifest writes.
  productName: 'UpdaterTest',
  version: '0.8.0',
  description: 'Updater UI test app',
  icon: 'src/assets/icon.png',
  // updater: true → repo from package.json#repository (ichi1007/murasaki-update-test),
  // public key from .murasaki/update-key.pub, channel 'stable', checkOnStart.
  updater: true,
  locales: ['en', 'ja'],
  window: {
    title: 'UpdaterTest',
    width: 1000,
    height: 700,
  },
})
