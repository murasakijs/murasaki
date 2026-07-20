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
    "page、layout、loading、error、not-found、route group、単一dynamic segment、そしてcatch-all/optional catch-allページsegment([...slug]、[[...slug]])まで利用できます。",
    "ルーターはクライアント側で動作し、Next.js App RouterやReact Server Componentsの完全なruntimeを提供するものではありません。",
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
    "Middlewareはrenderer内でclient navigationの前に実行され、pathnameとquery stringだけを受け取ります。",
    "request/response header、cookie、edge実行、matcher設定は利用できません。",
  ],
  "route-metadata": [
    "document title、description、favicon、一部のOpen Graph metadataをrendererへ反映します。titleはさらにnative window titleへも反映されます(ベストエフォート、window:setTitle capabilityが必要)。",
    "metadata shapeはNext.js完全互換ではありません。",
  ],
  "node-main-lifecycle": [
    "src/main.ts lifecycleはready、cancel可能なbeforeQuit、時間制限付きshutdown、second-launch配送、app path、AbortSignal、renderer向けtyped live event、そして開発・packaged両方でのdeclared window管理を提供します。",
    "設定済みのsecondary windowはruntimeで生成・破棄でき、packaged hostは同梱Nodeの予期しない終了を検出すると未確定のupdate handoffを破棄し、backend process treeを終了させたうえでWebViewを残したままにせず非ゼロ終了します。再生可能なlifecycle event、公開されたcrash-restart policy、health-check APIは未実装です。macOSでは、外部からのDock QuitやOSログアウトはtao経由のcancel可能なbeforeQuitを保証できません。",
  ],
  "native-window": [
    "trusted Node Mainから設定済みのsecondary templateを生成・破棄・再生成でき、generation単位のlifecycle eventを受け取れます。rendererは宣言済みwindowの表示・管理に限定され、runtime URLやcapability policyを指定することはできません。",
    "macOSのhud、sidebar、popover vibrancyはtransparentなwindow/WebView合成のうえでnative materialとして適用されます。Windows / LinuxはこのmacOS専用optionを無視します。",
    "parent/child関係やmodal windowはサポートされません — taoにcross-platform対応がないため、宣言したwindowはすべて独立したtop-level windowになります。",
    "borderless fullscreenのみ対応しており、exclusive/dedicated video mode fullscreenはありません。",
    "titleBarStyle: 'hidden'はmacOS専用です(transparentなtitlebar + hidden title + full-size content view)。Windows / Linuxはこのoptionを受け取っても無視します。",
    "getMonitors()が返すgeometry(position、size)はphysical pixelで、logical/CSS pixelではありません。",
    "Linuxでは、runtimeにsecondary windowを生成・破棄したのち再度生成する操作はまだ安定していません: destroy→recreateの経路はpackaged processをX11のBadWindow errorでクラッシュさせます(追跡中)。primary windowと起動時に宣言されたsecondary windowは問題なく動作し、影響を受けるのはruntimeでのrecreate経路のみです。",
  ],
  "application-menu": [
    "native application menuはmacOS、Windows、Linux(GTK、muda経由)で利用できます。差し替えはprocess-globalでprimary rendererに限定され、menu:applicationと各privileged roleのcapabilityが必要です。",
    "Linux / Windowsのmenuは、macOSのような太字のapp名submenuを持たない、plainなFile/Edit/Windowバーです。Edit項目はnative responder chainではなくfocus中のwebviewへdocument.execCommandを発行します。role capabilityが不足すると差し替え全体を拒否し、現在のmenuを維持します。",
  ],
  "context-menu": [
    "window全体およびscope付きのnative context menuはmenu:context capabilityの下でmacOS、Windows、Linux(GTK)で利用できます。privileged native roleにはさらに対応するcapabilityが必要です。",
    "Menu IPCはpayload、item数、depth、文字列長の上限で制限されます。Linuxではundo/redoのcontext menu role項目が無言で省略され(upstreamのmuda/GTKの制限)、cut/copy/paste/selectAllはX11 key eventの合成で配信されます(libxdoが必要で、XWayland抜きのWaylandでは利用できません)。",
  ],
  "native-utilities": [
    "dialog、clipboard、notification、shell helper、secure storage、window操作はsame-origin native bridgeとwindow別allowlistを通してtrusted rendererへ公開されます。",
    "対象を指定する一部commandはinlineのallow/deny scopeに対応します。それ以外のargumentはcommand単位で、native renderer APIはsrc/main.tsから直接利用できません。",
    "dialog.showMessageはnative OSのmessage boxを表示します。clipboardはPNG画像とHTMLの読み書きにも対応し、それぞれ上限付き・個別permissionです。shell.trashItemとshell.openPathはshell.showItemInFolderと同様にpathスコープで、shell.openPathはURLとUNC/device pathを拒否します。",
    "notification.showが返すidはlocal bookkeeping専用の生成idです。upstreamのnotify-rustはmacOS/Windowsでclick/actionコールバックを配信できないため、このidが後続eventと対応することはありません。",
  ],
  "secure-storage": [
    "文字列valueはmacOS Keychain、Windows Credential Manager、(Linuxでは)freedesktop.orgのSecret Service D-Bus APIへ、SHA-256から導出したappId/key namespaceの下で保存されます。存在しないkeyはnullを返し、inputとIPCは上限付きで、どのplatformにもplaintext fallbackはありません。",
    "Linuxでは稼働中のSecret Service provider(gnome-keyring、KWalletのksecretsservice、KeePassXCなど)が必要です。到達可能なproviderがない場合、plaintext fallbackではなく構造化されたerrorですべてのoperationが失敗します。",
    "get、set、deleteはそれぞれ独立したdeny-by-defaultのwindow別capabilityを持ちますが、許可はkey単位ではなくcommand単位です。rendererが侵害されると、そのapp namespace内で許可されたsecure-storage operationをすべて利用できてしまいます。",
  ],
  "auto-update": [
    "署名付きmanifest(pinned-key rotationとkeyIdヒント付き)、上限付きdownload、SHA-256によるpayload検証、manifestの鮮度・anti-replayチェック、段階的なpercentage rollout、staged handoff/relaunchはpackaged済みのmacOS、Windows(x64・arm64)、Linux AppImageアプリで実装済みです。",
    "自前でホストするendpointはhttpsが必須です(loopback httpはlocal testing限定で許可)。delta/differential updateは未実装です。Linuxのself-updateはAppImage packaging形式でのみ動作します(実行中の.AppImageファイルをその場でjournal-swapし、--appimage-extract-and-runで再起動)。.debインストールや手動展開したAppDirには差し替えるファイルがないため、check()はerrorではなく構造化されたnot-available理由(updateはsystem package managerが管理)を返します。",
  ],
  "application-packaging": [
    "macOSの.app/.dmgと、Windowsのportable .zip、NSIS .exe、WiX .msiを生成できます。",
    "Linux向けのAppDir/AppImage/deb artifact組み立ては実装済みです(murasaki bundle/installer --target linux-x64|linux-arm64)。macOS/Windows bundleと同じresource layoutから生成され、build hostにmksquashfs(squashfs-tools)が必要です。native launcherは生成されたAppImage/.debをwindow、webview、single-instance、deep link、AppImageのself-updateまでend-to-endで実行します。rpm packaging、repository metadataは未実装ですが、コード署名はGPG detached署名で利用できます(code-signing機能を参照)。MSIにはWiXが必要で、WiXはWindows上でのみ動作します。",
  ],
  "code-signing": [
    "開発者がcredentialを用意した場合、macOSのDeveloper ID署名とApple notarizationを利用できます。",
    "Windows Authenticodeは、開発者が用意したPFX/store証明書またはMicrosoft Artifact Signing providerを通じて、application実行ファイル、portable ZIP payload、NSIS setup、MSIへ署名・検証します。macOSのad-hoc署名は利用者からの信頼を確立しません。",
    "Linux: `murasaki installer --sign`は、.AppImage、.deb、そして両者を束ねたSHA256SUMSに対してdetachedかつarmored形式のGPG署名(<artifact>.sig)を生成し、dpkg-sigがPATH上にあればDebianネイティブの署名も追加で埋め込みます(opportunistic)。署名鍵は$MURASAKI_GPG_KEYまたはsign.linux.gpgKeyで選択し、passphraseは$MURASAKI_GPG_PASSPHRASEまたはgpg-agentからのみ取得します。distro repositoryのtrust storeやapt/dnf keyringとの統合はなく、rpmにも対応していません。",
  ],
  "loopback-endpoint-protection": [
    "開発時のprivileged endpointはHttpOnly SameSite runtime sessionを要求し、loopback Host、Origin、Fetch Metadataを検証します。",
    "renderer native commandにはdeny-by-defaultのwindow別allowlistと、値をscopeした一部のallow/deny ruleがありますが、multi-origin policyとすべてのcommand argumentへのscopeは未実装です。",
  ],
  "content-security-policy": [
    "Murasakiは環境別の既定CSPをframework / user-owned HTMLへ注入し、完全なsecurity.csp override、明示的opt-out、user-owned CSP tagのhead先頭への移動に対応します。",
    "policyはmeta tag配信のためframe-ancestors、sandbox、reportingなどheader専用directiveを強制できません。CSPはHTMLのsanitizeやNode関数の認可を行わず、互換性のためinline styleを許可します。",
  ],
  "multi-window": [
    "windowはconfigでの宣言が必須です。secondary templateは起動時生成をopt outでき、trusted Node Mainから生成・破棄・再生成できます。任意のruntime URL、native policy、未宣言のlabelは拒否されます。",
    "secondaryのOS/self closeは再openできるようhideし、Node Mainからのdestroyはnative resourceを解放し、再生成時にgenerationをincrementします。application menuはprocess-globalでprimary所有のままです。",
    "各native windowは独立したbrowser profileを持つため、Service Worker、SharedWorker、cookie、storageが他windowのbackend authorityを引き継ぐことはありません。secondary profileはWindows/LinuxおよびmacOS 14+では永続化され、macOS 11-13では別の非永続WebKit storeを使用します。",
    "Linuxは未対応です: secondary windowをruntimeで破棄してから再生成する操作はpackaged processをX11のBadWindow errorでクラッシュさせます。起動時に宣言されたsecondary windowは動作しますが、multi-windowが前提とするruntimeでのrecreate lifecycleは動作しません(既知のissueとして追跡中)。",
  ],
  "tray-and-global-shortcuts": [
    "macOS status item / Windows system-tray iconはprocess-wideで1つ、tooltip、click event、native nested menu、menu-item event、動的なicon/menu差し替えを備えます。最後に成功したcreateが以前のownerを置き換えます。",
    "Linux trayはlibappindicatorを使用し、AppIndicator host(GNOMEではAppIndicator/KStatusNotifierItem Shell拡張)が必要です。tray-menuのclickと動的なicon/menu差し替えはmacOS/Windowsと同様に動作しますが、tray iconのclick/double-click eventは発火しません — AppIndicatorには「attachされたmenuを表示する」以外のsignalがないためです。",
    "macOSとWindowsのglobal shortcutは、修飾キー+既知キーの組み合わせ(上限付き)、明示的なid、owner向けのpress event、同一process内のconflict検知、register/unregister capabilityによる自動owner/shutdown cleanupに対応します。",
    "Linuxのglobal shortcutは同じaccelerator/idモデルをX11経由で使用し、X11またはXWaylandが必要です。純粋なWaylandセッション(DISPLAYなし)は登録せず構造化されたunsupported errorを返します。Linuxにはdesktop環境依存のため、macOS/Windowsのようなos-reserved-shortcut一覧がありません。",
    "shortcutの利用可否はOS予約bindingや他のapplicationにも依存するため、packaged OSでのsmoke testingが必要です。",
  ],
  "system-permissions": [
    "packaged済みのmacOS appはcamera/microphone/locationのusage descriptionを宣言し、起動時にcamera、microphone、screen-recording、accessibility、input-monitoring、locationのconsentを要求できます。同じpermissionはcapability-gatedなrenderer APIからquery/requestできます。対応するのはこの7種類で、すべてmacOS専用です — WindowsとLinuxには、これらが表すapp-scopedなTCC promptに相当するOSレベルの機能がありません。",
    "fullDiskAccessはguidance-onlyです。macOSにはこれに対応するTCC request APIが存在しないため、`request()`はSystem SettingsのFull Disk Accessペインを開くだけで(権限取得を装うことはありません)、`status()`はTCCで保護されたfileを読み取るdocument済みのbest-effort heuristicであり、実際の答えの代わりに`unknown`を返すことがあります。",
    "locationの`mode: 'always'`はInfo.plistへ`NSLocationWhenInUseUsageDescription`と`NSLocationAlwaysAndWhenInUseUsageDescription`の両方を書き込み、request時にも同じInfo.plist keyを読み戻すため、追加の配線なしでrequestOnLaunchとruntimeの`systemPermission.request('location')`呼び出しの両方に同一に適用されます。",
    "Windowsのunpackaged desktopではprivacy consentがapp単位のlaunch promptではなくusage駆動のため、これらの汎用callはunsupportedを返します。Linuxは未実装です。開発時のrequestはterminal/Node hostのidentityを使うため、packaged appでの検証が必要です。",
  ],
  "single-instance-and-deep-links": [
    "packaged macOS appとinstall済みのWindows appは、宣言したURL schemeとfile associationを登録し、per-userのsingle-instance lockを維持したまま、正規化したstartup、second-instance、system open requestをsrc/main.tsへ届けます。",
    "Windowsのportable .zipとbare executable配布はprotocolやfile associationを自動登録しません — 登録はNSISとMSI installerが担います。Linuxも同じper-userのsingle-instance lockを維持し、cold-startのargv(.desktopのExec行が展開する%U/%F)とsecond-instanceのactivationを既存のloopback channel経由で届けます。protocol/file associationのMimeTypeエントリは.desktopファイルで宣言されます(.debがusr/share/applications配下へinstallし、update-desktop-databaseが反映)が、手動展開したAppImage/AppDirにはWindowsのNSIS/MSIのようなOSレベルの登録手順を検証する仕組みはありません。",
  ],
  "capability-permissions": [
    "renderer native commandはdeny-by-defaultで、runtimeで検証されるwindow別capability allowlistを通じて許可されます。Rustがsender originとcommand名を検証します。",
    "URL、path、対象window、OS permissionのscopeは明示的なallow/deny ruleに対応します。それ以外のargumentはcommand単位のままで、secondary windowは意図的にtop-level grantを継承せず、privileged menu roleには対応するcapabilityが必要です。",
  ],
  "diagnostics-and-logging": [
    "Node Mainは構造化されたJSONL logging、上限付きrotation、secretらしいfieldのredaction、shutdown時のflushing、application/runtime metadataとlog tailを含むopt-inの上限付きdiagnostic reportを提供します。",
    "Murasakiはversion付きのlocal crash reportを3つのdomainにわたって取得します: Node側のuncaughtException/unhandledRejection、native launcherのpanicと予期しない終了metadata、そして(production buildのみ)未捕捉のrenderer errorとunhandled rejectionです。いずれもlog fieldと同じ方法で上限付き・redact済みで、MainContext.diagnosticsから読み取れます。",
    "crash reportはlocalのJSONファイルのみで、Murasakiが送信することはありません。minidump/native symbolicationの対応、自動uploadはなく、murasaki dev下でのrenderer captureはno-opです(その代わりdevのerror overlayがUXを担います)。crash-reporting serviceへの連携はapplication側の責務です。",
  ],
  "webview-session-network": [
    "application全体のcustom User-Agent、non-persistent/incognito session、上限付きの未認証HTTP CONNECTまたはSOCKSv5 proxy endpointは、runtimeで検証されたうえで開発・packaged済みmacOS/Windows WebViewのWryへ渡されます。",
    "Browser profileはnative window単位で分離されます。primaryは従来からのapp profileを保持し、secondary profileはWindows/LinuxおよびmacOS 14+では永続化されます。macOS 11-13は分離された非永続storeを使用します。window間でのcookie/storage/workerの共有は意図的に未対応で、永続的なstateはMain/APIハンドラを通じて共有してください。",
    "macOSのproxy設定にはmacOS 14以降が必要で、それより古いOSではstartupが失敗します。Windowsのcustom User-AgentにはWebView2 86.0.616.0以降、private modeには101.0.1210.39以降が必要で、古いruntimeはこれらの設定を無視します。window単位のoverrideとauthenticatedなproxyには対応していません。",
    "webview:downloadは、sanitizeされ衝突解決済みのdownloadを設定済み(またはOS既定)のdirectoryへ限定し、start/completion eventを報告します。completion eventのidをstart eventと確実に対応付ける手段はなく、macOSは完了したdownloadのpathを報告しません(upstream WebKitの制限)。",
    "webview:dragDropはfile drag-and-drop event(dragoverは20/秒にthrottle)を、OS既定の動作を妨げることなく報告します。file inputはgrantの有無に関わらず動作します。webview.initScriptsはtrustedでconfig所有のJavaScriptをpage load前に注入し、capabilityでは制御されません。",
    "webview:zoomはpage zoomを0.25〜5.0に制限し、macOS 11+/iOS 14+でのみ利用できます。webview.hotkeysZoom(capabilityではなくconfig)はWindowsでのみOS zoom hotkey/gestureを有効にします。webview:printはplatformのprint dialogを開きます。Wryがfind-in-page APIを公開していないため、この機能はありません。",
    "webview:readCookies/webview:writeCookiesは上限付きのcookie読み取り・設定・削除を公開し、構造化されたURL scopeに対応します。scope付きの読み取りには明示的なURLが必要で、書き込みは有効なcookie pathと照合され、domain overrideはURLホストと完全に一致する必要があります。予約済みのlegacy名murasaki_runtimeは、runtime認証がすでにcookieに依存していなくても防御的措置として読み取りから除外され、書き込み・削除からは拒否されます。deleteCookieはname、URLホストをdomainとして、default(/)pathのみで一致判定します。",
    "rendererのcamera、microphone、geolocation Web APIは、framework所有のPermissions-Policy headerによってfail closedになります。Wry 0.55にはcross-platformなwindow単位のpermission callbackがないため、これらのAPIをconfigから有効化することはまだできません。capability-checkされたnative機能を代わりに使用してください。",
    "Linuxでは、webview.deleteCookie()はresolveしますが、その削除が後続のwebview.readCookies()に確実に反映されるとは限りません(WebKitGTK/libsoupのcookie manager特有の挙動)。cookieのset/readとcustom User-Agentは問題なく動作します。packaged Linuxで検証済みです。",
  ],
  "build-time-plugin-sdk": [
    "trustedなbuild-time pluginは、Vite PluginOptions、決定的なbundle dependency/resource、runtimeで検証されたstable nameを持つ直列のdev/build/bundle lifecycle hookを提供できます。",
    "native Rust ABI、dynamic library loader、renderer/runtime plugin sandbox、permission boundaryではありません。plugin codeはmurasaki.config.tsと同じNode.js権限を持ちます。",
  ],
  "linux-distribution": [
    "AppDir/AppImage/debのartifact組み立て(application-packaging capability参照)とnative launcher runtimeは、いずれもend-to-endで動作します: window/webview生成、single-instance lock、cold-startのdeep link(.desktopのExec行由来のargv)とsecond-instanceの転送、graceful shutdown、native crash reportingが、packaged済みのAppImageまたは.debから実行され、Docker上のXvfb + 専用D-Bus sessionおよびapp-package-linux.ymlで検証されています。",
    "AppImageのself-updateは動作します(実行中の.AppImageをjournal付きで単一ファイル差し替えし、--appimage-extract-and-runで再起動、health checkに失敗した場合はfirst launchでrollback)。.debインストールや素の/手動展開したAppDirには差し替える単一ファイルがなくself-updateは提供されず、updateはsystem package managerが管理すると報告します。rpm packaging、repository metadataは未実装ですが、コード署名はGPG detached署名で利用できます(code-signing機能を参照)。",
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
