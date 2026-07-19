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
- [Plugins](#plugins)
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
pnpm --filter murasaki build
cd examples/papelle
pnpm dev
```

The dev server opens a WebView window and reloads on file changes. Edit
files under `packages/murasaki/src/` or under `examples/papelle/src/`
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

This is a monorepo — every published package lives here, in one place, and
each is released independently via its own tag-triggered GitHub Actions
workflow:

| Path | What it is |
| --- | --- |
| `packages/murasaki` | The `murasaki` npm package — CLI (`bin/murasaki.mjs`), framework runtime (`src/`), config loader, and the capability manifest (`capabilities.json`). |
| `crates/native` | `@murasakijs/native` — the Rust binding (napi-rs) for windows, menus, dialogs, clipboard, notifications, tray, and other native APIs. |
| `packages/create-murasaki` | The `create-murasaki` scaffolder and its default project template. |
| `packages/ui` | `@murasakijs/ui` — the optional component library. |
| `packages/mcp` | `@murasakijs/mcp` — the MCP server that gives AI coding tools grounded Murasaki knowledge. |
| `apps/docs` | The docs site ([murasaki.ichi10.com](https://murasaki.ichi10.com)), English and Japanese. |
| `examples/` | Full example apps — [Papelle](https://github.com/murasakijs/murasaki/tree/main/examples/papelle), [Oscilla](https://github.com/murasakijs/murasaki/tree/main/examples/oscilla), and [Orglia](https://github.com/murasakijs/murasaki/tree/main/examples/orglia) — used for manual verification and screenshots. See the [example verification ladder](examples/README.md); a client build alone is not completion. |

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
5. **Run `pnpm --filter murasaki build`** to confirm it compiles, then
   **`pnpm --filter murasaki test`** to run the test suite.
6. **Verify by hand** with the affected app in `examples/` and record the
   relevant [verification level](examples/README.md#verification-ladder).
7. **Open a PR** referencing the issue.

---

## Reporting issues

Before filing a new issue:

1. Search [existing issues](https://github.com/murasakijs/murasaki/issues)
   including closed ones.
2. Confirm you're running the **latest version** of murasaki
   (`pnpm add murasaki@latest`).
3. Try to reproduce from a fresh `npm create murasaki@latest` scaffold, or a
   minimal repo you can link to — a small reproducer helps enormously.

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

## Plugins

Murasaki's supported extension point today is the **build-time plugin SDK**:
plugins declared in `murasaki.config.ts` that contribute Vite options, bundle
dependencies/resources, and serial dev/build/bundle hooks — see the
[Plugins section of the configuration docs](https://murasaki.ichi10.com/docs/building/configuration).
If your idea fits there, that's the fastest path to shipping it.

A **runtime plugin system** — dynamically loaded plugins running inside a
packaged app — is under RFC, not implemented yet: `rfcs/0004-runtime-plugins.md`.
If that's what you need, join the discussion there instead of working around
the build-time SDK.

Extensions to the **native (Rust) surface** — new `@murasakijs/native` APIs,
new capabilities, or changes to the native ABI — should be proposed as an
issue first, before any code. These touch the security/capability model
directly and need design discussion up front.

---

## Pull requests

- One PR per logical change.
- Include tests **or** a manual verification note.
- Explain the "why" in the PR description — the diff shows the "what".
- Reference the issue with `Fixes #NNN` or `Closes #NNN`.
- CI runs the workspace build, the murasaki test suite, API-report checks
  (`api:check`), the docs build, MCP knowledge checks, a fresh-scaffold
  install/build, and `cargo test` for the native crate. Before requesting
  review, make sure `pnpm --filter murasaki test` is green — and `cargo test`
  in `crates/native` too if you touched Rust.

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

`pnpm --filter murasaki test` covers the framework's unit tests, but PRs that
touch runtime/CLI behavior should also go through the smoke checklist below
before opening a PR:

1. `pnpm --filter murasaki build` — clean compile — then `pnpm --filter murasaki test` — automated tests pass.
2. `cd examples/papelle && pnpm dev` — window opens, HMR works, and a real edit survives restart.
3. `pnpm bundle` — `.app` (or the OS-native folder) is produced and launches;
   launching it also verifies the packaged Node prod server boots (the native
   launcher spawns it — there is no standalone server entry point to run).
4. `pnpm installer` — installer file is produced.

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
