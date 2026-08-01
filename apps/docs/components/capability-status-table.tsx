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
    ja: "ナビゲーションミドルウェア",
  },
  "route-metadata": { en: "Route metadata", ja: "ルートメタデータ" },
  "node-main-lifecycle": {
    en: "Node main lifecycle",
    ja: "Node Main ライフサイクル",
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
  "secure-storage": { en: "Secure storage", ja: "セキュアストレージ" },
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
  "content-security-policy": {
    en: "Content Security Policy",
    ja: "Content Security Policy",
  },
  "multi-window": { en: "Multi-window", ja: "マルチウィンドウ" },
  "tray-and-global-shortcuts": {
    en: "Tray and global shortcuts",
    ja: "トレイとグローバルショートカット",
  },
  "system-permissions": { en: "System permissions", ja: "システム権限" },
  "single-instance-and-deep-links": {
    en: "Single instance and deep links",
    ja: "シングルインスタンスとディープリンク",
  },
  "capability-permissions": {
    en: "Capability permissions",
    ja: "ケイパビリティ権限",
  },
  "diagnostics-and-logging": {
    en: "Diagnostics and logging",
    ja: "診断とロギング",
  },
  "webview-session-network": {
    en: "WebView session & network",
    ja: "WebViewセッションとネットワーク",
  },
  "build-time-plugin-sdk": {
    en: "Build-time plugin SDK",
    ja: "ビルド時プラグインSDK",
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
  operations: { en: "Operations", ja: "運用" },
  tooling: { en: "Tooling", ja: "ツール" },
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
    "page、layout、loading、error、not-found、route group、単一の dynamic segment、catch-all・optional catch-all のページ segment（[...slug]、[[...slug]]）に対応しています。",
    "ルーターはクライアントサイドで動作し、Next.js の App Router や React Server Components の実行環境を完全な形で提供するものではありません。",
  ],
  "server-actions": [
    "Action は同梱されたローカルの Node 実行環境で実行されます。Next.js の Server Actions そのものではなく、リモートでホストされる RPC サービスでもありません。",
    "バージョン管理された wire format は wire version 1 で固定されています。1.x 系のデコーダーは常に v1 を受理し、値とペイロードの上限は仕様として保証されます。将来拡張する場合も、より新しいバージョンをネゴシエートしつつ v1 へのフォールバックを維持します。",
  ],
  "api-routes": [
    "ルートはアプリ内のローカルな Node プロセスから提供され、公開ネットワークサービスとして利用することは想定していません。",
    "API の形式は Web の Request / Response プリミティブに準拠していますが、Next.js の Route Handler の実行環境を完全に再現するものではありません。",
  ],
  "navigation-middleware": [
    "Middleware はレンダラー内でクライアントナビゲーションの前に実行され、遷移先の pathname と query string のみを受け取ります。",
    "リクエストヘッダー、レスポンスヘッダー、cookie、edge 実行環境、matcher 設定には対応していません。",
  ],
  "route-metadata": [
    "document の title、description、favicon、および Open Graph の一部の項目をレンダラーに反映します。title についてはネイティブウィンドウのタイトルにも反映されます（ベストエフォートであり、window:setTitle ケイパビリティが必要です）。",
    "metadata の形式は Next.js と完全には互換性がありません。",
  ],
  "node-main-lifecycle": [
    "src/main.ts のライフサイクルは、ready、キャンセル可能な beforeQuit、時間制限付きの shutdown、二重起動時の second-launch の配送、アプリのパス、AbortSignal、レンダラー向けの型付きライブイベント、そして開発時・パッケージ済みアプリの双方における宣言済みウィンドウの管理をカバーします。",
    "設定済みのセカンダリウィンドウは実行時に生成・破棄できます。パッケージ済みのホストは同梱された Node の予期しない終了を検知すると、未確定のアップデートの引き継ぎを破棄し、バックエンドのプロセスツリーを終了させたうえで、WebView を残したままにせず非ゼロで終了します。再生可能なライフサイクルイベント、公開されたクラッシュ時再起動ポリシー、ヘルスチェック API は未実装です。macOS では、外部からの Dock 経由の終了や OS のログアウトに対して、tao 経由のキャンセル可能な beforeQuit を保証できません。",
  ],
  "login-autostart": [
    "ユーザー単位のログイン起動は autostart.status / enable / disable として公開され、読み取り用と書き込み用で別々のレンダラー ケイパビリティの背後にあります。murasaki dev 下では拒否されるため、Node の開発用実行ファイルが誤って登録されることはありません。",
    "macOS ではユーザーの LaunchAgent、Windows では現在のユーザーの Run レジストリキー、Linux では XDG Autostart を使用します。`status` は、保存されている登録が現在のパッケージ済み実行ファイルと完全に一致する場合にのみ `enabled` を報告します。ユーザーや OS のポリシーによって、アプリの外で登録が無効化・削除されることもあります。",
    "macOS の LaunchAgent 実装は App Sandbox ビルドと互換性がありません。別途署名されたログイン項目用ヘルパーはまだ実装されていません。",
  ],
  "native-window": [
    "設定済みのセカンダリテンプレートは、信頼された Node Main から生成・破棄・再生成でき、世代単位のライフサイクルイベントを受け取れます。レンダラー側は、宣言済みで稼働中のウィンドウを表示・管理することに限られ、実行時の URL やケイパビリティのポリシーを指定することはできません。",
    "macOS の hud、sidebar、popover の vibrancy マテリアルは、ウィンドウ / WebView を透過合成したうえでネイティブに適用されます。Windows と Linux はこの macOS 専用オプションを無視します。",
    "親子関係やモーダルウィンドウには対応していません。tao にクロスプラットフォーム対応がないため、宣言したウィンドウはすべて独立したトップレベルウィンドウになります。",
    "対応するのはボーダーレスの全画面表示のみで、専有のビデオモードによる全画面表示には対応していません。",
    "titleBarStyle: 'hidden' は macOS 専用です（透過タイトルバー、タイトル非表示、full-size content view の組み合わせ）。Windows と Linux ではこのオプションを受け付けても無視します。",
    "getMonitors() が返す geometry（position、size）は物理ピクセル単位で報告され、論理ピクセルや CSS ピクセルではありません。",
  ],
  "application-menu": [
    "ネイティブのアプリケーションメニューは macOS、Windows、Linux（GTK、muda 経由）に対応しています。差し替えはプロセス全体に及ぶものとして primary レンダラーに限定され、menu:application に加えて特権的なロールのケイパビリティが必要です。",
    "Linux と Windows のメニューは、macOS のような太字のアプリ名サブメニューを持たない、シンプルな File / Edit / Window バーです。Edit 項目は、ネイティブの responder chain を経由するのではなく、フォーカス中の webview に対して document.execCommand を発行します。ロールのケイパビリティが不足している場合は差し替え全体を拒否し、現在のメニューをそのまま維持します。",
  ],
  "context-menu": [
    "ウィンドウ全体を対象とするものとスコープを指定するものの両方のネイティブコンテキストメニューが、menu:context ケイパビリティの下で macOS、Windows、Linux（GTK）に対応しています。特権的なネイティブロールについては、対応するケイパビリティが別途必要です。",
    "メニューの IPC は、ペイロード、項目数、深さ、文字列長のそれぞれに上限があります。Linux では、undo / redo のコンテキストメニューのロール項目は（upstream の muda / GTK の制約により）無言で省略され、cut / copy / paste / selectAll は X11 のキーイベントを合成することで配信されます（libxdo が必要で、XWayland を介さない Wayland 環境では利用できません）。",
  ],
  "native-utilities": [
    "dialog、clipboard、notification、shell 関連のヘルパー、secure storage、ウィンドウ操作は、同一オリジンのネイティブブリッジとウィンドウごとの許可リストを通じて、信頼されたレンダラーコードに公開されます。",
    "対象を指定する一部のコマンドは、インラインの allow / deny スコープに対応しています。それ以外の引数はコマンド単位の許可にとどまり、ネイティブのレンダラー API を src/main.ts から直接利用することはできません。",
    "dialog.showMessage はネイティブの OS メッセージボックスを表示します。clipboard は PNG 画像と HTML の読み書きにも対応しており、それぞれ上限が設けられ、個別に権限が付与されます。shell.trashItem と shell.openPath は shell.showItemInFolder と同様にパスのスコープが適用され、shell.openPath は URL や UNC・device パスを拒否します。",
    "notification.show が返す id は、ローカルでの管理専用に生成されたものです。upstream の notify-rust は macOS と Windows で click / action のコールバックを配信できないため、この id が後続のイベントと対応付けられることはありません。",
    "app.isElevated() は、すべてのプラットフォームで読み取り専用かつケイパビリティによって保護された自己問い合わせです（Windows: プロセストークンの elevation 状態、macOS / Linux: 実効 root 権限）。失敗することはありません。",
    "shell.runElevated({ executable, args? }) は、既存の絶対パスで指定された、ディレクトリトラバーサルを含まない実行ファイルを、Windows の UAC「runas」プロンプトを通じて起動します。Windows 専用で、shell.openPath と同様にパスのスコープが適用され、shell を経由することはなく、fire-and-forget です（起動した時点で resolve し、終了時ではありません）。ユーザーがプロンプトを拒否した場合は、固有のメッセージ「elevation was cancelled by the user」で reject されます。それ以外のプラットフォームでは unsupported エラーで reject されます。",
  ],
  "secure-storage": [
    "文字列の値は、macOS の Keychain、Windows の Credential Manager、（Linux では）freedesktop.org の Secret Service D-Bus API に、SHA-256 から導出した appId・キーの名前空間の下で保存されます。存在しないキーは null を返し、入力と IPC には上限があり、いずれのプラットフォームにも平文へのフォールバックはありません。",
    "Linux では、freedesktop.org の Secret Service D-Bus API を通じて値を保存します。これは GNOME（gnome-keyring）と KDE（KWallet）ではデフォルトで提供されています。到達可能なプロバイダーが存在しない場合、すべての操作は構造化されたエラーでフェイルクローズします。平文へのフォールバックが行われることはありません。",
    "get、set、delete はそれぞれ独立した、デフォルト拒否のウィンドウごとのケイパビリティを持ちます。許可はコマンド単位に加えて、キー単位の allow / deny スコープ（完全一致のキー、および末尾が前方一致するパターン）にも対応します。スコープを指定しない許可を与えた場合、そのアプリの名前空間内のすべてのキーが当該ウィンドウに公開されます。",
  ],
  "auto-update": [
    "署名付き manifest（固定鍵のローテーションと keyId ヒント付き）、上限付きのダウンロード、SHA-256 によるペイロード検証、manifest の鮮度・anti-replay チェック、段階的な percentage rollout、段階的な引き継ぎ・再起動が、パッケージ済みの macOS、Windows（x64・arm64）、Linux AppImage の各アプリで実装されています。",
    "Windows での self-update には、ユーザー単位の NSIS インストールが必要です。アップデーター機能を有効にしたビルドは installMode=perMachine を拒否し、MSI をスキップします。MSI は、システム管理による大規模なアップグレード向けに、組み込みのアップデーターを無効化した状態で利用できます。",
    "自前でホストするエンドポイントは https である必要があります（loopback の http はローカルテスト目的に限り許可されます）。delta / differential アップデートは未実装です。Linux での self-update は AppImage 形式でパッケージした場合にのみ動作します（実行中の .AppImage ファイルを journal 付きでその場で差し替え、--appimage-extract-and-run で再起動します）。.deb によるインストールや手動で展開した AppDir には差し替える対象のファイルが存在しないため、check() はエラーではなく、構造化された not-available の理由（アップデートはシステムのパッケージマネージャーが管理している）を返します。",
  ],
  "application-packaging": [
    "macOS の .app / .dmg、および Windows の portable .zip、NSIS .exe、WiX .msi を生成できます。プラットフォーム向けのインストーラーが1つも生成されなかった場合、インストーラー作成はフェイルクローズします。Windows のアップデーター対応ビルドはユーザー単位の NSIS を必要とし、MSI をスキップします。MSI が生成されるのは、組み込みのアップデーターを無効化した場合に限られます。",
    "Linux 向けの AppDir / AppImage / deb の artifact 組み立ては実装済みです（murasaki bundle / installer --target linux-x64|linux-arm64）。macOS / Windows のバンドルと同じリソース構成から生成され、ビルドを行うホストに mksquashfs（squashfs-tools）が必要です。ネイティブランチャーは、生成された AppImage / .deb をウィンドウ、webview、single-instance、deep link、AppImage の self-update まで含めて end-to-end で実行します。rpm packaging とリポジトリのメタデータは未実装ですが、コード署名は detached GPG 署名で利用できます（code-signing 機能を参照）。MSI の生成には WiX が必要で、WiX は Windows 上でのみ動作します。",
  ],
  "code-signing": [
    "開発者が資格情報を用意した場合、macOS 向けに Developer ID 署名と Apple の公証（notarization）を利用できます。",
    "Windows の Authenticode は、開発者が用意した PFX・store 証明書、または Microsoft Artifact Signing プロバイダーを通じて、アプリの実行ファイル、portable ZIP のペイロード、NSIS のセットアップ、MSI に署名・検証を行います。macOS の ad-hoc 署名は、利用者からの信頼を確立するものではありません。",
    "Linux では、`murasaki installer --sign` が .AppImage、.deb、および両者をまとめた SHA256SUMS に対して detached かつ armored 形式の GPG 署名（<artifact>.sig）を生成します。dpkg-sig が PATH 上にあれば、Debian ネイティブの署名も日和見的に埋め込みます。署名鍵は $MURASAKI_GPG_KEY または sign.linux.gpgKey で選択し、passphrase は $MURASAKI_GPG_PASSPHRASE または gpg-agent からのみ取得します。distro のリポジトリの trust store や apt / dnf の keyring との統合はなく、rpm にも対応していません。",
  ],
  "loopback-endpoint-protection": [
    "開発時およびパッケージ済みの特権的なエンドポイントは、loopback の Host、Origin、Fetch Metadata を検証したうえで、正確なネイティブウィンドウのラベルと、そのラベルに紐づくデフォルト拒否の backendCapabilities に結び付けられた、HMAC 由来の identity を要求します。パッケージ済みの identity はネイティブウィンドウの世代にも結び付けられており、ウィンドウを閉じると稼働中の世代が失効し、再生成すると HMAC がローテーションされます。document-start の bootstrap は、サブフレームやアプリの正確な loopback オリジン以外の document で資格情報を定義する前に終了します。これは、WebView2 が main のみを対象としたスクリプトをフレームに注入する Windows の場合も含みます。静的な document のレスポンスには bearer 型の資格情報が一切含まれず、ネイティブ専用のライフサイクルエンドポイントはレンダラーの JavaScript からは利用できない別個の token を使用します。",
    "アプリのサーバーは依然として予測可能な loopback のポート範囲にバインドされるため、ローカルのプロセスが起動時にサービス拒否を引き起こす可能性があります。初回起動時に Murasaki は空いているプライベート範囲のポートを1つ選び、以降永続的に使用します。後から衝突が発生した場合は、HTTP のオリジンを変更して localStorage、IndexedDB、cookie を取り残す代わりに、フェイルクローズします。ブラウザのプロファイルはネイティブウィンドウ単位で分離されるため、同一オリジンの Service Worker や共有ストレージが、ラベルに紐づくバックエンドの権限境界を越えることはありません。XSS が発生した場合も、影響はそのウィンドウ自身が持つ許可の範囲にとどまります。",
  ],
  "content-security-policy": [
    "Murasaki は、環境ごとのデフォルト CSP を framework 側および利用者が所有する HTML に注入し、security.csp による完全なオーバーライドや明示的な無効化に対応するほか、利用者が所有する CSP タグを head の先頭に正規化して配置します。",
    "解決済みのポリシーは、単一のリゾルバーから Content-Security-Policy レスポンスヘッダー（開発時のミドルウェアおよびパッケージ済みの本番サーバー）と meta タグの両方で配信されるため、frame-ancestors 'none' のようなヘッダー専用のディレクティブも強制されます。meta タグには、ヘッダー専用のディレクティブ（frame-ancestors、sandbox、report-uri、report-to）を除いた、共有可能なサブセットが含まれます。security.csp: false は両方の配信経路を無効化します。CSP は HTML のサニタイズや Node 関数の認可を行うものではなく、レポートの送信先エンドポイントはデフォルトでは設定されません。また、互換性のためインラインスタイルは引き続き有効です。",
  ],
  "multi-window": [
    "ウィンドウは configuration 内で宣言されている必要があります。セカンダリテンプレートは起動時の生成を無効化することができ、信頼された Node Main から生成・破棄・再生成できます。任意の実行時 URL、ネイティブのポリシー、未宣言のラベルは拒否されます。",
    "セカンダリウィンドウを OS 側や自身の操作で閉じた場合は、後で再度開けるように非表示になります。一方、Node Main からの destroy はネイティブリソースを解放し、再生成時に世代をインクリメントします。アプリケーションメニューは引き続きプロセス全体で共有され、primary ウィンドウが所有します。",
    "各ネイティブウィンドウは分離された browser profile を持つため、Service Worker、SharedWorker、cookie、storage が他のウィンドウのバックエンドの権限を引き継ぐことはありません。セカンダリの profile は Windows / Linux および macOS 14 以降では永続化されます。macOS 11〜13 では、別個の非永続的な WebKit store を使用します。",
  ],
  "tray-and-global-shortcuts": [
    "プロセス全体で1つの macOS のステータスアイテム、または Windows の system tray icon が、tooltip、click イベント、ネイティブなネストメニュー、メニュー項目のイベント、動的な icon・メニューの差し替えに対応します。最後に成功した create が、それ以前の所有者を置き換えます。",
    "Linux の tray は libappindicator を使用し、AppIndicator ホストが必要です（GNOME では AppIndicator / KStatusNotifierItem Shell 拡張機能）。tray メニューの click や動的な icon・メニューの差し替えは macOS / Windows と同様に動作しますが、tray icon 自体の click / double-click イベントは発火しません。AppIndicator には「アタッチされたメニューを表示する」以外の signal が存在しないためです。",
    "macOS と Windows の global shortcut は、上限のある修飾キー + 既知キーの組み合わせによる accelerator、明示的な id、所有者宛にルーティングされる press イベント、同一プロセス内での競合検知、register / unregister それぞれ独立したケイパビリティの背後での所有者・shutdown 時の自動クリーンアップに対応します。",
    "Linux の global shortcut は、同じ accelerator / id のモデルを X11 経由で使用し、X11 または XWayland を必要とします。純粋な Wayland セッション（DISPLAY が存在しない場合）では登録を行わず、構造化された unsupported エラーを返します。Linux には、macOS / Windows と異なり OS 予約済みショートカットの一覧がありません。これはデスクトップ環境に依存するためです。",
    "ショートカットが実際に利用できるかどうかは、OS 側で予約されたキー割り当てや他のアプリケーションにも依存するため、パッケージ済みアプリでの OS 上の smoke testing が必要です。",
  ],
  "system-permissions": [
    "パッケージ済みの macOS アプリは、camera、microphone、screen recording、accessibility、input monitoring、location、full disk access、photos、contacts、calendar、reminders、speech recognition、Bluetooth について、usage description を宣言し、ケイパビリティによって保護されたレンダラー API と（ほとんどの種別では）任意の起動時プロンプトを通じて、同意の問い合わせ・要求ができます。これは、リクエスト可能な13種類に加え、以下の宣言専用の2種類（appleEvents、localNetwork）を合わせたものです。この15種類はすべて macOS 専用です。Windows / Linux には、これらが表すアプリ単位の TCC プロンプトに相当する OS レベルの機能がないためです。",
    "fullDiskAccess は案内のみを行います。macOS にはこれに対応する TCC のリクエスト用 API が存在しないため、`request()` はシステム設定の Full Disk Access ペインを開くだけです（許可が得られたと主張することはありません）。`status()` は、ドキュメント化されたベストエフォートのヒューリスティック（TCC で保護されたファイルを読み取る方式）であり、実際の答えの代わりに `unknown` を報告することがあります。",
    "appleEvents と localNetwork は宣言専用です。Murasaki はそれぞれの purpose string（NSAppleEventsUsageDescription / NSLocalNetworkUsageDescription）を書き込みますが、どちらについても問い合わせ用の API はありません。appleEvents の `request()` は、案内としてシステム設定の Automation ペインを開くだけです（同意は対象アプリ単位であり、送信時にしか判定できません）。localNetwork の `status()` / `request()` は、いずれも常に `unknown` を返す no-op です。実際にローカルネットワークへアクセスした時点で macOS が自動的にプロンプトを表示するためです。どちらにも `requestOnLaunch` の設定フィールドはありません。",
    "bluetooth には明示的なリクエスト呼び出しがありません。CoreBluetooth は、central manager が最初にインスタンス化された時点で暗黙的に同意を判定します。`status()` は、稼働中の manager インスタンスを必要としないクラスプロパティである `CBManager.authorization` を読み取ります。`request()` は、その OS 側の判定を発生させることだけを目的として（`location` と同様に delegate なしで）manager をインスタンス化します。",
    "calendar / reminders の起動時および実行時の `request()` は、実行中のシステムが対応していれば macOS 14 以降の full-access EventKit API を使用し、対応していなければ非推奨の 14 未満向け entity-type API にフォールバックします（この判定は build 時ではなく呼び出し時に NSProcessInfo で行われます）。Info.plist には常に、legacy 版と 14 以降の full-access 版の両方の usage-description キーが含まれるため、1つのパッケージ済みビルドがどちらのバージョンでも正しく動作します。",
    "location の `mode: 'always'` は、`NSLocationWhenInUseUsageDescription` と `NSLocationAlwaysAndWhenInUseUsageDescription` の両方を Info.plist に書き込み、リクエスト時にも同じ Info.plist のキーから読み戻します。そのため、追加の実装なしに `requestOnLaunch` と実行時の `systemPermission.request('location')` 呼び出しの両方に同一に適用されます。",
    "Hardened Runtime での署名では、メインアプリと同梱された Node の entitlements を分離しています。メインアプリは、`systemPermissions.macOS` から宣言された camera、microphone、location、photos、contacts、calendar / reminders、Apple Events のリソースアクセス権限を導出します。署名済みビルドには、Info.plist の purpose string に加えてこれらの権限が必要です。Bluetooth の device entitlement は App Sandbox 専用であり、speech recognition には Hardened Runtime のリソース entitlement がありません。JIT・署名なし実行可能メモリ・ライブラリ検証の無効化を取得できるのは Node のみです。ネイティブアドオンには実行可能 entitlement が付与されず、アプリが所有する実行可能なバンドルリソースは、macOS / Windows の内側から外側への署名のために `executable: true` を指定する必要があります。`sign.appSandbox: true` はフェイルクローズで拒否されます。これは、Apple の inherit-only な helper ルールが、現在の同梱された Node / JIT のアーキテクチャと非互換であるためです。カスタムの `sign.entitlements` と `sign.helperEntitlements` のファイルはそのまま使用され、設定されたファイルが見つからない、または不正な場合はフェイルクローズします。",
    "Windows のパッケージ化されていないデスクトップアプリでは、プライバシーの同意はアプリ単位の起動時プロンプトではなく利用状況に応じたものになるため、これらの汎用的な呼び出しは unsupported を報告します。Linux では未実装です。開発時のリクエストは terminal・Node のホストの identity を使用するため、パッケージ済みアプリでのテストが必要です。",
  ],
  "single-instance-and-deep-links": [
    "パッケージ済みの macOS アプリとインストール済みの Windows アプリは、宣言された URL scheme とファイルの関連付けを登録し、ユーザー単位の single-instance lock を維持したまま、正規化された起動時・second-instance・システムからのオープン要求を src/main.ts へ配送します。",
    "Windows の portable .zip や単体の実行ファイルによる配布では、protocol やファイルの関連付けは自動登録されません。登録は NSIS と MSI のインストーラーが担います。Linux も同じユーザー単位の single-instance lock を維持し、cold-start 時の argv（.desktop の Exec 行が展開する %U / %F）と second-instance の activation を、既存の loopback チャンネル経由で配送します。protocol・ファイル関連付けの MimeType エントリは .desktop ファイル内で宣言されます（.deb によって usr/share/applications 配下にインストールされ、update-desktop-database によって反映されます）が、Windows における NSIS / MSI のような、手動で展開した AppImage / AppDir に対する OS レベルの登録手順を検証する仕組みはありません。",
  ],
  "capability-permissions": [
    "レンダラーのネイティブコマンドはデフォルト拒否であり、実行時に検証されるウィンドウごとのケイパビリティの許可リストを通じて許可されます。送信元のオリジンとコマンド名は Rust 側で検証されます。レンダラーから Node のリソースへのアクセスは、ラベルに紐づく backendCapabilities を通じて、これとは別にデフォルト拒否となっています。",
    "URL（cookie の origin・パスを含む）、ファイルシステムのパス、secure storage のキー、対象ウィンドウ、OS の permission のスコープについては、明示的な allow / deny ルールに対応しています。それ以外のネイティブな引数はコマンド単位のままです。cookie の domain のオーバーライドは、URL のホストの範囲を超えることはできません。バックエンドのリソースについては、Main の export、Server Actions、API のメソッド・パス、updater のルート、イベント、diagnostics に対して、完全一致および末尾の前方一致による許可に対応しています。セカンダリウィンドウは意図的にどちらの許可リストも引き継がず、特権的なメニューロールには対応するネイティブケイパビリティが必要です。",
  ],
  "diagnostics-and-logging": [
    "Node Main は、構造化された JSONL 形式のログ出力、上限付きのローテーション、secret に見えるフィールドのマスキング、shutdown 時のフラッシュ処理、そしてアプリケーション・実行環境のメタデータとログの末尾を含む、オプトインかつ上限付きの診断レポートを提供します。",
    "Murasaki はさらに、バージョン管理されたローカルのクラッシュレポートを3つの領域にわたって取得します。Node の uncaughtException / unhandledRejection、ネイティブランチャーのパニックと予期しない終了時のメタデータ、そして（production ビルドのみ）レンダラーの未捕捉エラー・unhandled rejection です。いずれもログのフィールドと同様に上限が設けられマスキングされており、MainContext.diagnostics から読み取れます。",
    "クラッシュレポートはローカルの JSON ファイルとしてのみ保存され、Murasaki が送信することはありません。minidump やネイティブのシンボル解決には対応しておらず、自動アップロードも行いません。murasaki dev 環境下ではレンダラー側のキャプチャは no-op になります（代わりに dev のエラーオーバーレイがその UX を担います）。クラッシュレポート用サービスへの連携は、引き続きアプリケーション側の責務です。",
  ],
  "webview-session-network": [
    "アプリ全体に対する custom User-Agent、non-persistent（incognito）セッション、上限付きで未認証の HTTP CONNECT または SOCKSv5 のプロキシエンドポイントは、実行時に検証されたうえで、開発時およびパッケージ済みの macOS、Windows、Linux の WebView 向けに Wry へ渡されます。",
    "browser profile はネイティブウィンドウごとに分離されます。primary は従来通りアプリの profile を保持し、セカンダリの profile は Windows / Linux および macOS 14 以降では永続化されます。macOS 11〜13 では、分離された非永続的な store を使用します。ウィンドウをまたいだ cookie・storage・worker の共有は意図的にサポートしておらず、永続化したい状態はアプリ側で Main / API のハンドラーを通じて共有してください。",
    "macOS でのプロキシ設定には macOS 14 以降が必要で、それより古いリリースでは起動に失敗します。Windows の custom User-Agent には WebView2 86.0.616.0 以降が、private mode には 101.0.1210.39 以降が必要で、それより古い実行環境ではこれらの設定は無視されます。ウィンドウごとのオーバーライドや、認証が必要なプロキシには対応していません。",
    "webview:download は、サニタイズされ、衝突が解決されたダウンロードを、設定済み（または OS のデフォルト）のディレクトリに限定し、start と completion のイベントを報告します。completion イベントを、それに先立つ start イベントと確実に対応付ける id はなく、macOS では完了したダウンロードのパスが報告されることはありません（upstream の WebKit による制約です）。",
    "webview:dragDrop は、ファイルの drag-and-drop イベント（dragover は1秒あたり20回に throttle）を、OS のデフォルトの挙動を妨げることなく報告します。そのため、ファイル選択用の input 要素は許可の有無にかかわらず動作し続けます。webview.initScripts は、信頼された設定側が所有する JavaScript を page の読み込み前に注入するもので、ケイパビリティによる制御の対象ではありません。",
    "webview:zoom は page の zoom を 0.25〜5.0 の範囲に制限し、macOS 11 以降・iOS 14 以降でのみ利用できます。webview.hotkeysZoom（ケイパビリティではなく設定です）は、Windows でのみ OS の zoom 用ホットキー・ジェスチャーを有効にします。webview:print は各プラットフォームの print dialog を開きます。Wry が find-in-page の API を公開していないため、この機能は存在しません。",
    "webview:readCookies / webview:writeCookies は、上限付きの cookie の読み取り・設定・削除を公開し、構造化された URL のスコープに対応します。スコープを指定した読み取りには明示的な URL が必要です。書き込みは有効な cookie のパスと照合され、domain のオーバーライドは URL のホストと完全に一致する必要があります。予約されている legacy 名の murasaki_runtime は、実行時の認証がすでに cookie に依存していない場合でも、防御的な措置として読み取りの対象から除外され、書き込み・削除では拒否されます。deleteCookie は、name、domain としての URL ホスト、そしてデフォルトの / パスのみで一致判定を行います。",
    "レンダラーの camera、microphone、geolocation の Web API は、framework が管理する Permissions-Policy ヘッダーの下でフェイルクローズします。Wry 0.55 にはクロスプラットフォームなウィンドウごとの permission コールバックが存在しないため、これらの API を設定から有効化することはまだできません。代わりに、ケイパビリティで保護されたネイティブ機能を使用してください。",
  ],
  "build-time-plugin-sdk": [
    "信頼された build-time plugin は、Vite の PluginOptions、決定的な bundle の依存関係・リソース、そして実行時に検証される安定した名前を持つ、順番に実行される dev / build / bundle のライフサイクルフックを提供できます。",
    "これはネイティブの Rust ABI、動的ライブラリのローダー、レンダラー・実行時の plugin sandbox、あるいは権限境界ではありません。plugin のコードは、murasaki.config.ts と同じ Node.js の権限を持ちます。",
  ],
  "linux-distribution": [
    "AppDir / AppImage / deb の artifact 組み立て（application-packaging ケイパビリティを参照）と、ネイティブランチャーの実行環境のいずれも end-to-end で動作します。ウィンドウ・webview の生成、single-instance のロック、cold-start 時の deep link（.desktop の Exec 行に由来する argv）と second-instance の転送、graceful shutdown、ネイティブのクラッシュレポートは、いずれもパッケージ済みの AppImage または .deb から実行され、Docker 上の Xvfb と専用の D-Bus セッション、および app-package-linux.yml で検証されています。",
    "AppImage の self-update は動作します（実行中の .AppImage を journal 付きで単一のファイルとして差し替え、--appimage-extract-and-run で再起動し、health check に失敗した場合は初回起動時に rollback します）。.deb によるインストールや、素のまま・手動で展開した AppDir には self-update がありません（差し替える対象となる単一のファイルが存在しないためです）。この場合、アップデートはシステムのパッケージマネージャーが管理していると報告します。rpm packaging とリポジトリのメタデータは未実装ですが、コード署名は detached GPG 署名で利用できます（code-signing 機能を参照）。",
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
  const translated = JA_LIMITATIONS[feature.id];
  // The manifest is canonical. If its limitation shape changes before the
  // translation is updated, show the current English source instead of a
  // stale Japanese claim about a feature that may now ship.
  return translated?.length === feature.limitations.length
    ? translated
    : feature.limitations;
}

function localizeDocsSlug(slug: string, locale: Locale) {
  return locale === "ja" ? `/ja${slug}` : slug;
}

export function CapabilityStatusTable({ locale }: { locale: Locale }) {
  const text =
    locale === "ja"
      ? {
          caption: "Murasakiの機能とプラットフォーム対応状況",
          feature: "機能",
          status: "状態",
          limits: "現在の制限",
          details: "APIと検証根拠",
          api: "API",
          evidence: "検証根拠",
          noPublicApi: "正式な公開APIなし",
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
