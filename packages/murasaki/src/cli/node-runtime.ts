import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { dim } from './brand.js'

/**
 * Fetch, verify, and cache the official macOS Node.js runtime for a target
 * arch/version, so `murasaki bundle` ships a portable, target-specific
 * node — not whatever node happens to be running the CLI, which is (a) the
 * wrong architecture for cross-arch builds, and (b) possibly a non-portable
 * Homebrew/nvm build linked against libs that aren't present on other
 * machines.
 *
 * Cached at `~/.murasaki/node/<version>/darwin-<arch>/node`; a second call
 * for the same version/arch returns the cached path immediately with no
 * network access.
 */
export async function ensureNodeBinary(arch: 'arm64' | 'x64', version: string): Promise<string> {
  const cacheDir = join(homedir(), '.murasaki', 'node', version, `darwin-${arch}`)
  const cachedNode = join(cacheDir, 'node')
  if (existsSync(cachedNode)) return cachedNode

  const dist = `node-v${version}-darwin-${arch}`
  const tarballName = `${dist}.tar.gz`
  const baseUrl = `https://nodejs.org/dist/v${version}`

  process.stdout.write(`${dim(`downloading Node v${version} (darwin-${arch})…`)}\n`)

  const expectedSha256 = await fetchExpectedSha256(`${baseUrl}/SHASUMS256.txt`, tarballName)

  const workDir = await mkdtemp(join(tmpdir(), 'murasaki-node-'))
  try {
    const tarballPath = join(workDir, tarballName)
    await downloadFile(`${baseUrl}/${tarballName}`, tarballPath)

    const actualSha256 = await sha256File(tarballPath)
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `murasaki: checksum mismatch for ${tarballName} — expected ${expectedSha256}, got ${actualSha256}`,
      )
    }

    const extractDir = join(workDir, 'extract')
    await mkdir(extractDir, { recursive: true })
    const extract = spawnSync('tar', ['-xzf', tarballPath, '-C', extractDir])
    if (extract.status !== 0) {
      throw new Error(
        `murasaki: failed to extract ${tarballName}: ${extract.stderr?.toString().trim() || extract.error}`,
      )
    }

    const extractedNode = join(extractDir, dist, 'bin', 'node')
    if (!existsSync(extractedNode)) {
      throw new Error(`murasaki: extracted archive is missing bin/node at ${extractedNode}`)
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
