import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { MurasakiConfig } from '../config.js'
import { dim, success, warn } from './brand.js'

/**
 * Linux code-signing: detached, armored GPG signatures for the `.AppImage`
 * (bundle.ts's `bundleLinux`) and the `.deb` (installer.ts's
 * `installerLinux`), plus a `SHA256SUMS`/`SHA256SUMS.sig` covering both.
 * Murasaki ships no key — signing only runs once the app developer supplies
 * their own (config.sign.linux.gpgKey / $MURASAKI_GPG_KEY, resolved into an
 * imported GPG secret key on the build host or CI runner).
 *
 * A detached `<artifact>.sig` (`gpg --detach-sign --armor`) is the baseline
 * and the only thing `--sign` actually guarantees: it needs no
 * dpkg-sig/debsigs/appimagetool on the build host, cross-builds from any OS
 * with `gpg` installed, and is verified the same way upstream distributions
 * publish detached release signatures (`gpg --verify <artifact>.sig
 * <artifact>`). `embedDebSignatureIfAvailable` additionally embeds a
 * Debian-native signature into the `.deb` itself via `dpkg-sig --sign
 * builder` when that tool happens to be on PATH — purely opportunistic, its
 * failure never fails the build, and (important for callers) it MUST run
 * before `signLinuxArtifact` produces the detached `.sig`: `dpkg-sig --sign`
 * mutates the `.deb` in place (ar-appends a `_gpgbuilder` member), so
 * detach-signing first would leave `.sig` covering bytes the file no longer
 * has by the time dpkg-sig is done with it.
 *
 * The passphrase (if the imported key has one) is read only from
 * `$MURASAKI_GPG_PASSPHRASE` and piped to `gpg --passphrase-fd 0` — never
 * accepted through config or a file path in config. When that variable is
 * unset, `gpg` falls through to gpg-agent (an interactive pinentry prompt
 * locally, or a CI runner's own agent/loopback-pinentry setup) — see the
 * README "Signing & distribution" section.
 */

export interface ResolvedLinuxSigningOptions {
  /** `gpg --local-user` selector: key id, fingerprint, or email. */
  gpgKey: string
  /** Piped to `gpg --passphrase-fd 0`; undefined relies on gpg-agent. */
  passphrase?: string
}

/**
 * Resolves the GPG signing identity: `$MURASAKI_GPG_KEY` overrides
 * `config.sign.linux.gpgKey`. Throws an actionable error if `--sign` is
 * requested but neither resolves — Linux signing has no "let the tool pick
 * one" fallback the way Windows SignTool does (`/a`), because an unattended
 * `gpg --local-user` selector is required either way.
 */
