# Changelog

Murasaki は 1.0 に達するまで semantic versioning に従います。minor release には
破壊的変更が記載される場合があります。production application を更新する前に、
対応する migration guide を確認してください。

## 0.55.6 — 安定性の宣言 (2026-07-20)

capability manifest にある 26 個の機能すべてが `status: stable` になりました
— これは単なる label 変更ではなく、引用された test evidence に裏付けられた、
現行 release 系列に対する互換性の約束です。OS レベルの gap が実際に存在する
場合、platform label は正直な表示のままです。

### 追加

- **設定可能な About panel。** `about` config を指定すると、macOS、Windows、
  Linux で、custom な本文段落、label/value の詳細行(Build、Commit など)、
  external link button、サイズ調整を備えた native About panel を有効にでき
  ます。省略した場合、各 platform はコンパクトな標準 About dialog のままです。
- **response header として配信される CSP。** 解決済みの Content Security
  Policy は、meta tag に加えて、単一の resolver から生成される HTTP
  `Content-Security-Policy` response header(development の middleware と
  packaged な production server の両方)としても配信されるようになりました。
  これにより、新しい既定値である `frame-ancestors 'none'` のような header
  専用の directive が実際に強制されます。`index.html` 内の user-owned な CSP
  meta tag は引き続き優先されます。その場合 Murasaki は header を送信せず
  完全に tag に委ね、development では live file をリクエストごとに再チェック
  します。

### 修正

- **Linux の cookie 削除。** WebKitGTK では `webview.deleteCookie()` が
  resolve されても cookie が実際には削除されませんでした。WebKit は削除対象の
  cookie を value を含む完全一致で照合しますが、呼び出し側はその value を
  持っていません。vendored な wry patch により、macOS や Windows と同様に、
  保存済みの cookie を name、domain、path で検索するようになり、削除結果が
  次回の read に反映されるようになりました(`@murasakijs/native` 0.43.2、
  packaged された AppImage で検証済み)。
- Orglia の sample form の styling を改善しました。

### 補足

- `webview-session-network` は Linux で `supported` になりました。残っている
  正直な platform gap は次のとおりです。system permission は Linux で
  `unsupported`、Windows で `partial` のままです(macOS の TCC prompt に相当
  する OS 機能がないため)。また Linux の tray には引き続き AppIndicator host
  が必要で、global shortcut には X11/XWayland が必要です。

## 0.55.5 — Linux 機能パリティ (2026-07-20)

OS レベルの gap によって阻まれていないすべての機能について、Linux は macOS
や Windows と同等の立ち位置になりました。26 個中 16 個の capability が Linux
で `supported` になり(従来の 2 個から増加)、それぞれ packaged された
AppImage で end to end 検証済みです。

### 追加

- **Linux 機能パリティ。** file routing、navigation middleware、route
  metadata、server action、API route、Node Main lifecycle、content security
  policy、capability permission、diagnostics/crash report、build-time plugin
  SDK、native window、declarative multi-window が Linux で `supported` に
  なりました。CI 上の Xvfb で動作する packaged AppImage の feature probe に
  よって証明されています。
- **Linux code signing。** `murasaki installer --sign` は `.AppImage`、
  `.deb`、および統合された `SHA256SUMS` に対して detached かつ armored な
  GPG 署名を生成します(可能であれば `dpkg-sig` 経由で Debian-native な署名
  も埋め込みます)。key は `$MURASAKI_GPG_KEY` または `sign.linux.gpgKey` で
  選択し、passphrase は `$MURASAKI_GPG_PASSPHRASE` または gpg-agent からのみ
  取得します。
- `murasaki demo` に、Papelle、Oscilla、Orglia の sample preview を
  one-command で起動する機能が追加されました。

### 修正

- **macOS の About panel の icon 描画。** 標準の About panel は、生の
  source PNG を受け取る代わりに LaunchServices が解決した application icon
  を継承するようになりました。そのため mask、corner radius、shadow、見た目が
  Finder や Dock に表示される icon と一致します。
- **Linux での multi-window 再生成 crash。** runtime に secondary window を
  破棄して再生成すると、packaged された process が X11 の `BadWindow` error
  で abort していました。積み重なった 2 つの原因を修正しています。window
  ごとの `WebContext` を破棄時に解放し、再生成時には新しいものを構築する
  ようにしたこと、そして vendored な 1 行の wry patch
  (`crates/native/vendor/wry`)により、non-child embedding path で
  `Drop for X11Data` が親 window の X resource を破棄してしまうのを止めた
  ことです。
- Windows で、初回起動時の bind において OS に除外された(`EACCES`)
  deterministic な origin port を、起動失敗にせずに retry するようになりま
  した。

### 補足

- OS 側の gap が実際に存在する箇所では、Linux は `partial` のままです。
  secure storage には Secret Service provider が必要、`.deb` の update は
  package manager が所有、rpm や distribution repository の trust 統合は
  ない、tray には AppIndicator host が必要で global shortcut には
  X11/XWayland が必要、`webview.deleteCookie()` は WebKitGTK では確実には
  反映されません。system permission は Linux で `unsupported` のままです
  — macOS の TCC prompt に相当する OS レベルの機能がないためです。
