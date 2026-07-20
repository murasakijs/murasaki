import type { RouteHandler } from 'murasaki'

/** api-routes probe: a dynamic [name] segment. */
export const GET: RouteHandler = (_request, { params }) =>
  Response.json({ greeting: `Hello, ${params.name}! (linux-parity-probe)` })
