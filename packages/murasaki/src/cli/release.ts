import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import {
  createHash,
  generateKeyPairSync,
  createPrivateKey,
  sign as signEd25519,
} from 'node:crypto'
import { resolve } from 'node:path'
import pc from 'picocolors'
import { loadUserConfig } from './load-config.js'
import { sha256File } from './secure-fetch.js'

/**
 * `murasaki release` — the auto-update publishing helpers (contract §9).
 * Three independent subcommands, dispatched by flag:
 *
 *   murasaki release --keygen
 *   murasaki release --manifest --base-url <url> --version <v> [--notes <md>] [--mandatory] [--rollout <0-100>]
 *   murasaki release --sign
 *
 * `--generate-manifest` is kept working as a deprecated alias of `--manifest`.
 */
export default async function release(argv: string[]) {
  const cwd = process.cwd()

  if (argv.includes('--keygen')) return keygen(argv, cwd)

  if (argv.includes('--generate-manifest')) {
    process.stderr.write(
      `\n  ${pc.yellow('!')} --generate-manifest is deprecated, use --manifest\n\n`,
    )
    return manifest(argv, cwd)
  }

  if (argv.includes('--manifest')) return manifest(argv, cwd)

  if (argv.includes('--sign')) return signManifest(cwd)

  process.stdout.write(
    `\n  ${pc.yellow('!')} usage:\n` +
      `    murasaki release --keygen [--force]\n` +
      `    murasaki release --manifest --base-url <url> --version <v> [--notes <md>] [--mandatory] [--rollout <0-100>]\n` +
      `    murasaki release --sign\n\n`,
  )
}

// ── Ed25519 raw <-> DER wrapping (contract §2) ─────────────────────────────
// Ed25519's SPKI/PKCS8 DER encodings have no variable-length fields, so these
// headers are constant for every key — verified against node:crypto's own
// generateKeyPairSync('ed25519') output.
const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

function rawPrivateKeyToDer(raw: Buffer): Buffer {
  return Buffer.concat([PKCS8_ED25519_PREFIX, raw])
}

// ── --keygen ────────────────────────────────────────────────────────────

/**
 * Generates an Ed25519 keypair and writes `.murasaki/update-key.pub`
 * (commit) + `.murasaki/update-key` (gitignored — appends the entry to
 * `.gitignore` if it isn't already covered). The private key is never printed;
 * the CLI gives an stdin-based command for copying the private file into a CI
 * secret without exposing it in terminal logs, argv, or shell history.
 */
async function keygen(argv: string[], cwd: string): Promise<void> {
  const force = argv.includes('--force')
  const dir = resolve(cwd, '.murasaki')
  const pubPath = resolve(dir, 'update-key.pub')
  const privPath = resolve(dir, 'update-key')

  if (!force && (existsSync(pubPath) || existsSync(privPath))) {
    process.stderr.write(
      `\n  ${pc.red('✗')} ${privPath} already exists — pass --force to overwrite.\n` +
        `    (this invalidates the old key: apps already shipped with the old public key\n` +
        `    will reject manifests signed with the new one)\n\n`,
    )
    process.exit(1)
  }

  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const pubDer = publicKey.export({ type: 'spki', format: 'der' }) as Buffer
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' }) as Buffer
  const pubB64 = pubDer.subarray(pubDer.length - 32).toString('base64')
  const privB64 = privDer.subarray(privDer.length - 32).toString('base64')

  await mkdir(dir, { recursive: true })
  await writeFile(pubPath, `${pubB64}\n`)
  await writeFile(privPath, `${privB64}\n`)
  await chmod(privPath, 0o600)

  await ensureGitignored(cwd, '.murasaki/update-key')

  process.stdout.write(
    `\n  ${pc.green('✓')} wrote ${pubPath} (commit this)\n` +
      `  ${pc.green('✓')} wrote ${privPath} (mode 0600, gitignored; never printed)\n\n` +
      `  Store it as the MURASAKI_UPDATE_KEY GitHub secret so CI can sign releases:\n` +
      `    gh secret set MURASAKI_UPDATE_KEY < .murasaki/update-key\n` +
      `  (or Settings → Secrets and variables → Actions → New repository secret)\n\n`,
  )
}

/** Appends `entry` to `<cwd>/.gitignore` unless it's already ignored. */
async function ensureGitignored(cwd: string, entry: string): Promise<void> {
  const path = resolve(cwd, '.gitignore')
  let contents = ''
  try {
    contents = await readFile(path, 'utf8')
  } catch {
    // no .gitignore yet — write a new one below
  }
  const alreadyIgnored = contents
    .split('\n')
    .some((line) => line.trim() === entry || line.trim() === `/${entry}`)
  if (alreadyIgnored) return

  const separator = contents.length > 0 && !contents.endsWith('\n') ? '\n' : ''
  await writeFile(path, `${contents}${separator}${entry}\n`)
}

