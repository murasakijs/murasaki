import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { resolveAssociations, windowsProgId } from '../dist/associations.js'
import { infoPlist } from '../dist/cli/bundle.js'
import { nsiScript, nsisAssociationRegistry, wixAssociationComponents, wxsScript } from '../dist/cli/installer.js'

const config = {
  appId: 'com.example.violet',
  productName: 'Violet & Notes',
  protocols: [{ scheme: 'Violet', name: 'Violet Link' }],
  fileAssociations: [{
    extensions: ['.violet', 'vnote'],
    name: 'Violet Document',
    description: 'Violet & document',
    role: 'editor',
    mimeType: 'application/x-violet',
  }],
}

test('normalizes and validates protocol and file associations', () => {
  const resolved = resolveAssociations(config)
  assert.equal(resolved.protocols[0].scheme, 'violet')
  assert.deepEqual(resolved.files[0].extensions, ['violet', 'vnote'])
  assert.equal(windowsProgId(config.appId, 'violet'), 'com.example.violet.violet')
  assert.throws(() => resolveAssociations({ ...config, protocols: [{ scheme: 'https' }] }), /reserved/)
  assert.throws(() => resolveAssociations({ ...config, protocols: [{ scheme: 'ms-settings' }] }), /reserved/)
  assert.throws(() => resolveAssociations({ ...config, fileAssociations: [{ extensions: ['../bad'] }] }), /invalid extension/)
  assert.throws(() => resolveAssociations({ ...config, protocols: [{ scheme: 'violet' }, { scheme: 'VIOLET' }] }), /duplicate/)
  assert.throws(() => resolveAssociations({
    ...config,
    fileAssociations: [
      { extensions: ['one'], mimeType: 'application/x-violet' },
      { extensions: ['two'], mimeType: 'APPLICATION/X-VIOLET' },
    ],
  }), /duplicate file association MIME type/)
  assert.throws(() => resolveAssociations({ ...config, protocols: [{ scheme: 'violet', name: 'bad\nname' }] }), /printable/)
})

test('emits macOS URL and document metadata', () => {
  const plist = infoPlist(config, config.productName, true)
  assert.match(plist, /<key>CFBundleURLTypes<\/key>/)
  assert.match(plist, /<string>violet<\/string>/)
  assert.match(plist, /<string>com\.example\.violet\.url\.violet<\/string>/)
  assert.match(plist, /<key>CFBundleTypeRole<\/key><string>Viewer<\/string>/)
  assert.match(plist, /<key>CFBundleDocumentTypes<\/key>/)
  assert.match(plist, /<string>Editor<\/string>/)
  assert.match(plist, /Violet &amp; Notes/)
  assert.match(plist, /<key>UTExportedTypeDeclarations<\/key>/)
})

test('generated association plist passes plutil validation on macOS', { skip: process.platform !== 'darwin' }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-plist-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'Info.plist')
  await writeFile(path, infoPlist(config, config.productName, true))
  const checked = spawnSync('plutil', ['-lint', path], { encoding: 'utf8' })
  assert.equal(checked.status, 0, checked.stderr || checked.stdout)
})

