import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { defineConfig } from '../dist/config.js'
import { metaJson } from '../dist/cli/bundle.js'
import {
  appShellPlugin,
  applyContentSecurityPolicy,
  DEFAULT_DEVELOPMENT_CSP,
  DEFAULT_PRODUCTION_CSP,
  htmlDeclaresUserContentSecurityPolicy,
  resolveContentSecurityPolicy,
  resolveHeaderContentSecurityPolicy,
  stripHeaderOnlyDirectives,
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
  assert.match(DEFAULT_PRODUCTION_CSP, /frame-ancestors 'none'/)
  const html = applyContentSecurityPolicy(frameworkHtml, undefined, 'build')
  assert.equal(cspMetaCount(html), 1)
  assert.match(html, /script-src 'self';/)
  assert.doesNotMatch(html, /script-src 'self' 'unsafe-inline'/)
  assert.match(html, /object-src 'none'/)
  assert.match(html, /base-uri 'none'/)
  assert.match(html, /frame-src 'none'/)
  assert.match(html, /style-src 'self' 'unsafe-inline'/)
  assert.match(html, /connect-src 'self' https: wss:/)
  // frame-ancestors is header-only (ignored by browsers in a meta tag), so
  // the meta variant omits it — the header carries the full policy instead.
  assert.doesNotMatch(html, /frame-ancestors/)
})

test('default development CSP permits only the inline/HMR additions development needs', () => {
  assert.equal(resolveContentSecurityPolicy(undefined, 'serve'), DEFAULT_DEVELOPMENT_CSP)
  assert.match(DEFAULT_DEVELOPMENT_CSP, /frame-ancestors 'none'/)
  const html = applyContentSecurityPolicy(frameworkHtml, undefined, 'serve')
  assert.equal(cspMetaCount(html), 1)
  assert.match(html, /script-src 'self' 'unsafe-inline'/)
  assert.doesNotMatch(html, /unsafe-eval/)
  assert.match(html, /connect-src 'self' https: ws: wss:/)
  assert.doesNotMatch(html, /frame-ancestors/)
})

test('stripHeaderOnlyDirectives derives the meta-safe policy from the resolved header policy', () => {
  assert.equal(
    stripHeaderOnlyDirectives(DEFAULT_PRODUCTION_CSP),
    DEFAULT_PRODUCTION_CSP.split('; ').filter((d) => !d.startsWith('frame-ancestors')).join('; '),
  )
  assert.equal(
    stripHeaderOnlyDirectives("default-src 'self'; sandbox allow-scripts; report-to csp-endpoint"),
    "default-src 'self'",
  )
  // Directives that ARE meta-safe pass through unchanged, in order.
  assert.equal(
    stripHeaderOnlyDirectives("default-src 'self'; script-src 'self'"),
    "default-src 'self'; script-src 'self'",
  )
})

test('the resolved header policy and the meta policy agree on every directive except the header-only ones', () => {
  for (const command of ['serve', 'build']) {
    const header = resolveContentSecurityPolicy(undefined, command)
    const html = applyContentSecurityPolicy(frameworkHtml, undefined, command)
    const [, metaContent] = /data-murasaki-csp[^>]*content="([^"]*)"/.exec(html)
    assert.equal(metaContent, stripHeaderOnlyDirectives(header))
  }
})

test('a custom CSP carrying header-only directives keeps them for the header but strips them from the meta tag', () => {
  const custom = "default-src 'self'; frame-ancestors 'self' https://embed.example.test; sandbox allow-forms"
  assert.equal(resolveContentSecurityPolicy(custom, 'build'), custom)
  const html = applyContentSecurityPolicy(frameworkHtml, custom, 'build')
  assert.equal(cspMetaCount(html), 1)
  assert.doesNotMatch(html, /frame-ancestors/)
  assert.doesNotMatch(html, /sandbox/)
  assert.match(html, /content="default-src 'self'"/)
})

test('a custom CSP completely overrides the framework default and is attribute-escaped', () => {
  const custom = "default-src 'none'; connect-src https://api.example.test?a=1&b=2"
  const html = applyContentSecurityPolicy(frameworkHtml, custom, 'build')
  assert.equal(resolveContentSecurityPolicy(custom, 'serve'), custom)
  assert.equal(cspMetaCount(html), 1)
  assert.match(html, /default-src 'none'; connect-src https:\/\/api\.example\.test\?a=1&amp;b=2/)
  assert.doesNotMatch(html, /style-src/)
})

