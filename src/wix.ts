// WiX v4 (.NET-based) integration — build a Windows .msi installer
// from any host OS, as long as the `wix` tool is on PATH.
//
// WiX v4 ships as a dotnet global tool:
//   dotnet tool install -g wix
//
// macOS / Linux users need .NET SDK first:
//   macOS:  brew install --cask dotnet-sdk
//   Linux:  https://learn.microsoft.com/en-us/dotnet/core/install/linux
//
// If `wix` is not available, makeMsi returns null and the caller falls
// back to a plain .zip.

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export function detectWix(): boolean {
  try {
    const r = spawnSync('wix', ['--version'], { encoding: 'utf8' })
    return r.status === 0
  } catch {
    return false
  }
}

/**
 * Build a Windows .msi from a packaged folder. Returns the .msi path or
 * null if WiX isn't available.
 */
export async function makeMsi(args: {
  distDir: string
  folderPath: string
  appName: string
  displayName: string
  version: string
  manufacturer: string
  bundleId: string
}): Promise<string | null> {
  if (!detectWix()) return null

  const wxsPath = join(args.distDir, `${args.appName}.wxs`)
  const msiPath = join(args.distDir, `${args.appName}-${args.version}.msi`)

  // Strip any pre-existing .msi so wix doesn't refuse to overwrite.
  try {
    rmSync(msiPath, { force: true })
  } catch {}

  // WiX expects 4-component versions (X.Y.Z.W).
  const wixVersion = padVersion(args.version)
  const upgradeCode = deriveGuid(`${args.bundleId}.upgrade`)
  const productCode = deriveGuid(`${args.bundleId}.${wixVersion}`)

  const wxs = buildWxs({
    productCode,
    upgradeCode,
    displayName: args.displayName,
    version: wixVersion,
    manufacturer: args.manufacturer,
    sourceDir: args.folderPath,
  })
  mkdirSync(dirname(wxsPath), { recursive: true })
  writeFileSync(wxsPath, wxs)

  // Run: wix build foo.wxs -o foo.msi -arch x64
  const r = spawnSync(
    'wix',
    ['build', wxsPath, '-arch', 'x64', '-out', msiPath],
    { stdio: 'inherit' },
  )
  if (r.status !== 0) {
    throw new Error(`wix build exited with ${r.status}`)
  }
  return msiPath
}

function buildWxs(opts: {
  productCode: string
  upgradeCode: string
  displayName: string
  version: string
  manufacturer: string
  sourceDir: string
}): string {
  const xml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  return `<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs"
     xmlns:ui="http://wixtoolset.org/schemas/v4/wxs/ui">
  <Package
    Name="${xml(opts.displayName)}"
    Manufacturer="${xml(opts.manufacturer)}"
    Version="${opts.version}"
    UpgradeCode="${opts.upgradeCode}"
    ProductCode="${opts.productCode}"
    Scope="perMachine">

    <MajorUpgrade DowngradeErrorMessage="A newer version of [ProductName] is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <ui:WixUI Id="WixUI_InstallDir" InstallDirectory="INSTALLFOLDER" />

    <Feature Id="Main" Title="${xml(opts.displayName)}" Level="1">
      <ComponentGroupRef Id="HarvestedFiles" />
    </Feature>

    <StandardDirectory Id="ProgramFiles6432Folder">
      <Directory Id="INSTALLFOLDER" Name="${xml(opts.displayName)}" />
    </StandardDirectory>

    <ComponentGroup Id="HarvestedFiles" Directory="INSTALLFOLDER">
      <Files Include="${xml(opts.sourceDir)}\\**" />
    </ComponentGroup>
  </Package>
</Wix>
`
}

function padVersion(v: string): string {
  // "1.2.3" → "1.2.3.0", "1.2" → "1.2.0.0", "1" → "1.0.0.0"
  const parts = v.split(/[.\-]/).slice(0, 4).map((p) => p.replace(/[^0-9]/g, '') || '0')
  while (parts.length < 4) parts.push('0')
  return parts.join('.')
}

/**
 * Deterministic GUID from an arbitrary string. Same input → same GUID,
 * so MajorUpgrade detection works across versions.
 */
function deriveGuid(seed: string): string {
  const hash = createHash('sha256').update(seed).digest('hex')
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    // Set version nibble to 4 (formally "name-based" — close enough).
    `4${hash.slice(13, 16)}`,
    // Variant bits: high 2 must be "10".
    `${((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hash.slice(18, 20)}`,
    hash.slice(20, 32),
  ]
    .join('-')
    .toUpperCase()
}