test('emits ownership-safe NSIS registrations with quoted targets', () => {
  const associations = resolveAssociations(config)
  const registry = nsisAssociationRegistry({
    appId: config.appId,
    productName: config.productName,
    executableName: config.productName,
    regRoot: 'HKCU',
    associations,
  })
  assert.match(registry.install, /Software\\Classes\\violet/)
  assert.match(registry.install, /com\.example\.violet\.Url\.violet/)
  assert.match(registry.install, /ReadRegStr \$0 HKCU "Software\\Classes\\violet\\shell\\open\\command"/)
  assert.match(registry.install, /"MurasakiAppId" "com\.example\.violet"/)
  assert.match(registry.install, /"\$INSTDIR\\Violet & Notes\.exe" "%1"/)
  assert.match(registry.install, /OpenWithProgids/)
  assert.match(registry.install, /ApplicationDescription/)
  assert.match(registry.install, /MIMEAssociations/)
  assert.doesNotMatch(registry.install, /Software\\Classes\\\.violet" "Content Type"/)
  assert.match(registry.install, /Software\\RegisteredApplications/)
  assert.match(registry.uninstall, /ReadRegStr \$0 HKCU/)
  assert.match(registry.uninstall, /MurasakiInstallPath/)
  assert.doesNotMatch(registry.uninstall, /DeleteRegKey HKCU "Software\\Classes\\\.violet"/)
})

test('emits MSI components without taking UserChoice ownership', () => {
  const rendered = wixAssociationComponents({
    appId: config.appId,
    displayName: config.productName,
    associations: resolveAssociations(config),
  })
  assert.match(rendered.components, /URL Protocol/)
  assert.match(rendered.components, /com\.example\.violet\.Url\.violet/)
  assert.doesNotMatch(rendered.components, /Key="Software\\Classes\\violet"/)
  assert.match(rendered.components, /OpenWithProgids/)
  assert.match(rendered.components, /ApplicationDescription/)
  assert.match(rendered.components, /MIMEAssociations/)
  assert.match(rendered.components, /RegisteredApplications/)
  assert.match(rendered.components, /&quot;%1&quot;/)
  assert.doesNotMatch(rendered.components, /UserChoice/)
  assert.match(rendered.featureRefs, /ComponentRef/)
})

test('MSI authoring notifies the shell and escapes formatted app names', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'murasaki-wix-associations-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const displayName = 'Violet [Beta]'
  await writeFile(join(root, `${displayName}.exe`), 'fixture')
  const script = await wxsScript({
    appId: config.appId,
    displayName,
    description: 'Violet desktop application',
    version: '1.0.0.0',
    publisher: 'Murasaki',
    upgradeCode: '11111111-1111-1111-1111-111111111111',
    productCode: '22222222-2222-2222-2222-222222222222',
    bundleDir: root,
    branding: { icon: null, banner: null, sidebar: null, license: null },
    licenseRtf: join(root, 'license.rtf'),
    associations: resolveAssociations(config),
  })
  assert.match(script, /--murasaki-associations-install/)
  assert.match(script, /--murasaki-associations-uninstall/)
  assert.match(script, /Return="check"/)
  assert.match(script, /After="WriteRegistryValues"/)
  assert.match(script, /Before="RemoveFiles"/)
  assert.match(script, /Violet \[\\\[\]Beta\[\\\]\]\.exe/)
})

test('generated MSI source with associations compiles when WiX is available', async (t) => {
  if (process.platform !== 'win32') return t.skip('WiX compilation requires Windows')
  const available = spawnSync('wix', ['--version'], { encoding: 'utf8' })
  if (available.error) return t.skip('WiX is not installed')
  const root = await mkdtemp(join(tmpdir(), 'murasaki-wix-compile-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bundleDir = join(root, 'bundle')
  await mkdir(bundleDir)
  const displayName = 'Violet Notes'
  await writeFile(join(bundleDir, `${displayName}.exe`), 'fixture')
  await writeFile(join(bundleDir, 'metadata.json'), '{}')
  const licenseRtf = join(root, 'license.rtf')
  await writeFile(licenseRtf, '{\\rtf1\\ansi Murasaki test license}')
  const script = await wxsScript({
    appId: config.appId,
    displayName,
    description: 'Violet desktop application',
    version: '1.0.0.0',
    publisher: 'Murasaki',
    upgradeCode: '11111111-1111-1111-1111-111111111111',
    productCode: '22222222-2222-2222-2222-222222222222',
    bundleDir,
    branding: { icon: null, banner: null, sidebar: null, license: null },
    licenseRtf,
    associations: resolveAssociations(config),
  })
  const scriptPath = join(root, 'installer.wxs')
  await writeFile(scriptPath, script)
  const compiled = spawnSync('wix', [
    'build', scriptPath, '-arch', 'x64', '-ext', 'WixToolset.UI.wixext',
    '-out', join(root, 'installer.msi'),
  ], { encoding: 'utf8' })
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout)
})

test('generated NSIS installer with associations compiles when makensis is available', async (t) => {
  const available = spawnSync('makensis', ['-VERSION'], { encoding: 'utf8' })
  if (available.error) return t.skip('makensis is not installed')
  const root = await mkdtemp(join(tmpdir(), 'murasaki-nsis-associations-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bundleDir = join(root, 'bundle')
  await mkdir(bundleDir)
  await writeFile(join(bundleDir, `${config.productName}.exe`), 'fixture')
  await writeFile(join(bundleDir, 'metadata.json'), '{}')
  const script = await nsiScript({
    appId: config.appId,
    productName: config.productName,
    version: '1.0.0',
    publisher: 'Murasaki',
    bundleDir,
    setupPath: join(root, 'setup.exe'),
    installMode: 'perUser',
    locales: ['en'],
    branding: { icon: null, banner: null, sidebar: null, license: null },
    associations: resolveAssociations(config),
  })
  assert.match(script, /com\.example\.violet\.Application\\Install/)
  assert.match(script, /ExecWait '\"\$0\" \/S' \$1/)
  assert.match(script, /WriteRegStr HKCU .* "Uninstaller" "\$INSTDIR\\Uninstall\.exe"/)
  const scriptPath = join(root, 'installer.nsi')
  await writeFile(scriptPath, `\uFEFF${script}`)
  const compiled = spawnSync('makensis', [scriptPath], { encoding: 'utf8' })
  assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout)
})
