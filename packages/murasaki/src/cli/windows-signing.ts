import { existsSync, readdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import type { MurasakiConfig } from '../config.js'
import { dim, success } from './brand.js'

const DEFAULT_TIMESTAMP_URL = 'http://timestamp.digicert.com'
const ARTIFACT_SIGNING_TIMESTAMP_URL = 'http://timestamp.acs.microsoft.com'

export interface ResolvedWindowsSigningOptions {
  signToolPath?: string
  certificateFile?: string
  certificateSubjectName?: string
  certificateSha1?: string
  certificatePassword?: string
  certificateStore: 'currentUser' | 'localMachine'
  timestampUrl: string | false
  artifactSigning?: { dlib: string; metadata: string }
  allowUntrustedCiCertificate: boolean
}

/**
 * Resolve Windows signing without ever persisting credentials. Environment
 * variables override project config so CI can select a certificate/provider
 * without editing a release checkout.
 */
export function resolveWindowsSigningOptions(
  config: MurasakiConfig,
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): ResolvedWindowsSigningOptions {
  const windows = config.sign?.windows
  const certificateFile = optionalPath(
    env.MURASAKI_WINDOWS_CERTIFICATE_FILE ?? windows?.certificateFile,
    cwd,
  )
  const certificateSubjectName = optionalString(
    env.MURASAKI_WINDOWS_CERTIFICATE_SUBJECT ?? windows?.certificateSubjectName,
  )
  const certificateSha1 = optionalString(
    env.MURASAKI_WINDOWS_CERTIFICATE_SHA1 ?? windows?.certificateSha1,
  )?.replace(/\s/g, '').toUpperCase()

  const dlibValue = env.MURASAKI_WINDOWS_ARTIFACT_SIGNING_DLIB
    ?? windows?.artifactSigning?.dlib
  const metadataValue = env.MURASAKI_WINDOWS_ARTIFACT_SIGNING_METADATA
    ?? windows?.artifactSigning?.metadata
  if ((dlibValue && !metadataValue) || (!dlibValue && metadataValue)) {
    throw new Error(
      'murasaki: Windows Artifact Signing requires both the dlib and metadata paths.',
    )
  }
  const artifactSigning = dlibValue && metadataValue
    ? { dlib: resolvePath(dlibValue, cwd), metadata: resolvePath(metadataValue, cwd) }
    : undefined

  const selectors = [certificateFile, certificateSubjectName, certificateSha1, artifactSigning]
    .filter(Boolean)
  if (selectors.length > 1) {
    throw new Error(
      'murasaki: choose exactly one Windows signing source: PFX file, certificate subject, ' +
        'certificate SHA-1 thumbprint, or Artifact Signing provider.',
    )
  }
  if (certificateSha1 && !/^[0-9A-F]{40}$/.test(certificateSha1)) {
    throw new Error('murasaki: MURASAKI_WINDOWS_CERTIFICATE_SHA1 must be a 40-character SHA-1 thumbprint.')
  }

  for (const [label, path] of [
    ['certificate file', certificateFile],
    ['Artifact Signing dlib', artifactSigning?.dlib],
    ['Artifact Signing metadata', artifactSigning?.metadata],
  ] as const) {
    if (path && !existsSync(path)) {
      throw new Error(`murasaki: Windows signing ${label} was not found: ${path}`)
    }
  }

  const rawTimestamp = env.MURASAKI_WINDOWS_TIMESTAMP_URL
  const timestampUrl = rawTimestamp !== undefined
    ? (rawTimestamp.toLowerCase() === 'false' ? false : rawTimestamp)
    : (windows?.timestampUrl
      ?? (artifactSigning ? ARTIFACT_SIGNING_TIMESTAMP_URL : DEFAULT_TIMESTAMP_URL))
  if (timestampUrl !== false) validateHttpUrl(timestampUrl, 'Windows timestamp URL')

  const allowUntrustedCiCertificate = env.MURASAKI_WINDOWS_CI_ALLOW_UNTRUSTED_CERTIFICATE === '1'
  if (allowUntrustedCiCertificate) {
    if (env.CI !== 'true' && env.CI !== '1') {
      throw new Error(
        'murasaki: MURASAKI_WINDOWS_CI_ALLOW_UNTRUSTED_CERTIFICATE is restricted to CI.',
      )
    }
    if (!certificateFile) {
      throw new Error(
        'murasaki: CI integrity-only verification requires MURASAKI_WINDOWS_CERTIFICATE_FILE.',
      )
    }
  }

  return {
    signToolPath: optionalString(env.MURASAKI_SIGNTOOL_PATH ?? windows?.signToolPath),
    certificateFile,
    certificateSubjectName,
    certificateSha1,
    certificatePassword: env.MURASAKI_WINDOWS_CERTIFICATE_PASSWORD,
    certificateStore: windows?.certificateStore ?? 'currentUser',
    timestampUrl,
    artifactSigning,
    allowUntrustedCiCertificate,
  }
}

/** Build the exact SignTool `sign` arguments. Exported for regression tests. */
export function windowsSignArgs(
  artifactPath: string,
  productName: string,
  options: ResolvedWindowsSigningOptions,
): string[] {
  const args = ['sign', '/v']
  if (options.artifactSigning) args.push('/debug')
  args.push('/fd', 'SHA256', '/d', productName)

  if (options.artifactSigning) {
    args.push('/dlib', options.artifactSigning.dlib, '/dmdf', options.artifactSigning.metadata)
  } else if (options.certificateFile) {
    args.push('/a', '/f', options.certificateFile)
    if (options.certificatePassword) args.push('/p', options.certificatePassword)
  } else if (options.certificateSubjectName) {
    args.push('/n', options.certificateSubjectName)
  } else if (options.certificateSha1) {
    args.push('/sha1', options.certificateSha1)
  } else {
    // Standard CI flow: import one suitable code-signing certificate into
    // CurrentUser/My, then let SignTool select the best valid candidate.
    args.push('/a')
  }

  if (!options.certificateFile
    && !options.artifactSigning
    && options.certificateStore === 'localMachine') {
    args.push('/sm')
  }
  if (options.timestampUrl !== false) {
    // Microsoft requires /td after /tr; placing it earlier can silently yield
    // a SHA-1 timestamp with older SignTool releases.
    args.push('/tr', options.timestampUrl, '/td', 'SHA256')
  }
  args.push(artifactPath)
  return args
}

/** Build Authenticode-policy verification arguments. */
export function windowsVerifyArgs(
  artifactPath: string,
  options: Pick<ResolvedWindowsSigningOptions, 'timestampUrl'>,
): string[] {
  return ['verify', '/pa', '/v', ...(options.timestampUrl === false ? [] : ['/tw']), artifactPath]
}

/** Sign and then independently verify one PE/MSI artifact. */
export function signWindowsArtifact(
  artifactPath: string,
  config: MurasakiConfig,
  cwd = process.cwd(),
): void {
  if (process.platform !== 'win32') {
    throw new Error(
      'murasaki: Windows Authenticode signing requires Windows and SignTool. ' +
        'Build unsigned cross-platform artifacts without --sign, or run the signed release job on Windows.',
    )
  }
  if (!existsSync(artifactPath)) {
    throw new Error(`murasaki: cannot sign missing Windows artifact: ${artifactPath}`)
  }

  const options = resolveWindowsSigningOptions(config, cwd)
  const signTool = resolveSignTool(options.signToolPath, cwd)
  const signed = spawnSync(
    signTool,
    windowsSignArgs(artifactPath, config.productName, options),
    { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  )
  if (signed.error || signed.status !== 0) {
    throw new Error(
      `murasaki: SignTool signing failed for ${artifactPath}:\n${sanitizeOutput(
        signed.stderr || signed.stdout || signed.error?.message || '',
        options.certificatePassword,
      )}`,
    )
  }

  const verified = options.allowUntrustedCiCertificate
    ? verifyUntrustedCiSignature(artifactPath, options)
    : spawnSync(
      signTool,
      windowsVerifyArgs(artifactPath, options),
      { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
    )
  if (verified.error || verified.status !== 0) {
    throw new Error(
      `murasaki: Windows signature verification failed for ${artifactPath}:\n${sanitizeOutput(
        verified.stderr || verified.stdout || verified.error?.message || '',
        options.certificatePassword,
      )}`,
    )
  }

  process.stdout.write(`\n${success(`signed and verified  ${dim(artifactPath)}`)}\n`)
}

/**
 * GitHub-hosted Windows runners can block indefinitely when a test root is
 * added to the trusted store. This narrowly scoped CI path still rejects an
 * unsigned/tampered artifact and requires the embedded signer to match the
 * configured PFX, but deliberately does not assert public chain trust.
 * Production releases never enter this path and continue through SignTool
 * `verify /pa` above.
 */
function verifyUntrustedCiSignature(
  artifactPath: string,
  options: ResolvedWindowsSigningOptions,
): SpawnSyncReturns<string> {
  const script = String.raw`
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $env:MURASAKI_VERIFY_ARTIFACT
$expected = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(
  $env:MURASAKI_WINDOWS_CERTIFICATE_FILE,
  $env:MURASAKI_WINDOWS_CERTIFICATE_PASSWORD,
  [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
)
try {
  if ($null -eq $signature.SignerCertificate) {
    throw 'The artifact has no embedded Authenticode signer.'
  }
  $status = [string]$signature.Status
  if (@('Valid', 'NotTrusted', 'UnknownError') -notcontains $status) {
    throw ('Authenticode integrity check failed with status {0}: {1}' -f $status, $signature.StatusMessage)
  }
  if ($signature.SignerCertificate.Thumbprint -ne $expected.Thumbprint) {
    throw 'The embedded signer does not match the configured PFX certificate.'
  }
  Write-Output "integrity-only CI verification passed ($status)"
} finally {
  $expected.Dispose()
}
`
  return spawnSync(
    'pwsh.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        MURASAKI_VERIFY_ARTIFACT: artifactPath,
        MURASAKI_WINDOWS_CERTIFICATE_FILE: options.certificateFile,
        MURASAKI_WINDOWS_CERTIFICATE_PASSWORD: options.certificatePassword ?? '',
      },
    },
  )
}

/** Resolve an explicit tool, PATH entry, or the newest installed Windows SDK copy. */
function resolveSignTool(configured: string | undefined, cwd: string): string {
  if (configured) {
    const candidate = configured.includes('/') || configured.includes('\\')
      ? resolvePath(configured, cwd)
      : configured
    if ((candidate.includes('/') || candidate.includes('\\')) && !existsSync(candidate)) {
      throw new Error(`murasaki: configured signtool.exe was not found: ${candidate}`)
    }
    return candidate
  }

  const where = spawnSync('where.exe', ['signtool.exe'], {
    encoding: 'utf8',
    windowsHide: true,
  })
  const fromPath = where.status === 0
    ? where.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    : undefined
  if (fromPath) return fromPath

  const programFilesX86 = process.env['ProgramFiles(x86)']
  if (programFilesX86) {
    const sdkBin = join(programFilesX86, 'Windows Kits', '10', 'bin')
    if (existsSync(sdkBin)) {
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      const versions = readdirSync(sdkBin, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d+(?:\.\d+)+$/.test(entry.name))
        .map((entry) => entry.name)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      for (const version of versions) {
        const candidate = join(sdkBin, version, arch, 'signtool.exe')
        if (existsSync(candidate)) return candidate
      }
    }
  }

  throw new Error(
    'murasaki: signtool.exe was not found. Install the Windows SDK or set ' +
      'MURASAKI_SIGNTOOL_PATH / sign.windows.signToolPath.',
  )
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function optionalPath(value: string | undefined, cwd: string): string | undefined {
  const trimmed = optionalString(value)
  return trimmed ? resolvePath(trimmed, cwd) : undefined
}

function resolvePath(value: string, cwd: string): string {
  return isAbsolute(value) ? value : resolve(cwd, value)
}

function validateHttpUrl(value: string, label: string): void {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new Error(`murasaki: ${label} must be an absolute HTTP or HTTPS URL.`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`murasaki: ${label} must be an absolute HTTP or HTTPS URL.`)
  }
}

function sanitizeOutput(output: string, secret: string | undefined): string {
  const trimmed = output.trim()
  return secret ? trimmed.split(secret).join('[redacted]') : trimmed
}
