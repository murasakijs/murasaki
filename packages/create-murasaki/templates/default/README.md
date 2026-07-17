# Murasaki App

A desktop app scaffolded by `create-murasaki`.

```bash
pnpm dev        # Vite dev server + native WebView + React Fast Refresh
pnpm build      # Vite production build
pnpm bundle     # native .app / .exe / AppImage folder
pnpm installer  # distributable installer
```

`Hello, Murasaki 🦋`

## Environment variables

Murasaki automatically loads `.env`, `.env.local`, and mode-specific files such
as `.env.development.local`. Renderer-public values use the Murasaki namespace:

```env
MURASAKI_PUBLIC_API_ORIGIN=https://api.example.com
```

```ts
const apiOrigin = import.meta.env.MURASAKI_PUBLIC_API_ORIGIN
```

Unprefixed values stay Node-only and are available through `process.env` in Node
Main, Server Actions, and API Routes. `.env` files are not copied into packaged
apps.
