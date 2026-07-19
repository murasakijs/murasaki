import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

export async function hashPassword(password) {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, 32)
  return `scrypt$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`
}

export async function verifyPassword(password, encoded) {
  const [algorithm, saltText, hashText] = String(encoded).split('$')
  if (algorithm !== 'scrypt' || !saltText || !hashText) return false
  const expected = Buffer.from(hashText, 'base64url')
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function newSessionToken() { return randomBytes(32).toString('base64url') }
export function hashToken(token) { return createHash('sha256').update(token).digest('hex') }

export function parseCookies(header = '') {
  const cookies = Object.create(null)
  for (const part of header.split(';').map((value) => value.trim()).filter(Boolean)) {
    const index = part.indexOf('=')
    const name = index < 0 ? part : part.slice(0, index)
    if (!name || Object.hasOwn(cookies, name)) continue
    try {
      cookies[name] = index < 0 ? '' : decodeURIComponent(part.slice(index + 1))
    } catch {
      // A malformed unrelated Cookie header must not turn every authenticated
      // endpoint into a 500 response. Ignore only the malformed pair.
    }
  }
  return cookies
}

export function sessionCookie(token, { secure = false, maxAge = 8 * 60 * 60 } = {}) {
  return `orglia_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export function clearSessionCookie({ secure = false } = {}) {
  return `orglia_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`
}

export async function readSecret(name, { requiredInProduction = true, developmentFallback } = {}) {
  const file = process.env[`${name}_FILE`]
  const direct = process.env[name]
  if (file) return (await readFile(file, 'utf8')).trim()
  if (direct) return direct
  if (process.env.NODE_ENV === 'production' && requiredInProduction) throw new Error(`${name} or ${name}_FILE is required in production`)
  if (developmentFallback) return developmentFallback
  return ''
}
