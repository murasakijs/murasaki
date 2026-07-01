# Contributing to Murasaki

Thank you for your interest in contributing to Murasaki! This document
covers how to get set up locally, the workflow we prefer for issues and
pull requests, and the coding conventions used throughout the repo.

There are lots of ways to contribute — you don't have to write code:

- 🐛 Reporting bugs (see [Reporting issues](#reporting-issues))
- 💡 Suggesting features (see [Feature requests](#feature-requests))
- 📖 Improving documentation
- 🧪 Writing examples
- 💬 Answering questions in [Discussions](https://github.com/murasakijs/murasaki/discussions)
- 📢 Spreading the word

---

## Table of Contents

- [Getting started locally](#getting-started-locally)
- [Repository layout](#repository-layout)
- [Development workflow](#development-workflow)
- [Reporting issues](#reporting-issues)
- [Feature requests](#feature-requests)
- [Pull requests](#pull-requests)
- [Coding style](#coding-style)
- [Testing manually](#testing-manually)
- [Release process](#release-process)
- [Getting help](#getting-help)

---

## Getting started locally

Prerequisites:

- **Node.js 22+** (we test against Node 24)
- **pnpm 9+**
- macOS / Windows / Linux (native WebView installed)

```bash
git clone https://github.com/murasakijs/murasaki.git
cd murasaki
pnpm install
pnpm --filter murasaki tsc -p tsconfig.build.json
cd examples/app-router
pnpm dev
```

The dev server opens a WebView window and reloads on file changes. Edit
files under `src/` in the root of the repo or under `examples/app-router/src/`
— both hot-reload.

### Optional tooling for cross-compile

The `--target` flag downloads binaries at build time. For `.msi` and
`.AppImage` output you additionally need:

```bash
# macOS
brew install --cask dotnet-sdk && dotnet tool install -g wix   # for .msi
brew install squashfs                                          # for .AppImage
```

Without these, cross-compile still succeeds — it just falls back to `.zip`
or `.tar.gz`.

---

## Repository layout

```
murasaki/
├── bin/
│   └── murasaki.js           CLI entry point (dev/build/bundle/installer)
├── src/
│   ├── index.ts              Public API (components, hooks, defineAction, defineConfig)
│   ├── dev.tsx               Development server (HMR, file watcher)
│   ├── prod.tsx              Production boot (used inside dist/server.cjs)
│   ├── build.ts              Build pipeline (esbuild → pack → installer)
│   ├── config.ts             murasaki.config.ts loader + resolveAppMeta
│   ├── download.ts           Cross-compile: Node + webview prebuild download
│   ├── wix.ts                .msi builder (WiX v4)
│   ├── appimage.ts           .AppImage builder (mksquashfs + type-2 runtime)
│   ├── rpc-server.ts         defineAction / attachRpc
│   ├── rpc-client.ts         callAction / useAction
│   ├── components/           Batteries-included UI (Button, Card, Modal, …)
│   ├── jsx/                  JSX runtime (SSR + hydration)
│   └── runtime/              window lifecycle, native bridge, routing
└── examples/
    └── app-router/           Reference app used for iteration + smoke tests
```

The `create-murasaki` scaffolder lives in a sibling repo:
[github.com/murasakijs/create-murasaki](https://github.com/murasakijs/create-murasaki).

---

## Development workflow

1. **Search first.** Check open [issues](https://github.com/murasakijs/murasaki/issues)
   and [PRs](https://github.com/murasakijs/murasaki/pulls) for related work.
2. **Open an issue** describing what you plan to do for any non-trivial
   change — API additions, protocol changes, new dependencies. Small bug
   fixes, typo corrections, and doc improvements can go straight to a PR.
3. **Fork + branch** from `main` using a short descriptive name
   (`fix/close-button-hang`, `feat/data-table`).
4. **Make the change** with focused commits.
5. **Run `pnpm --filter murasaki tsc -p tsconfig.build.json`** to
   confirm the whole build compiles.
6. **Verify by hand** with `examples/app-router`.
7. **Open a PR** referencing the issue.

---

## Reporting issues

Before filing a new issue:

1. Search [existing issues](https://github.com/murasakijs/murasaki/issues)
   including closed ones.
2. Confirm you're running the **latest version** of murasaki
   (`pnpm add murasaki@latest`).
3. Try to reproduce with `examples/app-router` — a minimal reproducer helps
   enormously.

Please include:

- **What you did** (commands, code snippets).
- **What you expected**.
- **What actually happened** (full error message + stack trace where possible).
- **Your environment**: OS + version, Node version, `pnpm --version`,
  `pnpm ls murasaki`.

---

## Feature requests

Open an issue tagged **Feature request** describing:

- The **problem** you're trying to solve — not just the API you'd like.
- Any workarounds you've considered.
- Prior art from Next.js / Tauri / Electron if it applies.

We prefer to discuss non-trivial APIs before code is written.

---

## Pull requests

- One PR per logical change.
- Include tests **or** a manual verification note.
- Explain the "why" in the PR description — the diff shows the "what".
- Reference the issue with `Fixes #NNN` or `Closes #NNN`.
- CI will run TypeScript compilation. Make sure it's green before requesting review.

### Commit messages

Follow the general format the repo already uses:

```
subject line summarizing the change

Extra context — motivation, tradeoffs, follow-up notes.
Wrap at ~72 characters.
```

Emoji, ticket prefixes, or scope prefixes aren't required.

### Reviews

Expect at least one maintainer review. Please be patient and receptive to
feedback — we all want the change to land in a great state.

---

## Coding style

- **TypeScript** strict, with explicit return types on exported functions.
- **No React**. We have our own JSX runtime — don't add react/react-dom.
- **No lodash / date-fns / axios**. Prefer built-in Node + browser APIs.
- **No implicit `any`**.
- **Comments** — write them only when the *why* is non-obvious. Well-named
  identifiers already explain the *what*.
- **Errors** — throw `Error` with a clear message; don't swallow.
- **Cross-platform** — anything touching the shell / filesystem / paths must
  work on macOS, Windows, and Linux.

Formatting: the repo uses **Biome** where enabled. If in doubt, match the
surrounding code.

---

## Testing manually

We don't have an automated test suite yet. Please run through the
smoke checklist below before opening a PR that touches runtime code:

1. `pnpm --filter murasaki tsc -p tsconfig.build.json` — clean compile.
2. `cd examples/app-router && pnpm dev` — window opens, HMR works.
3. `pnpm build && node dist/server.cjs` — production bundle boots.
4. `pnpm bundle` — `.app` (or the OS-native folder) is produced and launches.
5. `pnpm installer` — installer file is produced.

Cross-compile changes should also be verified with `--target win-x64` (at
minimum) to catch platform assumptions.

---

## Release process

Releases are automated:

1. Bump `package.json` version (`npm version <type> --no-git-tag-version`).
2. Update template pins in `create-murasaki` if the change is user-facing.
3. Commit and tag: `git tag vX.Y.Z && git push origin main --tags`.
4. GitHub Actions runs `.github/workflows/release.yml`, which:
   - Runs the build
   - Publishes to npm with **Trusted Publisher OIDC + provenance**
   - Attaches release artefacts

Maintainers only — you don't need to do this as a contributor.

---

## Getting help

- 💬 [GitHub Discussions](https://github.com/murasakijs/murasaki/discussions)
  — questions, design conversations
- 🐛 [Issues](https://github.com/murasakijs/murasaki/issues) — bugs, feature requests
- 📧 murasaki@ichi10.com — maintainer contact for anything sensitive

By contributing, you agree that your contributions will be licensed under
the [MIT License](./LICENSE).