- どの platform でも `planned` のままの機能はもうありません。

## 0.55.4 — 依存ゼロの scaffolder (2026-07-20)

- scaffolder の runtime dependency tree を削除し、Node 組み込みの prompt と
  spinner の primitive を使うようにしました。これにより CLI が起動する前に
  package-store の link failure が発生することを防ぎます。
- unattended な `--yes --skip-install` path が、依存を install せずに
  packed tarball から直接実行できることを保証します。

## 0.55.3 — 再利用可能な依存検証 (2026-07-20)

- release gate が、published git commit が ancestor であり、かつ package
  directory が現行 release まで変更されていない場合に限り、既に publish
  済みの workspace package を再利用できるようにしました。
- tag によって publish される package については、integrity、provenance、
  current-commit の厳格な check を維持します。

## 0.55.2 — 信頼できる新規 scaffold (2026-07-20)

- 既定の Biome 設定が、install済みの schema と現行の recommended-rule
  preset を使うようにしました。
- scaffold される Biome CLI を pin し、新規生成された app が時間が経っても
  lint-clean な状態を保つようにしました。
- CI で、新規に packed された scaffold に対して lint、type-check、
  production build による検証を行います。

## 0.55.1 — リリース検証の強化 (2026-07-20)

- npm payload の inspection が pnpm workspace root から動作するようにしま
  した。
- 依存順に行う publish の間で、npm registry への伝播を待つようにしました。
- 最終的な integrity、git-head、SLSA provenance の検証が Node.js 24 上で
  正しく実行されるようにしました。

## 0.55.0 — production 候補の基盤 (2026-07-20)

### 追加

- typed な `'use main'` call、lifecycle hook、sidecar supervision、crash
  report、declarative な multi-window control を備えた、長期稼働する
  Node Main runtime。
- app ごとに安定した browser origin と、window ごとに分離された browser
  profile。
- default-deny な capability policy の下にある、native tray、global
  shortcut、autostart、secure storage、notification、dialog、clipboard、
  file/system shell、WebView、permission、updater の各 API。
- macOS arm64/x64、Windows arm64/x64、Linux arm64/x64 の packaging path。
  文書化された host tool が利用可能な場合の DMG、NSIS、MSI、AppImage、deb
  の生成を含みます。
- key rotation、staged rollout、永続的な replay protection、rollback
  journal、health acknowledgement を備えた署名済み update manifest。
- `MURASAKI_PUBLIC_*` renderer environment variable、`llms.txt` endpoint、
  read-only な MCP documentation server、拡張された UI component library。
- 3 つの独立した application example: Papelle、Oscilla、Orglia。

### セキュリティ

- renderer/native と renderer/backend の authority は分離されており、
  既定ですべて deny です。packaged された window credential は origin、
  label、generation に bind されており、native window の lifecycle に
  合わせて失効します。
- production と development の response は、`Permissions-Policy` を通じて
  既定で camera、microphone、geolocation の Web API を deny します。
- bundle された Node の download は、archive の checksum を信頼する前に
  Node の OpenPGP 署名付き checksum document を検証します。
- updater manifest は既定で `generatedAt` を要求し、restart をまたいだ
  replay や、より低い version の authenticated manifest を拒否します。
- app が所有する executable resource は、platform の inner-to-outer な
  signing pass に組み込まれます。

### 0.54 からの破壊的変更

- renderer から見える environment value には `MURASAKI_PUBLIC_*` を使って
  ください。private な値は Node/config にのみ留まります。追加の prefix を
  使うには明示的な `build.envPrefix` の entry が必要です。
- `generatedAt` を持たない update manifest は、一時的な
  `allowLegacyManifestsWithoutGeneratedAt` migration flag を有効にしない
  限り拒否されます。
- executable な bundle resource には `{ from, to, executable: true }` を
  使う必要があります。宣言されていない Mach-O、PE、ELF、shebang resource
  は packaging に失敗します。
- 永続化された application-origin port が使用中の場合、暗黙に fallback
  しなくなりました。代わりに startup が失敗し、既存の Web Storage と
  IndexedDB の identity を保持します。
- bundle された Node helper が有効な sandbox architecture を持つまで、
  macOS App Sandbox の設定は拒否されます。Hardened Runtime signing は
  引き続き対応しています。
- Node.js 22.12.0 が対応する development runtime の最小 version です。

移行手順の全体: [English](https://murasaki.ichi10.com/docs/building/migration-0.55) ·
[日本語](https://murasaki.ichi10.com/ja/docs/building/migration-0.55)

## 0.54.0 — 初の一般公開リリース (2026-07-18)

この framework の最初の npm release です。React 19 + Vite 上での file
routing、Server Actions、API route、typed な `'use main'` call。
default-deny な capability policy の下にある native window、menu、tray、
global shortcut、dialog、clipboard、notification、WebView の各 API。macOS
の system-permission(TCC)request と Windows の elevation。Ed25519 署名に
よる automatic update を備えた `.dmg`、NSIS、MSI packaging。そして Papelle、
Oscilla、Orglia の sample application です。
