import { existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readCleartextMessage, readKey, verify, type Key } from 'openpgp'
import { dim } from './brand.js'
import { downloadHttpsFile, fetchHttpsText, sha256File } from './secure-fetch.js'

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
  const cachedHash = join(cacheDir, `${binaryName}.sha256`)
  if (existsSync(cachedNode) && existsSync(cachedHash)) {
    const expected = (await readFile(cachedHash, 'utf8')).trim()
    if (/^[a-f0-9]{64}$/.test(expected) && await sha256File(cachedNode) === expected) {
      return cachedNode
    }
    await Promise.all([rm(cachedNode, { force: true }), rm(cachedHash, { force: true })])
  } else if (existsSync(cachedNode) || existsSync(cachedHash)) {
    // Legacy/partial caches have no independently recorded verified digest.
    await Promise.all([rm(cachedNode, { force: true }), rm(cachedHash, { force: true })])
  }

  // nodejs.org dist filenames use "win" rather than "win32" (e.g.
  // node-v22.9.0-win-x64.zip), unlike every other platform bucket murasaki
  // uses elsewhere (which matches Node's own process.platform naming).
  const distPlatform = platform === 'win32' ? 'win' : platform
  const dist = `node-v${version}-${distPlatform}-${arch}`
  const archiveName = platform === 'win32' ? `${dist}.zip` : `${dist}.tar.gz`
  const baseUrl = `https://nodejs.org/dist/v${version}`

  process.stdout.write(`${dim(`downloading Node v${version} (${platform}-${arch})…`)}\n`)

  const expectedSha256 = await fetchExpectedSha256(`${baseUrl}/SHASUMS256.txt.asc`, archiveName)

  const workDir = await mkdtemp(join(tmpdir(), 'murasaki-node-'))
  try {
    const archivePath = join(workDir, archiveName)
    const actualSha256 = await downloadHttpsFile(`${baseUrl}/${archiveName}`, archivePath, {
      label: archiveName,
      maxBytes: 256 * 1024 * 1024,
      timeoutMs: 5 * 60_000,
    })
    if (actualSha256 !== expectedSha256) {
      throw new Error(
        `murasaki: checksum mismatch for ${archiveName} — expected ${expectedSha256}, got ${actualSha256}`,
      )
    }

    const extractDir = join(workDir, 'extract')
    await mkdir(extractDir, { recursive: true })

    // `tar` extracts both the Windows `.zip` and the macOS/Linux `.tar.gz`
    // (bsdtar auto-detects the format from `-xf`), and — unlike `unzip` — it
    // ships in the box on every target we build on: `tar.exe` is bundled with
    // Windows 10 1803+ (as bsdtar/libarchive), and `unzip` is NOT a stock
    // Windows command, so the previous win32 branch failed with `spawnSync
    // unzip ENOENT` on a clean Windows host (CI only passed because Git Bash
    // supplies `unzip` there). One extractor, every platform.
    const extract = spawnSync('tar', ['-xf', archivePath, '-C', extractDir])
    if (extract.status !== 0) {
      throw new Error(
        `murasaki: failed to extract ${archiveName}: ${extract.stderr?.toString().trim() || extract.error}`,
      )
    }
    // The Windows zip lays node.exe at the archive root (node-v.../node.exe);
    // the macOS/Linux tarball nests it under bin/ (node-v.../bin/node).
    const extractedNode =
      platform === 'win32'
        ? join(extractDir, dist, 'node.exe')
        : join(extractDir, dist, 'bin', 'node')
    if (!existsSync(extractedNode)) {
      throw new Error(`murasaki: extracted archive is missing ${binaryName} at ${extractedNode}`)
    }

    await mkdir(cacheDir, { recursive: true })
    await copyFile(extractedNode, cachedNode)
    await chmod(cachedNode, 0o755)
    await writeFile(cachedHash, `${expectedSha256}\n`, { mode: 0o600 })
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }

  return cachedNode
}

/**
 * Node.js release-key fingerprints pinned from the official
 * nodejs/release-keys repository. Active keys are tried first; legacy keys
 * preserve support for older Node 22+ patch releases. Downloaded public keys
 * are accepted only when their cryptographic fingerprint matches this list,
 * so a compromised key-hosting TLS channel cannot substitute an attacker key.
 */
