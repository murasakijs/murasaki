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
  /** "Why Murasaki" comparison table + the "~1/5 memory" pull-stat. */
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
      "One command → a real native installer. macOS & Windows today — Linux next.",
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
        "@murasakijs/ui — a shadcn-style component library built for Murasaki apps.",
    },
    {
      title: "Signed distribution",
      description:
        "Portable .app bundles with optional code signing and notarization.",
    },
  ],
  whyMurasaki: {
    eyebrow: "Why Murasaki",
    heading: "Why Murasaki",
    paragraph:
      "Choose Murasaki if you know React/Next.js and want a small-footprint desktop app without learning Rust or hand-wiring IPC.",
    tableHeadings: {
      feature: "Category",
      murasaki: "Murasaki",
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
      "Murasaki windows are native — a real title bar, a real menu bar, real OS chrome. Right-click anywhere and you get an actual native menu, not an HTML popup pretending to be one.",
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
        note: "optional — your own Apple Developer ID; Murasaki ships no certificate",
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
        status: "Ships today",
        available: true,
        description:
          "Portable .zip plus NSIS .exe and MSI .msi installers, cross-arch (arm64 & x64).",
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
    license: "© 2026 ichi · MIT licensed",
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
      "1コマンドで、本物のネイティブインストーラへ。macOS と Windows は今すぐ、Linux は近日。",
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
        "@murasakijs/ui — Murasaki アプリのために作られた shadcn スタイルのコンポーネントライブラリです。",
    },
    {
      title: "署名済み配布",
      description: "コード署名・公証にも対応した、ポータブルな .app バンドル。",
    },
  ],
  whyMurasaki: {
    eyebrow: "Murasaki を選ぶ理由",
    heading: "Murasaki を選ぶ理由",
    paragraph:
      "React/Next.js を知っていて、Rust を学んだり IPC を手動で配線したりすることなく、軽量なデスクトップアプリを作りたいなら Murasaki を選んでください。",
    tableHeadings: {
      feature: "項目",
      murasaki: "Murasaki",
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
      "Murasaki のウィンドウはネイティブです — 本物のタイトルバー、本物のメニューバー、本物の OS クロームを備えています。どこを右クリックしても、HTML のポップアップではない、本物のネイティブメニューが開きます。",
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
        note: "任意 — 自分の Apple Developer ID を使用。Murasaki は証明書を提供しません",
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
        status: "本日から利用可能",
        available: true,
        description:
          ".zip ポータブル版に加え、NSIS .exe / MSI .msi インストーラ、クロスアーキテクチャ(arm64 / x64)。",
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
    license: "© 2026 ichi · MIT ライセンス",
  },
};

export const homeContent: Record<string, HomeContent> = { en, ja };

