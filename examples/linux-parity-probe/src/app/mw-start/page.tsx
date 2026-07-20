/**
 * navigation-middleware probe: src/middleware.ts redirects every navigation
 * to this path before it renders. If this ever shows, the redirect failed.
 */
export default function MiddlewareStartPage() {
  return <div data-probe="MIDDLEWARE_REDIRECT_DID_NOT_FIRE" />
}
