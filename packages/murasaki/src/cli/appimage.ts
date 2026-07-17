import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { dim } from './brand.js'

/**
 * `.AppImage` packaging — squashfs-compresses a just-assembled AppDir (see
 * bundle.ts's `bundleLinux`) and prepends the AppImage type-2 runtime,
 * producing a single self-mounting, executable file. Re-homed from the
 * pre-v1 `src/appimage.ts` (see PROTECTED.md) with the AppDir-building half
 * removed — bundle.ts now owns that (the resources layout must match the
 * macOS/win32 bundles exactly), leaving this module with just the
 * runtime-download + squashfs + concat mechanics.
 *
 * Host setup: `mksquashfs` must be on PATH.
 *   macOS:           brew install squashfs
 *   Debian/Ubuntu:   apt install squashfs-tools
 *   Fedora:           dnf install squashfs-tools
 */

export type LinuxArch = 'arm64' | 'x64'

/**
 * The AppImage/type2-runtime GitHub release murasaki pins its downloaded
 * runtime binaries against — a numbered, immutable release (unlike the
 * project's own "continuous" tag, which upstream periodically re-uploads to
 * in place, making it unsafe to pin a checksum against).
 * https://github.com/AppImage/type2-runtime/releases/tag/20251108
 */
const APPIMAGE_RUNTIME_RELEASE = '20251108'

/** SHA-256 of each arch's `runtime-<arch>` asset from the pinned release above — verified before the downloaded runtime is trusted (it becomes part of every produced, executable `.AppImage`). */
const APPIMAGE_RUNTIME_SHA256: Record<LinuxArch, string> = {
  x64: '2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d',
  arm64: '00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444',
}

function runtimeArchName(arch: LinuxArch): string {
  return arch === 'arm64' ? 'aarch64' : 'x86_64'
}

/** Whether `mksquashfs` (the `squashfs-tools` package) is on PATH. */
export function detectMksquashfs(): boolean {
  const result = spawnSync('mksquashfs', ['-version'], { encoding: 'utf8' })
  return (
    !result.error &&
    (result.status === 0 || /squashfs/i.test(`${result.stdout ?? ''}${result.stderr ?? ''}`))
  )
}

/**
 * Downloads (or returns the cached copy of) the official AppImage type-2
 * runtime ELF binary for `arch` — what `buildAppImage` prepends to the
 * squashfs filesystem image to produce a self-mounting `.AppImage`. Cached
 * at `~/.murasaki/appimage-runtime/<release>/<arch>/runtime`, a sibling of
 * node-runtime.ts's `~/.murasaki/node/` cache under the same `~/.murasaki`
 * cache root; a second call for the same release/arch returns the cached
 * path immediately with no network access. SHA-256-verified against the
 * pinned checksums above — this is an executable that gets shipped inside
 * every produced `.AppImage`.
 */
export async function ensureAppImageRuntime(arch: LinuxArch): Promise<string> {
  const archName = runtimeArchName(arch)
  const expectedSha256 = APPIMAGE_RUNTIME_SHA256[arch]
  const cacheDir = join(homedir(), '.murasaki', 'appimage-runtime', APPIMAGE_RUNTIME_RELEASE, archName)
  const cachedRuntime = join(cacheDir, 'runtime')
  if (existsSync(cachedRuntime)) return cachedRuntime

  const url = `https://github.com/AppImage/type2-runtime/releases/download/${APPIMAGE_RUNTIME_RELEASE}/runtime-${archName}`
  process.stdout.write(`${dim(`downloading AppImage runtime (${archName})…`)}\n`)

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`murasaki: failed to download ${url} (${res.status} ${res.statusText})`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  const actualSha256 = createHash('sha256').update(buf).digest('hex')
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `murasaki: checksum mismatch for AppImage runtime-${archName} — expected ${expectedSha256}, got ${actualSha256}`,
    )
  }

  await mkdir(cacheDir, { recursive: true })
  await writeFile(cachedRuntime, buf)
  await chmod(cachedRuntime, 0o755)
  return cachedRuntime
}

/**
 * Squashfs-compresses `appDir` and prepends the AppImage type-2 runtime (see
 * `ensureAppImageRuntime`) to produce a self-mounting `.AppImage` at
 * `appImagePath`, then chmod +x. Requires `mksquashfs` on PATH — throws an
 * actionable error naming the `squashfs-tools` package rather than silently
 * degrading (e.g. to a plain `.tar.gz`, what the pre-v1 version did): unlike
 * NSIS/WiX (optional installers alongside the always-produced win32 portable
 * folder/zip — see installer.ts), the `.AppImage` is bundle.ts's only Linux
 * packaged deliverable besides the raw AppDir, so silently skipping it would
 * leave `murasaki bundle --target linux-*` with no packaged output at all.
 */
export async function buildAppImage(
  appDir: string,
  appImagePath: string,
  arch: LinuxArch,
): Promise<void> {
  if (!detectMksquashfs()) {
    throw new Error(
      'murasaki: mksquashfs not found on PATH — required to build the .AppImage. Install the ' +
        '`squashfs-tools` package (`brew install squashfs` on macOS, `apt install squashfs-tools` ' +
        'on Debian/Ubuntu, `dnf install squashfs-tools` on Fedora).',
    )
  }

  const runtimePath = await ensureAppImageRuntime(arch)
  const workDir = await mkdtemp(join(tmpdir(), 'murasaki-appimage-'))
  try {
    const squashfsPath = join(workDir, 'filesystem.squashfs')
    let result = spawnSync(
      'mksquashfs',
      [appDir, squashfsPath, '-root-owned', '-noappend', '-comp', 'zstd', '-Xcompression-level', '19'],
      { encoding: 'utf8' },
    )
    if (result.status !== 0) {
      // zstd may be unsupported on older squashfs-tools builds; retry with the default compressor.
      result = spawnSync('mksquashfs', [appDir, squashfsPath, '-root-owned', '-noappend'], {
        encoding: 'utf8',
      })
      if (result.status !== 0) {
        throw new Error(`murasaki: mksquashfs failed:\n${(result.stderr || result.stdout || '').trim()}`)
      }
    }

    await rm(appImagePath, { force: true })
    await writeFile(appImagePath, await readFile(runtimePath))
    await appendFile(appImagePath, await readFile(squashfsPath))
    await chmod(appImagePath, 0o755)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}
