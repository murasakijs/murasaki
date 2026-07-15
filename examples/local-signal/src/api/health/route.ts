import type { RouteHandler } from 'murasaki'

export const GET: RouteHandler = () => Response.json({
  status: 'ok',
  service: 'murasaki-showcase',
  runtime: process.version,
  timestamp: new Date().toISOString(),
})
