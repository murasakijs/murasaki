// JSX dev runtime entry — used when tsconfig has `jsx: "react-jsxdev"`.
// We don't (yet) track source locations or component stacks, so jsxDEV
// behaves identically to jsx.

export { Fragment, jsx as jsxDEV } from './runtime.ts'
export type { JSX } from './types.ts'
