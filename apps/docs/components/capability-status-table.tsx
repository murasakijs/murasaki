import Link from "next/link";
import type { ReactNode } from "react";
import manifestJson from "../../../packages/murasaki/capabilities.json";

type Locale = "en" | "ja";
type FeatureStatus = "stable" | "experimental" | "partial" | "planned";
type PlatformStatus =
  | "supported"
  | "partial"
  | "development-only"
  | "planned"
  | "unsupported";

interface CapabilityFeature {
  id: string;
  category: string;
  status: FeatureStatus;
  platforms: Record<"macos" | "windows" | "linux", PlatformStatus>;
  limitations: string[];
  apiSymbols: string[];
  testEvidence: string[];
  docsSlug: string;
}

interface CapabilityManifest {
  schemaVersion: number;
  frameworkVersion: string;
  features: CapabilityFeature[];
}

const manifest = manifestJson as CapabilityManifest;

const FEATURE_LABELS: Record<string, Record<Locale, string>> = {
  "file-routing": { en: "File routing", ja: "ファイルルーティング" },
  "server-actions": { en: "Server Actions", ja: "Server Actions" },
  "api-routes": { en: "API Routes", ja: "API Routes" },
  "navigation-middleware": {
    en: "Navigation middleware",
    ja: "ナビゲーションMiddleware",
  },
  "route-metadata": { en: "Route metadata", ja: "ルートMetadata" },
  "node-main-lifecycle": {
    en: "Node main lifecycle",
    ja: "Nodeメインライフサイクル",
  },
  "native-window": { en: "Native window", ja: "ネイティブウィンドウ" },
  "application-menu": {
    en: "Application menu",
    ja: "アプリケーションメニュー",
  },
  "context-menu": { en: "Context menu", ja: "コンテキストメニュー" },
  "native-utilities": {
    en: "Native utilities",
    ja: "ネイティブユーティリティ",
  },
  "auto-update": { en: "Auto-update", ja: "自動アップデート" },
  "application-packaging": {
    en: "Application packaging",
    ja: "アプリケーションパッケージング",
  },
  "code-signing": { en: "Code signing", ja: "コード署名" },
  "loopback-endpoint-protection": {
    en: "Loopback endpoint protection",
    ja: "ループバックエンドポイント保護",
  },
  "multi-window": { en: "Multi-window", ja: "マルチウィンドウ" },
  "tray-and-global-shortcuts": {
    en: "Tray and global shortcuts",
    ja: "トレイとグローバルショートカット",
  },
  "single-instance-and-deep-links": {
    en: "Single instance and deep links",
    ja: "シングルインスタンスとディープリンク",
  },
  "capability-permissions": {
    en: "Capability permissions",
    ja: "ケイパビリティ権限",
  },
  "linux-distribution": {
    en: "Linux distribution",
    ja: "Linux配布",
  },
};

const CATEGORY_LABELS: Record<string, Record<Locale, string>> = {
  "web-framework": { en: "Web framework", ja: "Webフレームワーク" },
  "application-model": {
    en: "Application model",
    ja: "アプリケーションモデル",
  },
  "native-integration": { en: "Native integration", ja: "ネイティブ統合" },
  distribution: { en: "Distribution", ja: "配布" },
  security: { en: "Security", ja: "セキュリティ" },
};

const STATUS_LABELS: Record<FeatureStatus, Record<Locale, string>> = {
  stable: { en: "Stable", ja: "Stable" },
  experimental: { en: "Experimental", ja: "実験的" },
  partial: { en: "Partial", ja: "部分対応" },
  planned: { en: "Planned", ja: "計画中" },
};

const PLATFORM_LABELS: Record<PlatformStatus, Record<Locale, string>> = {
  supported: { en: "Supported", ja: "対応" },
  partial: { en: "Partial", ja: "部分対応" },
  "development-only": { en: "Dev only", ja: "開発のみ" },
  planned: { en: "Planned", ja: "計画中" },
  unsupported: { en: "Unavailable", ja: "未対応" },
};