// ── --manifest ──────────────────────────────────────────────────────────

/**
 * Scans `dist/` for this version's payloads (contract §5:
 * `dist/bundle/<productName>-darwin-<arch>.app.zip`,
 * `dist/<productName>-<version>-setup-<arch>.exe`,
 * `dist/bundle/<productName>-<version>-linux-<arch>.AppImage`), hashes
 * whichever exist, and writes `dist/latest.json`. Missing targets are
 * skipped, not errors — an app may only ship for some platforms; only zero
 * payloads found is fatal. The Linux `.deb` (installer.ts's `installerLinux`)
 * is deliberately never scanned here — it's package-manager-owned (apt/dpkg
 * upgrades own its lifecycle), unlike the self-contained `.AppImage`, which
 * is murasaki's own update-manifest payload for Linux the same way the
 * darwin `.app.zip`/win32 `-setup-<arch>.exe` are.
 */
async function manifest(argv: string[], cwd: string): Promise<void> {
  const baseUrl = flag(argv, '--base-url')
  const version = flag(argv, '--version')
  const notes = flag(argv, '--notes') ?? ''
  const mandatory = argv.includes('--mandatory')
  const rollout = parseRolloutFlag(argv)
  if (!baseUrl || !version) {
    process.stderr.write(`\n  ${pc.red('✗')} --base-url and --version are required\n\n`)
    process.exit(1)
  }
  validateReleaseVersion(version)
  const releaseBaseUrl = validateReleaseBaseUrl(baseUrl)

  const config = await loadUserConfig(cwd)
  const productName = config.productName

  // Each win32 target lists its candidate filename(s) in preference order:
  // installer.ts now names the NSIS installer `-setup-<arch>.exe` (win32
  // arm64 support), but a win32-x64 build published before that change used
  // the un-suffixed `-setup.exe` — still recognized here so already-published
  // assets keep resolving.
  const targets: Array<{ key: string; files: string[] }> = [
    { key: 'darwin-arm64', files: [resolve(cwd, 'dist/bundle', `${productName}-darwin-arm64.app.zip`)] },
    { key: 'darwin-x64', files: [resolve(cwd, 'dist/bundle', `${productName}-darwin-x64.app.zip`)] },
    {
      key: 'win32-x64',
      files: [
        resolve(cwd, 'dist', `${productName}-${version}-setup-x64.exe`),
        resolve(cwd, 'dist', `${productName}-${version}-setup.exe`), // legacy, pre-arch-suffix name
      ],
    },
    { key: 'win32-arm64', files: [resolve(cwd, 'dist', `${productName}-${version}-setup-arm64.exe`)] },
    {
      key: 'linux-x64',
      files: [resolve(cwd, 'dist/bundle', `${productName}-${version}-linux-x64.AppImage`)],
    },
    {
      key: 'linux-arm64',
      files: [resolve(cwd, 'dist/bundle', `${productName}-${version}-linux-arm64.AppImage`)],
    },
  ]

  const assets: Record<string, { url: string; sha256: string }> = {}
  for (const t of targets) {
    for (const file of t.files) {
      try {
        const filename = file.split(/[\\/]/).pop()!
        assets[t.key] = {
          url: new URL(encodeURIComponent(filename), releaseBaseUrl).toString(),
          sha256: await sha256File(file),
        }
        break // first existing candidate for this target wins
      } catch {
        // try the next candidate name, or skip the target — the app may
        // only ship for some platforms
      }
    }
  }

  if (Object.keys(assets).length === 0) {
    process.stderr.write(
      `\n  ${pc.red('✗')} no payloads found under dist/ — run \`murasaki bundle\`/\`murasaki installer\` first\n\n`,
    )
    process.exit(1)
  }

  // `generatedAt` is the anti-freeze/replay guard the client checks against
  // `updater.maxManifestAgeDays` — see runtime/updater.ts's
  // `assertManifestFreshness`. Same instant as `publishedAt` (kept for
  // back-compat / human display) so the two never drift apart.
  const generatedAt = new Date().toISOString()
  const manifestObj = {
    version,
    publishedAt: generatedAt,
    generatedAt,
    notes,
    mandatory,
    ...(rollout !== undefined ? { rollout } : {}),
    assets,
  }

  const outPath = resolve(cwd, 'dist/latest.json')
  await mkdir(resolve(cwd, 'dist'), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(manifestObj, null, 2)}\n`)

  const count = Object.keys(assets).length
  process.stdout.write(
    `\n  ${pc.green('✓')} wrote ${outPath} (${count} target${count === 1 ? '' : 's'}: ${Object.keys(assets).join(', ')})\n\n`,
  )
}

function validateReleaseVersion(version: string): void {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version)
  if (!match
    || [match[1], match[2], match[3]].some((part) => !Number.isSafeInteger(Number(part)))
    || (match[4]?.split('.').some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0')) ?? false)) {
    throw new Error('murasaki: --version must be a valid semantic version')
  }
}

function validateReleaseBaseUrl(baseUrl: string): URL {
  let parsed: URL
  try {
    parsed = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
  } catch {
    throw new Error('murasaki: --base-url must be an absolute URL')
  }
  const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase())
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash) {
    throw new Error(
      'murasaki: --base-url must be credential-free HTTPS (loopback HTTP is allowed for testing) without query or fragment',
    )
  }
  return parsed
}

/** Parses `--rollout <0-100>` (staged rollout percentage — contract-adjacent, see the auto-update guide). Exits with an error on a malformed value; `undefined` (field omitted, meaning 100%) when the flag isn't passed. */
function parseRolloutFlag(argv: string[]): number | undefined {
  const raw = flag(argv, '--rollout')
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    process.stderr.write(`\n  ${pc.red('✗')} --rollout must be an integer between 0 and 100\n\n`)
    process.exit(1)
  }
  return value
}

// ── --sign ──────────────────────────────────────────────────────────────

/**
 * Signs `dist/latest.json` → `dist/latest.json.sig`: base64 of a detached
 * Ed25519 signature over the manifest's exact raw bytes (contract §1 — the
 * client never re-serializes them, verifying the bytes as received before
 * `JSON.parse`ing them). Key from `$MURASAKI_UPDATE_KEY`, else
 * `.murasaki/update-key`.
 *
 * When the committed public key file (`.murasaki/update-key.pub`) is
 * present, this also injects a `keyId` field — the first 8 bytes (hex) of
 * sha256 of the raw 32-byte public key — into `dist/latest.json` *before*
 * signing, so it's covered by the signature like every other field. The
 * client uses `keyId` only as a hint for which pinned key to try first
 * during rotation (see the auto-update guide's rotation runbook); it never
 * skips trying every pinned key. Skipped (not an error) when the public key
 * file isn't available — e.g. a bring-your-own-key setup that only holds
 * `$MURASAKI_UPDATE_KEY` — since the client already tries every pinned key
 * regardless of a hint.
 */
async function signManifest(cwd: string): Promise<void> {
  const manifestPath = resolve(cwd, 'dist/latest.json')
  if (!existsSync(manifestPath)) {
    process.stderr.write(
      `\n  ${pc.red('✗')} dist/latest.json not found — run \`murasaki release --manifest\` first\n\n`,
    )
    process.exit(1)
  }

  const keyB64 = await resolvePrivateKey(cwd)
  const raw = Buffer.from(keyB64, 'base64')
  if (raw.length !== 32) {
    process.stderr.write(
      `\n  ${pc.red('✗')} invalid update key: expected a base64-encoded 32-byte Ed25519 seed, got ${raw.length} bytes\n\n`,
    )
    process.exit(1)
  }

  const privateKey = createPrivateKey({
    key: rawPrivateKeyToDer(raw),
    format: 'der',
    type: 'pkcs8',
  })

  const data = await injectKeyIdIfAvailable(cwd, manifestPath)
  const signature = signEd25519(null, data, privateKey)

  const sigPath = resolve(cwd, 'dist/latest.json.sig')
  await writeFile(sigPath, signature.toString('base64'))

  process.stdout.write(`\n  ${pc.green('✓')} wrote ${sigPath}\n\n`)
}

