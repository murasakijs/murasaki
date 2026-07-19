import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { banner, dim, error, success, warn } from './brand.js'
import { downloadHttpsFile, fetchHttpsText } from './secure-fetch.js'

export interface DemoSpec {
  appName: string
  assetStem: string
  version: string
  releaseTag: string
  checksumAsset: string
  description: string
}

export const DEMO_SPECS: Record<string, DemoSpec> = {
  default: {
    appName: 'MurasakiDemo',
    assetStem: 'MurasakiDemo',
    version: '0.47.3',
    releaseTag: 'v0.47.3',
    checksumAsset: 'SHA256SUMS.txt',
    description: 'the packaged create-murasaki scaffold',
  },
  papelle: {
    appName: 'Papelle',
    assetStem: 'Papelle',
    version: '0.55.5',
    releaseTag: 'samples-v0.55.5',
    checksumAsset: 'SHA256SUMS',
    description: 'a local-first block knowledge workspace',
  },
  oscilla: {
    appName: 'Oscilla',
    assetStem: 'Oscilla',
    version: '0.55.5',
    releaseTag: 'samples-v0.55.5',
    checksumAsset: 'SHA256SUMS',
    description: 'an API testing and observability workbench',
  },
  orglia: {
    appName: 'Orglia',
    assetStem: 'Orglia',
    version: '0.55.5',
    releaseTag: 'samples-v0.55.5',
    checksumAsset: 'SHA256SUMS',
    description: 'a self-hosted operations workspace',
  },
}

export function resolveDemoTarget(platform: NodeJS.Platform, arch: string): string {
  if (platform !== 'darwin') {
    throw new Error('the verified demo runner currently supports macOS only')
  }
  if (arch === 'arm64') return 'darwin-arm64'
  if (arch === 'x64') return 'darwin-x64'
  throw new Error(`unsupported Mac architecture: ${arch}`)
}

export function demoAssetName(spec: DemoSpec, target: string): string {
  return `${spec.assetStem}-${spec.version}-${target}.dmg`
}

export function checksumForAsset(contents: string, asset: string): string | undefined {
  for (const line of contents.split(/\r?\n/)) {
    const [digest, filename] = line.trim().split(/\s+/, 2)
    if (filename === asset && /^[a-f0-9]{64}$/i.test(digest ?? '')) return digest?.toLowerCase()
  }
  return undefined
}

export default async function demo(argv: string[]) {
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp()
    return
  }
  if (argv.includes('--list')) {
    printList()
    return
  }

  try {
    await runDemo(argv)
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    process.stderr.write(`\n${error(message)}\n\n`)
    process.exitCode = 1
  }
}

async function runDemo(argv: string[]) {
  const requested = argv.find((arg) => !arg.startsWith('-')) ?? 'default'
  const spec = DEMO_SPECS[requested]
  if (!spec) {
    throw new Error(`unknown demo “${requested}” — run murasaki demo --list`)
  }

  const target = resolveDemoTarget(process.platform, process.arch)
  const asset = demoAssetName(spec, target)
  const releaseRoot = `https://github.com/murasakijs/murasaki/releases/download/${spec.releaseTag}`
  const cacheRoot = join(homedir(), '.murasaki', 'demos', requested, `${spec.version}-${target}`)
  const appPath = join(cacheRoot, `${spec.appName}.app`)
  const metadataPath = join(cacheRoot, `${spec.assetStem}.json`)
  const refresh = argv.includes('--refresh')
  const noOpen = argv.includes('--no-open')

  process.stdout.write(`\n${banner({ mode: 'demo' })}\n`)
  process.stdout.write(`${dim(`  ${spec.appName} — ${spec.description}`)}\n\n`)
  process.stdout.write(
    `${warn('Developer preview: removes macOS quarantine only after checksum and code-signature verification.')}\n\n`,
  )

  const checksums = await fetchHttpsText(`${releaseRoot}/${spec.checksumAsset}`, {
    label: `${spec.releaseTag} demo checksums`,
    maxBytes: 4 * 1024 * 1024,
    timeoutMs: 60_000,
  })
  const expectedSha = checksumForAsset(checksums, asset)
  if (!expectedSha) throw new Error(`no published checksum found for ${asset}`)

  if (!refresh && verifiedCache(appPath, metadataPath, asset, expectedSha)) {
    process.stdout.write(`${success(`verified cache · ${target}`)}\n`)
  } else {
    await installDemo({ spec, target, asset, releaseRoot, expectedSha, cacheRoot, appPath, metadataPath })
  }

  const xattr = spawnSync('xattr', ['-dr', 'com.apple.quarantine', appPath], { encoding: 'utf8' })
  if (xattr.status !== 0 || xattr.error) {
    throw new Error(
      xattr.error?.message ?? xattr.stderr.trim() ?? `could not clear quarantine for ${spec.appName}`,
    )
  }

  if (noOpen) {
    process.stdout.write(`${success(`ready · ${appPath}`)}\n\n`)
    return
  }

  const opened = spawnSync('open', ['-n', appPath], { encoding: 'utf8' })
  if (opened.status !== 0 || opened.error) {
    throw new Error(opened.error?.message ?? opened.stderr.trim() ?? `could not open ${spec.appName}`)
  }
  process.stdout.write(`${success(`opened ${spec.appName}`)}\n`)
  process.stdout.write(`${dim(`  ${appPath}`)}\n\n`)
}

