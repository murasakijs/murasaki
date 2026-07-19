import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { resolveLauncherBinary, workspaceLauncherNeedsRebuild } from '../dist/cli/bundle.js'

test('workspace launcher freshness follows Rust sources but ignores published prebuild packages', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-native-freshness-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const launcher = join(root, 'target/release/murasaki-launcher')
  const source = join(root, 'src/capability_policy.rs')
  await mkdir(join(root, 'target/release'), { recursive: true })
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'Cargo.toml'), '[package]\nname="fixture"\nversion="0.0.0"\n')
  await writeFile(source, 'const KNOWN: &[&str] = &["dialog:message"];\n')
  await writeFile(launcher, 'old launcher')

  const old = new Date('2026-01-01T00:00:00Z')
  const current = new Date('2026-01-02T00:00:00Z')
  await utimes(launcher, old, old)
  await utimes(join(root, 'Cargo.toml'), old, old)
  await utimes(join(root, 'src'), old, old)
  await utimes(source, current, current)
  assert.equal(await workspaceLauncherNeedsRebuild(root, launcher), true)

  await utimes(launcher, new Date('2026-01-03T00:00:00Z'), new Date('2026-01-03T00:00:00Z'))
  assert.equal(await workspaceLauncherNeedsRebuild(root, launcher), false)

  const published = join(root, 'published')
  await mkdir(published)
  assert.equal(
    await workspaceLauncherNeedsRebuild(published, join(published, 'murasaki-launcher.darwin-arm64')),
    false,
  )
})

test('cross-bundling refuses a stale workspace prebuild instead of packaging an incompatible host', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-native-cross-freshness-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'Cargo.toml'), '[package]\nname="fixture"\nversion="0.0.0"\n')
  await writeFile(join(root, 'src/capability_policy.rs'), 'const NEW_CAPABILITY: &str = "dialog:message";\n')

  const platform = process.platform === 'win32' ? 'linux' : 'win32'
  const filename = platform === 'win32'
    ? 'murasaki-launcher.win32-x64-msvc.exe'
    : 'murasaki-launcher.linux-x64-gnu'
  const launcher = join(root, filename)
  await writeFile(launcher, 'stale prebuild')
  const old = new Date('2026-01-01T00:00:00Z')
  const current = new Date('2026-01-02T00:00:00Z')
  await utimes(launcher, old, old)
  await utimes(join(root, 'src/capability_policy.rs'), current, current)

  await assert.rejects(
    resolveLauncherBinary(root, platform, 'x64'),
    /older than the workspace Rust sources.*will not package a capability-incompatible launcher/s,
  )
})