/**
 * Rewrites `dist/latest.json` with a `keyId` field and returns its new raw
 * bytes, or returns the manifest's bytes unchanged if `.murasaki/update-key.pub`
 * doesn't exist or isn't a valid 32-byte key. See `signManifest`'s doc comment.
 */
async function injectKeyIdIfAvailable(cwd: string, manifestPath: string): Promise<Buffer> {
  const original = await readFile(manifestPath)
  const pubKeyPath = resolve(cwd, '.murasaki/update-key.pub')
  if (!existsSync(pubKeyPath)) return original

  const pubB64 = (await readFile(pubKeyPath, 'utf8')).trim()
  const pubRaw = Buffer.from(pubB64, 'base64')
  if (pubRaw.length !== 32) return original

  const keyId = createHash('sha256').update(pubRaw).digest('hex').slice(0, 16)
  const parsed = JSON.parse(original.toString('utf8'))
  parsed.keyId = keyId
  const updated = Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`)
  await writeFile(manifestPath, updated)
  return updated
}

async function resolvePrivateKey(cwd: string): Promise<string> {
  if (process.env.MURASAKI_UPDATE_KEY) return process.env.MURASAKI_UPDATE_KEY.trim()
  const keyPath = resolve(cwd, '.murasaki/update-key')
  if (existsSync(keyPath)) return (await readFile(keyPath, 'utf8')).trim()
  process.stderr.write(
    `\n  ${pc.red('✗')} no update key found — set $MURASAKI_UPDATE_KEY or run \`murasaki release --keygen\`\n\n`,
  )
  process.exit(1)
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
