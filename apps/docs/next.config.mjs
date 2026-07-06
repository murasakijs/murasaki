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
  // Dynamic server deploy (Dokploy/VPS), not a static export: this app is a
  // real Next.js server (i18n middleware, per-query server search with a
  // Japanese tokenizer — neither is possible from `output: "export"`).
  // `standalone` traces the minimal `node_modules` subset the server needs
  // into `.next/standalone`, which the Dockerfile copies into the runner
  // image instead of shipping the whole workspace.
  output: "standalone",
  // The workspace root (see `workspaceRoot` above) isn't necessarily where
  // this app's Docker build runs `pnpm install` from, but locally it's the
  // right place to trace `node_modules` up from for the pnpm workspace.
  outputFileTracingRoot: workspaceRoot,
  images: {
    // No Image Optimization server is running in the container; keep it
    // simple rather than wiring one up.
    unoptimized: true,
  },
  turbopack: {
    root: workspaceRoot,
  },
};

export default withMDX(config);
