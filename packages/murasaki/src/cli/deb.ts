/**
 * Pure-Node `ar` archive + ustar tar codec — the two file formats a `.deb`
 * package is built from (`ar` as the outer container holding
 * `debian-binary` / `control.tar.gz` / `data.tar.gz`; ustar for each of
 * those `.tar.gz` members). No `dpkg-deb`/`ar`/`tar` binary dependency, so
 * `murasaki installer --target linux-*` (installer.ts's `installerLinux`,
 * the caller) cross-builds a `.deb` from any host the same way `bundle
 * --target linux-*` already does. gzip is `node:zlib`'s built-in
 * `gzipSync`/`gunzipSync` — callers compress the plain tar this module
 * writes themselves (kept separate so tests can inspect the uncompressed
 * tar structure directly).
 */

export interface ArEntry {
  name: string
  data: Buffer
}

const AR_MAGIC = '!<arch>\n'
const AR_HEADER_SIZE = 60
/** ar's fixed 2-byte end-of-header marker (0x60 0x0A) — not "backtick + newline" text, the format itself defines these as the literal terminating bytes. */
const AR_END_MARKER = '`\n'

/**
 * Writes a Unix `ar` archive: the `"!<arch>\n"` magic, then one 60-byte
 * header + payload per entry (payload padded to an even byte count with a
 * trailing `\n`, per the format's own alignment rule). Every murasaki
 * `.deb` has exactly three entries — `debian-binary`, `control.tar.gz`,
 * `data.tar.gz` — in that order (installer.ts's `installerLinux` assembles
 * them); this codec itself doesn't assume any particular entry set.
 */
export function writeArArchive(entries: ArEntry[]): Buffer {
  const parts: Buffer[] = [Buffer.from(AR_MAGIC, 'ascii')]
  for (const entry of entries) {
    if (Buffer.byteLength(entry.name, 'ascii') > 16) {
      throw new Error(`murasaki: ar entry name too long (max 16 bytes): ${entry.name}`)
    }
    const header = Buffer.alloc(AR_HEADER_SIZE, 0x20) // space-padded, ar's convention for unused field width
    header.write(entry.name, 0, 16, 'ascii')
    header.write('0', 16, 12, 'ascii') // mtime — 0 for deterministic output
    header.write('0', 28, 6, 'ascii') // owner uid
    header.write('0', 34, 6, 'ascii') // group gid
    header.write('100644', 40, 8, 'ascii') // file mode (octal, regular file)
    header.write(String(entry.data.length), 48, 10, 'ascii') // file size
    header.write(AR_END_MARKER, 58, 2, 'ascii')
    parts.push(header, entry.data)
    if (entry.data.length % 2 === 1) parts.push(Buffer.from('\n', 'ascii'))
  }
  return Buffer.concat(parts)
}

/**
 * Reads back an `ar` archive written by `writeArArchive` — used by
 * linux-deb.test.mjs for a structural round-trip without shelling out to
 * `ar`/`dpkg-deb`.
 */
export function readArArchive(buffer: Buffer): ArEntry[] {
  const magic = buffer.subarray(0, AR_MAGIC.length).toString('ascii')
  if (magic !== AR_MAGIC) {
    throw new Error('murasaki: not an ar archive (bad magic)')
  }
  const entries: ArEntry[] = []
  let offset = AR_MAGIC.length
  while (offset < buffer.length) {
    const header = buffer.subarray(offset, offset + AR_HEADER_SIZE)
    const name = header.subarray(0, 16).toString('ascii').trim()
    const size = parseInt(header.subarray(48, 58).toString('ascii').trim(), 10)
    const dataStart = offset + AR_HEADER_SIZE
    const data = Buffer.from(buffer.subarray(dataStart, dataStart + size))
    entries.push({ name, data })
    offset = dataStart + size + (size % 2)
  }
  return entries
}

export interface TarEntry {
  /** POSIX-style relative path (e.g. `"./usr/bin/app"` or `"."`). */
  path: string
  type: 'file' | 'directory'
  mode: number
  mtime?: number
  data?: Buffer
}

export interface ReadTarEntry {
  path: string
  type: 'file' | 'directory'
  mode: number
  mtime: number
  data: Buffer
}

const USTAR_BLOCK_SIZE = 512
const USTAR_MAGIC = 'ustar\0'
const USTAR_VERSION = '00'

/** Writes a null-terminated octal ASCII field (the ustar numeric field convention) into `buffer` at `[offset, offset + length)`. */
function writeOctalField(buffer: Buffer, offset: number, length: number, value: number): void {
  const digits = length - 1
  const octal = value.toString(8).padStart(digits, '0')
  if (octal.length > digits) {
    throw new Error(`murasaki: value ${value} does not fit in a ${digits}-digit ustar octal field`)
  }
  buffer.write(octal, offset, digits, 'ascii')
  buffer[offset + length - 1] = 0
}

function readOctalField(buffer: Buffer, offset: number, length: number): number {
  const raw = buffer
    .subarray(offset, offset + length)
    .toString('ascii')
    .replace(/\0.*$/, '')
    .trim()
  return raw.length > 0 ? parseInt(raw, 8) : 0
}

