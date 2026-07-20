import assert from 'node:assert/strict'
import test from 'node:test'

import { metaJson } from '../dist/cli/bundle.js'
import { validateConfig } from '../dist/config.js'

const base = {
  appId: 'com.example.about-panel',
  productName: 'About Panel',
  version: '1.2.3',
}

test('validates and serializes a configurable About panel', () => {
  const config = {
    ...base,
    about: {
      name: 'About Panel Pro',
      width: 520,
      height: 680,
      paragraphs: ['A focused desktop workspace.', 'Built with Murasaki.'],
      paragraphSpacing: 16,
      details: [
        { label: 'Build', value: '15212' },
        { label: 'Commit', value: '332b2aefc', href: 'https://github.com/example/app/commit/332b2aefc' },
      ],
      buttons: [
        { label: 'Docs', href: 'https://docs.example.com' },
        { label: 'GitHub', href: 'https://github.com/example/app' },
      ],
    },
  }

  validateConfig(config)
  const metadata = JSON.parse(metaJson(config, config.productName, null, process.cwd()))
  assert.deepEqual(metadata.about, config.about)
})

test('rejects unsafe or malformed About configuration', () => {
  assert.throws(
    () => validateConfig({ ...base, about: { width: 359 } }),
    /about\.width must be an integer between 360 and 900/,
  )
  assert.throws(
    () => validateConfig({
      ...base,
      about: { buttons: [{ label: 'Local file', href: 'file:///etc/passwd' }] },
    }),
    /supports only credential-free http, https, and mailto URLs/,
  )
  assert.throws(
    () => validateConfig({
      ...base,
      about: { buttons: [{ label: 'Private', href: 'https://user:secret@example.com' }] },
    }),
    /supports only credential-free http, https, and mailto URLs/,
  )
  assert.throws(
    () => validateConfig({ ...base, about: { backgroundColor: '#fff' } }),
    /about contains unknown field backgroundColor/,
  )
})

test('keeps the platform-standard About panel when custom config is omitted', () => {
  validateConfig(base)
  const metadata = JSON.parse(metaJson(base, base.productName, null, process.cwd()))
  assert.equal(metadata.about, undefined)
})
