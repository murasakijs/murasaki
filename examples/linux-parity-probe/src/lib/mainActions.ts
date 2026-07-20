'use main'

/**
 * node-main-lifecycle probe: a typed renderer-to-Node call. Proves the
 * 'use main' RPC boundary round-trips through the wire codec and reaches the
 * long-lived Node Main process (not a stateless request handler).
 */
export async function ping(value: string): Promise<{ pong: string; pid: number }> {
  if (typeof value !== 'string' || value.length > 256) {
    throw new TypeError('value must be a string no longer than 256 characters')
  }
  return { pong: value, pid: process.pid }
}
