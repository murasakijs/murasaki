import type { RouteHandler } from 'murasaki'

/**
 * A demo API route at POST /api/action-demo. Like every route.ts it runs on the
 * server (Node), so it can reach the filesystem, a database, secrets, … — here
 * it just greets you and proves it ran in Node. The card's "Call API route"
 * button (and its context-menu item) posts to this endpoint.
 */
export const POST: RouteHandler = async (request) => {
  const { name } = (await request.json()) as { name: string }
  return Response.json({ greeting: `Hello, ${name}! (from Node ${process.version})` })
}
