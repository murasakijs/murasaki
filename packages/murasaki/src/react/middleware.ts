/**
 * Route middleware — murasaki's take on Next.js middleware, for its
 * client-side router.
 *
 * `src/middleware.ts` may export a default function that runs before every
 * client-side navigation and can redirect it:
 *
 * ```ts
 * // src/middleware.ts
 * import type { Middleware } from 'murasaki'
 *
 * const middleware: Middleware = ({ pathname }) => {
 *   if (pathname === '/admin') return { redirect: '/' }
 * }
 * export default middleware
 * ```
 *
 * It may be async (e.g. an auth check) — `<AppRouter>` awaits it before
 * rendering the matched route.
 */
export interface MiddlewareContext {
  pathname: string
}

export type MiddlewareResult = { redirect: string } | void | undefined

export type Middleware = (
  ctx: MiddlewareContext,
) => MiddlewareResult | Promise<MiddlewareResult>
