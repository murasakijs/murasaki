<div align="center">

<img src="./assets/logo.svg" alt="Murasaki — Next.js 開発者のためのデスクトップフレームワーク" width="720">

**Next.js 開発者のためのデスクトップフレームワーク**

Node 駆動 · WebView 薄 · Rust 不要 · Chromium 不要

[![npm version](https://img.shields.io/npm/v/murasaki?color=A855F7&label=npm)](https://www.npmjs.com/package/murasaki)
[![npm downloads](https://img.shields.io/npm/dm/murasaki?color=A855F7)](https://www.npmjs.com/package/murasaki)
[![license](https://img.shields.io/npm/l/murasaki?color=A855F7)](./LICENSE)
[![CI](https://github.com/murasakijs/murasaki/actions/workflows/release.yml/badge.svg)](https://github.com/murasakijs/murasaki/actions)

[English](./README.md) · [日本語](./README.ja.md)

</div>

---

Murasaki は TypeScript ファーストのデスクトップフレームワークです。
**Next.js のような DX** — ファイルベースルーティング、レイアウト、metadata、
ウィンドウ内 HMR、サーバーアクション — をすべて素の Node.js 上で提供し、
**OS 標準搭載の WebView** でレンダリングします。

```bash
pnpm create murasaki@latest my-app
cd my-app
pnpm dev
```

```tsx
// src/app/page.tsx
import { Button, Card, Text, useAction } from 'murasaki'
import { useState } from 'murasaki/jsx/dom'
import type { greet } from '../actions'

export default function Home() {
  const [count, setCount] = useState(0)
  const g = useAction<typeof greet>('greet')

  return (
    <Card>
      <Text size={24} weight="bold">カウント: {count}</Text>
      <Button onClick={() => setCount(count + 1)}>+</Button>
      <Button variant="secondary" onClick={() => g.call('world')}>
        Node から挨拶
      </Button>
      {g.data && <Text>{g.data}</Text>}
    </Card>
  )
}
```

これだけです。TypeScript アプリがそのままデスクトップアプリになります。
**macOS / Windows / Linux** 対応、`.app` / `.dmg` / `.msi` / `.AppImage`
/ `.zip` / `.tar.gz` として配布可能 — どの host OS からでも。

---

## 目次

- [クイックスタート](#クイックスタート)
- [なぜ Murasaki?](#なぜ-murasaki)
- [機能](#機能)
- [CLI リファレンス](#cli-リファレンス)
- [設定 (`murasaki.config.ts`)](#設定-murasakiconfigts)
- [サーバーアクション](#サーバーアクション)
- [クロスコンパイル対応表](#クロスコンパイル対応表)
- [コンポーネント (34 個) & フック (13 個)](#コンポーネント-34-個--フック-13-個)
- [アーキテクチャ](#アーキテクチャ)
- [ロードマップ](#ロードマップ)
- [コントリビュート](#コントリビュート)
- [行動規範](#行動規範)
- [セキュリティ](#セキュリティ)
- [ライセンス](#ライセンス)

---

## クイックスタート

```bash
# 生成
pnpm create murasaki@latest my-app

# HMR で開発
cd my-app
pnpm dev

# 配布
pnpm build          # dist/server.cjs                    (~400 KB)
pnpm bundle         # dist/<App>.app                     (~120 MB)
pnpm installer      # dist/<App>-<ver>.dmg               (~43 MB 圧縮)

# クロスコンパイル
pnpm exec murasaki installer --target win-x64      # → .msi (要 WiX v4)
pnpm exec murasaki installer --target linux-x64    # → .AppImage (要 squashfs)
```

---

## なぜ Murasaki?

|                     | **Murasaki**       | Electron     | Tauri          | NW.js     |
| ------------------- | ------------------ | ------------ | -------------- | --------- |
| 言語                | TypeScript         | TypeScript   | Rust + JS      | JS        |
| レンダリング        | OS WebView         | Chromium     | OS WebView     | Chromium  |
| ランタイム          | **Node.js**        | Node.js      | Rust           | Node.js   |
| インストーラサイズ  | **~40 MB**         | ~90 MB       | ~5 MB          | ~110 MB   |
| Next.js 風 DX       | ★★★ ネイティブ     | ★★           | ★ (SSG 経由)   | ★         |
| 組込コンポーネント  | **34 + 13 フック** | なし         | なし           | なし      |
| サーバーアクション  | **`defineAction`** | 手動 IPC     | 手動 IPC       | 手動      |
| クロスコンパイル    | **組込 `--target`** | 手動        | matrix         | 手動      |
| 自動 publish CI     | **Trusted Publisher OIDC** | 手動  | 手動           | 手動      |

Murasaki が唯一提供する組み合わせ:

- 🟢 **既に知ってる Node.js** (npm, package.json, async/await)
- 🪶 **Tauri 並みに軽量** (OS WebView、Chromium バンドルなし)
- ⚛️ **React 風 JSX** (自前ランタイム、React 依存なし)
- 🎨 **テーマトークン込みの UI コンポーネント**
- 🔧 **フルツールチェーン**: dev → build → bundle → installer 全部同梱

---

## 機能

- **ファイルベースルーティング** — `src/app/**/page.tsx` が自動でルートに。
- **HMR 標準装備** — ファイル保存でウィンドウが再読込。ネイティブメニューも維持。
- **React 不要の JSX レンダラ** — 独自の `jsx/` + `jsx/dom/` ランタイム。
- **UI コンポーネント込み** — 34 個が単一のテーマトークンを共有。
- **サーバーアクション** — サーバー側 `defineAction`、クライアント側 `useAction`、型安全。
- **マルチウィンドウ** — `useWindow` + `openWindow()` API。
- **ネイティブ API** — 通知、クリップボード、ダイアログ、ファイルシステム、シェル、トレイアイコン。
- **クロスコンパイル** — macOS host から `.dmg`, `.msi`, `.AppImage`, `.zip`, `.tar.gz` 全部生成。
- **Trusted Publisher OIDC** — tag push で署名付き `npm publish --provenance`。

---

## CLI リファレンス

```
murasaki dev                       開発サーバ起動 (HMR)
murasaki build                     本番 JS bundle → dist/server.cjs
murasaki bundle                    現ホスト OS 用のネイティブフォルダ / .app
murasaki installer                 現ホスト OS 用の配布用アーカイブ/インストーラ
```

全ビルド系サブコマンドで `--target <id>` によるクロスコンパイル対応:

```
--target darwin-arm64    (Apple Silicon の初期値)
--target darwin-x64
--target win-x64
--target win-arm64
--target linux-x64
--target linux-arm64
```

target 用の Node バイナリと `@webviewjs/webview` prebuild は必要になった時に
自動 download され、`~/.murasaki/cache/` にキャッシュされます。

---

## 設定 (`murasaki.config.ts`)

```ts
import { defineConfig } from 'murasaki'

export default defineConfig({
  name: 'My App',                             // 表示名 (macOS .app タイトル)
  bundleId: 'com.example.myapp',              // 逆 DNS 形式の識別子
  description: 'A murasaki app',
  copyright: '© 2026 Example, Inc.',
  icon: 'assets/icon.icns',                   // .icns / .ico / .png
  category: 'public.app-category.productivity',
  targets: ['darwin-arm64', 'win-x64', 'linux-x64'],
  window: {
    title: 'My App',
    width: 1280,
    height: 800,
  },
})
```

参照順序 (最初にヒットしたものが採用): `murasaki.config.ts` → `murasaki.config.js`
→ `murasaki.config.json` → `package.json` の `"murasaki"` フィールド。

---

## サーバーアクション

```ts
// src/actions.ts — サーバー側
import { defineAction } from 'murasaki'

export const greet = defineAction('greet', async (name: string) => {
  return `こんにちは、${name}! (Node ${process.version})`
})
```

```tsx
// src/app/page.tsx — クライアント側
import { useAction } from 'murasaki'
import type { greet } from '../actions'   // 型のみ

export default function Home() {
  const g = useAction<typeof greet>('greet')

  return (
    <>
      <Button onClick={() => g.call('世界')}>挨拶</Button>
      {g.loading ? '…' : g.data}
      {g.error && <Text color="red">{g.error.message}</Text>}
    </>
  )
}
```

内部動作: `window.ipc.postMessage` → サーバー側の `webview.onIpcMessage`、
結果は `webview.evaluate` 経由で返却 — 追加のネイティブブリッジ不要。

---

## クロスコンパイル対応表

| 出力       | 生成可能ホスト                    | ユーザ側の準備                       |
| ---------- | --------------------------------- | ------------------------------------ |
| `.dmg`     | **macOS ホストのみ**              | `hdiutil` (macOS 標準)               |
| `.msi`     | 任意ホスト + WiX v4               | `dotnet tool install -g wix`         |
| `.AppImage`| 任意ホスト + squashfs-tools       | `brew install squashfs` / `apt install squashfs-tools` |
| `.zip`     | 任意ホスト                        | 標準搭載 (`zip` / `Compress-Archive`) |
| `.tar.gz`  | 任意ホスト                        | 標準搭載 (`tar`)                     |

WiX + squashfs が入った macOS ホストなら、**1 台で全 4 プラットフォーム
分のインストーラが揃います**。ツールが未インストールの場合は自動的に
`.zip` / `.tar.gz` へ fallback してインストール手順が表示されます。
致命的失敗にはなりません。

---

## コンポーネント (34 個) & フック (13 個)

```ts
import {
  // Layout (4)
  View, Row, Stack, Text,

  // Desktop shell (7)
  TitleBar, NoDrag, Sidebar, SidebarItem, Toolbar, StatusBar, Pane,

  // UI Tier 1 (7)
  Button, Card, Input, Textarea, Modal, List, ListItem,

  // UI Tier 2 (10)
  Switch, Checkbox, Radio, RadioGroup,
  Tooltip, Tabs, TabList, Tab, TabPanel, ContextMenu,

  // UI Tier 3 (5)
  Badge, Avatar, Spinner, Progress, ToastProvider,

  // Routing (1)
  Link,

  // Theme
  ThemeProvider, useTheme,
} from 'murasaki'

import {
  // React ライク (3)
  useState, useEffect, useRef,

  // ネイティブブリッジ (10)
  useNotification, useClipboard, useShell, useFs, useDialog,
  useWindow, useTray, useAction, useToast, toast,
} from 'murasaki/jsx/dom'
```

全コンポーネントが単一のテーマトークン (CSS カスタムプロパティ) を共有し、
`<ThemeProvider theme="auto" | "dark" | "light">` で切替、`className` と
`style` によるフルオーバーライドも可能。ネイティブ系フックは SSR-safe で、
SSR 時は no-op に degrade します。

---

## アーキテクチャ

```
┌─────────────────────────────────────────┐
│  ユーザアプリ (src/app/page.tsx)         │  ファイルベースルーティング, metadata
├─────────────────────────────────────────┤
│  Murasaki コンポーネント + フック        │  Button / Card / Modal / …
│                                         │  useState / useAction / useNotification
├─────────────────────────────────────────┤
│  Server Actions (defineAction)          │  wry IPC を使った RPC ディスパッチャ
├─────────────────────────────────────────┤
│  クライアント bundle (jsx/dom)          │  自前 JSX ランタイム、React 依存なし
├─────────────────────────────────────────┤
│  ネイティブブリッジ (window.murasaki)   │  Promise ベース、typed
├─────────────────────────────────────────┤
│  Murasaki ランタイム (Node.js)          │  window ライフサイクル, HMR, esbuild
├─────────────────────────────────────────┤
│  OS 標準の WebView                       │  WKWebView / WebView2 / WebKitGTK
└─────────────────────────────────────────┘
```

Chromium なし。Rust なし。新規ランタイムなし。OS 同梱の WebView + Node、
その上に薄い TypeScript レイヤだけ。

---

## ロードマップ

- 🚧 UI Tier 4 (`DataTable`, `Slider`, `DatePicker`, `Skeleton`)
- 🚧 自動アップデート機能
- 🚧 アイコンジェネレータ (単一 PNG → `.icns` / `.ico` / `.png` セット)
- 🚧 ドキュメントサイト (`https://murasaki.dev`)
- 🚧 v1.0 API 安定化

---

## コントリビュート

コード、ドキュメント、事例、バグ報告、機能要望 — あらゆる貢献を歓迎します。
セットアップ方法とワークフローは [CONTRIBUTING.md](./CONTRIBUTING.md) を参照してください。

簡易セットアップ:

```bash
git clone https://github.com/murasakijs/murasaki.git
cd murasaki
pnpm install
pnpm --filter murasaki tsc -p tsconfig.build.json
cd examples/app-router
pnpm dev
```

## 行動規範

本プロジェクトは Contributor Covenant に従います。参加前に
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) をご一読ください。

## セキュリティ

セキュリティ上の問題は **公開の GitHub Issue で報告しないでください**。
責任ある報告方法は [SECURITY.md](./SECURITY.md) を参照してください。

## ライセンス

MIT © ichi — [LICENSE](./LICENSE) を参照。
