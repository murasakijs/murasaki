/**
 * Rewrites pnpm `workspace:` dependency specs to the real versions they resolve
 * to, then fails if any survive. Run in CI right before `npm publish`.
 *
 * `pnpm publish` does this itself; `npm publish` does not. release.yml publishes
 * with npm (for OIDC provenance), so without this every `workspace:` spec would
 * ship verbatim — `"@murasakijs/ui": "workspace:^"` is not a version anyone can
 * install, so the package would be broken for every consumer.
 *
 * The mutation is CI-only. The committed manifests keep their `workspace:` specs
 * so the monorepo's local links keep working.
 *
 * Every dependency field is rewritten, not just `dependencies`: npm installs
 * `optionalDependencies` and (since npm 7) `peerDependencies` too, so a
 * `workspace:` spec in either is just as broken. `devDependencies` are not
 * installed from a published package, but an un-resolvable spec has no business
 * in a published manifest either.
 *
 * The workspace operator is preserved rather than normalized to `^` — pnpm gives
 * each one a different meaning, and widening an exact pin into a caret range at
 * publish time would silently change what consumers get:
 *
 *   workspace:*      → 1.2.3     (exact pin)
 *   workspace:^      → ^1.2.3
 *   workspace:~      → ~1.2.3
 *   workspace:>=1.0  → >=1.0     (explicit range, passed through)
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** Workspace packages, by the manifest that carries their name + version. */
const WORKSPACE_MANIFESTS = [
  'packages/murasaki/package.json',
  'packages/create-murasaki/package.json',
  'packages/ui/package.json',
  'crates/native/package.json',
]

/** The manifests that actually get published — the ones that must not ship a `workspace:` spec. */
const PUBLISHED_MANIFESTS = [
  'packages/murasaki/package.json',
  'packages/create-murasaki/package.json',
  'packages/ui/package.json',
]

const DEP_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']

const read = (p) => JSON.parse(readFileSync(p, 'utf8'))

/** name → version, for every package the workspace can resolve a `workspace:` spec against. */
const versions = new Map(WORKSPACE_MANIFESTS.map((m) => [read(m).name, read(m).version]))

/** Applies pnpm's workspace-protocol semantics — see the module comment. */
function resolveSpec(spec, version) {
  const operator = spec.slice('workspace:'.length)
  if (operator === '*') return version
  if (operator === '^' || operator === '~') return operator + version
  // `workspace:<range>` — the range is already literal, just drop the protocol.
  return operator
}

let rewrote = 0

for (const manifestPath of PUBLISHED_MANIFESTS) {
  const pkg = read(manifestPath)
  let touched = false

  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (!String(spec).startsWith('workspace:')) continue

      const version = versions.get(name)
      if (!version) {
        console.error(
          `::error::${pkg.name} depends on ${name} via "${spec}", but ${name} isn't a known ` +
            `workspace package — add its manifest to WORKSPACE_MANIFESTS in this script.`,
        )
        process.exit(1)
      }

      const resolved = resolveSpec(String(spec), version)
      pkg[field][name] = resolved
      console.log(`${pkg.name} [${field}] ${name}: ${spec} → ${resolved}`)
      touched = true
      rewrote++
    }
  }

  if (touched) writeFileSync(manifestPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

// Guard. A `workspace:` spec that this script didn't know how to rewrite must
// never reach npm, so fail the release rather than publish something broken.
const survivors = []
for (const manifestPath of PUBLISHED_MANIFESTS) {
  const pkg = read(manifestPath)
  for (const field of DEP_FIELDS) {
    for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
      if (String(spec).startsWith('workspace:')) survivors.push(`${pkg.name} [${field}] ${name}`)
    }
  }
}

if (survivors.length > 0) {
  console.error(`::error::unresolved workspace specs would be published: ${survivors.join(', ')}`)
  process.exit(1)
}

console.log(
  rewrote === 0
    ? 'No workspace: specs to resolve.'
    : `Resolved ${rewrote} workspace: spec(s); none left in any published manifest.`,
)
