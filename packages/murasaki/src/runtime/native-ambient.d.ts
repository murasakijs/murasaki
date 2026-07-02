// Ambient stub for `@murasakijs/native` so the framework compiles before
// the Rust binding is built. Real types come from
// `crates/native/index.d.ts` at napi build time.
declare module '@murasakijs/native' {
  const anything: any
  export = anything
}