// ---------------------------------------------------------------------------
// Strings that exist only for the redesigned landing page (the "紫 /
// Murasaki" bold-grotesque direction) — kept separate from HomeContent so
// the canonical copy above stays the single source of truth for facts.
// ---------------------------------------------------------------------------
export interface LpExtra {
  /** Phrases looping in the marquee band (joined with a separator glyph). */
  marquee: string[];
  /** Vertical Japanese rail on the hero's right edge (pure art direction —
   * shown in both locales, like a hanko/colophon). */
  tategaki: string;
  /** The live native-window demo (proof-by-demo section). The window's
   * CONTENT is a faithful miniature of the real `create-murasaki` scaffold
   * home — so it stays English in every locale (it's a screenshot of the
   * product, and the menu labels must match the code panel beside it).
   * Only the captions around the window localize. */
  demo: {
    windowTitle: string;
    menus: {
      label: string;
      items: { label: string; shortcut?: string; divider?: boolean }[];
    }[];
    contentTitle: string;
    /** The scaffold home's tagline, verbatim. */
    tagline: string;
    /** The scaffold home's "Edit … and save to reload." hint, verbatim. */
    editHint: { before: string; code: string; after: string };
    /** The scaffold home's three resource cards. */
    cards: string[];
    /** The scaffold home's CTA button label, verbatim. */
    demoCta: string;
    /** Caption under the code panel — "this code → that menu". */
    codeCaption: string;
    /** Small hint that the menus are clickable. */
    tryHint: string;
  };
  /** Pinned converging headline — the two halves slide together while the
   * viewport holds (the madewithgsap hero move). */
  converge: { left: string; right: string };
  /** Word/character-illuminated manifesto (scroll-linked, pinned). */
  manifesto: string;
  /** Silkscreen progress counter shown while the manifesto is pinned. */
  manifestoCounterLabel: string;
  /** Scroll cue label at the bottom of the hero. */
  scrollCue: string;
  /** The pixel-canvas easter egg — a different register of playful than the
   * CTA's drag/physics toy: creation (draw brand-purple pixels on a 16px
   * grid) plus discovery (a right-click menu that can stamp the logo
   * butterfly), capped by a self-aware joke about the one context menu on
   * this page that ISN'T real (unlike the native one in nativeDeepDive/
   * PxShowcase). */
  playground: {
    eyebrow: string;
    heading: string;
    /** Hint pinned inside the canvas — right-click AND drawing both work. */
    hint: string;
    items: {
      /** Paints the pixel-butterfly onto the canvas at the click point. */
      stamp: string;
      /** Recolors every painted cell to a random brand color. */
      shuffle: string;
      clear: string;
      /** The joke — deliberately not a real menu action. */
      confession: string;
    };
    caption: string;
  };
  /** Downloadable proof: the packaged default scaffold plus three independent
   * sample products. These links intentionally point at immutable GitHub
   * releases so the LP never serves a stale local installer. */
  examples: {
    eyebrow: string;
    heading: string;
    intro: string;
    defaultDemo: {
      label: string;
      heading: string;
      description: string;
      macArm: string;
      macIntel: string;
      windows: string;
      releaseNotes: string;
      firstLaunch: string;
    };
    sampleLabel: string;
    sourceLabel: string;
    downloadsLabel: string;
    apps: { name: string; description: string }[];
  };
  /** The 360° ASCII butterfly — the brand's Sasakia charonda voxelized from
   * butterfly-rects and rendered as rotating text (three.js AsciiEffect),
   * bridging the LP back to create-murasaki's ASCII banner. */
  asciiButterfly: {
    eyebrow: string;
    heading: string;
    /** Pinned inside the render — tells people it spins and is pure text. */
    hint: string;
    caption: string;
  };
  /** The DMG-installer easter egg tucked under Artifacts (07) — a faithful,
   * fully drag-and-droppable mock of the real macOS "drag app into
   * Applications" install window. Nothing actually installs; the caption
   * says so once you drop it, the same honesty beat as the playground's
   * "just HTML" confession. */
  dmgDemo: {
    /** "Applications" folder label under the drop target (macOS localizes
     * this folder name itself — kept per-locale to match). */
    folderLabel: string;
    /** Hint shown before a successful drop. */
    hint: string;
    /** Shown after a successful drop. */
    installedTitle: string;
    installedCaption: string;
  };
}

