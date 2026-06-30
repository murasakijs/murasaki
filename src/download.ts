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
export async function ensureWebviewPrebuild(target: Target): Promise<string> {
  if (target.id === currentTarget().id) {
    // The host already has it via the project's node_modules
    // (resolved by build.ts → resolveDepRoot('@webviewjs/webview')).
    // The caller can locate the matching .node file there.
    return '' // signal: use existing node_modules
  }

  // Map target → npm package name
  const webviewPkg = mapWebviewPackage(target)
  if (!webviewPkg) {
    throw new Error(`No @webviewjs/webview prebuild for ${target.id}`)
  }

  const cacheRoot = join(cacheDir(), 'webview', webviewPkg)
  if (existsSync(cacheRoot) && readdirSync(cacheRoot).length > 0) return cacheRoot

  mkdirSync(cacheRoot, { recursive: true })

  // Use `npm pack` style — fetch the tarball from registry and extract.
  const tarballUrl = await resolveNpmTarball(webviewPkg)
  // Flatten the package name (it contains a `/`) for the local archive path.
  const safeName = webviewPkg.replace(/[/@]/g, '-')
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

async function resolveNpmTarball(pkgName: string): Promise<string> {
  // Use the registry's "latest" version that matches the host's
  // @webviewjs/webview version. We read the consumer project's resolved
  // version via the package.json from the existing node_modules.
  let version = 'latest'
  try {
    const { createRequire } = await import('node:module')
    const req = createRequire(join(homedir(), 'package.json')) // dummy base
    const local = req(`@webviewjs/webview/package.json`)
    version = local.version
  } catch {
    // Best effort — fall back to latest.
  }
  return `https://registry.npmjs.org/${pkgName.replace('/', '%2F')}/-/${pkgName.split('/')[1]}-${version}.tgz`
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
