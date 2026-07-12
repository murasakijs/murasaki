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
import { loadUserConfig } from './bundle.js'

/**
 * `murasaki release` — the auto-update publishing helpers (contract §9).
 * Three independent subcommands, dispatched by flag:
 *
 *   murasaki release --keygen
 *   murasaki release --manifest --base-url <url> --version <v> [--notes <md>] [--mandatory]
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
      `    murasaki release --manifest --base-url <url> --version <v> [--notes <md>] [--mandatory]\n` +
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
 * `.gitignore` if it isn't already covered). Prints the private key exactly
 * once, since after this it only lives in the gitignored file and (ideally)
 * a GitHub secret.
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
      `  ${pc.green('✓')} wrote ${privPath} (gitignored)\n\n` +
      `  Private key — save it now, this is the only time it is printed:\n\n` +
      `    ${privB64}\n\n` +
      `  Store it as the MURASAKI_UPDATE_KEY GitHub secret so CI can sign releases:\n` +
      `    gh secret set MURASAKI_UPDATE_KEY --body "${privB64}"\n` +
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
 * `dist/<productName>-<version>-setup.exe`), hashes whichever exist, and
 * writes `dist/latest.json`. Missing targets are skipped, not errors — an
 * app may only ship for some platforms; only zero payloads found is fatal.
 */
async function manifest(argv: string[], cwd: string): Promise<void> {
  const baseUrl = flag(argv, '--base-url')
  const version = flag(argv, '--version')
  const notes = flag(argv, '--notes') ?? ''
  const mandatory = argv.includes('--mandatory')
  if (!baseUrl || !version) {
    process.stderr.write(`\n  ${pc.red('✗')} --base-url and --version are required\n\n`)
    process.exit(1)
  }

  const config = await loadUserConfig(cwd)
  const productName = config.productName

  // The win32 NSIS installer's filename (installer.ts) doesn't currently
  // encode arch, so only win32-x64 is distinguishable here — matching
  // contract §5's payload table, which lists a single Windows row.
  const targets: Array<{ key: string; file: string }> = [
    { key: 'darwin-arm64', file: resolve(cwd, 'dist/bundle', `${productName}-darwin-arm64.app.zip`) },
    { key: 'darwin-x64', file: resolve(cwd, 'dist/bundle', `${productName}-darwin-x64.app.zip`) },
    { key: 'win32-x64', file: resolve(cwd, 'dist', `${productName}-${version}-setup.exe`) },
  ]

  const assets: Record<string, { url: string; sha256: string }> = {}
  for (const t of targets) {
    try {
      const buf = await readFile(t.file)
      assets[t.key] = {
        url: `${baseUrl.replace(/\/$/, '')}/${t.file.split(/[\\/]/).pop()}`,
        sha256: createHash('sha256').update(buf).digest('hex'),
      }
    } catch {
      // skip missing target — the app may only ship for some platforms
    }
  }

  if (Object.keys(assets).length === 0) {
    process.stderr.write(
      `\n  ${pc.red('✗')} no payloads found under dist/ — run \`murasaki bundle\`/\`murasaki installer\` first\n\n`,
    )
    process.exit(1)
  }

  const manifestObj = {
    version,
    publishedAt: new Date().toISOString(),
    notes,
    mandatory,
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

// ── --sign ──────────────────────────────────────────────────────────────

/**
 * Signs `dist/latest.json` → `dist/latest.json.sig`: base64 of a detached
 * Ed25519 signature over the manifest's exact raw bytes (contract §1 — never
 * re-serialized, so the client verifies the bytes as received before
 * `JSON.parse`ing them). Key from `$MURASAKI_UPDATE_KEY`, else
 * `.murasaki/update-key`.
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
  const data = await readFile(manifestPath)
  const signature = signEd25519(null, data, privateKey)

  const sigPath = resolve(cwd, 'dist/latest.json.sig')
  await writeFile(sigPath, signature.toString('base64'))

  process.stdout.write(`\n  ${pc.green('✓')} wrote ${sigPath}\n\n`)
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
