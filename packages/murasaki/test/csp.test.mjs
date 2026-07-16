import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { defineConfig } from '../dist/config.js'
import {
  appShellPlugin,
  applyContentSecurityPolicy,
  DEFAULT_DEVELOPMENT_CSP,
  DEFAULT_PRODUCTION_CSP,
  resolveContentSecurityPolicy,
} from '../dist/vite-plugin/shell.js'

const frameworkHtml = '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>'

function cspMetaCount(html) {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '')
  return (withoutComments.match(/<meta\b[^>]*>/gi) ?? [])
    .filter((tag) => /\bhttp-equiv\s*=\s*["']content-security-policy["']/i.test(tag))
    .length
}

test('default production CSP is strict while allowing remote HTTPS/WSS backends', () => {
  assert.equal(resolveContentSecurityPolicy(undefined, 'build'), DEFAULT_PRODUCTION_CSP)
  const html = applyContentSecurityPolicy(frameworkHtml, undefined, 'build')
  assert.equal(cspMetaCount(html), 1)
  assert.match(html, /script-src 'self';/)
  assert.doesNotMatch(html, /script-src 'self' 'unsafe-inline'/)
  assert.match(html, /object-src 'none'/)
  assert.match(html, /base-uri 'none'/)
  assert.match(html, /frame-src 'none'/)
  assert.match(html, /style-src 'self' 'unsafe-inline'/)
  assert.match(html, /connect-src 'self' https: wss:/)
})

test('default development CSP permits only the inline/HMR additions development needs', () => {
  assert.equal(resolveContentSecurityPolicy(undefined, 'serve'), DEFAULT_DEVELOPMENT_CSP)
  const html = applyContentSecurityPolicy(frameworkHtml, undefined, 'serve')
  assert.equal(cspMetaCount(html), 1)
  assert.match(html, /script-src 'self' 'unsafe-inline'/)
  assert.doesNotMatch(html, /unsafe-eval/)
  assert.match(html, /connect-src 'self' https: ws: wss:/)
})

test('a custom CSP completely overrides the framework default and is attribute-escaped', () => {
  const custom = "default-src 'none'; connect-src https://api.example.test?a=1&b=2"
  const html = applyContentSecurityPolicy(frameworkHtml, custom, 'build')
  assert.equal(resolveContentSecurityPolicy(custom, 'serve'), custom)
  assert.equal(cspMetaCount(html), 1)
  assert.match(html, /default-src 'none'; connect-src https:\/\/api\.example\.test\?a=1&amp;b=2/)
  assert.doesNotMatch(html, /style-src/)
})

test('false opts out without removing a user-owned CSP meta tag', () => {
  assert.equal(applyContentSecurityPolicy(frameworkHtml, false, 'build'), frameworkHtml)
  const existing = '<html><head><meta content="default-src \'none\'" HTTP-EQUIV = \'Content-Security-Policy\'></head></html>'
  assert.equal(applyContentSecurityPolicy(existing, false, 'build'), existing)
})

test('an existing CSP is moved before earlier content without duplication', () => {
  const existing = '<html><head><script src="early.js"></script><meta content="default-src \'none\'" HTTP-EQUIV = \'Content-Security-Policy\'><title>Custom</title></head></html>'
  const transformed = applyContentSecurityPolicy(existing, undefined, 'build')
  assert.equal(cspMetaCount(transformed), 1)
  assert.ok(transformed.indexOf('Content-Security-Policy') < transformed.indexOf('<script'))
  assert.match(transformed, /default-src \'none\'/)

  assert.throws(
    () => applyContentSecurityPolicy(existing, "default-src 'self'", 'build'),
    /configure the policy in one place/,
  )

  const commented = '<html><head><!-- <meta http-equiv="Content-Security-Policy" content="default-src none"> --></head></html>'
  assert.equal(cspMetaCount(applyContentSecurityPolicy(commented, undefined, 'build')), 1)
})

test('the Vite HTML hook applies production CSP to the framework shell path', async () => {
  const plugin = appShellPlugin()
  plugin.configResolved({ command: 'build', root: process.cwd() })
  const transformed = await plugin.transformIndexHtml.handler(frameworkHtml)
  assert.equal(cspMetaCount(transformed), 1)
  assert.match(transformed, /script-src 'self';/)
})

test('app shell ownership follows the configured and resolved Vite root', async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), 'murasaki-shell-root-'))
  const userRoot = join(workspace, 'apps', 'user-html')
  const frameworkRoot = join(workspace, 'apps', 'framework-html')
  await mkdir(userRoot, { recursive: true })
  await mkdir(frameworkRoot, { recursive: true })
  await writeFile(join(userRoot, 'index.html'), frameworkHtml)
  t.after(() => rm(workspace, { recursive: true, force: true }))

  const userPlugin = appShellPlugin()
  assert.deepEqual(userPlugin.config({ root: userRoot }), {})
  userPlugin.configResolved({ command: 'serve', root: userRoot })
  assert.equal(userPlugin.configureServer({}), undefined)

  const frameworkPlugin = appShellPlugin()
  assert.deepEqual(frameworkPlugin.config({ root: frameworkRoot }), { appType: 'custom' })
  // The resolved root remains authoritative if another Vite config layer
  // changes it after this plugin's early config hook.
  frameworkPlugin.configResolved({ command: 'serve', root: userRoot })
  assert.equal(frameworkPlugin.configureServer({}), undefined)

  const noHtmlPlugin = appShellPlugin()
  noHtmlPlugin.config({ root: userRoot })
  noHtmlPlugin.configResolved({ command: 'serve', root: frameworkRoot })
  assert.equal(typeof noHtmlPlugin.configureServer({}), 'function')
})

test('CSP configuration rejects HTML/control injection and invalid values', () => {
  for (const csp of [
    '',
    "default-src 'self'\nscript-src *",
    'default-src *\" onload=alert(1)',
    'default-src *><script>alert(1)</script>',
  ]) {
    assert.throws(
      () => defineConfig({ appId: 'dev.csp', productName: 'CSP', security: { csp } }),
      /security\.csp/,
    )
  }
  assert.throws(
    () => defineConfig({ appId: 'dev.csp', productName: 'CSP', security: { csp: true } }),
    /string or false/,
  )
  assert.throws(
    () => defineConfig({ appId: 'dev.csp', productName: 'CSP', security: false }),
    /security must be an object/,
  )
})
