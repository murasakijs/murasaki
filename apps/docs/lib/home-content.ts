// User-visible copy for the landing page (app/[lang]/(home)/page.tsx),
// keyed by locale so the page can render `homeContent[lang] ?? homeContent.en`.
export interface HomeContent {
  eyebrow: string;
  headline: {
    prefix: string;
    highlight: string;
    suffix: string;
  };
  subhead: string;
  getStarted: string;
  github: string;
  /** Full-bleed solid-purple/white band rendered between the hero and the
   * product window mockup — the site's boldest "color field" moment. */
  bandLabel: string;
  /** Copy for the installer-artifacts showcase section. */
  mockup: {
    heading: string;
    caption: string;
    /** Status-pill label for the macOS (available today) card. */
    availableLabel: string;
    /** Status-pill label for the Windows/Linux (roadmap) cards. */
    soonLabel: string;
  };
  /** Copy for the tabbed code showcase section. */
  codeShowcase: {
    eyebrow: string;
    heading: {
      prefix: string;
      highlight: string;
      suffix: string;
    };
    description: string;
    tabs: {
      id: string;
      label: string;
    }[];
  };
  /** Editorial numbered set — the 6 shipping features. */
  featuresEyebrow: string;
  featuresHeading: string;
  featuresIntro: string;
  features: {
    title: string;
    description: string;
  }[];
  /** "Why murasaki" comparison table + the "~1/5 memory" pull-stat. */
  whyMurasaki: {
    eyebrow: string;
    heading: string;
    paragraph: string;
    tableHeadings: {
      feature: string;
      murasaki: string;
      electron: string;
      tauri: string;
    };
    statValue: string;
    statLabel: string;
  };
  comparisonRows: {
    label: string;
    murasaki: string;
    electron: string;
    tauri: string;
  }[];
  comparisonFootnote: string;
  /** Native window / menu bar / context menu deep-dive, with a real
   * `useContextMenu` snippet. */
  nativeDeepDive: {
    eyebrow: string;
    heading: string;
    paragraph: string;
    bullets: {
      title: string;
      description: string;
    }[];
    codeLabel: string;
    menuMockLabel: string;
  };
  /** "From dev to a signed .app" stepped distribution flow. */
  distribution: {
    eyebrow: string;
    heading: string;
    paragraph: string;
    steps: {
      label: string;
      command: string;
      note?: string;
    }[];
    platforms: {
      name: string;
      status: string;
      /** Ships today vs. on the roadmap — drives the status pill's style,
       * kept separate from `status`'s (locale-specific) copy. */
      available: boolean;
      description: string;
    }[];
  };
  /** "Ship in three commands" recap, just before the CTA band. */
  quickStart: {
    eyebrow: string;
    heading: string;
    steps: {
      label: string;
      command: string;
    }[];
  };
  /** Full-bleed solid-purple closing CTA band. */
  ctaBand: {
    heading: string;
    paragraph: string;
  };
  /** Rich, columned footer. */
  footer: {
    columns: {
      heading: string;
      links: {
        label: string;
        href: string;
      }[];
    }[];
    community: {
      heading: string;
      links: {
        label: string;
        href: string;
      }[];
    };
    license: string;
  };
}

