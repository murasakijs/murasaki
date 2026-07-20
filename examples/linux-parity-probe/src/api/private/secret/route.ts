import type { RouteHandler } from 'murasaki'

/**
 * capability-permissions probe: intentionally never listed in any window's
 * `backendCapabilities` (see murasaki.config.ts). Its only purpose is to be
 * unreachable — the primary renderer asserts this returns 403.
 */
export const GET: RouteHandler = async () => Response.json({ secret: 'never reachable from any window' })
