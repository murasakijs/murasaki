import type { RouteHandler } from 'murasaki'

/** api-routes probe: plain GET + POST, exercised by both the renderer and the smoke script (curl). */
export const GET: RouteHandler = async () => Response.json({ message: 'linux-parity-probe hello' })

export const POST: RouteHandler = async (request) => {
  const body = await request.json()
  return Response.json({ echo: body })
}
