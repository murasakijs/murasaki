import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { readArArchive, readUstarTar, writeArArchive, writeUstarTar } from '../dist/cli/deb.js'
import { debControlFile, debMd5sumsFile, sanitizeDebName } from '../dist/cli/installer.js'

async function withTempDir(t) {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-linux-deb-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

// `murasaki installer --sign --target linux-*` used to hard-refuse
// unconditionally (see git history). `--sign` is now implemented as GPG
// detach-signing of both the .AppImage and this .deb (see linux-signing.ts) —
// `installerLinux` needs a real bundled AppDir to build a `.deb` from, so its
// signing step isn't re-exercised against a bare fixture here; see
// linux-signing.test.mjs for the sign-command construction / key-selection
// precedence / config validation coverage, and CI's `linux-sign-smoke` job
// (.github/workflows/app-package-linux.yml) plus this feature's Docker
// verification for the real end-to-end .deb signing + gpg --verify path.

// ── sanitizeDebName ─────────────────────────────────────────────────────

test('sanitizeDebName produces a lowercase Debian-policy-safe package name', () => {
  assert.equal(sanitizeDebName('My Cool App'), 'my-cool-app')
  assert.equal(sanitizeDebName('Notes_&_Things!'), 'notes-things-')
    // stripped of a leading separator, not just lowercased
  assert.equal(sanitizeDebName('...Weird'), 'weird')
  assert.equal(sanitizeDebName('🦋🦋🦋'), 'murasaki-app')
})

// ── control file / md5sums ──────────────────────────────────────────────

test('debControlFile emits the required Debian control fields', () => {
  const control = debControlFile({
    debName: 'notes-app',
    version: '1.2.3',
    debArch: 'amd64',
    maintainer: 'Ada Lovelace',
    description: 'A notes app',
  })
  assert.match(control, /^Package: notes-app\n/)
  assert.match(control, /\nVersion: 1\.2\.3\n/)
  assert.match(control, /\nArchitecture: amd64\n/)
  assert.match(control, /\nMaintainer: Ada Lovelace\n/)
  assert.match(control, /\nDescription: A notes app\n/)
  assert.match(control, /\nSection: utils\n/)
  assert.match(control, /\nPriority: optional\n/)
})

test('debMd5sumsFile hashes only regular files, keyed by path without the leading "./"', () => {
  const data = Buffer.from('hello world')
  const entries = [
    { path: './usr', type: 'directory', mode: 0o755 },
    { path: './usr/bin', type: 'directory', mode: 0o755 },
    { path: './usr/bin/app', type: 'file', mode: 0o755, data },
  ]
  const md5sums = debMd5sumsFile(entries)
  const expectedHash = createHash('md5').update(data).digest('hex')
  assert.equal(md5sums, `${expectedHash}  usr/bin/app\n`)
})

// ── ar archive codec ─────────────────────────────────────────────────────

test('writeArArchive/readArArchive round-trip debian-binary/control.tar.gz/data.tar.gz', () => {
  const entries = [
    { name: 'debian-binary', data: Buffer.from('2.0\n', 'ascii') },
    { name: 'control.tar.gz', data: Buffer.from('control-fixture-odd', 'ascii') }, // odd length on purpose
    { name: 'data.tar.gz', data: Buffer.from('data-fixture', 'ascii') },
  ]
  const archive = writeArArchive(entries)
  assert.equal(archive.subarray(0, 8).toString('ascii'), '!<arch>\n')

  const roundTripped = readArArchive(archive)
  assert.deepEqual(roundTripped.map((e) => e.name), ['debian-binary', 'control.tar.gz', 'data.tar.gz'])
  for (let i = 0; i < entries.length; i++) {
    assert.deepEqual(roundTripped[i].data, entries[i].data)
  }
})

test('writeArArchive rejects an entry name over 16 bytes', () => {
  assert.throws(
    () => writeArArchive([{ name: 'this-name-is-way-too-long', data: Buffer.alloc(0) }]),
    /too long/,
  )
})

// ── ustar tar codec ──────────────────────────────────────────────────────

test('writeUstarTar/readUstarTar round-trip files and directories with the right modes', () => {
  const entries = [
    { path: '.', type: 'directory', mode: 0o755 },
    { path: './usr', type: 'directory', mode: 0o755 },
    { path: './usr/bin', type: 'directory', mode: 0o755 },
    { path: './usr/bin/app', type: 'file', mode: 0o755, data: Buffer.from('#!/bin/sh\necho hi\n') },
    { path: './usr/share/doc/app/README', type: 'file', mode: 0o644, data: Buffer.from('readme') },
  ]
  const tar = writeUstarTar(entries)
  assert.equal(tar.length % 512, 0)

  const roundTripped = readUstarTar(tar)
  assert.equal(roundTripped.length, entries.length)
  for (let i = 0; i < entries.length; i++) {
    assert.equal(roundTripped[i].path, entries[i].path)
    assert.equal(roundTripped[i].type, entries[i].type)
    assert.equal(roundTripped[i].mode, entries[i].mode)
    if (entries[i].type === 'file') assert.deepEqual(roundTripped[i].data, entries[i].data)
  }
})

test('ustar splits a long path across the name/prefix fields and reassembles it on read', () => {
  const longDir = 'a'.repeat(120)
  const path = `./usr/lib/${longDir}/resources/very/deeply/nested/file.txt`
  const data = Buffer.from('deep fixture')
  const tar = writeUstarTar([{ path, type: 'file', mode: 0o644, data }])
  const [entry] = readUstarTar(tar)
  assert.equal(entry.path, path)
  assert.deepEqual(entry.data, data)
})

test('ustar throws a clear error for a path with no valid split point', () => {
  const unsplittable = `./${'a'.repeat(300)}`
  assert.throws(
    () => writeUstarTar([{ path: unsplittable, type: 'file', mode: 0o644, data: Buffer.alloc(1) }]),
    /too long for the ustar tar format/,
  )
})

// ── Full .deb structure round-trip (extract with Node; opportunistically
//    cross-check with the host's own `ar`/`dpkg-deb` if installed) ─────────

test('a full ar(debian-binary + control.tar.gz + data.tar.gz) round-trips end-to-end', async (t) => {
  const dataEntries = [
    { path: './usr', type: 'directory', mode: 0o755 },
    { path: './usr/bin', type: 'directory', mode: 0o755 },
    { path: './usr/bin/notes-app', type: 'file', mode: 0o755, data: Buffer.from('fixture-launcher') },
    { path: './usr/share/applications', type: 'directory', mode: 0o755 },
    {
      path: './usr/share/applications/com.example.notes.desktop',
      type: 'file',
      mode: 0o644,
      data: Buffer.from('[Desktop Entry]\nName=Notes\n'),
    },
  ]
  const dataTarGz = gzipSync(writeUstarTar(dataEntries))

  const control = debControlFile({
    debName: 'notes-app',
    version: '1.0.0',
    debArch: 'amd64',
    maintainer: 'dev.test.notes',
    description: 'Notes desktop application',
  })
  const md5sums = debMd5sumsFile(dataEntries)
  const controlEntries = [
    { path: '.', type: 'directory', mode: 0o755 },
    { path: './control', type: 'file', mode: 0o644, data: Buffer.from(control, 'utf8') },
    { path: './md5sums', type: 'file', mode: 0o644, data: Buffer.from(md5sums, 'utf8') },
    { path: './postinst', type: 'file', mode: 0o755, data: Buffer.from('#!/bin/sh\nexit 0\n') },
    { path: './postrm', type: 'file', mode: 0o755, data: Buffer.from('#!/bin/sh\nexit 0\n') },
  ]
  const controlTarGz = gzipSync(writeUstarTar(controlEntries))

  const deb = writeArArchive([
    { name: 'debian-binary', data: Buffer.from('2.0\n', 'ascii') },
    { name: 'control.tar.gz', data: controlTarGz },
    { name: 'data.tar.gz', data: dataTarGz },
  ])

  // 1. Extract with Node (this module's own reader) — the primary check.
  const members = readArArchive(deb)
  assert.deepEqual(members.map((m) => m.name), ['debian-binary', 'control.tar.gz', 'data.tar.gz'])
  assert.equal(members[0].data.toString('ascii'), '2.0\n')

  const extractedControlTar = readUstarTar(gunzipSync(members[1].data))
  const controlFile = extractedControlTar.find((e) => e.path === './control')
  assert.ok(controlFile)
  assert.match(controlFile.data.toString('utf8'), /^Package: notes-app\n/)
  const md5File = extractedControlTar.find((e) => e.path === './md5sums')
  assert.match(md5File.data.toString('utf8'), /usr\/bin\/notes-app\n/)
  const postinst = extractedControlTar.find((e) => e.path === './postinst')
  assert.equal(postinst.mode, 0o755)

  const extractedDataTar = readUstarTar(gunzipSync(members[2].data))
  const launcher = extractedDataTar.find((e) => e.path === './usr/bin/notes-app')
  assert.ok(launcher)
  assert.equal(launcher.mode, 0o755)
  assert.equal(launcher.data.toString('utf8'), 'fixture-launcher')
  const desktopEntry = extractedDataTar.find(
    (e) => e.path === './usr/share/applications/com.example.notes.desktop',
  )
  assert.match(desktopEntry.data.toString('utf8'), /Name=Notes/)

  // 2. Opportunistic cross-check with the host's real `ar`/`tar`/`dpkg-deb`,
  //    if installed — skipped gracefully when absent.
  const root = await withTempDir(t)
  const debPath = join(root, 'notes-app_1.0.0_amd64.deb')
  await writeFile(debPath, deb)

  const arList = spawnSync('ar', ['t', debPath], { encoding: 'utf8' })
  if (!arList.error && arList.status === 0) {
    assert.deepEqual(
      arList.stdout.trim().split('\n'),
      ['debian-binary', 'control.tar.gz', 'data.tar.gz'],
    )
  } else {
    t.diagnostic('`ar` is not available on this host — skipped the opportunistic ar-listing cross-check')
  }

  const dpkgDeb = spawnSync('dpkg-deb', ['--info', debPath], { encoding: 'utf8' })
  if (!dpkgDeb.error && dpkgDeb.status === 0) {
    assert.match(dpkgDeb.stdout, /Package: notes-app/)
  } else {
    t.diagnostic('`dpkg-deb` is not available on this host — skipped the opportunistic dpkg-deb cross-check')
  }
})
