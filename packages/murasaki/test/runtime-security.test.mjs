import assert from 'node:assert/strict'
import test from 'node:test'
import { isAuthorizedRuntimeRequest } from '../dist/vite-plugin/runtime-security.js'

const TOKEN = 'a'.repeat(64)

function request(headers = {}) {
  return { headers }
}

test('accepts only same-origin loopback requests with the runtime cookie', () => {
  assert.equal(isAuthorizedRuntimeRequest(request({
    host: 'localhost:5178',
    origin: 'http://localhost:5178',
    cookie: `other=1; murasaki_runtime=${TOKEN}`,
    'sec-fetch-site': 'same-origin',
  }), TOKEN), true)

  for (const headers of [
    { host: 'localhost:5178' },
    { host: 'localhost:5178', cookie: 'murasaki_runtime=wrong' },
    { host: 'evil.test:5178', cookie: `murasaki_runtime=${TOKEN}` },
    { host: 'localhost:5178', origin: 'https://evil.test', cookie: `murasaki_runtime=${TOKEN}` },
    { host: 'localhost:5178', 'sec-fetch-site': 'cross-site', cookie: `murasaki_runtime=${TOKEN}` },
  ]) {
    assert.equal(isAuthorizedRuntimeRequest(request(headers), TOKEN), false)
  }
})
