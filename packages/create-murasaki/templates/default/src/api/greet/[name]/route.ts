import type { RouteHandler } from 'murasaki'

export const GET: RouteHandler = (_request, { params }) =>
  Response.json({ greeting: `Hello, ${params.name}!` })
