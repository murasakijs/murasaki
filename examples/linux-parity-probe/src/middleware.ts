import type { Middleware } from 'murasaki'

/** navigation-middleware probe: redirects a fixed path before it ever renders. */
const middleware: Middleware = ({ pathname }) => {
  if (pathname === '/mw-start') return { redirect: '/mw-landed' }
}

export default middleware