test('framework-injected custom CSP is idempotent across repeated Vite HTML transforms', () => {
  const custom = "default-src 'none'; connect-src https://api.example.test"
  const once = applyContentSecurityPolicy(frameworkHtml, custom, 'build')
  const twice = applyContentSecurityPolicy(once, custom, 'build')

  assert.equal(cspMetaCount(twice), 1)
  assert.match(twice, /data-murasaki-csp/)
  assert.match(twice, /default-src 'none'/)

  const withUserPolicy = twice.replace(
    '</head>',
    '<meta http-equiv="Content-Security-Policy" content="script-src \'none\'"></head>',
  )
  assert.throws(
    () => applyContentSecurityPolicy(withUserPolicy, custom, 'build'),
    /configure the policy in one place/,
  )
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

test('htmlDeclaresUserContentSecurityPolicy detects a user-owned CSP meta tag but not a framework-owned one', () => {
  assert.equal(
    htmlDeclaresUserContentSecurityPolicy(
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head></html>',
    ),
    true,
  )
  assert.equal(
    htmlDeclaresUserContentSecurityPolicy(
      '<html><head><meta data-murasaki-csp http-equiv="Content-Security-Policy" content="default-src \'self\'"></head></html>',
    ),
    false,
  )
  assert.equal(htmlDeclaresUserContentSecurityPolicy(frameworkHtml), false)
})

test('resolveHeaderContentSecurityPolicy suppresses the header only when deferring to a user-owned meta tag', () => {
  const userMetaHtml = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head></html>'
  const noMetaHtml = frameworkHtml

  // false opts out regardless of index.html.
  assert.equal(resolveHeaderContentSecurityPolicy(false, 'build', userMetaHtml), false)
  assert.equal(resolveHeaderContentSecurityPolicy(false, 'build', null), false)

  // A configured string is always the full header policy, unstripped — this
  // combination never reaches here in practice when index.html also has a
  // meta tag (applyContentSecurityPolicy throws first), but the resolver
  // itself stays a pure pass-through.
  const custom = "default-src 'self'; frame-ancestors 'self' https://embed.example.test"
  assert.equal(resolveHeaderContentSecurityPolicy(custom, 'build', userMetaHtml), custom)
  assert.equal(resolveHeaderContentSecurityPolicy(custom, 'serve', null), custom)

  // Unconfigured + a user-owned CSP meta tag in index.html: defer to it, no header.
  assert.equal(resolveHeaderContentSecurityPolicy(undefined, 'build', userMetaHtml), false)
  assert.equal(resolveHeaderContentSecurityPolicy(undefined, 'serve', userMetaHtml), false)

  // Unconfigured + no index.html, or an index.html without a CSP meta tag: full default header.
  assert.equal(resolveHeaderContentSecurityPolicy(undefined, 'build', null), DEFAULT_PRODUCTION_CSP)
  assert.equal(resolveHeaderContentSecurityPolicy(undefined, 'build', noMetaHtml), DEFAULT_PRODUCTION_CSP)
  assert.equal(resolveHeaderContentSecurityPolicy(undefined, 'serve', noMetaHtml), DEFAULT_DEVELOPMENT_CSP)
})

test('bundle metadata suppresses csp when the source index.html declares a user CSP meta tag, else carries the full default', async (t) => {
  const withMeta = await mkdtemp(join(tmpdir(), 'murasaki-bundle-csp-usermeta-'))
  const withoutMeta = await mkdtemp(join(tmpdir(), 'murasaki-bundle-csp-nometa-'))
  t.after(() => Promise.all([
    rm(withMeta, { recursive: true, force: true }),
    rm(withoutMeta, { recursive: true, force: true }),
  ]))
  await writeFile(
    join(withMeta, 'index.html'),
    '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'"></head><body></body></html>',
  )

  const config = defineConfig({ appId: 'dev.csp.meta', productName: 'CSP Meta Test' })
  const withMetaMeta = JSON.parse(metaJson(config, config.productName, null, withMeta))
  assert.equal(withMetaMeta.csp, false)

  const withoutMetaMeta = JSON.parse(metaJson(config, config.productName, null, withoutMeta))
  assert.equal(withoutMetaMeta.csp, DEFAULT_PRODUCTION_CSP)
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
