#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const directories = process.argv.slice(2)
if (!directories.length) throw new Error('pass one or more package directories')

function npmView(spec, field) {
  const result = spawnSync('npm', ['view', spec, field, '--json'], { encoding: 'utf8' })
  if (result.status !== 0) return null
  try { return JSON.parse(result.stdout) } catch { return result.stdout.trim() || null }
}

function compareStable(left, right) {
  const parse = (value) => {
    if (!/^\d+\.\d+\.\d+$/.test(value)) throw new Error(`only stable SemVer is accepted: ${value}`)
    return value.split('.').map(Number)
  }
  const a = parse(left); const b = parse(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}

for (const directory of directories) {
  const manifest = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
  const spec = `${manifest.name}@${manifest.version}`
  const publishedVersion = npmView(spec, 'version')
  if (publishedVersion) {
    const publishedGitHead = npmView(spec, 'gitHead')
    if (!publishedGitHead) throw new Error(`${spec} exists without a verifiable gitHead; bump its package version`)
    const diff = spawnSync('git', ['diff', '--quiet', String(publishedGitHead), 'HEAD', '--', directory])
    if (diff.status === 0) {
      process.stdout.write(`${spec} already exists and ${directory} is unchanged since its published gitHead\n`)
      continue
    }
    throw new Error(`${spec} already exists but ${directory} changed; bump its package version`)
  }
  const latest = npmView(`${manifest.name}@latest`, 'version')
  if (latest && compareStable(manifest.version, String(latest)) <= 0) {
    throw new Error(`${spec} must be newer than published latest ${latest}`)
  }
  process.stdout.write(`${spec} is an unpublished, increasing version\n`)
}
