declare module 'virtual:murasaki/routes' {
  import type { Middleware, RouteEntry } from 'murasaki'
  export const routes: RouteEntry[]
  export const appDir: string
  export const middleware: Middleware | undefined
}
