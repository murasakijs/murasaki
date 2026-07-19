#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

const args = process.argv.slice(2)
const requireCi = args.includes('--require-ci')
const positional = args.filter((arg) => arg !== '--require-ci')
const [tagPrefix, ...manifestPaths] = positional

if (!tagPrefix || manifestPaths.length === 0) {
  throw new Error('usage: verify-release-commit.mjs [--require-ci] <tag-prefix> <package.json>...')
}

const manifests = await Promise.all(manifestPaths.map(async (path) => ({
  path,
  value: JSON.parse(await readFile(path, 'utf8')),
})))
const version = manifests[0].value.version
if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error(`release version must be stable SemVer, got ${JSON.stringify(version)}`)
}
for (const manifest of manifests) {
  if (manifest.value.version !== version) {
    throw new Error(`${manifest.path} version ${manifest.value.version} does not match ${version}`)
  }
}

const expectedTag = `${tagPrefix}${version}`
if (process.env.GITHUB_REF_NAME !== expectedTag) {
  throw new Error(`release tag ${process.env.GITHUB_REF_NAME} does not match ${expectedTag}`)
}

execFileSync('git', ['fetch', '--no-tags', 'origin', 'main'], { stdio: 'inherit' })
try {
  execFileSync('git', ['merge-base', '--is-ancestor', process.env.GITHUB_SHA, 'origin/main'])
} catch {
  throw new Error('release tag must point to a commit contained in origin/main')
}

if (requireCi) await requireSuccessfulChecks()
process.stdout.write(`release commit verified: ${expectedTag}\n`)

async function requireSuccessfulChecks() {
  const repository = process.env.GITHUB_REPOSITORY
  const sha = process.env.GITHUB_SHA
  const token = process.env.GITHUB_TOKEN
  if (!repository || !sha || !token) {
    throw new Error('GITHUB_REPOSITORY, GITHUB_SHA, and GITHUB_TOKEN are required for --require-ci')
  }
  const required = [
    'Ubuntu / build, test, docs, scaffold',
    'Examples / typecheck, test, build, PostgreSQL',
    'Linux x64 / native release build, bundle smoke',
    'macOS arm64 / framework, native, bundle smoke',
    'Windows x64 / native and bundle smoke',
    'macOS arm64 / DMG, update, rollback gate',
    'macOS x64 / DMG, update, rollback gate',
    'Linux x64 / AppImage, update, .deb',
    'Linux arm64 / AppImage, update, .deb',
    'win-smoke (x64)',
    'win-smoke (arm64)',
    'cargo-deny / crates/native',
    'npm audit / workspace root',
    'CodeQL / javascript-typescript',
  ]
  const response = await fetch(
    `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?per_page=100`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'x-github-api-version': '2022-11-28',
      },
    },
  )
  if (!response.ok) throw new Error(`GitHub check-runs query failed: HTTP ${response.status}`)
  const payload = await response.json()
  const failures = required.flatMap((name) => {
    const runs = payload.check_runs.filter((run) => run.name === name)
    return runs.some((run) => run.status === 'completed' && run.conclusion === 'success')
      ? []
      : [`${name} (${runs.map((run) => `${run.status}/${run.conclusion}`).join(', ') || 'missing'})`]
  })
  if (failures.length > 0) {
    throw new Error(`release commit is not fully green:\n- ${failures.join('\n- ')}`)
  }
}
