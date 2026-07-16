import type { FileAssociationConfig, MurasakiConfig, ProtocolConfig } from './config.js'

export interface ResolvedProtocol extends ProtocolConfig {
  scheme: string
  name: string
}

export interface ResolvedFileAssociation extends Omit<FileAssociationConfig, 'role'> {
  extensions: string[]
  name: string
  description: string
  role: NonNullable<FileAssociationConfig['role']>
}

export interface ResolvedAssociations {
  protocols: ResolvedProtocol[]
  files: ResolvedFileAssociation[]
}

const RESERVED_SCHEMES = new Set([
  'blob', 'callto', 'data', 'file', 'http', 'https', 'javascript', 'ldap',
  'mailto', 'maps', 'ms-appx', 'ms-settings', 'ms-windows-store', 'smb',
  'tel', 'telnet', 'vbscript', 'wallet', 'murasaki',
])
const SCHEME_RE = /^[a-z][a-z0-9+.-]{0,62}$/
const EXTENSION_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/
const MIME_RE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i

/** Validate and normalize OS registration config before creating artifacts. */
export function resolveAssociations(config: Pick<MurasakiConfig, 'appId' | 'productName' | 'protocols' | 'fileAssociations'>): ResolvedAssociations {
  validateDisplayText(config.productName, 'productName')
  const seenSchemes = new Set<string>()
  const protocols = (config.protocols ?? []).map((entry, index) => {
    const scheme = entry.scheme.trim().toLowerCase()
    if (!SCHEME_RE.test(scheme)) {
      throw new TypeError(`protocols[${index}].scheme must be a valid RFC 3986 scheme`)
    }
    if (RESERVED_SCHEMES.has(scheme)) {
      throw new TypeError(`protocols[${index}].scheme cannot override reserved scheme ${scheme}`)
    }
    if (seenSchemes.has(scheme)) throw new TypeError(`duplicate protocol scheme: ${scheme}`)
    seenSchemes.add(scheme)
    const name = entry.name?.trim() || `${config.productName} URL`
    validateDisplayText(name, `protocols[${index}].name`)
    return { scheme, name }
  })

  const seenExtensions = new Set<string>()
  const seenMimeTypes = new Set<string>()
  const files = (config.fileAssociations ?? []).map((entry, index) => {
    if (!Array.isArray(entry.extensions) || entry.extensions.length === 0) {
      throw new TypeError(`fileAssociations[${index}].extensions must contain at least one extension`)
    }
    const extensions = entry.extensions.map((raw) => {
      const extension = raw.trim().replace(/^\./, '').toLowerCase()
      if (!EXTENSION_RE.test(extension)) {
        throw new TypeError(`fileAssociations[${index}] contains invalid extension: ${raw}`)
      }
      if (seenExtensions.has(extension)) throw new TypeError(`duplicate file extension: ${extension}`)
      seenExtensions.add(extension)
      return extension
    })
    if (entry.mimeType && !MIME_RE.test(entry.mimeType)) {
      throw new TypeError(`fileAssociations[${index}].mimeType must be a valid MIME type`)
    }
    const mimeType = entry.mimeType?.toLowerCase()
    if (mimeType && seenMimeTypes.has(mimeType)) {
      throw new TypeError(`duplicate file association MIME type: ${mimeType}`)
    }
    if (mimeType) seenMimeTypes.add(mimeType)
    const name = entry.name?.trim() || `${config.productName} document`
    const description = entry.description?.trim() || name
    validateDisplayText(name, `fileAssociations[${index}].name`)
    validateDisplayText(description, `fileAssociations[${index}].description`)
    return {
      extensions,
      name,
      description,
      role: entry.role ?? 'viewer',
      ...(mimeType ? { mimeType } : {}),
    }
  })

  return { protocols, files }
}

function validateDisplayText(value: string, label: string): void {
  if (value.length === 0 || value.length > 255 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label} must be 1-255 printable characters`)
  }
}

/** Stable Windows ProgID derived from the application id and extension. */
export function windowsProgId(appId: string, extension: string): string {
  const safeAppId = appId.replace(/[^A-Za-z0-9.]/g, '_').replace(/^\.+|\.+$/g, '') || 'Murasaki.App'
  return `${safeAppId}.${extension}`
}
