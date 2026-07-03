import type { Middleware } from 'murasaki'

// Example route guard — runs before every navigation. Edit or delete.
const middleware: Middleware = ({ pathname }) => {
  if (pathname === '/admin') return { redirect: '/' }
}

export default middleware
