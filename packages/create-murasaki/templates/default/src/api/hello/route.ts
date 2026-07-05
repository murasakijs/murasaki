import type { RouteHandler } from 'murasaki'

export const GET: RouteHandler = () => Response.json({ message: 'Hello from a murasaki API route' })

export const POST: RouteHandler = async (request) => {
  const body = await request.json()
  return Response.json({ echo: body })
}