const en: HomeContent = {
  eyebrow: "React 19 · Vite · Rust-native",
  headline: {
    prefix: "Next.js DX for",
    highlight: "desktop apps",
    suffix: ".",
  },
  subhead:
    "Build native desktop apps with file-based routing, server actions, and React 19 — in a Rust-native window, not Electron's Chromium. Without writing Rust.",
  getStarted: "Get started",
  github: "GitHub",
  bandLabel: "Open source · MIT licensed · React 19 · Vite · Rust-native",
  mockup: {
    heading: "This is what you ship.",
    caption:
      "One command → a real native installer. macOS .dmg today — Windows & Linux next.",
    availableLabel: "Ships today",
    soonLabel: "Coming soon",
  },
  codeShowcase: {
    eyebrow: "Straight from the docs",
    heading: {
      prefix: "Write React. Ship ",
      highlight: "native",
      suffix: ".",
    },
    description:
      "File routes, server actions, API routes, and one config file — the same shapes you already know from Next.js, compiled straight into a native app.",
    tabs: [
      { id: "actions", label: "src/actions.ts" },
      { id: "page", label: "src/app/page.tsx" },
      { id: "route", label: "src/api/hello/route.ts" },
      { id: "config", label: "murasaki.config.ts" },
    ],
  },
  featuresEyebrow: "What ships today",
  featuresHeading: "Everything you need to ship a desktop app",
  featuresIntro:
    "No native code to write, no IPC to hand-wire — six things that just work out of the box.",
  features: [
    {
      title: "File-based routing",
      description:
        "src/app/**/page.tsx, layouts, and dynamic segments — the routing you already know from Next.js.",
    },
    {
      title: "Server Actions",
      description:
        "'use server' + defineAction / useAction — the same React 19 shape, running natively.",
    },
    {
      title: "API Routes",
      description:
        "Next.js-style src/api/**/route.ts HTTP endpoints, no extra server to run.",
    },
    {
      title: "Native window & menus",
      description:
        "A real native window, a native menu bar, and scoped native context menus — not HTML popups.",
    },
    {
      title: "UI kit",
      description:
        "@murasakijs/ui — a shadcn-style component library built for murasaki apps.",
    },
    {
      title: "Signed distribution",
      description:
        "Portable .app bundles with optional code signing and notarization.",
    },
  ],
  whyMurasaki: {
    eyebrow: "Why murasaki",
    heading: "Why murasaki",
    paragraph:
      "Choose murasaki if you know React/Next.js and want a small-footprint desktop app without learning Rust or hand-wiring IPC.",
    tableHeadings: {
      feature: "Category",
      murasaki: "murasaki",
      electron: "Electron",
      tauri: "Tauri",
    },
    statValue: "~1/5",
    statLabel: "of Electron's idle memory footprint.",
  },
  comparisonRows: [
    {
      label: "UI runtime",
      murasaki: "OS WebView (wry)",
      electron: "Bundled Chromium",
      tauri: "OS WebView",
    },
    {
      label: "Language",
      murasaki: "TypeScript / React",
      electron: "TypeScript / React",
      tauri: "TypeScript + Rust",
    },
    {
      label: "DX",
      murasaki: "Next.js-style (Vite HMR)",
      electron: "Manual wiring",
      tauri: "Manual wiring",
    },
    {
      label: "Memory (idle)",
      murasaki: "~1/5 of Electron*",
      electron: "Baseline",
      tauri: "Small",
    },
    {
      label: "Server actions",
      murasaki: "defineAction / useAction",
      electron: "Manual IPC",
      tauri: "Manual IPC / commands",
    },
  ],
  comparisonFootnote:
    "* commonly-cited ballpark for Electron/Tauri — not a measured benchmark.",
  nativeDeepDive: {
    eyebrow: "Real OS, not a browser tab",
    heading: "Not a browser tab. A real OS window.",
    paragraph:
      "murasaki windows are native — a real title bar, a real menu bar, real OS chrome. Right-click anywhere and you get an actual native menu, not an HTML popup pretending to be one.",
    bullets: [
      {
        title: "Native window",
        description:
          "A real OS window (wry) — not a browser tab, not an iframe.",
      },
      {
        title: "Native menu bar",
        description:
          "A real application menu bar, built from the same config as your app.",
      },
      {
        title: "Scoped context menus",
        description:
          "useContextMenu(items) declares a real NSMenu / HMENU / GtkMenu — global, or scoped to one element.",
      },
    ],
    codeLabel: "src/app/layout.tsx",
    menuMockLabel: "A real NSMenu / HMENU / GtkMenu — not HTML.",
  },
  distribution: {
    eyebrow: "Ship a real .app",
    heading: "From dev to a signed .app.",
    paragraph:
      "The same CLI takes you from a running dev window to a portable, cross-arch, optionally signed and notarized .app — no separate packaging tool.",
    steps: [
      { label: "Scaffold", command: "pnpm create murasaki@latest my-app" },
      { label: "Develop", command: "pnpm dev" },
      {
        label: "Bundle",
        command: "pnpm bundle",
        note: "-> dist/bundle/<App>.app",
      },
      {
        label: "Sign & notarize",
        command: "murasaki bundle --sign",
        note: "optional — your own Apple Developer ID; murasaki ships no certificate",
      },
      {
        label: "Installer",
        command: "murasaki installer --sign --notarize",
        note: "-> dist/<App>-<version>.dmg, notarized",
      },
    ],
    platforms: [
      {
        name: "macOS",
        status: "Ships today",
        available: true,
        description:
          ".app / .dmg, cross-arch (arm64 & x64), with optional code signing and notarization.",
      },
      {
        name: "Windows",
        status: "Roadmap",
        available: false,
        description:
          "murasaki dev runs today; @murasakijs/native ships prebuilt x64 binaries. App packaging is on the roadmap.",
      },
      {
        name: "Linux",
        status: "Roadmap",
        available: false,
        description:
          "murasaki dev runs today; @murasakijs/native ships prebuilt x64/arm64 binaries. App packaging is on the roadmap.",
      },
    ],
  },
  quickStart: {
    eyebrow: "Three commands",
    heading: "Ship in three commands.",
    steps: [
      { label: "Create", command: "pnpm create murasaki@latest my-app" },
      { label: "Run", command: "pnpm dev" },
      { label: "Bundle", command: "pnpm bundle" },
    ],
  },
  ctaBand: {
    heading: "Build your first native app.",
    paragraph:
      "React 19, file-based routing, and server actions — in a real native window. No Rust required.",
  },
  footer: {
    columns: [
      {
        heading: "Docs",
        links: [
          { label: "Introduction", href: "/docs" },
          {
            label: "Quick start",
            href: "/docs/getting-started/quick-start",
          },
          {
            label: "Project structure",
            href: "/docs/getting-started/project-structure",
          },
        ],
      },
      {
        heading: "Guides",
        links: [
          { label: "Routing", href: "/docs/guides/routing" },
          { label: "Server Actions", href: "/docs/guides/server-actions" },
          { label: "API Routes", href: "/docs/guides/api-routes" },
          { label: "Native APIs", href: "/docs/guides/native-apis" },
        ],
      },
      {
        heading: "Building",
        links: [
          { label: "Configuration", href: "/docs/building/configuration" },
          { label: "CLI", href: "/docs/building/cli" },
          { label: "Distribution", href: "/docs/building/distribution" },
        ],
      },
    ],
    community: {
      heading: "Community",
      links: [
        { label: "GitHub", href: "https://github.com/murasakijs/murasaki" },
        { label: "npm", href: "https://www.npmjs.com/package/murasaki" },
        { label: "X", href: "https://x.com/murasaki_js" },
      ],
    },
    license: "MIT licensed",
  },
};

