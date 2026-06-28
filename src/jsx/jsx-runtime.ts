// JSX automatic runtime entry — consumed by `tsx` / `esbuild` when the
// user's tsconfig has `jsxImportSource: "murasaki"`.
//
// The transform emits calls like:
//   jsx(Component, props, key?)
//   jsxs(Component, propsWithChildrenArray, key?)
//   <></> → jsx(Fragment, { children: [...] })

export { Fragment, jsx, jsx as jsxs } from './runtime.ts'
export type { JSX } from './types.ts'
