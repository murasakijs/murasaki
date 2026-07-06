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
  turbopack: {
    root: workspaceRoot,
  },
};

export default withMDX(config);
