import { resolve } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import pc from 'picocolors'

/**
 * `murasaki icon assets/logo.png` → dist/icons/{icon.icns, icon.ico, icon.png set}
 * macOS: sips + iconutil. Windows/Linux: image crate helper (Phase A.9).
 */
export default async function icon(argv: string[]) {
  const src = argv[0]
  if (!src || !existsSync(src)) {
    process.stderr.write(
      `\n  ${pc.red('✗')} usage: murasaki icon <path-to-1024.png>\n\n`,
    )
    process.exit(1)
  }
  const cwd = process.cwd()
  const out = resolve(cwd, 'dist/icons')
  mkdirSync(out, { recursive: true })

  if (process.platform === 'darwin') {
    const sizes = [16, 32, 64, 128, 256, 512, 1024]
    const iset = resolve(out, 'icon.iconset')
    mkdirSync(iset, { recursive: true })
    for (const s of sizes) {
      spawnSync(
        'sips',
        ['-z', String(s), String(s), src, '--out', resolve(iset, `icon_${s}x${s}.png`)],
        { stdio: 'inherit' },
      )
    }
    spawnSync('iconutil', ['-c', 'icns', iset, '-o', resolve(out, 'icon.icns')], {
      stdio: 'inherit',
    })
    process.stdout.write(
      `\n  ${pc.green('✓')} dist/icons/icon.icns written\n\n`,
    )
  } else {
    process.stdout.write(
      `\n  ${pc.yellow('!')} PNG-only mode on ${process.platform}. Windows .ico / Linux set land in Phase A.9.\n\n`,
    )
  }
}