const JA_LIMITATIONS: Record<string, string[]> = {
  "file-routing": [
    "page、layout、loading、error、not-found、route group、単一dynamic segmentは利用できますが、catch-allページsegmentは未実装です。",
    "ルーターはクライアント側で動作し、Next.js App RouterやReact Server Componentsの全機能を提供するものではありません。",
  ],
  "server-actions": [
    "Actionは同梱されたローカルNode runtimeで実行されます。Next.js Server Actionsそのものでも、リモート公開RPCサービスでもありません。",
    "version付きwire formatには値とpayloadの上限があり、Murasaki 1.0までは変更される可能性があります。",
  ],
  "api-routes": [
    "ルートはアプリ内のローカルNode processから提供され、公開ネットワークサービスとしての利用は想定していません。",
    "Web Request / Response primitiveに沿いますが、Next.js Route Handler runtimeの完全な実装ではありません。",
  ],
  "navigation-middleware": [
    "Middlewareはrenderer内でclient navigationの前に実行され、pathnameだけを受け取ります。",
    "request/response header、cookie、edge実行、matcher設定は利用できません。",
  ],
  "route-metadata": [
    "document title、description、favicon、一部のOpen Graph metadataをrendererへ反映します。",
    "metadata shapeはNext.js完全互換ではなく、document metadataからnative window titleは更新されません。",
  ],
  "node-main-lifecycle": [
    "src/main.tsはready、cancel可能なbeforeQuit、時間制限付きshutdown、app path、AbortSignalを提供します。",
    "本番向けwindow manager、native command registry、process監視APIはまだ提供していません。",
  ],
  "native-window": [
    "Murasakiが起動するapplication windowは1つです。対応済みのmulti-window managerやwindowごとのlifecycle eventはありません。",
    "window vibrancyは現在もno-opで、renderer向けpublic APIが公開するnative window操作は一部だけです。",
  ],
  "application-menu": [
    "macOSとWindowsではnative application menuを利用できますが、roleの挙動にはplatform差があります。",
    "Linuxにはdefault/custom application menuの実装がありません。",
  ],
  "context-menu": [
    "macOSとWindowsではwindow全体およびscope付きのnative context menuを利用できます。",
    "LinuxのIPC経路ではnative context menu未実装としてエラーになります。",
  ],
  "native-utilities": [
    "dialog、clipboard、notification、shell helperは@murasakijs/nativeに存在します。",
    "mainのmurasaki packageから、permission scopeを持つ正式なpublic APIとしてはまだ公開されていません。",
  ],
  "auto-update": [
    "署名付きmanifest、上限付きdownload、SHA-256 payload検証、staging handoff、relaunchをpackaged app向けに実装しています。",
    "Linux packaging/updateは未対応です。現在のartifact名とmanifest scanではWindows arm64 updateを公開できません。",
  ],
  "application-packaging": [
    "macOSの.app/.dmgと、Windowsのportable .zip、NSIS .exe、WiX .msiを生成できます。",
    "Linux launcher packaging/installerは未実装です。MSIにはWiXが必要で、WiXはWindows上でのみ動作します。",
  ],
  "code-signing": [
    "開発者がcredentialを用意した場合、macOSのDeveloper ID署名とApple notarizationを利用できます。",
    "Windows AuthenticodeとLinux package署名は未実装です。macOSのad-hoc署名は利用者からの信頼を確立しません。",
  ],
  "loopback-endpoint-protection": [
    "開発時のprivileged endpointはHttpOnly SameSite runtime sessionを要求し、loopback Host、Origin、Fetch Metadataを検証します。",
    "すべてのnative command、window、remote originを対象にするTauri型のcapability/permission systemはまだありません。",
  ],
  "multi-window": [
    "複数windowの作成、識別、復元、個別closeを行う正式なpublic APIはありません。",
  ],
  "tray-and-global-shortcuts": [
    "public frameworkにはtray iconやsystem-wide shortcut APIがありません。依存packageや内部moduleがあるだけではshipping featureとして扱いません。",
  ],
  "single-instance-and-deep-links": [
    "single-instance lock、second-launch event、URL scheme登録、file association eventの正式なAPIはありません。",
  ],
  "capability-permissions": [
    "window/origin単位のpermission、command scope、deny rule、監査可能なcapability manifestはまだ提供していません。",
  ],
  "linux-distribution": [
    "Linux用prebuilt native binaryと開発対応だけでは、install可能なLinux application releaseにはなりません。",
    "AppImage、deb、rpm、repository metadata、署名、update、launcher packagingは未実装です。",
  ],
};

const STATUS_CLASSES: Record<FeatureStatus, string> = {
  stable:
    "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  experimental:
    "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  partial:
    "border-orange-600/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  planned: "border-fd-border bg-fd-muted text-fd-muted-foreground",
};

const PLATFORM_CLASSES: Record<PlatformStatus, string> = {
  supported:
    "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  partial:
    "border-orange-600/30 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  "development-only":
    "border-sky-600/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  planned: "border-fd-border bg-fd-muted text-fd-muted-foreground",
  unsupported: "border-red-600/30 bg-red-500/10 text-red-700 dark:text-red-300",
};

