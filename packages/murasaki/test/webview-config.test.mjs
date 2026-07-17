import assert from 'node:assert/strict'
import test from 'node:test'

import { defineConfig, resolveWebviewNetworkConfig } from '../dist/config.js'
import { metaJson } from '../dist/cli/bundle.js'

const base = {
  appId: 'dev.test.webview-network',
  productName: 'WebView Network Test',
}

test('validates and normalizes app-wide WebView session/network settings', () => {
  const webview = {
    userAgent: 'Murasaki/1.0 (Desktop)',
    incognito: true,
    proxy: {
      protocol: 'socks5',
      host: '[2001:db8::1]',
      port: 1080,
    },
  }
  const config = defineConfig({ ...base, webview })
  const resolved = resolveWebviewNetworkConfig(config)
  assert.deepEqual(resolved, webview)
  assert.notEqual(resolved, webview)
  assert.notEqual(resolved.proxy, webview.proxy)
})

test('writes WebView settings into packaged launcher metadata', () => {
  const config = defineConfig({
    ...base,
    webview: {
      userAgent: 'Murasaki/1.0',
      incognito: true,
      proxy: { protocol: 'http', host: 'proxy.example.com', port: 3128 },
    },
  })
  const metadata = JSON.parse(metaJson(config, config.productName, null, process.cwd()))
  assert.deepEqual(metadata.webview, config.webview)

  const withoutWebview = JSON.parse(metaJson(base, base.productName, null, process.cwd()))
  assert.equal('webview' in withoutWebview, false)
})

test('rejects unsafe or unbounded WebView settings before native startup', () => {
  const longUserAgent = 'x'.repeat(513)
  for (const [webview, message] of [
    [null, /webview must be an object/],
    [{ unknown: true }, /webview contains unknown field unknown/],
    [{ userAgent: '' }, /webview\.userAgent must be/],
    [{ userAgent: ' padded' }, /webview\.userAgent must be/],
    [{ userAgent: 'Murasaki\r\nX-Injected: yes' }, /webview\.userAgent must be/],
    [{ userAgent: longUserAgent }, /no greater than 512 UTF-8 bytes/],
    [{ incognito: 'yes' }, /webview\.incognito must be a boolean/],
    [{ proxy: { protocol: 'https', host: 'proxy.example.com', port: 443 } }, /protocol must be http or socks5/],
    [{ proxy: { protocol: 'http', host: 'https:\/\/proxy.example.com', port: 8080 } }, /host must be a hostname or IP literal/],
    [{ proxy: { protocol: 'http', host: 'user@proxy.example.com', port: 8080 } }, /host must be a hostname or IP literal/],
    [{ proxy: { protocol: 'http', host: 'bad_name.example', port: 8080 } }, /host must be a hostname or IP literal/],
    [{ proxy: { protocol: 'http', host: 'proxy.example.com', port: 0 } }, /port must be an integer between 1 and 65535/],
    [{ proxy: { protocol: 'http', host: 'proxy.example.com', port: 65536 } }, /port must be an integer between 1 and 65535/],
    [{ proxy: { protocol: 'http', host: 'proxy.example.com', port: 8080, password: 'secret' } }, /webview\.proxy contains unknown field password/],
  ]) {
    assert.throws(() => defineConfig({ ...base, webview }), message)
  }
})