/**
 * Splits `path` into ustar's `name` (<=100 bytes) + `prefix` (<=155 bytes)
 * fields, reassembled on read as `prefix + '/' + name`. Throws a clear error
 * if no split keeps both halves within bounds (ustar's hard limit: 255
 * bytes total, and only at a `/` boundary).
 */
function splitUstarPath(path: string): { name: string; prefix: string } {
  if (Buffer.byteLength(path, 'utf8') <= 100) return { name: path, prefix: '' }
  const segments = path.split('/')
  for (let i = segments.length - 1; i > 0; i--) {
    const prefix = segments.slice(0, i).join('/')
    const name = segments.slice(i).join('/')
    if (Buffer.byteLength(prefix, 'utf8') <= 155 && Buffer.byteLength(name, 'utf8') <= 100) {
      return { name, prefix }
    }
  }
  throw new Error(
    `murasaki: path too long for the ustar tar format (max 100+155 bytes, split on '/'): ${path}`,
  )
}

function ustarHeader(entry: TarEntry, size: number): Buffer {
  const header = Buffer.alloc(USTAR_BLOCK_SIZE, 0)
  const path = entry.type === 'directory' && !entry.path.endsWith('/') ? `${entry.path}/` : entry.path
  const { name, prefix } = splitUstarPath(path)

  header.write(name, 0, 100, 'utf8')
  writeOctalField(header, 100, 8, entry.mode)
  writeOctalField(header, 108, 8, 0) // uid
  writeOctalField(header, 116, 8, 0) // gid
  writeOctalField(header, 124, 12, size)
  writeOctalField(header, 136, 12, entry.mtime ?? 0)
  header.fill(0x20, 148, 156) // checksum placeholder (8 spaces) while the sum below is computed
  header.write(entry.type === 'directory' ? '5' : '0', 156, 1, 'ascii') // typeflag
  header.write(USTAR_MAGIC, 257, 6, 'ascii')
  header.write(USTAR_VERSION, 263, 2, 'ascii')
  writeOctalField(header, 329, 8, 0) // devmajor
  writeOctalField(header, 337, 8, 0) // devminor
  header.write(prefix, 345, 155, 'utf8')

  let checksum = 0
  for (const byte of header) checksum += byte
  // ustar's checksum field is 6 octal digits + NUL + space — distinct from
  // every other numeric field above (NUL-only terminated), per spec.
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii')
  header[154] = 0
  header[155] = 0x20

  return header
}

/**
 * Writes a plain (uncompressed) ustar tar stream — POSIX IEEE 1003.1-2001
 * ustar, the format every modern `tar` reads, using the `prefix` field for
 * any path longer than 100 bytes (see `splitUstarPath`).
 */
export function writeUstarTar(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = []
  for (const entry of entries) {
    const data = entry.type === 'file' ? (entry.data ?? Buffer.alloc(0)) : Buffer.alloc(0)
    parts.push(ustarHeader(entry, data.length))
    if (data.length > 0) {
      parts.push(data)
      const padding = (USTAR_BLOCK_SIZE - (data.length % USTAR_BLOCK_SIZE)) % USTAR_BLOCK_SIZE
      if (padding > 0) parts.push(Buffer.alloc(padding))
    }
  }
  parts.push(Buffer.alloc(USTAR_BLOCK_SIZE * 2)) // two zero blocks mark the end of the archive
  return Buffer.concat(parts)
}

/**
 * Reads back a ustar tar stream written by `writeUstarTar` — used by
 * linux-deb.test.mjs for a structural round-trip without shelling out to
 * `tar`, and by installer.ts's md5sums generation (which needs the exact
 * file set/paths that ended up in `data.tar`).
 */
export function readUstarTar(buffer: Buffer): ReadTarEntry[] {
  const entries: ReadTarEntry[] = []
  let offset = 0
  while (offset + USTAR_BLOCK_SIZE <= buffer.length) {
    const header = buffer.subarray(offset, offset + USTAR_BLOCK_SIZE)
    if (header.every((byte) => byte === 0)) break // end-of-archive zero block

    const nameField = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    const prefixField = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
    const path = prefixField.length > 0 ? `${prefixField}/${nameField}` : nameField
    const mode = readOctalField(header, 100, 8)
    const size = readOctalField(header, 124, 12)
    const mtime = readOctalField(header, 136, 12)
    const typeflag = String.fromCharCode(header[156])
    const isDirectory = typeflag === '5'

    const dataStart = offset + USTAR_BLOCK_SIZE
    const data = Buffer.from(buffer.subarray(dataStart, dataStart + size))
    entries.push({
      path: isDirectory ? path.replace(/\/$/, '') : path,
      type: isDirectory ? 'directory' : 'file',
      mode,
      mtime,
      data,
    })

    const padding = (USTAR_BLOCK_SIZE - (size % USTAR_BLOCK_SIZE)) % USTAR_BLOCK_SIZE
    offset = dataStart + size + padding
  }
  return entries
}