function Badge({
  children,
  className,
}: {
  children: ReactNode;
  className: string;
}) {
  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold ${className}`}
    >
      {children}
    </span>
  );
}

function limitationText(feature: CapabilityFeature, locale: Locale) {
  if (locale === "en") return feature.limitations;
  return JA_LIMITATIONS[feature.id] ?? feature.limitations;
}

function localizeDocsSlug(slug: string, locale: Locale) {
  return locale === "ja" ? `/ja${slug}` : slug;
}

export function CapabilityStatusTable({ locale }: { locale: Locale }) {
  const text =
    locale === "ja"
      ? {
          caption: "Murasakiの機能とplatform対応状況",
          feature: "機能",
          status: "状態",
          limits: "現在の制限",
          details: "APIと検証根拠",
          api: "API",
          evidence: "検証根拠",
          noPublicApi: "正式なpublic APIなし",
          noAutomatedEvidence: "自動検証なし（未実装）",
          manifest: "manifest schema",
        }
      : {
          caption: "Murasaki feature and platform support",
          feature: "Feature",
          status: "Status",
          limits: "Current limits",
          details: "API and evidence",
          api: "API",
          evidence: "Evidence",
          noPublicApi: "No supported public API",
          noAutomatedEvidence: "No automated evidence (not implemented)",
          manifest: "manifest schema",
        };

  return (
    <div className="my-6">
      <p className="mb-3 text-sm text-fd-muted-foreground">
        Murasaki {manifest.frameworkVersion} · {text.manifest}{" "}
        {manifest.schemaVersion}
      </p>
      <div className="overflow-x-auto rounded-xl border border-fd-border">
        <table className="m-0 min-w-[980px] border-collapse text-sm">
          <caption className="sr-only">{text.caption}</caption>
          <thead className="bg-fd-muted/60">
            <tr>
              <th className="w-48 px-4 py-3 text-left">{text.feature}</th>
              <th className="w-28 px-3 py-3 text-left">{text.status}</th>
              <th className="w-24 px-3 py-3 text-left">macOS</th>
              <th className="w-24 px-3 py-3 text-left">Windows</th>
              <th className="w-24 px-3 py-3 text-left">Linux</th>
              <th className="px-4 py-3 text-left">{text.limits}</th>
            </tr>
          </thead>
          <tbody>
            {manifest.features.map((feature) => (
              <tr
                key={feature.id}
                className="border-t border-fd-border align-top"
              >
                <td className="px-4 py-4">
                  <Link
                    className="font-semibold text-fd-foreground underline decoration-fd-border underline-offset-4 hover:decoration-fd-primary"
                    href={localizeDocsSlug(feature.docsSlug, locale)}
                  >
                    {FEATURE_LABELS[feature.id]?.[locale] ?? feature.id}
                  </Link>
                  <span className="mt-1 block text-xs text-fd-muted-foreground">
                    {CATEGORY_LABELS[feature.category]?.[locale] ??
                      feature.category}
                  </span>
                </td>
                <td className="px-3 py-4">
                  <Badge className={STATUS_CLASSES[feature.status]}>
                    {STATUS_LABELS[feature.status][locale]}
                  </Badge>
                </td>
                {(["macos", "windows", "linux"] as const).map((platform) => (
                  <td key={platform} className="px-3 py-4">
                    <Badge
                      className={PLATFORM_CLASSES[feature.platforms[platform]]}
                    >
                      {PLATFORM_LABELS[feature.platforms[platform]][locale]}
                    </Badge>
                  </td>
                ))}
                <td className="px-4 py-4">
                  <ul className="m-0 space-y-1.5 pl-4 text-fd-muted-foreground">
                    {limitationText(feature, locale).map((limitation) => (
                      <li key={limitation}>{limitation}</li>
                    ))}
                  </ul>
                  <details className="mt-3 text-xs text-fd-muted-foreground">
                    <summary className="cursor-pointer font-medium text-fd-foreground">
                      {text.details}
                    </summary>
                    <div className="mt-2 grid gap-2">
                      <div>
                        <span className="font-medium text-fd-foreground">
                          {text.api}:{" "}
                        </span>
                        {feature.apiSymbols.length > 0
                          ? feature.apiSymbols.map((symbol, index) => (
                              <span key={symbol}>
                                {index > 0 ? ", " : null}
                                <code>{symbol}</code>
                              </span>
                            ))
                          : text.noPublicApi}
                      </div>
                      <div>
                        <span className="font-medium text-fd-foreground">
                          {text.evidence}:
                        </span>
                        {feature.testEvidence.length > 0
                          ? feature.testEvidence.map((evidence, index) => (
                              <span key={evidence}>
                                {index > 0 ? ", " : null}
                                <code>{evidence}</code>
                              </span>
                            ))
                          : text.noAutomatedEvidence}
                      </div>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