const lpEn: LpExtra = {
  marquee: [
    "Next.js DX for desktop",
    "Native windows",
    "Native menus",
    "~1/5 Electron memory",
    "React 19",
    "Vite HMR",
    "Rust-native",
    "No Rust required",
    "MIT licensed",
  ],
  tategaki: "紫は蝶のように軽い",
  demo: {
    windowTitle: "Murasaki App",
    menus: [
      {
        label: "File",
        items: [{ label: "Close Window", shortcut: "⌘W" }],
      },
      {
        label: "Edit",
        items: [
          { label: "Undo", shortcut: "⌘Z" },
          { label: "Redo", shortcut: "⇧⌘Z" },
          { label: "", divider: true },
          { label: "Cut", shortcut: "⌘X" },
          { label: "Copy", shortcut: "⌘C" },
          { label: "Paste", shortcut: "⌘V" },
          { label: "Select All", shortcut: "⌘A" },
        ],
      },
      {
        label: "View",
        items: [{ label: "Reload", shortcut: "⌘R" }],
      },
    ],
    contentTitle: "Hello, Murasaki 🦋",
    tagline:
      "The Next.js developer experience — file-based routing, server actions and native menus — in a lightweight Rust shell.",
    editHint: {
      before: "Edit ",
      code: "src/app/page.tsx",
      after: " and save to reload.",
    },
    cards: ["Docs", "GitHub", "murasaki_js"],
    demoCta: "Try the interactive demo",
    codeCaption:
      "This code becomes that menu. NSMenu on macOS, HMENU on Windows.",
    tryHint: "Try the menus — View → Reload works.",
  },
  converge: { left: "Native apps.", right: "Web DX." },
  manifesto:
    "Build native desktop apps with file-based routing, server actions, and React 19 — in a Rust-native window, not Electron's Chromium. Without writing Rust.",
  manifestoCounterLabel: "Lit",
  scrollCue: "Scroll",
  playground: {
    eyebrow: "Try it",
    heading: "Right-click this.",
    hint: "psst — right-click. drawing works too",
    items: {
      stamp: "Stamp a butterfly 🦋",
      shuffle: "Shuffle the palette 🎨",
      clear: "Clear the canvas 🧹",
      confession: "(okay, THIS menu is just HTML)",
    },
    caption:
      "In a real Murasaki app this pops a native NSMenu / HMENU. On a website? Still just HTML — we had to be honest somewhere.",
  },
  examples: {
    eyebrow: "Runnable apps",
    heading: "Try the result, not just the pitch.",
    intro:
      "Download the packaged default scaffold, or open three independent apps built to prove different product directions.",
    defaultDemo: {
      label: "Ready to run · v0.47.3",
      heading: "The default scaffold, already packaged.",
      description:
        "The exact app created by create-murasaki, with native menus, file-based routes, Server Actions, API routes, and the bundled Node runtime.",
      macArm: "macOS · Apple silicon",
      macIntel: "macOS · Intel",
      windows: "Windows · x64",
      releaseNotes: "Release notes & checksums",
      firstLaunch:
        "Unsigned demo: on macOS, use right-click → Open once. Windows may show SmartScreen.",
    },
    sampleLabel: "Three apps. Three directions.",
    sourceLabel: "Source",
    downloadsLabel: "Downloads",
    apps: [
      {
        name: "Violet Notes",
        description:
          "Local-first Markdown editing, live preview, import/export, and native menus.",
      },
      {
        name: "Murasaki Focus",
        description:
          "Persistent timer state, keyboard controls, and a focused consumer desktop UI.",
      },
      {
        name: "Local Signal",
        description:
          "API Routes, Server Actions, the bundled Node runtime, and live request monitoring.",
      },
    ],
  },
  asciiButterfly: {
    eyebrow: "Say hi",
    heading: "Meet the Great Purple Emperor.",
    hint: "drag to spin · 100% text",
    caption:
      "Sasakia charonda — the great purple emperor, Japan's national butterfly, and this framework's namesake. Rendered in plain text, the same way the create-murasaki banner draws it in your terminal.",
  },
  dmgDemo: {
    folderLabel: "Applications",
    hint: "Drag Murasaki into Applications to install.",
    installedTitle: "Installed.",
    installedCaption:
      "(Okay — not really. But the real installer feels exactly like this.)",
  },
};

