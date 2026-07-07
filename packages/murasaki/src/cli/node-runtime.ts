import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { dim } from './brand.js'

export type NodePlatform = 'darwin' | 'win32' | 'linux'
export type NodeArch = 'arm64' | 'x64'

/**
 * Fetch, verify, and cache the official Node.js runtime for a target
 * platform/arch/version, so `murasaki bundle` ships a portable,
 * target-specific node — not whatever node happens to be running the CLI,
 * which is (a) possibly the wrong platform/arch for a cross build, and (b)
 * possibly a non-portable Homebrew/nvm build linked against libs that aren't
 * present on other machines.
 *
 * Cached at `~/.murasaki/node/<version>/<platform>-<arch>/<node|node.exe>`; a
 * second call for the same version/platform/arch returns the cached path
 * immediately with no network access.
 */
export async function ensureNodeBinary(
  platform: NodePlatform,
  arch: NodeArch,
  version: string,
): Promise<string> {
  const cacheDir = join(homedir(), '.murasaki', 'node', version, `${platform}-${arch}`)
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'
  const cachedNode = join(cacheDir, binaryName)
  if (existsSync(cachedNode)) return cachedNode

  // nodejs.org dist filenames use "win" rather than "win32" (e.g.
  // node-v22.9.0-win-x64.zip), unlike every other platform bucket murasaki
  // uses elsewhere (which matches Node's own process.platform naming).
  const distPlatform = platform === 'win32' ? 'win' : platform
  const dist = `node-v${version}-${distPlatform}-${arch}`
  const archiveName = platform === 'win32' ? `${dist}.zip` : `${dist}.tar.gz`
  const baseUrl = `https://nodejs.org/dist/v${version}`

  process.stdout.write(`${dim(`downloading Node v${version} (${platform}-${arch})…`)}\n`)

  const expectedSha256 = await fetchExpectedSha256(`${baseUrl}/SHASUMS256.txt`, archiveName)

  const workDir = await mkdtemp(join(tmpdir(), 'murasaki-node-'))
  try {
    const archivePath = join(workDir, archiveName)
    await downloadFile(`${baseUrl}/${archiveName}`, archivePath)

    const actualSha256 = await sha256File(archivePath)
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `murasaki: checksum mismatch for ${archiveName} — expected ${expectedSha256}, got ${actualSha256}`,
      )
    }

    const extractDir = join(workDir, 'extract')
    await mkdir(extractDir, { recursive: true })

    // The Windows zip lays node.exe at the archive root (node-v.../node.exe);
    // the macOS/Linux tarball nests it under bin/ (node-v.../bin/node).
    let extractedNode: string
    if (platform === 'win32') {
      const extract = spawnSync('unzip', ['-q', '-o', archivePath, '-d', extractDir])
      if (extract.status !== 0) {
        throw new Error(
          `murasaki: failed to extract ${archiveName}: ${extract.stderr?.toString().trim() || extract.error}`,
        )
      }
      extractedNode = join(extractDir, dist, 'node.exe')
    } else {
      const extract = spawnSync('tar', ['-xzf', archivePath, '-C', extractDir])
      if (extract.status !== 0) {
        throw new Error(
          `murasaki: failed to extract ${archiveName}: ${extract.stderr?.toString().trim() || extract.error}`,
        )
      }
      extractedNode = join(extractDir, dist, 'bin', 'node')
    }
    if (!existsSync(extractedNode)) {
      throw new Error(`murasaki: extracted archive is missing ${binaryName} at ${extractedNode}`)
    }

    await mkdir(cacheDir, { recursive: true })
    await copyFile(extractedNode, cachedNode)
    await chmod(cachedNode, 0o755)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }

  return cachedNode
}

/**
 * Find the checksum line for `filename` in nodejs.org's SHASUMS256.txt
 * (format: `<sha256>  <filename>` per line). Fails loudly rather than
 * skipping verification — we're about to ship this file as an executable.
 */
async function fetchExpectedSha256(url: string, filename: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`murasaki: failed to fetch ${url} (${res.status} ${res.statusText})`)
  }
  const text = await res.text()
  for (const line of text.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/)
    if (name === filename) return hash
  }
  throw new Error(`murasaki: no checksum entry for ${filename} in ${url}`)
}

/** Download `url` to `dest` (a path under `os.tmpdir()`). */
async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`murasaki: failed to download ${url} (${res.status} ${res.statusText})`)
  }
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}
