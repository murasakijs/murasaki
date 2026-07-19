import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { defineConfig, resolveWebviewNetworkConfig } from '../dist/config.js'
import { metaJson } from '../dist/cli/bundle.js'
import { resolveInitScripts } from '../dist/cli/init-scripts.js'

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
    downloads: { directory: '/Users/example/Downloads' },
    hotkeysZoom: true,
  }
  const config = defineConfig({ ...base, webview })
  const resolved = resolveWebviewNetworkConfig(config)
  assert.deepEqual(resolved, webview)
  assert.notEqual(resolved, webview)
  assert.notEqual(resolved.proxy, webview.proxy)
  assert.notEqual(resolved.downloads, webview.downloads)
})

test('validates windows-style absolute download directories too', () => {
  const config = defineConfig({
    ...base,
    webview: { downloads: { directory: 'C:\\Users\\example\\Downloads' } },
  })
  assert.deepEqual(resolveWebviewNetworkConfig(config), {
    downloads: { directory: 'C:\\Users\\example\\Downloads' },
  })
})

test('resolveWebviewNetworkConfig omits initScripts (resolved separately from disk)', () => {
  const config = defineConfig({ ...base, webview: { initScripts: ['a.js'] } })
  assert.deepEqual(resolveWebviewNetworkConfig(config), {})
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
    [{ hotkeysZoom: 'yes' }, /webview\.hotkeysZoom must be a boolean/],
    [{ initScripts: 'a.js' }, /webview\.initScripts must be/],
    [{ initScripts: [''] }, /webview\.initScripts must be/],
    [{ initScripts: [42] }, /webview\.initScripts must be/],
    [{ initScripts: Array.from({ length: 65 }, (_, i) => `${i}.js`) }, /webview\.initScripts must be/],
    [{ downloads: 'x' }, /webview\.downloads must be an object/],
    [{ downloads: { directory: '' } }, /webview\.downloads\.directory must be/],
    [{ downloads: { directory: 'relative/path' } }, /webview\.downloads\.directory must be/],
    [{ downloads: { directory: '/Users/example/../../etc' } }, /webview\.downloads\.directory must be/],
    [{ downloads: { directory: '/Users/example/Downloads', unknown: true } }, /webview\.downloads contains unknown field unknown/],
  ]) {
    assert.throws(() => defineConfig({ ...base, webview }), message)
  }
})

test('resolveInitScripts reads project-root-relative files into contents, in order', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-init-scripts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'first.js'), 'console.log("first")')
  await writeFile(join(root, 'second.js'), 'console.log("second")')

  const config = defineConfig({
    ...base,
    webview: { initScripts: ['first.js', 'second.js'] },
  })
  assert.deepEqual(resolveInitScripts(config, root), [
    'console.log("first")',
    'console.log("second")',
  ])
  assert.deepEqual(resolveInitScripts(defineConfig(base), root), [])
})

test('resolveInitScripts enforces per-file and combined-total byte bounds', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-init-scripts-bounds-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'huge.js'), 'x'.repeat(256 * 1024 + 1))
  // Each individually at the 256 KiB per-file bound, but five of them exceed
  // the 1 MiB combined-total bound.
  for (const name of ['a.js', 'b.js', 'c.js', 'd.js', 'e.js']) {
    await writeFile(join(root, name), 'x'.repeat(256 * 1024))
  }

  assert.throws(
    () => resolveInitScripts(
      defineConfig({ ...base, webview: { initScripts: ['huge.js'] } }),
      root,
    ),
    /exceeds 262144 bytes/,
  )
  assert.throws(
    () => resolveInitScripts(
      defineConfig({ ...base, webview: { initScripts: ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'] } }),
      root,
    ),
    /total size exceeds 1048576 bytes/,
  )
})

test('resolveInitScripts surfaces a clear error for a missing file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-init-scripts-missing-'))
  t.after(() => rm(root, { recursive: true, force: true }))

  assert.throws(
    () => resolveInitScripts(
      defineConfig({ ...base, webview: { initScripts: ['missing.js'] } }),
      root,
    ),
    /failed to read webview\.initScripts entry "missing\.js"/,
  )
})

test('createDevWindowTemplates and metaJson embed resolved init script contents', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-init-scripts-dev-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'inject.js'), 'window.__murasakiTest = true')

  const config = defineConfig({
    ...base,
    webview: { initScripts: ['inject.js'] },
  })

  const { createDevWindowTemplates } = await import('../dist/cli/dev.js')
  const [devTemplate] = createDevWindowTemplates(config, root, 'http://127.0.0.1:5178/', 'a'.repeat(64))
  assert.equal(devTemplate.webview.initScripts.length, 2)
  assert.match(devTemplate.webview.initScripts[0], /x-murasaki-window-token/)
  assert.doesNotMatch(devTemplate.webview.initScripts[0], new RegExp('a{64}'))
  assert.equal(devTemplate.webview.initScripts[1], 'window.__murasakiTest = true')

  const metadata = JSON.parse(metaJson(config, config.productName, null, root))
  assert.deepEqual(metadata.webview.initScripts, ['window.__murasakiTest = true'])

  // Absent when empty, so existing configs without initScripts keep an exact
  // pass-through `webview` shape in packaged metadata.
  const withoutScripts = defineConfig({ ...base, webview: { incognito: true } })
  const metaWithoutScripts = JSON.parse(
    metaJson(withoutScripts, withoutScripts.productName, null, root),
  )
  assert.equal('initScripts' in metaWithoutScripts.webview, false)
})
