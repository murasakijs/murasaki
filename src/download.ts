// Cross-compile helpers — download Node.js binary + @webviewjs/webview
// prebuilds for any supported target platform, caching under
// ~/.murasaki/cache/.

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export type Target = {
  /** Canonical id we use in CLI flags. */
  id: 'darwin-arm64' | 'darwin-x64' | 'win-x64' | 'win-arm64' | 'linux-x64' | 'linux-arm64'
  /** OS bucket. */
  os: 'darwin' | 'win32' | 'linux'
  /** Architecture. */
  arch: 'x64' | 'arm64'
}

export const TARGETS: Record<Target['id'], Target> = {
  'darwin-arm64': { id: 'darwin-arm64', os: 'darwin', arch: 'arm64' },
  'darwin-x64': { id: 'darwin-x64', os: 'darwin', arch: 'x64' },
  'win-x64': { id: 'win-x64', os: 'win32', arch: 'x64' },
  'win-arm64': { id: 'win-arm64', os: 'win32', arch: 'arm64' },
  'linux-x64': { id: 'linux-x64', os: 'linux', arch: 'x64' },
  'linux-arm64': { id: 'linux-arm64', os: 'linux', arch: 'arm64' },
}

export function currentTarget(): Target {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  if (process.platform === 'darwin') return TARGETS[`darwin-${arch}` as Target['id']]
  if (process.platform === 'win32') return TARGETS[`win-${arch}` as Target['id']]
  return TARGETS[`linux-${arch}` as Target['id']]
}

function cacheDir(): string {
  const dir = join(homedir(), '.murasaki', 'cache')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

// ── Node.js binary ────────────────────────────────────────────────
/**
 * Returns the absolute path to the Node binary for the given target.
 * Downloads + extracts under ~/.murasaki/cache/node/v{version}/{id}/ on
 * first request; subsequent calls return immediately.
 *
 * For the host target this is just `process.execPath` — no network needed.
 */
export async function ensureNodeBinary(target: Target): Promise<string> {
  if (target.id === currentTarget().id) return process.execPath

  const version = process.versions.node // e.g. "24.16.0"
  const targetDir = join(cacheDir(), 'node', `v${version}`, target.id)
  const exe = target.os === 'win32' ? 'node.exe' : 'node'
  const binaryPath = join(targetDir, exe)
  if (existsSync(binaryPath)) return binaryPath

  mkdirSync(targetDir, { recursive: true })

  const archExt = target.arch
  const platformPart = target.os === 'win32' ? 'win' : target.os
  // node-v24.16.0-darwin-arm64.tar.gz / node-v24.16.0-win-x64.zip
  const archiveName =
    target.os === 'win32'
      ? `node-v${version}-${platformPart}-${archExt}.zip`
      : `node-v${version}-${platformPart}-${archExt}.tar.gz`
  const url = `https://nodejs.org/dist/v${version}/${archiveName}`
  const archivePath = join(tmpdir(), archiveName)

  await fetchToFile(url, archivePath)

  // Extract archive and find node binary inside.
  if (target.os === 'win32') {
    await runOrThrow('unzip', ['-q', '-o', archivePath, '-d', targetDir])
  } else {
    await runOrThrow('tar', ['-xf', archivePath, '-C', targetDir])
  }

  // The archive contains a top-level "node-v.../bin/node" or similar.
  // Find and move the actual node binary to binaryPath.
  const actualBinary = findNodeBinary(targetDir, exe)
  if (!actualBinary) throw new Error(`Could not find ${exe} inside extracted archive`)
  if (actualBinary !== binaryPath) {
    renameSync(actualBinary, binaryPath)
  }

  return binaryPath
}

function findNodeBinary(root: string, exe: string): string | null {
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop() as string
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
      const p = join(dir, name)
      let isDir = false
      try {
        isDir = statSync(p).isDirectory()
      } catch {}
      if (isDir) {
        stack.push(p)
      } else if (name === exe) {
        return p
      }
    }
  }
  return null
}

// ── @webviewjs/webview prebuild ────────────────────────────────────
/** Returns absolute path to the .node prebuild file for the given target. */
/**
 * Locates the exact version of a webview prebuild package the consumer
 * needs, by reading @webviewjs/webview's optionalDependencies map. That
 * map pins each prebuild to the same version as the main package (per
 * napi-rs convention), so downloading anything else — including 'latest'
 * from the registry — risks an ABI / API mismatch at runtime.
 *
 * Returns null when the main package can't be located at all; the caller
 * decides how to handle that.
 */
