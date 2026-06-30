// .AppImage builder — fully cross-platform when mksquashfs is on PATH.
//
// AppImage anatomy: it's just an ELF runtime concatenated with a
// squashfs filesystem holding the AppDir. We assemble both halves
// ourselves so a Mac or Linux host can produce a Linux .AppImage.
//
// Host setup:
//   macOS:  brew install squashfs
//   Linux:  apt install squashfs-tools  (or dnf install squashfs-tools)
//
// If mksquashfs isn't on PATH, makeAppImage returns null and the
// caller falls back to .tar.gz.

import { spawn, spawnSync } from 'node:child_process'
import {
  appendFileSync,
  chmodSync,
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

export function detectMksquashfs(): boolean {
  try {
    const r = spawnSync('mksquashfs', ['-version'], { encoding: 'utf8' })
    return r.status === 0 || /squashfs/i.test(`${r.stdout ?? ''}${r.stderr ?? ''}`)
  } catch {
    return false
  }
}

export type AppImageOpts = {
  distDir: string
  folderPath: string
  appName: string
  displayName: string
  version: string
  arch: 'x64' | 'arm64'
  iconPath?: string
}

/**
 * Build a Linux .AppImage from the packaged folder. Returns the
 * absolute path of the .AppImage, or null if mksquashfs isn't available.
 */
export async function makeAppImage(opts: AppImageOpts): Promise<string | null> {
  if (!detectMksquashfs()) return null

  const appDir = join(opts.distDir, `${opts.appName}.AppDir`)
  const appImagePath = join(
    opts.distDir,
    `${opts.appName}-${opts.version}-${opts.arch === 'arm64' ? 'aarch64' : 'x86_64'}.AppImage`,
  )

  // 1. Build the AppDir layout.
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(join(appDir, 'usr/bin'), { recursive: true })

  // Copy the packaged folder contents under usr/lib/<app>/.
  const usrLibApp = join(appDir, 'usr/lib', opts.appName)
  mkdirSync(usrLibApp, { recursive: true })
  cpSync(opts.folderPath, usrLibApp, { recursive: true, dereference: true })

  // AppRun: the entry point AppImage exec's at launch.
  const appRun = `#!/bin/bash
HERE="$(dirname "$(readlink -f "$0")")"
exec "$HERE/usr/lib/${opts.appName}/node" "$HERE/usr/lib/${opts.appName}/server.cjs" "$@"
`
  writeFileSync(join(appDir, 'AppRun'), appRun)
  chmodSync(join(appDir, 'AppRun'), 0o755)

  // .desktop file (required by AppImage spec).
  writeFileSync(
    join(appDir, `${opts.appName}.desktop`),
    `[Desktop Entry]
Type=Application
Name=${opts.displayName}
Exec=${opts.appName}
Icon=${opts.appName}
Categories=Utility;
Terminal=false
`,
  )

  // Icon (1024x1024 PNG by convention; we don't resize, just copy).
  const iconDst = join(appDir, `${opts.appName}.png`)
  if (opts.iconPath && existsSync(opts.iconPath)) {
    cpSync(opts.iconPath, iconDst)
  } else {
    // Tiny 1x1 transparent PNG placeholder so squashfs has something.
    writeFileSync(iconDst, transparentPngBytes())
  }

  // 2. Download (and cache) the AppImage runtime for the target arch.
  const runtimePath = await ensureAppImageRuntime(opts.arch)

  // 3. squashfs the AppDir.
  const squashfsPath = join(tmpdir(), `${opts.appName}.squashfs`)
  try {
    rmSync(squashfsPath, { force: true })
  } catch {}
  const r = spawnSync(
    'mksquashfs',
    [appDir, squashfsPath, '-root-owned', '-noappend', '-comp', 'zstd', '-Xcompression-level', '19'],
    { stdio: 'inherit' },
  )
  if (r.status !== 0) {
    // zstd may be unsupported on older squashfs-tools; retry with default.
    const r2 = spawnSync('mksquashfs', [appDir, squashfsPath, '-root-owned', '-noappend'], {
      stdio: 'inherit',
    })
    if (r2.status !== 0) throw new Error(`mksquashfs exited with ${r2.status}`)
  }

  // 4. Concat runtime + squashfs → .AppImage, chmod +x.
  try {
    rmSync(appImagePath, { force: true })
  } catch {}
  writeFileSync(appImagePath, readFileSync(runtimePath))
  appendFileSync(appImagePath, readFileSync(squashfsPath))
  chmodSync(appImagePath, 0o755)

  // 5. AppDir was a build artifact; remove it.
  try {
    rmSync(appDir, { recursive: true, force: true })
  } catch {}

  return appImagePath
}

// ── AppImage runtime cache ─────────────────────────────────────────
async function ensureAppImageRuntime(arch: 'x64' | 'arm64'): Promise<string> {
  const archName = arch === 'arm64' ? 'aarch64' : 'x86_64'
  const cacheDir = join(homedir(), '.murasaki', 'cache', 'appimage')
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true })
  const runtimePath = join(cacheDir, `runtime-${archName}`)
  if (existsSync(runtimePath)) return runtimePath

  const url = `https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-${archName}`
  await fetchToFile(url, runtimePath)
  return runtimePath
}

function fetchToFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fetch(url)
      .then(async (res) => {
        if (!res.ok || !res.body) {
          reject(new Error(`fetch ${url}: ${res.status}`))
          return
        }
        const arr = new Uint8Array(await res.arrayBuffer())
        const stream = createWriteStream(dest)
        stream.on('error', reject)
        stream.on('finish', () => resolve())
        stream.end(arr)
      })
      .catch(reject)
  })
}

// ── tiny placeholder icon ──────────────────────────────────────────
function transparentPngBytes(): Buffer {
  // 1x1 fully transparent PNG (≈ 70 bytes).
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYGD4DwABBAEAfbLI3wAAAABJRU5ErkJggg==',
    'base64',
  )
}

// Unused export — kept so build.ts can spawn helpers later if needed.
void spawn
