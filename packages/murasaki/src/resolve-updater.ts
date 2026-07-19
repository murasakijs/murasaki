/**
 * Node-only implementation of `resolveUpdater()` (contract §3). Does
 * filesystem/env I/O (reads `package.json`, `.murasaki/update-key.pub`) and
 * therefore must NEVER be imported from `index.ts`'s client-facing barrel —
 * only from build-time Node code (`cli/bundle.ts`, `vite-plugin/updater.ts`).
 *
 * This lives in its own module, separate from `config.ts`, so that
 * `config.ts` — which `index.ts` re-exports `defineConfig`/`UpdaterConfig`
 * from — stays free of `node:*` imports. `config.ts` is reachable from
 * browser bundles (anything importing `useUpdate`/`quit`/etc. from
 * `"murasaki"` pulls in `index.ts`'s whole barrel), and a bundler choking on
 * `node:fs` in a client chunk is a hard build failure, not a lint nit.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ResolvedUpdater, UpdaterConfig } from './config.js'

export type { ResolvedUpdater } from './config.js'

/**
 * Resolves a `UpdaterConfig` down to what the updater HTTP handler and
 * `murasaki-meta.json` actually need — see contract §3. Signature
 * verification is not optional: there is no config path that skips
 * resolving (and thus requiring) a public key.
 *
 * Resolution order:
 * 1. `updater` absent or `false` → `null` (updater disabled).
 * 2. `repo` and `endpoint` both set → throws.
 * 3. Neither set → read `repository` from `<projectRoot>/package.json`,
 *    normalizing the usual shapes ("owner/repo", "github:owner/repo",
 *    `{ url: "git+https://github.com/owner/repo.git" }`). Throws if nothing
 *    resolves.
 * 4. GitHub mode's `manifestUrl` is a `releases/latest/download/…` (default
 *    channel) or `releases/download/<channel>/…` (named channel) URL — a
 *    fixed GitHub Releases asset URL that always 302s to the newest matching
 *    release, so no GitHub API call, rate limit, or token is needed.
 * 5. `publicKey`: explicit config → `$MURASAKI_UPDATE_PUBLIC_KEY` →
 *    `<projectRoot>/.murasaki/update-key.pub`. Throws (with a `murasaki
 *    release --keygen` pointer) if none is found.
 */
export function resolveUpdater(
  updater: UpdaterConfig | undefined,
  ctx: { projectRoot: string },
): ResolvedUpdater | null {
  if (!updater) return null
  const opts = updater === true ? {} : updater

  if (opts.repo && opts.endpoint) {
    throw new Error(
      'murasaki: updater.repo and updater.endpoint are mutually exclusive — set only one.',
    )
  }

  const channel = opts.channel ?? 'stable'

  let manifestUrl: string
  if (opts.endpoint) {
    manifestUrl = opts.endpoint
  } else {
    // normalizeRepo also covers an explicit `repo` written as
    // "github:owner/repo" (or a URL) rather than bare "owner/repo" — falls
    // back to the raw value for anything it doesn't recognize, so an
    // already-correct explicit repo is never rejected.
    const repo =
      (opts.repo && normalizeRepo(opts.repo)) ||
      opts.repo ||
      normalizeRepo(readPackageRepository(ctx.projectRoot))
    if (!repo) {
      throw new Error(
        'murasaki: updater is enabled but no GitHub repo could be resolved — set updater.repo ' +
          '("owner/repo") or add a "repository" field to your package.json.',
      )
    }
    manifestUrl =
      channel === 'stable'
        ? `https://github.com/${repo}/releases/latest/download/latest.json`
        : `https://github.com/${repo}/releases/download/${channel}/latest.json`
  }

  const { publicKey, publicKeys } = resolvePublicKeys(opts, ctx.projectRoot)

  return {
    manifestUrl,
    publicKey,
    publicKeys,
    channel,
    checkOnStart: opts.checkOnStart ?? true,
    checkIntervalMs: parseCheckInterval(opts.checkInterval),
    maxManifestAgeDays: opts.maxManifestAgeDays ?? 90,
    allowLegacyManifestsWithoutGeneratedAt: opts.allowLegacyManifestsWithoutGeneratedAt ?? false,
  }
}

function readPackageRepository(projectRoot: string): unknown {
  try {
    const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
    return pkg.repository
  } catch {
    return undefined
  }
}

/**
 * Normalizes `package.json#repository` (or an explicit `updater.repo`) down
 * to `"owner/repo"`. Handles the bare shorthand, the `github:` shorthand,
 * and the `{ url }` object form (with or without a `git+`/`.git`
 * wrapper) — see contract §3.
 */
function normalizeRepo(repository: unknown): string | null {
  if (!repository) return null
  const raw =
    typeof repository === 'string'
      ? repository
      : typeof repository === 'object' && repository !== null && 'url' in repository
        ? String((repository as { url: unknown }).url)
        : null
  if (!raw) return null

  if (raw.startsWith('github:')) return raw.slice('github:'.length)

  // Bare "owner/repo" shorthand: no scheme/colon, exactly one slash.
  if (/^[^\s/:]+\/[^\s/]+$/.test(raw)) return raw

  // Any github.com URL (https://, git+https://, ssh git@github.com:, with or
  // without a trailing .git) — covers the `{ url: "git+https://…" }` form.
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(raw)
  return match ? `${match[1]}/${match[2]}` : null
}

function resolvePublicKey(explicit: string | undefined, projectRoot: string): string {
  if (explicit) return explicit
  if (process.env.MURASAKI_UPDATE_PUBLIC_KEY) return process.env.MURASAKI_UPDATE_PUBLIC_KEY
  const keyPath = join(projectRoot, '.murasaki/update-key.pub')
  if (existsSync(keyPath)) return readFileSync(keyPath, 'utf8').trim()
  throw new Error(
    'murasaki: updater is enabled but no public key was found. Run: murasaki release --keygen',
  )
}

/**
 * Resolves the full pinned key set for rotation (contract §3-ish — see the
 * auto-update guide's rotation runbook): `publicKey` (explicit config, env,
 * or `.murasaki/update-key.pub` — same resolution as before) unioned with
 * `publicKeys`, deduplicated. `publicKey` on the returned object stays the
 * single primary key for back-compat; `publicKeys` is the complete set the
 * runtime engine tries in order (hinted by the manifest's optional `keyId`).
 */
function resolvePublicKeys(
  opts: { publicKey?: string; publicKeys?: string[] },
  projectRoot: string,
): { publicKey: string; publicKeys: string[] } {
  const publicKey = resolvePublicKey(opts.publicKey, projectRoot)
  const seen = new Set<string>()
  const publicKeys: string[] = []
  for (const key of [publicKey, ...(opts.publicKeys ?? [])]) {
    const trimmed = key.trim()
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    publicKeys.push(trimmed)
  }
  return { publicKey, publicKeys }
}

/** `'30m' | '6h' | '1d'` → milliseconds. `false` passes through. Defaults to `'6h'`. */
function parseCheckInterval(value: string | false | undefined): number | false {
  if (value === false) return false
  const str = value ?? '6h'
  const match = /^(\d+)(m|h|d)$/.exec(str)
  if (!match) {
    throw new Error(
      `murasaki: updater.checkInterval must look like "30m", "6h", or "1d" (or false), got ${JSON.stringify(str)}`,
    )
  }
  const amount = Number(match[1])
  const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 'm' | 'h' | 'd']
  return amount * unitMs
}