export async function detectWebviewPrebuildVersion(prebuildPkg: string): Promise<string | null> {
  try {
    const { createRequire } = await import('node:module')
    const { fileURLToPath } = await import('node:url')

    // Try resolving @webviewjs/webview/package.json from multiple bases.
    // In strict pnpm consumer layouts the main webview package isn't
    // reachable from the consumer's own node_modules — but it IS a direct
    // dep of murasaki itself, so resolving from murasaki's own file
    // always works, no matter how the consumer's project is set up.
    const bases = [
      // 1. Consumer's own package.json — works with npm / yarn / non-strict
      //    pnpm hoisting.
      join(process.cwd(), 'package.json'),
      // 2. This module's own file. Since @webviewjs/webview is a direct
      //    dep of murasaki, it's always resolvable from anywhere inside
      //    the murasaki package's tree — including under pnpm's
      //    virtual store nesting.
      fileURLToPath(import.meta.url),
    ]

    for (const base of bases) {
      try {
        const req = createRequire(base)
        const webviewPkg = req(`@webviewjs/webview/package.json`) as {
          version?: string
          optionalDependencies?: Record<string, string>
        }
        const pinned = webviewPkg.optionalDependencies?.[prebuildPkg]
        if (pinned) return pinned
        // Fallback: assume the prebuild version tracks the main package
        // version. napi-rs projects follow this convention by default.
        if (webviewPkg.version) return webviewPkg.version
      } catch {
        // try next base
      }
    }
  } catch {
    // ignore
  }
  return null
}

export async function ensureWebviewPrebuild(target: Target): Promise<string> {
  // Note: we no longer short-circuit for the host target. Whether the
  // requested target matches the host or not, some strict pnpm layouts
  // won't hoist the prebuild package to the consumer's node_modules —
  // so build.ts always calls into this function as a reliable fallback
  // and copies the resulting directory into the app bundle.

  // Map target → npm package name
  const webviewPkg = mapWebviewPackage(target)
  if (!webviewPkg) {
    throw new Error(`No @webviewjs/webview prebuild for ${target.id}`)
  }

  // Resolve the exact pin BEFORE we look at the cache. Including the
  // version in the cache path means a webview upgrade in the consumer's
  // node_modules invalidates the cache automatically — otherwise a
  // second build after `pnpm add @webviewjs/webview@latest` would silently
  // reuse the wrong ABI and crash the packaged app at runtime.
  const version = await detectWebviewPrebuildVersion(webviewPkg)
  if (!version) {
    throw new Error(
      `Cannot determine the correct version of ${webviewPkg} to download.\n` +
        `The main @webviewjs/webview package must be installed (as a direct or\n` +
        `transitive dependency of your project) so its optionalDependencies\n` +
        `pin can be read.`,
    )
  }

  const cacheRoot = join(cacheDir(), 'webview', webviewPkg, version)
  if (existsSync(cacheRoot) && readdirSync(cacheRoot).length > 0) return cacheRoot

  mkdirSync(cacheRoot, { recursive: true })

  // Fetch the tarball at the exact pinned version. Skip resolveNpmTarball
  // here because we already have the version — passing it around removes
  // the risk of a second lookup returning a different answer under a race.
  const tarballUrl = `https://registry.npmjs.org/${webviewPkg.replace(
    '/',
    '%2F',
  )}/-/${webviewPkg.split('/')[1]}-${version}.tgz`
  const safeName = `${webviewPkg.replace(/[/@]/g, '-')}-${version}`
  const archivePath = join(tmpdir(), `${safeName}.tgz`)
  await fetchToFile(tarballUrl, archivePath)
  await runOrThrow('tar', ['-xf', archivePath, '-C', cacheRoot, '--strip-components=1'])

  return cacheRoot
}

function mapWebviewPackage(target: Target): string | null {
  // Mirrors @webviewjs/webview's optionalDependencies map.
  if (target.os === 'darwin') return `@webviewjs/webview-darwin-${target.arch}`
  if (target.os === 'linux') return `@webviewjs/webview-linux-${target.arch}-gnu`
  if (target.os === 'win32') return `@webviewjs/webview-${target.os}-${target.arch}-msvc`
  return null
}


// ── helpers ────────────────────────────────────────────────────────
function fetchToFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then(async (res) => {
        if (!res.ok || !res.body) {
          reject(new Error(`fetch ${url}: ${res.status}`))
          return
        }
        const arr = new Uint8Array(await res.arrayBuffer())
        const stream = createWriteStream(dest)
        stream.on('error', reject)
        stream.on('finish', () => resolve())
        stream.end(arr)
      })
      .catch(reject)
  })
}

function runOrThrow(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' })
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exit ${code}`))))
  })
}