export function resolveLinuxSigningOptions(
  config: MurasakiConfig,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedLinuxSigningOptions {
  const gpgKey = optionalString(env.MURASAKI_GPG_KEY) ?? optionalString(config.sign?.linux?.gpgKey)
  if (!gpgKey) {
    throw new Error(
      'murasaki: --sign requires a GPG signing key for Linux artifacts. Set $MURASAKI_GPG_KEY ' +
        '(a key id, fingerprint, or email already imported into this host\'s GPG keyring) or ' +
        'config.sign.linux.gpgKey — run `gpg --list-secret-keys` to see keys available here.',
    )
  }
  return { gpgKey, passphrase: env.MURASAKI_GPG_PASSPHRASE }
}

/** Build the exact `gpg --detach-sign` arguments. Exported for regression tests. */
export function gpgDetachSignArgs(
  artifactPath: string,
  sigPath: string,
  options: ResolvedLinuxSigningOptions,
): string[] {
  const args = ['--batch', '--yes']
  if (options.passphrase !== undefined) args.push('--pinentry-mode', 'loopback', '--passphrase-fd', '0')
  args.push('--local-user', options.gpgKey, '--detach-sign', '--armor', '--output', sigPath, artifactPath)
  return args
}

/** Build `gpg --verify` arguments for a detached signature. */
export function gpgVerifyArgs(sigPath: string, artifactPath: string): string[] {
  return ['--verify', sigPath, artifactPath]
}

/** Whether `gpg` (GnuPG) is on PATH. */
export function detectGpg(env: NodeJS.ProcessEnv = process.env): boolean {
  const result = spawnSync('gpg', ['--version'], { encoding: 'utf8', env })
  return !result.error && result.status === 0
}

/**
 * Detach-signs `artifactPath` (the `.AppImage`, the `.deb`, or `SHA256SUMS`)
 * into `<artifactPath>.sig`, then independently verifies the signature it
 * just produced — mirrors `signWindowsArtifact`'s sign-then-verify shape.
 * Returns the `.sig` path.
 */
export function signLinuxArtifact(
  artifactPath: string,
  config: MurasakiConfig,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (!existsSync(artifactPath)) {
    throw new Error(`murasaki: cannot sign missing Linux artifact: ${artifactPath}`)
  }
  // Resolve the signing identity before checking for `gpg` itself — a
  // missing/misconfigured key is a config problem the caller can fix from
  // this error alone, whereas a missing `gpg` is a host/environment problem;
  // surfacing the identity error first keeps it host-independent (testable
  // without gpg installed) and doesn't bury it behind a tooling error.
  const options = resolveLinuxSigningOptions(config, env)
  if (!detectGpg(env)) {
    throw new Error(
      'murasaki: gpg not found on PATH — required for --sign on Linux. Install GnuPG ' +
        '(`apt install gnupg` on Debian/Ubuntu, `brew install gnupg` on macOS).',
    )
  }

  const sigPath = `${artifactPath}.sig`
  const signed = spawnSync('gpg', gpgDetachSignArgs(artifactPath, sigPath, options), {
    encoding: 'utf8',
    input: options.passphrase !== undefined ? `${options.passphrase}\n` : undefined,
    env,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (signed.error || signed.status !== 0) {
    throw new Error(
      `murasaki: gpg signing failed for ${artifactPath}:\n${sanitizeOutput(
        signed.stderr || signed.stdout || signed.error?.message || '',
        options.passphrase,
      )}`,
    )
  }

  const verified = spawnSync('gpg', gpgVerifyArgs(sigPath, artifactPath), {
    encoding: 'utf8',
    env,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (verified.error || verified.status !== 0) {
    throw new Error(
      `murasaki: GPG signature verification failed for ${artifactPath}:\n${sanitizeOutput(
        verified.stderr || verified.stdout || verified.error?.message || '',
        options.passphrase,
      )}`,
    )
  }

  process.stdout.write(`\n${success(`signed and verified  ${dim(sigPath)}`)}\n`)
  return sigPath
}

/** Whether `dpkg-sig` is on PATH. */
export function detectDpkgSig(env: NodeJS.ProcessEnv = process.env): boolean {
  const result = spawnSync('dpkg-sig', ['--help'], { encoding: 'utf8', env })
  return !result.error
}

/**
 * Opportunistically embeds a Debian-native signature into `debPath` via
 * `dpkg-sig --sign builder` (adds a `_gpgbuilder` ar member covering the
 * package's other members) — attempted only when `dpkg-sig` is on PATH, and
 * never a hard requirement: the caller must still run `signLinuxArtifact`
 * (the detached `.sig`, `--sign`'s real guarantee) AFTER this, not before —
 * `dpkg-sig --sign` mutates `debPath` in place, so detach-signing first would
 * produce a `.sig` for bytes the `.deb` no longer has once dpkg-sig is done.
 * Any failure here — tool present but the invocation didn't work, e.g. no
 * loopback-pinentry/agent access for an unattended passphrase — degrades to a
 * warning, never a thrown error.
 */
export function embedDebSignatureIfAvailable(
  debPath: string,
  options: ResolvedLinuxSigningOptions,
  env: NodeJS.ProcessEnv = process.env,
): 'dpkg-sig' | 'none' {
  if (!detectDpkgSig(env)) return 'none'

  const result = spawnSync('dpkg-sig', ['--sign', 'builder', '-k', options.gpgKey, debPath], {
    encoding: 'utf8',
    input: options.passphrase !== undefined ? `${options.passphrase}\n` : undefined,
    env,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    process.stdout.write(
      `\n${warn(`installer: dpkg-sig embedding failed — the detached ${basename(debPath)}.sig remains the verifiable signature:`)}\n` +
        `${dim(sanitizeOutput(result.stderr || result.stdout || result.error?.message || '', options.passphrase))}\n`,
    )
    return 'none'
  }
  return 'dpkg-sig'
}

/**
 * Writes a `sha256sum`-compatible `SHA256SUMS` file (`<hex>  <relPath>` per
 * line, two-space binary-mode separator) at `sumsPath` for `entries` — the
 * same convention `sample-release.yml`'s `sha256sum -- * > SHA256SUMS` step
 * produces, so `sha256sum --check SHA256SUMS` (run from `sumsPath`'s parent
 * directory) verifies it unmodified.
 */
export async function writeSha256Sums(
  sumsPath: string,
  entries: { relPath: string; absPath: string }[],
): Promise<void> {
  const lines: string[] = []
  for (const entry of entries) {
    const digest = createHash('sha256').update(await readFile(entry.absPath)).digest('hex')
    lines.push(`${digest}  ${entry.relPath}`)
  }
  await writeFile(sumsPath, lines.length > 0 ? `${lines.join('\n')}\n` : '')
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function sanitizeOutput(output: string, secret: string | undefined): string {
  const trimmed = output.trim()
  return secret ? trimmed.split(secret).join('[redacted]') : trimmed
}
