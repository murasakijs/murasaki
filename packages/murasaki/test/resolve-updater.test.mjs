import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveUpdater } from '../dist/resolve-updater.js'

const context = { projectRoot: '/unused' }
const publicKey = 'test-public-key'

test('normalizes supported GitHub repository forms without a backtracking regex', () => {
  const repositories = [
    'murasakijs/murasaki',
    'github:murasakijs/murasaki',
    'https://github.com/murasakijs/murasaki',
    'git+https://github.com/murasakijs/murasaki.git',
    'git@github.com:murasakijs/murasaki.git',
    'ssh://git@github.com/murasakijs/murasaki.git',
  ]

  for (const repo of repositories) {
    const resolved = resolveUpdater({ repo, publicKey }, context)
    assert.equal(
      resolved?.manifestUrl,
      'https://github.com/murasakijs/murasaki/releases/latest/download/latest.json',
    )
  }
})

test('rejects malformed or non-GitHub repository values', () => {
  for (const repo of [
    'murasakijs/murasaki/extra',
    'https://example.com/murasakijs/murasaki',
    'https://github.com/murasakijs/murasaki?redirect=evil',
    'git@github.com:murasakijs/murasaki/extra.git',
  ]) {
    assert.throws(
      () => resolveUpdater({ repo, publicKey }, context),
      /no GitHub repo could be resolved/,
    )
  }
})
