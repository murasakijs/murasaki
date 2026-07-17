# RFC 0004 — Runtime Plugin System (Design Only)

- Status: Draft for discussion (authored 2026-07-17). **Must not block 1.0.**
- Problem: the build-time plugin SDK cannot add runtime behavior. Tauri has
  `tauri-plugin-*`; Electron has npm. Murasaki needs an answer that doesn't
  surrender its two differentiators: TypeScript-only DX and deny-by-default
  capabilities.

## Position: Node-first plugins, no native ABI

Murasaki bundles Node — that is the extension mechanism. A runtime plugin is
an npm package running **in the Node Main process**, never in the renderer,
never as a dynamic native library. Rust surface stays fixed and first-party;
plugins needing new OS primitives upstream them into `@murasakijs/native`
(the Tauri model of community Rust plugins is explicitly rejected: it would
reintroduce "you write Rust" and an unauditable native ABI).

## Shape (target 1.1+)

```ts
// murasaki.config.ts
plugins: [sqlitePlugin({ file: 'app.db' })]   // same array as build-time SDK

// plugin package
export default defineMurasakiPlugin({
  name: 'sqlite',
  build: { /* existing build-time hooks, unchanged */ },
  runtime: {                          // NEW
    capabilities: ['plugin:sqlite'],  // namespaced grants, declared not granted
    setup(ctx) {                      // runs in Node Main after ready()
      ctx.expose('query', async (sql, params) => { ... })  // renderer-callable
    },
  },
})
```

- `ctx.expose(name, fn)` surfaces functions at
  `/__murasaki/plugin/<plugin>/<name>` over the existing authenticated
  loopback tier + wire codec — no new IPC channel, no new trust tier.
- **Renderer access requires the window to hold `plugin:<name>` capability**
  in its (deny-by-default) capability list — closing today's asymmetry where
  HTTP-transiting surfaces bypass per-window grants. Enforcement point: the
  prod-server/dev-middleware route handler checks the calling window's grant
  set (plumbed from the window-template catalog).
- Renderer-side: `usePlugin('sqlite')` returns typed stubs (codegen at build
  time from the plugin's exposed surface, same trick as server actions).
- Lifecycle: `setup` after `ready()`, teardown before `beforeQuit`; failures
  isolate (a throwing plugin is disabled with a structured log, not a crash).
- Naming/discovery: `murasaki-plugin-*` / `@scope/murasaki-plugin-*`,
  `murasaki` peer range, `capabilities` field surfaced by `murasaki doctor`
  and the MCP server.

## Trust model (unchanged honesty)

A runtime plugin has full Node authority — same as `murasaki.config.ts` today.
The capability gate protects the **renderer→plugin** edge, not the
plugin→OS edge. Docs must say exactly that.

## Sequencing

1.0 ships build-time SDK as-is (`experimental`). This RFC lands as a tracked
proposal; implementation targets 1.1 behind `experimental.runtimePlugins`.
First-party reference plugins to seed the ecosystem: `sqlite`, `autostart`,
`window-state` (the three most-requested Tauri plugins by download count).
