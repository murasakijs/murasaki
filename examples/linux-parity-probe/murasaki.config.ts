import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { defineConfig, defineMurasakiPlugin } from 'murasaki'

/**
 * Proves build-time-plugin-sdk (see docs/core-concepts/platform-feature-status):
 * a trivial plugin with a `before` bundle hook that writes a sentinel file,
 * declared as a `bundle.resources` entry so `murasaki bundle` copies it into
 * the packaged resources directory. A successful Linux bundle containing this
 * file at `usr/lib/<appId>/resources/plugin-sentinel.txt` IS the proof — see
 * `.github/scripts/linux-feature-probe.sh`.
 */
const sentinelPlugin = defineMurasakiPlugin({
  name: 'linux-parity-probe.sentinel',
  bundle: {
    resources: [{ from: 'generated/plugin-sentinel.txt', to: 'plugin-sentinel.txt' }],
  },
  hooks: {
    async before({ command, projectRoot }) {
      if (command !== 'bundle') return
      const dir = resolve(projectRoot, 'generated')
      if (!existsSync(dir)) await mkdir(dir, { recursive: true })
      await writeFile(
        resolve(dir, 'plugin-sentinel.txt'),
        `PROBE:build-time-plugin-sdk:PASS\ngeneratedAt=${new Date().toISOString()}\n`,
      )
    },
  },
})

export default defineConfig({
  appId: 'app.murasaki.linux.parity.probe',
  productName: 'Murasaki Linux Parity Probe',
  version: '1.0.0',
  description: 'Packaged-Linux E2E probe verifying platform-agnostic Murasaki capabilities.',
  icon: 'src/assets/icon.png',
  locales: ['en'],
  plugins: [sentinelPlugin],
  webview: {
    // webview-session-network: a renderer self-test asserts navigator.userAgent
    // matches this exact value in the packaged AppImage.
    userAgent: 'MurasakiLinuxParityProbe/1.0 (+linux-parity-probe)',
  },
  window: {
    title: 'Murasaki Linux Parity Probe',
    width: 1000,
    height: 700,
    capabilities: [
      'window:getLabel',
      'window:list',
      'window:open',
      'webview:readCookies',
      'webview:writeCookies',
    ],
    // Deliberately excludes window:manage — capability-permissions probes that
    // denial from the primary renderer. Backend grants are scoped to this
    // probe's own routes/main-modules/actions/events only (deny-by-default
    // for everything else, including src/api/private/secret).
    backendCapabilities: [
      'api:GET:/api/probe/*',
      'api:POST:/api/probe/*',
      'main:src/lib/mainActions.ts*',
      'action:src/lib/probeAction.ts*',
      'events:probe.*',
    ],
  },
  windows: {
    // native-window / multi-window: a secondary declared window, dormant at
    // launch, created/destroyed/recreated from Node Main and shown from the
    // primary renderer. Its own capability list intentionally excludes
    // window:manage (capability denial) and its backend grant is limited to
    // reporting its own results.
    probe: {
      route: '/window-probe',
      title: 'Murasaki Linux Parity Probe — Secondary',
      width: 640,
      height: 480,
      visible: false,
      createOnLaunch: false,
      capabilities: ['window:getLabel', 'window:list'],
      backendCapabilities: ['api:POST:/api/probe/window'],
    },
  },
})
