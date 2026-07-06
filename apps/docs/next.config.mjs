import path from "node:path";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

// This app lives at <repo root>/apps/docs inside the murasaki pnpm workspace.
// A pnpm-workspace.yaml also happens to exist a couple of directories further
// up (an unrelated sandbox), which makes Next.js mis-infer the monorepo root.
// Pin it explicitly to this repo's root to silence that and keep Turbopack's
// file access scoped correctly.
const workspaceRoot = path.join(import.meta.dirname, "..", "..");

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // Static export: the same `out/` folder deploys to GitHub Pages or a VPS
  // (nginx/caddy) behind murasaki.dev. No `basePath` is set because the
  // target is the root of a domain — a project-page deploy (e.g.
  // username.github.io/murasaki) would additionally need `basePath` /
  // `assetPrefix` set to the repo name.
  output: "export",
  images: {
    // No Image Optimization server is available for a static export.
    unoptimized: true,
  },
  // Serves `path/index.html` for nested routes, which is what GitHub Pages
  // (and most static hosts) expect.
  trailingSlash: true,
  turbopack: {
    root: workspaceRoot,
  },
};

export default withMDX(config);