const lpJa: LpExtra = {
  marquee: [
    "デスクトップのための Next.js DX",
    "ネイティブウィンドウ",
    "ネイティブメニュー",
    "メモリは Electron の約1/5",
    "React 19",
    "Vite HMR",
    "Rust ネイティブ",
    "Rust 不要",
    "MIT ライセンス",
  ],
  tategaki: "紫は蝶のように軽い",
  demo: {
    windowTitle: "Murasaki App",
    menus: [
      {
        label: "File",
        items: [{ label: "Close Window", shortcut: "⌘W" }],
      },
      {
        label: "Edit",
        items: [
          { label: "Undo", shortcut: "⌘Z" },
          { label: "Redo", shortcut: "⇧⌘Z" },
          { label: "", divider: true },
          { label: "Cut", shortcut: "⌘X" },
          { label: "Copy", shortcut: "⌘C" },
          { label: "Paste", shortcut: "⌘V" },
          { label: "Select All", shortcut: "⌘A" },
        ],
      },
      {
        label: "View",
        items: [{ label: "Reload", shortcut: "⌘R" }],
      },
    ],
    contentTitle: "Hello, Murasaki 🦋",
    tagline:
      "The Next.js developer experience — file-based routing, server actions and native menus — in a lightweight Rust shell.",
    editHint: {
      before: "Edit ",
      code: "src/app/page.tsx",
      after: " and save to reload.",
    },
    cards: ["Docs", "GitHub", "murasaki_js"],
    demoCta: "Try the interactive demo",
    codeCaption:
      "このコードが、このメニューになります。macOS では NSMenu、Windows では HMENU。",
    tryHint: "メニューを触ってみてください — 表示 → 再読み込みは動きます。",
  },
  converge: { left: "ネイティブアプリ。", right: "Web の DX。" },
  manifesto:
    "ファイルベースルーティング、サーバーアクション、React 19 でネイティブなデスクトップアプリを構築 — Electron の Chromium ではなく、Rust ネイティブなウィンドウで。Rust を書く必要はありません。",
  manifestoCounterLabel: "Lit",
  scrollCue: "Scroll",
  playground: {
    eyebrow: "試してみる",
    heading: "右クリックしてみて。",
    hint: "こっそり右クリック。お絵かきもできます",
    items: {
      stamp: "蝶をスタンプ 🦋",
      shuffle: "配色をシャッフル 🎨",
      clear: "キャンバスを消す 🧹",
      confession: "(このメニューだけは、ただの HTML です)",
    },
    caption:
      "本物の Murasaki アプリなら、ここでネイティブの NSMenu / HMENU が開きます。Web サイト上では……やっぱりただの HTML です。どこかで正直でいないと、ですね。",
  },
  examples: {
    eyebrow: "実際に動くアプリ",
    heading: "説明より先に、完成品を試す。",
    intro:
      "標準スキャフォールドのパッケージ版をダウンロードするか、異なる方向性を実証する3つの独立アプリを試せます。",
    defaultDemo: {
      label: "すぐに起動 · v0.47.3",
      heading: "標準スキャフォールドを、そのままアプリに。",
      description:
        "create-murasakiが生成するアプリそのものです。ネイティブメニュー、ファイルベースルーティング、Server Actions、API Routes、同梱Nodeを確認できます。",
      macArm: "macOS · Appleシリコン",
      macIntel: "macOS · Intel",
      windows: "Windows · x64",
      releaseNotes: "リリースノートとチェックサム",
      firstLaunch:
        "未公証のDemoです。macOSでは初回のみ右クリック→「開く」、WindowsではSmartScreenの確認が必要な場合があります。",
    },
    sampleLabel: "3つのアプリ。3つの方向性。",
    sourceLabel: "ソース",
    downloadsLabel: "ダウンロード",
    apps: [
      {
        name: "Violet Notes",
        description:
          "ローカルファーストなMarkdown編集、ライブプレビュー、入出力、ネイティブメニュー。",
      },
      {
        name: "Murasaki Focus",
        description:
          "永続化するタイマー、キーボード操作、コンシューマー向けデスクトップUI。",
      },
      {
        name: "Local Signal",
        description:
          "API Routes、Server Actions、同梱Node、リアルタイムなリクエスト監視。",
      },
    ],
  },
  asciiButterfly: {
    eyebrow: "ごあいさつ",
    heading: "オオムラサキ。",
    hint: "ドラッグで回せます · すべて文字",
    caption:
      "国蝶オオムラサキ(Sasakia charonda)— murasaki の名前の由来です。create-murasaki がターミナルに描く起動バナーと同じように、すべてテキストで描画しています。",
  },
  dmgDemo: {
    folderLabel: "アプリケーション",
    hint: "Murasaki を「アプリケーション」へドラッグしてインストール。",
    installedTitle: "インストール完了。",
    installedCaption:
      "(実際にはインストールしていません。でも本物も、こんな感触です。)",
  },
};

export const lpExtra: Record<string, LpExtra> = { en: lpEn, ja: lpJa };
