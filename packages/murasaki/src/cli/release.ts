import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import pc from 'picocolors'

/**
 * `murasaki release --generate-manifest --base-url URL --version X.Y.Z`
 *
 * Emits the JSON shape `useUpdate()` expects. Only the `custom` provider
 * needs this; the GitHub provider auto-derives from `gh release view`.
 */
export default async function release(argv: string[]) {
  if (!argv.includes('--generate-manifest')) {
    process.stdout.write(
      `\n  ${pc.yellow('!')} usage: murasaki release --generate-manifest --base-url <url> --version <v>\n\n`,
    )
    return
  }
  const baseUrl = flag(argv, '--base-url')
  const version = flag(argv, '--version')
  const notes = flag(argv, '--notes') ?? ''
  if (!baseUrl || !version) {
    process.stderr.write(`\n  ${pc.red('✗')} --base-url and --version are required\n\n`)
    process.exit(1)
  }
  const targets = [
    { key: 'darwin-arm64', file: `dist/${version}/darwin-arm64.dmg` },
    { key: 'darwin-x64', file: `dist/${version}/darwin-x64.dmg` },
    { key: 'win32-x64', file: `dist/${version}/win32-x64.msi` },
    { key: 'linux-x64', file: `dist/${version}/linux-x64.AppImage` },
  ]
  const assets: Record<string, { url: string; sha256: string }> = {}
  for (const t of targets) {
    try {
      const buf = await readFile(resolve(process.cwd(), t.file))
      assets[t.key] = {
        url: `${baseUrl.replace(/\/$/, '')}/${version}/${t.file.split('/').pop()}`,
        sha256: createHash('sha256').update(buf).digest('hex'),
      }
    } catch {
      // skip missing target — user may only ship for some platforms
    }
  }
  process.stdout.write(
    JSON.stringify(
      {
        version,
        releaseNotes: notes,
        publishedAt: new Date().toISOString(),
        mandatory: false,
        assets,
      },
      null,
      2,
    ) + '\n',
  )
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