async function installDemo(opts: {
  spec: DemoSpec
  target: string
  asset: string
  releaseRoot: string
  expectedSha: string
  cacheRoot: string
  appPath: string
  metadataPath: string
}) {
  const { spec, target, asset, releaseRoot, expectedSha, cacheRoot, appPath, metadataPath } = opts
  const workRoot = join(tmpdir(), `murasaki-demo-${process.pid}-${Date.now()}`)
  const mountPath = join(workRoot, 'mount')
  const dmgPath = join(workRoot, asset)
  const stagedApp = join(cacheRoot, `.${spec.assetStem}-${process.pid}.app`)
  let mounted = false

  mkdirSync(mountPath, { recursive: true })
  mkdirSync(cacheRoot, { recursive: true })

  try {
    process.stdout.write(`${dim(`  downloading ${asset}…`)}\n`)
    const actualSha = await downloadHttpsFile(`${releaseRoot}/${asset}`, dmgPath, {
      label: asset,
      maxBytes: 512 * 1024 * 1024,
      timeoutMs: 10 * 60_000,
    })
    if (actualSha !== expectedSha) throw new Error(`checksum mismatch for ${asset}`)
    process.stdout.write(`${success('SHA256 verified')}\n`)

    const attached = spawnSync(
      'hdiutil',
      ['attach', dmgPath, '-mountpoint', mountPath, '-nobrowse', '-readonly'],
      { encoding: 'utf8' },
    )
    if (attached.status !== 0 || attached.error) {
      throw new Error(attached.error?.message ?? attached.stderr.trim() ?? 'could not mount the DMG')
    }
    mounted = true

    const sourceApp = join(mountPath, `${spec.appName}.app`)
    if (!existsSync(sourceApp)) throw new Error(`DMG does not contain ${spec.appName}.app`)

    rmSync(stagedApp, { recursive: true, force: true })
    const copied = spawnSync('ditto', [sourceApp, stagedApp], { encoding: 'utf8' })
    if (copied.status !== 0 || copied.error) {
      throw new Error(copied.error?.message ?? copied.stderr.trim() ?? 'could not copy the demo app')
    }

    verifyCodeSignature(stagedApp)
    rmSync(appPath, { recursive: true, force: true })
    renameSync(stagedApp, appPath)
    writeFileSync(
      metadataPath,
      `${JSON.stringify({ asset, sha256: expectedSha, target, releaseTag: spec.releaseTag }, null, 2)}\n`,
    )
    process.stdout.write(`${success('ad-hoc code signature verified')}\n`)
  } finally {
    if (mounted) spawnSync('hdiutil', ['detach', mountPath], { stdio: 'ignore' })
    rmSync(stagedApp, { recursive: true, force: true })
    rmSync(workRoot, { recursive: true, force: true })
  }
}

function verifiedCache(appPath: string, metadataPath: string, asset: string, sha256: string): boolean {
  if (!existsSync(appPath) || !existsSync(metadataPath)) return false
  try {
    const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as {
      asset?: string
      sha256?: string
    }
    if (metadata.asset !== asset || metadata.sha256 !== sha256) return false
    verifyCodeSignature(appPath)
    return true
  } catch {
    return false
  }
}

function verifyCodeSignature(appPath: string) {
  const verified = spawnSync('codesign', ['--verify', '--deep', '--strict', appPath], {
    encoding: 'utf8',
  })
  if (verified.status !== 0 || verified.error) {
    throw new Error(
      verified.error?.message ?? verified.stderr.trim() ?? 'ad-hoc code-signature verification failed',
    )
  }
}

function printList() {
  process.stdout.write('\n  Available macOS developer previews:\n\n')
  for (const [name, spec] of Object.entries(DEMO_SPECS)) {
    process.stdout.write(`    ${name.padEnd(16)} ${spec.description}\n`)
  }
  process.stdout.write('\n')
}

function printHelp() {
  const names = Object.keys(DEMO_SPECS).join(' | ')
  process.stdout.write(
    '\n  Usage: murasaki demo [name] [--refresh] [--no-open]\n\n' +
      '  Downloads the matching macOS demo, verifies its published SHA256 and\n' +
      '  ad-hoc code signature, removes quarantine, then opens it.\n\n' +
      `  Names: ${names}\n` +
      '  Flags: --list | --refresh | --no-open\n\n',
  )
}
