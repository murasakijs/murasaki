import assert from 'node:assert/strict'
import test from 'node:test'

import { unsignedNote } from '../dist/cli/brand.js'

test('unsigned artifact guidance is platform-specific', () => {
  const mac = unsignedNote('/tmp/Example.app')
  assert.match(mac, /macOS may block/)
  assert.match(mac, /xattr -dr com\.apple\.quarantine/)

  const windows = unsignedNote('C:\\dist\\Example.zip', 'win32')
  assert.match(windows, /Windows build is unsigned/)
  assert.match(windows, /SmartScreen or application-control policy/)
  assert.match(windows, /configure sign\.windows/)
  assert.doesNotMatch(windows, /xattr|notarize|Apple Developer/)
})
