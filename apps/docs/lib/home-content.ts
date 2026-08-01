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
    /** Status-pill label for an artifact whose support is not yet complete. */
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
  /** Compact latest-3 timeline section, just before the CTA band. */
  changelog: {
    eyebrow: string;
    heading: string;
    viewAll: string;
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
      "One command → a real native installer. macOS, Windows, and Linux (AppImage / .deb).",
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
        "@murasakijs/ui — an accessible React Aria component library built for Murasaki apps.",
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
        status: "Partial support",
        available: true,
        description:
          "AppImage and .deb packages (x64 & arm64), with self-update for AppImage and GPG code signing (murasaki installer --sign); rpm packaging isn't shipped yet.",
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
  changelog: {
    eyebrow: "Changelog",
    heading: "Shipped, dated, honest.",
    viewAll: "View full changelog",
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
  eyebrow: "React 19 · Vite · Rust ホスト",
  headline: {
    prefix: "",
    highlight: "Next.js の開発体験",
    suffix: "を、デスクトップへ。",
  },
  subhead:
    "ファイルベースルーティング、Server Actions、React 19。Web 開発で慣れ親しんだ体験のまま、OS 標準の WebView で動くデスクトップアプリを構築できます。Rust を書く必要はありません。",
  getStarted: "今すぐ始める",
  github: "GitHub",
  bandLabel: "オープンソース · MIT ライセンス · React 19 · Vite · Rust ホスト",
  mockup: {
    heading: "開発画面ではなく、配布できるアプリへ。",
    caption:
      "1つのコマンドで配布用パッケージを生成。macOS、Windows、Linux（AppImage / .deb）に対応します。",
    availableLabel: "利用可能",
    soonLabel: "近日対応",
  },
  codeShowcase: {
    eyebrow: "コードからデスクトップアプリへ",
    heading: {
      prefix: "React で書いて、",
      highlight: "デスクトップアプリ",
      suffix: "として届ける。",
    },
    description:
      "ファイルベースルーティング、Server Actions、API Routes、そして1つの設定ファイル。Next.js に近い構成のまま、デスクトップアプリとしてビルドできます。",
    tabs: [
      { id: "actions", label: "src/actions.ts" },
      { id: "page", label: "src/app/page.tsx" },
      { id: "route", label: "src/api/hello/route.ts" },
      { id: "config", label: "murasaki.config.ts" },
    ],
  },
  featuresEyebrow: "今すぐ使える機能",
  featuresHeading: "開発から配布まで、ひとつのフレームワークで",
  featuresIntro:
    "ネイティブコードや IPC の配線をアプリごとに書かずに、デスクトップ固有の機能を React から利用できます。",
  features: [
    {
      title: "ファイルベースルーティング",
      description:
        "src/app/**/page.tsx、レイアウト、動的セグメント。Next.js に近いファイル構成で画面を追加できます。",
    },
    {
      title: "Server Actions",
      description:
        "'use server' と defineAction / useAction を使い、Node.js 側の処理を型付きで呼び出せます。",
    },
    {
      title: "API Routes",
      description:
        "src/api/**/route.ts にローカル HTTP エンドポイントを定義できます。別のローカルサーバーを用意する必要はありません。",
    },
    {
      title: "ネイティブウィンドウ & メニュー",
      description:
        "OS のウィンドウ、アプリケーションメニュー、コンテキストメニューを宣言的に構成できます。",
    },
    {
      title: "UI キット",
      description:
        "@murasakijs/ui は、Murasaki アプリ向けのアクセシブルなコンポーネントライブラリです。",
    },
    {
      title: "署名済み配布",
      description:
        "macOS はコード署名・公証、Windows は Authenticode、Linux は GPG 署名に対応した配布パッケージを生成します。",
    },
  ],
  whyMurasaki: {
    eyebrow: "Murasaki を選ぶ理由",
    heading: "Murasaki を選ぶ理由",
    paragraph:
      "React / Next.js の知識を活かしながら、Rust や IPC の実装を最小限にして軽量なデスクトップアプリを作りたい開発者に適しています。",
    tableHeadings: {
      feature: "項目",
      murasaki: "Murasaki",
      electron: "Electron",
      tauri: "Tauri",
    },
    statValue: "約 1/5",
    statLabel: "Electron に対するアイドル時メモリ使用量の目安",
  },
  comparisonRows: [
    {
      label: "UI ランタイム",
      murasaki: "OS WebView (wry)",
      electron: "Chromium を同梱",
      tauri: "OS WebView",
    },
    {
      label: "言語",
      murasaki: "TypeScript / React",
      electron: "TypeScript / React",
      tauri: "TypeScript + Rust",
    },
    {
      label: "開発体験",
      murasaki: "Next.js に近い構成（Vite HMR）",
      electron: "手動で構成",
      tauri: "手動で構成",
    },
    {
      label: "メモリ（アイドル時）",
      murasaki: "Electron の約 1/5*",
      electron: "基準値",
      tauri: "小さい傾向",
    },
    {
      label: "Server Actions",
      murasaki: "defineAction / useAction",
      electron: "手動 IPC",
      tauri: "手動 IPC / コマンド",
    },
  ],
  comparisonFootnote:
    "* Electron/Tauri でよく引用されるおおよその目安であり、実測ベンチマークではありません。",
  nativeDeepDive: {
    eyebrow: "ブラウザタブではなく、OS のウィンドウ",
    heading: "Web の開発体験を、OS のウィンドウで。",
    paragraph:
      "Murasaki は OS 標準の WebView をネイティブウィンドウに組み込みます。タイトルバーやアプリケーションメニュー、コンテキストメニューは OS の機能として動作します。",
    bullets: [
      {
        title: "ネイティブウィンドウ",
        description:
          "wry を通じて OS の WebView を表示します。ブラウザのタブや iframe ではありません。",
      },
      {
        title: "ネイティブメニューバー",
        description:
          "React 側の宣言から OS のアプリケーションメニューを構築します。",
      },
      {
        title: "スコープ付きコンテキストメニュー",
        description:
          "useContextMenu(items) で NSMenu / HMENU / GtkMenu を宣言し、対象をウィンドウ全体または特定の要素に限定できます。",
      },
    ],
    codeLabel: "src/app/layout.tsx",
    menuMockLabel: "本物の NSMenu / HMENU / GtkMenu — HTML ではありません。",
  },
  distribution: {
    eyebrow: "配布パッケージを生成",
    heading: "開発から配布まで、同じ CLI で。",
    paragraph:
      "開発用ウィンドウの起動から、複数アーキテクチャ向けのバンドル、署名・公証、インストーラー生成までを Murasaki CLI で実行できます。",
    steps: [
      {
        label: "プロジェクトを作成する",
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
        note: "任意 — ご自身の Apple Developer ID 証明書を使用します（Murasaki は証明書を同梱しません）",
      },
      {
        label: "インストーラーを作る",
        command: "murasaki installer --sign --notarize",
        note: "→ dist/<App>-<version>.dmg（公証済み）",
      },
    ],
    platforms: [
      {
        name: "macOS",
        status: "利用可能",
        available: true,
        description: ".app / .dmg、arm64 / x64、コード署名・公証に対応。",
      },
      {
        name: "Windows",
        status: "利用可能",
        available: true,
        description:
          ".zip ポータブル版、NSIS .exe / MSI .msi インストーラー、arm64 / x64 に対応。",
      },
      {
        name: "Linux",
        status: "部分対応",
        available: true,
        description:
          "AppImage と .deb パッケージ（x64 / arm64）に対応。AppImage は自己更新に、murasaki installer --sign は GPG コード署名に対応します。rpm は未対応です。",
      },
    ],
  },
  quickStart: {
    eyebrow: "3つのコマンドで開始",
    heading: "作成して、動かして、バンドルする。",
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
    heading: "最初のデスクトップアプリを作りましょう。",
    paragraph:
      "React 19、ファイルベースルーティング、Server Actions を OS のウィンドウで。Rust を書く必要はありません。",
  },
  changelog: {
    eyebrow: "Changelog",
    heading: "何を、いつ出したか。ありのままに。",
    viewAll: "更新履歴をすべて見る",
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
          { label: "設定", href: "/docs/building/configuration" },
          { label: "CLI", href: "/docs/building/cli" },
          { label: "配布", href: "/docs/building/distribution" },
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
  /** Silkscreen rail labels for the sections whose eyebrow is not part of
   * HomeContent (01/02/05/07) — keeps the "NN · label" rail fully localized. */
  rail: {
    showcase: string;
    manifesto: string;
    versus: string;
    artifacts: string;
  };
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
  /** Runnable proof: the packaged default scaffold plus three independent
   * sample products, launched through the checksum-verifying developer CLI. */
  examples: {
    eyebrow: string;
    heading: string;
    intro: string;
    defaultDemo: {
      label: string;
      heading: string;
      description: string;
      releaseNotes: string;
      firstLaunch: string;
    };
    sampleLabel: string;
    sourceLabel: string;
    downloadsLabel: string;
    runner: {
      note: string;
      label: string;
      copy: string;
      copied: string;
    };
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
  rail: {
    showcase: "Native proof",
    manifesto: "Why it exists",
    versus: "vs Electron / Tauri",
    artifacts: "Artifacts",
  },
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
      "Run the packaged default scaffold or launch any of three independent products built from real application requirements — each in one CLI command.",
    defaultDemo: {
      label: "Developer preview · CLI",
      heading: "The default scaffold, already packaged.",
      description:
        "The exact app created by create-murasaki, with native menus, file-based routes, Server Actions, API routes, and the bundled Node runtime.",
      releaseNotes: "Build details & checksums",
      firstLaunch:
        "The macOS CLI selects the correct CPU build, verifies its published SHA256 and ad-hoc code signature, then explicitly removes quarantine before launch.",
    },
    sampleLabel: "Three apps. Three directions.",
    sourceLabel: "Source",
    downloadsLabel: "Browse all sources",
    runner: {
      note: "Each macOS developer preview selects the correct CPU build, verifies its published SHA-256 and ad-hoc signature, removes quarantine, and launches. Source remains available for inspection; these previews are not presented as notarized consumer downloads.",
      label: "macOS developer preview",
      copy: "Copy demo command",
      copied: "Copied",
    },
    apps: [
      {
        name: "Papelle",
        description:
          "A local-first block workspace with Markdown, attachments, linked pages, database views, and optional self-hosted collaboration.",
      },
      {
        name: "Oscilla",
        description:
          "An API workbench for REST, GraphQL, WebSocket, scenarios, mock responses, and an integrated traffic timeline.",
      },
      {
        name: "Orglia",
        description:
          "A self-hosted operations suite connecting CRM, projects, orders, inventory, approvals, shifts, incidents, and analytics.",
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
    "Next.js の開発体験をデスクトップへ",
    "ネイティブウィンドウ",
    "ネイティブメニュー",
    "メモリは Electron の約 1/5",
    "React 19",
    "Vite HMR",
    "軽量な Rust ホスト",
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
    tryHint: "メニューを操作できます。View → Reload も試してみてください。",
  },
  converge: { left: "ネイティブアプリ。", right: "Web の開発体験。" },
  rail: {
    showcase: "ネイティブの証明",
    manifesto: "なぜ作ったか",
    versus: "vs Electron / Tauri",
    artifacts: "配布物",
  },
  manifesto:
    "ファイルベースルーティング、Server Actions、React 19 を使ってデスクトップアプリを構築。Electron の Chromium ではなく OS 標準の WebView を使い、Rust を書かずに開発できます。",
  manifestoCounterLabel: "点灯",
  scrollCue: "スクロール",
  playground: {
    eyebrow: "試してみる",
    heading: "右クリックしてみて。",
    hint: "右クリック、またはドラッグして描いてみてください",
    items: {
      stamp: "蝶をスタンプ 🦋",
      shuffle: "配色を変更 🎨",
      clear: "キャンバスを消去 🧹",
      confession: "（このメニューだけは HTML でできています）",
    },
    caption:
      "Murasaki アプリでは NSMenu / HMENU が開きます。この Web ページ上のメニューはデモ用の HTML です。",
  },
  examples: {
    eyebrow: "実行できるサンプル",
    heading: "売り文句ではなく、動くアプリで。",
    intro:
      "標準スキャフォールドに加え、実際の要件から設計した3つの独立したアプリを、それぞれ CLI の1コマンドで起動できます。",
    defaultDemo: {
      label: "開発者プレビュー · CLI",
      heading: "標準スキャフォールドを、そのまま実行。",
      description:
        "create-murasaki が生成するアプリです。ネイティブメニュー、ファイルベースルーティング、Server Actions、API Routes、同梱された Node.js ランタイムを確認できます。",
      releaseNotes: "ビルド詳細とチェックサム",
      firstLaunch:
        "macOS CLI が CPU に合うビルドを選び、公開済みの SHA-256 と ad-hoc コード署名を検証した後、隔離属性を解除して起動します。",
    },
    sampleLabel: "3つのアプリ。3つの方向性。",
    sourceLabel: "ソース",
    downloadsLabel: "すべてのソースを見る",
    runner: {
      note: "各 macOS 開発者プレビューは、CPU に合うビルドを選択し、公開済みの SHA-256 と ad-hoc 署名を検証してから隔離属性を解除し、起動します。ソースも確認できますが、公証済みの一般利用者向けダウンロードとしては案内しません。",
      label: "macOS 開発者プレビュー",
      copy: "デモ用コマンドをコピー",
      copied: "コピーしました",
    },
    apps: [
      {
        name: "Papelle",
        description:
          "ブロック編集、Markdown、添付ファイル、ページ間リンク、データベース表示、任意のセルフホスト同期を備えたローカルファーストのワークスペース。",
      },
      {
        name: "Oscilla",
        description:
          "REST、GraphQL、WebSocket、シナリオテスト、モック応答、通信タイムラインをまとめた API ワークベンチ。",
      },
      {
        name: "Orglia",
        description:
          "CRM、プロジェクト、受発注、在庫、申請、シフト、インシデント、分析をつなぐセルフホスト型の業務アプリ。",
      },
    ],
  },
  asciiButterfly: {
    eyebrow: "ごあいさつ",
    heading: "オオムラサキに会いましょう。",
    hint: "ドラッグで回転 · すべてテキスト",
    caption:
      "国蝶オオムラサキ（Sasakia charonda）は Murasaki の名前の由来です。create-murasaki がターミナルに描くバナーと同じように、すべてテキストで描画しています。",
  },
  dmgDemo: {
    folderLabel: "アプリケーション",
    hint: "Murasaki を「アプリケーション」へドラッグしてインストールします。",
    installedTitle: "インストール完了。",
    installedCaption:
      "（これは操作デモです。実際のアプリは同じ手順でインストールできます。）",
  },
};

export const lpExtra: Record<string, LpExtra> = { en: lpEn, ja: lpJa };
