import { defineConfig } from 'murasaki'

const releaseVersion = process.env.GITHUB_REF_NAME?.startsWith('samples-v')
  ? process.env.GITHUB_REF_NAME.slice('samples-v'.length)
  : '0.1.0'
const sourceCommit = process.env.GITHUB_SHA

export default defineConfig({
  appId: 'com.murasaki.examples.orglia',
  productName: 'Orglia',
  version: releaseVersion,
  description: 'Self-hosted integrated operations workspace',
  icon: 'src/assets/orglia-icon.png',
  about: {
    width: 440,
    height: 580,
    paragraphs: [
      'Self-hosted integrated operations workspace.',
      'Projects, customers, inventory, shifts, analytics, and incidents in one desktop app.',
    ],
    paragraphSpacing: 14,
    details: [
      {
        label: 'Commit',
        value: sourceCommit?.slice(0, 7) ?? 'development',
        ...(sourceCommit
          ? { href: `https://github.com/murasakijs/murasaki/commit/${sourceCommit}` }
          : {}),
      },
      { label: 'Runtime', value: 'Murasaki' },
      { label: 'Edition', value: 'Demo' },
    ],
    buttons: [
      { label: 'Docs', href: 'https://murasaki.ichi10.com/docs' },
      { label: 'GitHub', href: 'https://github.com/murasakijs/murasaki' },
    ],
  },
  locales: ['ja', 'en'],
  targets: ['darwin-arm64', 'darwin-x64', 'win32-x64', 'win32-arm64', 'linux-x64', 'linux-arm64'],
  main: { shutdownTimeoutMs: 8_000 },
  backendCapabilities: [
    'api:POST:/api/login',
    'api:POST:/api/logout',
    'api:GET:/api/native-demo',
    'api:GET:/api/session',
    'api:GET:/api/state',
    'api:POST:/api/commands',
  ],
  window: {
    title: 'Orglia — Integrated Operations',
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
  },
})
