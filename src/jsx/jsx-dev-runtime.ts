// JSX dev runtime entry — used when tsconfig has `jsx: "react-jsxdev"`.
// We don't (yet) track source locations or component stacks, so jsxDEV
// behaves identically to jsx.

export { Fragment, jsx as jsxDEV } from './runtime.ts'

// JSX namespace is declared globally in ./types.ts — picked up automatically
// by the JSX compiler without needing an explicit re-export here.