const ACTIVE_NODE_RELEASE_KEYS = [
  '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356',
  'DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7',
  'CC68F5A3106FF448322E48ED27F5E38D5B0A215F',
  '8FCCA13FEF1D0C2E91008E09770F7A9A5AE15600',
  '890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4',
  'C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C',
  '108F52B48DB57BB0CC439B2997B01419BD92F80A',
  'A363A499291CBBC940DD62E41F10027AF002F8B0',
] as const

const LEGACY_NODE_RELEASE_KEYS = [
  'C0D6248439F1D5604AAFFB4021D900FFDB233756',
  '4ED778F539E3634C779C87C6D7062848A1AB005C',
  '141F07595B7B3FFE74309A937405533BE57C7D57',
  '9554F04D7259F04124DE6B476D5A82AC7E37093B',
  '94AE36675C464D64BAFA68DD7434390BDBE9B9C5',
  '1C050899334244A8AF75E53792EF661D867B9DFA',
  '74F12602B6F1C4E913FAA37AD3A89613643B6201',
  'B9AE9905FFD7803F25714661B63B535A4C206CA9',
  '77984A986EBC2AA786BC0F66B01FBB92821C587A',
  '93C7E9E91B49E432C2F75674B0A78B0A6C481CF6',
  '56730D5401028683275BD23C23EFEFE93C4CFFFE',
  '71DCFD284A79C3B38668286BC97EC7A07EDE3FC1',
  'FD3A5288F042B6850C66B31F09FE44734EB7990E',
  '61FC681DFB92A079F1685E77973F295594EC4689',
  '114F43EE0176B71C7BC219DD50A3051F888C628D',
  'C4F0DFFF4E8C1A8236409D08E73BC641CC11F4C8',
  'DD8F2338BAE7501E3DD5AC78C273792F7D83545D',
  'A48C2BEE680E841632CD4E44F07496B3EB3C1762',
  'B9E2F5981AA6E0CD28160D9FF13993A75599653C',
  '7937DFD2AB06298B2293C3187D33FF9D0246406D',
] as const

const NODE_RELEASE_KEY_BASE = 'https://raw.githubusercontent.com/nodejs/release-keys/main/keys'
let activeReleaseKeys: Promise<Key[]> | undefined
let allReleaseKeys: Promise<Key[]> | undefined

async function loadReleaseKeys(fingerprints: readonly string[]): Promise<Key[]> {
  return await Promise.all(fingerprints.map(async (fingerprint) => {
    const armoredKey = await fetchHttpsText(`${NODE_RELEASE_KEY_BASE}/${fingerprint}.asc`, {
      label: `Node.js release key ${fingerprint}`,
      maxBytes: 256 * 1024,
      timeoutMs: 60_000,
    })
    const key = await readKey({ armoredKey })
    if (key.getFingerprint().toUpperCase() !== fingerprint) {
      throw new Error(`murasaki: Node.js release key fingerprint mismatch for ${fingerprint}`)
    }
    return key
  }))
}

async function verifiedChecksums(signedText: string): Promise<string> {
  const message = await readCleartextMessage({ cleartextMessage: signedText })
  activeReleaseKeys ??= loadReleaseKeys(ACTIVE_NODE_RELEASE_KEYS)
  try {
    const result = await verify({ message, verificationKeys: await activeReleaseKeys })
    await Promise.any(result.signatures.map((signature) => signature.verified))
    return result.data
  } catch {
    allReleaseKeys ??= Promise.all([
      activeReleaseKeys,
      loadReleaseKeys(LEGACY_NODE_RELEASE_KEYS),
    ]).then(([active, legacy]) => [...active, ...legacy])
    try {
      const result = await verify({ message, verificationKeys: await allReleaseKeys })
      await Promise.any(result.signatures.map((signature) => signature.verified))
      return result.data
    } catch (error) {
      throw new Error(`murasaki: Node.js SHASUMS256 signature verification failed: ${error}`)
    }
  }
}

/**
 * Verify the clear-signed checksum document, then find the exact archive line.
 * Fails loudly rather than trusting an unsigned hash from the same origin as
 * the executable archive.
 */
async function fetchExpectedSha256(url: string, filename: string): Promise<string> {
  const signedText = await fetchHttpsText(url, {
    label: 'Node.js SHASUMS256.txt.asc',
    maxBytes: 4 * 1024 * 1024,
    timeoutMs: 60_000,
  })
  const text = await verifiedChecksums(signedText)
  for (const line of text.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/)
    if (name === filename) return hash
  }
  throw new Error(`murasaki: no checksum entry for ${filename} in ${url}`)
}
