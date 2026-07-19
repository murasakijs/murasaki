import { resolve } from 'node:path'
import { mkdirSync } from 'node:fs'
import pc from 'picocolors'
import { buildMacIconResources } from './bundle.js'

/**
 * `murasaki icon assets/logo.png` → dist/icons/{icon.icns, icon.ico, icon.png set}
 * macOS: sips + iconutil. Windows/Linux: image crate helper (Phase A.9).
 */
export default async function icon(argv: string[]) {
  const src = argv[0]
  if (!src) {
    process.stderr.write(
      `\n  ${pc.red('✗')} usage: murasaki icon <path-to-1024.png>\n\n`,
    )
    process.exit(1)
  }
  const cwd = process.cwd()
  const out = resolve(cwd, 'dist/icons')
  mkdirSync(out, { recursive: true })

  if (process.platform === 'darwin') {
    const result = await buildMacIconResources(cwd, src, out)
    if (!result) process.exit(1)
    process.stdout.write(
      `\n  ${pc.green('✓')} dist/icons/${result.usesSystemMask ? 'Assets.car + icon.icns' : 'icon.icns'} written\n\n`,
    )
  } else {
    process.stdout.write(
      `\n  ${pc.yellow('!')} PNG-only mode on ${process.platform}. Windows .ico / Linux set land in Phase A.9.\n\n`,
    )
  }
}