const ja: HomeContent = {
  eyebrow: "React 19 · Vite · Rust-native",
  headline: {
    prefix: "",
    highlight: "デスクトップアプリ",
    suffix: "のための Next.js DX。",
  },
  subhead:
    "ファイルベースルーティング、サーバーアクション、React 19 でネイティブなデスクトップアプリを構築 — Electron の Chromium ではなく、Rust ネイティブなウィンドウで動作します。Rust を書く必要はありません。",
  getStarted: "はじめる",
  github: "GitHub",
  bandLabel: "オープンソース・MIT ライセンス・React 19・Vite・Rust ネイティブ",
  mockup: {
    heading: "実際に届けるのは、これです。",
    caption:
      "1コマンドで、本物のネイティブインストーラへ。macOS の .dmg は今すぐ、Windows・Linux は近日。",
    availableLabel: "今すぐ",
    soonLabel: "近日",
  },
  codeShowcase: {
    eyebrow: "ドキュメントそのまま",
    heading: {
      prefix: "React を書く。",
      highlight: "ネイティブ",
      suffix: "として届く。",
    },
    description:
      "ファイルルート、サーバーアクション、API ルート、そして1つの設定ファイル。Next.js でおなじみの形のまま、ネイティブアプリとしてビルドされます。",
    tabs: [
      { id: "actions", label: "src/actions.ts" },
      { id: "page", label: "src/app/page.tsx" },
      { id: "route", label: "src/api/hello/route.ts" },
      { id: "config", label: "murasaki.config.ts" },
    ],
  },
  featuresEyebrow: "今すぐ使える機能",
  featuresHeading: "デスクトップアプリをリリースするために必要なすべて",
  featuresIntro:
    "ネイティブコードを書く必要も、IPC を手動配線する必要もありません — そのまま動く6つの機能です。",
  features: [
    {
      title: "ファイルベースルーティング",
      description:
        "src/app/**/page.tsx、レイアウト、動的セグメント — Next.js でおなじみのルーティングです。",
    },
    {
      title: "Server Actions",
      description:
        "'use server' + defineAction / useAction — おなじみの React 19 の形そのままに、ネイティブで動作します。",
    },
    {
      title: "API Routes",
      description:
        "Next.js 風の src/api/**/route.ts による HTTP エンドポイント。別途サーバーを用意する必要はありません。",
    },
    {
      title: "ネイティブウィンドウ & メニュー",
      description:
        "本物のネイティブウィンドウ、ネイティブメニューバー、スコープ付きのネイティブコンテキストメニュー — HTML のポップアップではありません。",
    },
    {
      title: "UI キット",
      description:
        "@murasakijs/ui — murasaki アプリのために作られた shadcn スタイルのコンポーネントライブラリです。",
    },
    {
      title: "署名済み配布",
      description: "コード署名・公証にも対応した、ポータブルな .app バンドル。",
    },
  ],
  whyMurasaki: {
    eyebrow: "murasaki を選ぶ理由",
    heading: "murasaki を選ぶ理由",
    paragraph:
      "React/Next.js を知っていて、Rust を学んだり IPC を手動で配線したりすることなく、軽量なデスクトップアプリを作りたいなら murasaki を選んでください。",
    tableHeadings: {
      feature: "項目",
      murasaki: "murasaki",
      electron: "Electron",
      tauri: "Tauri",
    },
    statValue: "約1/5",
    statLabel: "Electron のアイドル時メモリ使用量。",
  },
  comparisonRows: [
    {
      label: "UI ランタイム",
      murasaki: "OS WebView (wry)",
      electron: "Bundled Chromium",
      tauri: "OS WebView",
    },
    {
      label: "言語",
      murasaki: "TypeScript / React",
      electron: "TypeScript / React",
      tauri: "TypeScript + Rust",
    },
    {
      label: "DX",
      murasaki: "Next.js 風(Vite HMR)",
      electron: "手動配線",
      tauri: "手動配線",
    },
    {
      label: "メモリ(アイドル時)",
      murasaki: "Electron の約1/5*",
      electron: "基準値",
      tauri: "小",
    },
    {
      label: "サーバーアクション",
      murasaki: "defineAction / useAction",
      electron: "手動 IPC",
      tauri: "手動 IPC / コマンド",
    },
  ],
  comparisonFootnote:
    "* Electron/Tauri でよく引用されるおおよその目安であり、実測ベンチマークではありません。",
  nativeDeepDive: {
    eyebrow: "本物の OS、ブラウザのタブではない",
    heading: "ブラウザのタブではない。本物の OS ウィンドウ。",
    paragraph:
      "murasaki のウィンドウはネイティブです — 本物のタイトルバー、本物のメニューバー、本物の OS クロームを備えています。どこを右クリックしても、HTML のポップアップではない、本物のネイティブメニューが開きます。",
    bullets: [
      {
        title: "ネイティブウィンドウ",
        description:
          "本物の OS ウィンドウ(wry)— ブラウザのタブでも iframe でもありません。",
      },
      {
        title: "ネイティブメニューバー",
        description:
          "アプリと同じ設定から組み立てられる、本物のアプリケーションメニューバー。",
      },
      {
        title: "スコープ付きコンテキストメニュー",
        description:
          "useContextMenu(items) は本物の NSMenu / HMENU / GtkMenu を宣言します — ウィンドウ全体にも、要素にスコープを絞った形にも。",
      },
    ],
    codeLabel: "src/app/layout.tsx",
    menuMockLabel: "本物の NSMenu / HMENU / GtkMenu — HTML ではありません。",
  },
  distribution: {
    eyebrow: "本物の .app を届ける",
    heading: "開発から、署名済み .app へ。",
    paragraph:
      "同じ CLI だけで、起動中の開発ウィンドウから、ポータブルでクロスアーキテクチャな、署名・公証済みの .app まで届きます — 別のパッケージングツールは不要です。",
    steps: [
      {
        label: "足場を作る",
        command: "pnpm create murasaki@latest my-app",
      },
      { label: "開発する", command: "pnpm dev" },
      {
        label: "バンドルする",
        command: "pnpm bundle",
        note: "→ dist/bundle/<App>.app",
      },
      {
        label: "署名・公証する",
        command: "murasaki bundle --sign",
        note: "任意 — 自分の Apple Developer ID を使用。murasaki は証明書を提供しません",
      },
      {
        label: "インストーラーを作る",
        command: "murasaki installer --sign --notarize",
        note: "→ dist/<App>-<version>.dmg(公証済み)",
      },
    ],
    platforms: [
      {
        name: "macOS",
        status: "本日から利用可能",
        available: true,
        description:
          ".app / .dmg、クロスアーキテクチャ(arm64 / x64)、コード署名・公証にも対応。",
      },
      {
        name: "Windows",
        status: "ロードマップ",
        available: false,
        description:
          "murasaki dev は今すぐ動作します。@murasakijs/native は x64 のビルド済みバイナリを提供済み。アプリのパッケージングはロードマップ上にあります。",
      },
      {
        name: "Linux",
        status: "ロードマップ",
        available: false,
        description:
          "murasaki dev は今すぐ動作します。@murasakijs/native は x64/arm64 のビルド済みバイナリを提供済み。アプリのパッケージングはロードマップ上にあります。",
      },
    ],
  },
  quickStart: {
    eyebrow: "たった3つのコマンド",
    heading: "3つのコマンドで届ける。",
    steps: [
      {
        label: "作成",
        command: "pnpm create murasaki@latest my-app",
      },
      { label: "実行", command: "pnpm dev" },
      { label: "バンドル", command: "pnpm bundle" },
    ],
  },
  ctaBand: {
    heading: "はじめての、ネイティブアプリを。",
    paragraph:
      "React 19、ファイルベースルーティング、サーバーアクション — 本物のネイティブウィンドウの中で動きます。Rust を書く必要はありません。",
  },
  footer: {
    columns: [
      {
        heading: "ドキュメント",
        links: [
          { label: "はじめに", href: "/docs" },
          {
            label: "クイックスタート",
            href: "/docs/getting-started/quick-start",
          },
          {
            label: "プロジェクト構成",
            href: "/docs/getting-started/project-structure",
          },
        ],
      },
      {
        heading: "ガイド",
        links: [
          { label: "ルーティング", href: "/docs/guides/routing" },
          { label: "Server Actions", href: "/docs/guides/server-actions" },
          { label: "API Routes", href: "/docs/guides/api-routes" },
          { label: "Native APIs", href: "/docs/guides/native-apis" },
        ],
      },
      {
        heading: "ビルド",
        links: [
          { label: "Configuration", href: "/docs/building/configuration" },
          { label: "CLI", href: "/docs/building/cli" },
          { label: "Distribution", href: "/docs/building/distribution" },
        ],
      },
    ],
    community: {
      heading: "コミュニティ",
      links: [
        { label: "GitHub", href: "https://github.com/murasakijs/murasaki" },
        { label: "npm", href: "https://www.npmjs.com/package/murasaki" },
        { label: "X", href: "https://x.com/murasaki_js" },
      ],
    },
    license: "MIT ライセンス",
  },
};

export const homeContent: Record<string, HomeContent> = { en, ja };
