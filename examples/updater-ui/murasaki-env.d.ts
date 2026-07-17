/// <reference types="vite/client" />

// `import Icon from './x.svg?react'` — murasaki's Vite plugin turns it into a
// React component (so it inherits `currentColor`). Plain `.svg` imports are URLs.
declare module '*.svg?react' {
  import type { FunctionComponent, SVGProps } from 'react'
  const ReactComponent: FunctionComponent<SVGProps<SVGSVGElement> & { title?: string }>
  export default ReactComponent
}
