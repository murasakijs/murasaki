# Murasaki Product Hunt ローンチ準備 作業手順書

## 目的

MurasakiをProduct Huntへ公開できる品質まで仕上げる。ローカル実装だけでなく、セキュリティ、公開パッケージ、Docs、GitHub Release、デモ、Product Hunt素材まで完成させる。

## 作業場所

```bash
cd /Users/ichi/Documents/dev/murasaki-oss/murasaki
```

## 重要な注意事項

- 既存の変更を削除・巻き戻ししない。
- `git reset --hard`や無関係な`git checkout --`は禁止。
- ユーザーが作成したuntrackedファイルを勝手に削除しない。
- 巨大な生成物、秘密鍵、ローカル専用バイナリをGitへ直接コミットしない。
- `git add .`を避け、意図したファイルだけを個別にstageする。
- npm公開前に`npm pack --dry-run`で内容を確認する。
- Product Huntへの実投稿は、全チェック完了後に行う。

## 監査時点の状態

- 作業ブランチ：`feat/win-linux-packaging`
- 監査時点のHEAD：`6c5f870`
- リモートfeature branchより約10コミット先
- `origin/main`には未反映
- npm最新版：
  - `murasaki@0.46.1`
  - `create-murasaki@0.46.1`
  - `@murasakijs/native@0.31.0`
- GitHub Release：0件
- 公開DocsのAuto Updateページ：404
- `pnpm audit`：High 1件、Moderate 4件
- updater sampleはuntracked
- Windows launcherのローカルバイナリもuntracked
- READMEに古いバージョンとRoadmapが残っている

作業開始時に状態が変わっている可能性があるため、必ず再確認すること。

---

## 1. 作業開始前の状態確認

```bash
git status --short
git branch -vv
git log --oneline --decorate -20
git diff --stat origin/main...HEAD
git ls-files --others --exclude-standard
```

ファイルを以下に分類する。

- 正式にコミットすべきソース
- ビルド生成物
- テスト用一時ファイル
- ソーシャル素材
- ローカル専用バイナリ
- ユーザーが別用途で保持しているファイル

勝手に削除せず、不要な生成物は適切な`.gitignore`で管理する。

---

## 2. ViteのHigh脆弱性を解消する

### 現在の問題

`vite@5.4.21`が解決されており、Windows上の`server.fs.deny` bypassに関するHigh advisoryが残っている。修正版はVite `>=6.4.3`。

### 対象

```text
packages/murasaki/package.json
packages/create-murasaki/templates/default/package.json
examples/updater-ui/package.json
pnpm-lock.yaml
```

Murasaki本体、scaffold、exampleのViteを互換性のある安全なバージョンへ更新する。`@vitejs/plugin-react`と`vite-plugin-svgr`も対応版へ揃える。

更新後に実行する。

```bash
pnpm install
pnpm audit --audit-level high
pnpm build
pnpm --filter murasaki-docs types:check
pnpm --filter murasaki-docs lint
pnpm --dir examples/updater-ui typecheck
pnpm --dir examples/updater-ui build
```

### 完了条件

- `pnpm audit --audit-level high`でHighが0件
- package build成功
- Docs型検査成功
- updater exampleのtypecheck/build成功
- scaffoldのproduction build成功

---

## 3. READMEとDocsを実装状態へ合わせる

### 主な対象

```text
README.md
README.ja.md
apps/docs/content/docs/guides/auto-update.mdx
apps/docs/content/docs/guides/auto-update.ja.mdx
apps/docs/content/docs/building/cli.mdx
apps/docs/content/docs/building/cli.ja.mdx
apps/docs/content/docs/building/configuration.mdx
apps/docs/content/docs/building/configuration.ja.mdx
```

### 必須修正

- READMEの`currently 0.34.5`を削除または今回の公開版へ更新する。
- RoadmapでAuto Updateを未完成扱いにしない。
- `UpdateButton`のimport元を実装と一致させる。
- macOS、Windows、Linuxについて「dev対応」「bundle対応」「installer対応」「updater対応」を分けて記載する。
- Windows arm64 updater、Linux packaging、Windows Authenticodeの制限を明記する。
- macOSの署名・notarization要件を明記する。
- manifest署名、SHA-256検証、mandatory updateの扱いを正確に記載する。
- 英語版と日本語版を一致させる。

確認する。

```bash
rg -n "0\.34\.5|auto-update.*roadmap|not implemented|coming soon" \
  README.md README.ja.md apps/docs/content/docs

pnpm --filter murasaki-docs types:check
pnpm --filter murasaki-docs lint
```

### 完了条件

- READMEと実装状態に矛盾がない
- 英語版と日本語版が一致
- 対応OSと既知の制限が明記されている
- Docs型検査成功

---

## 4. updater sampleを正式なexampleとして整理する

対象：

```text
examples/updater-ui/
```

次をコミット対象から除外する。

- `node_modules/`
- `dist/`
- `.dmg`、`.exe`、`.msi`、`.zip`
- 一時manifestとログ
- 秘密鍵
- ローカルで生成したバイナリ

公開鍵は用途が明確な場合のみコミット可能。秘密鍵は絶対にコミットしない。

```bash
find examples/updater-ui -maxdepth 4 -type f | sort
git check-ignore -v examples/updater-ui/dist
git status --short examples/updater-ui
```

exampleのREADMEに以下を書く。

- exampleの目的
- 起動方法
- updater UIの確認方法
- テスト用manifestの作り方
- 署名鍵の扱い
- production設定
- 対応OSと制限

検証する。

```bash
pnpm install
pnpm --dir examples/updater-ui typecheck
pnpm --dir examples/updater-ui build
pnpm --dir examples/updater-ui bundle
pnpm --dir examples/updater-ui installer
```

### 完了条件

- ソースだけがGit管理対象
- 巨大な生成物と秘密鍵が混入していない
- READMEだけで起動・検証可能
- typecheck/build成功

---

## 5. native packageを新バージョンにする

Native updater、launcher、Windows終了処理が変更されているため、既存の`@murasakijs/native@0.31.0`とは別の新バージョンを公開する。

以下のローカルバイナリは直接コミットしない。

```text
crates/native/murasaki-launcher.win32-x64-msvc.exe
```

native release workflowで全プラットフォーム向けに生成し、npm packageへ収録する。

公開済み最新版を確認する。

```bash
npm view @murasakijs/native version
npm view murasaki version
npm view create-murasaki version
```

推奨バージョン例：

```text
@murasakijs/native: 0.31.0 → 0.32.0
murasaki: 0.46.1 → 0.47.0
create-murasaki: 0.46.1 → 0.47.0
```

対象：

```text
crates/native/package.json
crates/native/Cargo.toml
crates/native/Cargo.lock
packages/murasaki/package.json
packages/create-murasaki/package.json
packages/create-murasaki/templates/default/package.json
pnpm-lock.yaml
```

Cargo packageとnpm native packageのバージョンも整理する。

```bash
cargo fmt --manifest-path crates/native/Cargo.toml -- --check
cargo check --manifest-path crates/native/Cargo.toml --all-targets
cargo test --manifest-path crates/native/Cargo.toml
pnpm --dir crates/native build
```

`cargo test`が0件なら、次の純粋処理にunit testを追加できないか検討する。

- manifest validation
- SHA-256 verification
- updater argument parsing
- target selection
- version comparison
- path validation

package内容を確認する。

```bash
cd crates/native
npm pack --dry-run --json
cd ../..
```

### 完了条件

- native packageを新バージョンへ更新
- Cargo側のバージョンも整理
- Rust check/test成功
- native build成功
- packageに必要なbindingとlauncherのみが入る

---

## 6. コミットを整理する

```bash
git status --short
git diff --stat
git diff --check
```

必要なら以下の単位でコミットする。

```text
fix(deps): upgrade Vite past known security advisories
docs: align updater status and platform support
test(updater): add the updater showcase app
chore(release): prepare native and framework versions
```

ステージ前後に確認する。

```bash
git diff --cached --stat
git diff --cached --check
```

意図したファイルだけをstageする。

```bash
git add <具体的なファイル>
git commit -m "<内容に合ったメッセージ>"
```

---

## 7. feature branchをpushしてCIを通す

```bash
git push origin feat/win-linux-packaging
```

```bash
gh run list \
  --repo murasakijs/murasaki \
  --branch feat/win-linux-packaging \
  --limit 20
```

```bash
gh run watch <RUN_ID> \
  --repo murasakijs/murasaki \
  --exit-status
```

失敗時：

```bash
gh run view <RUN_ID> \
  --repo murasakijs/murasaki \
  --log-failed
```

必須確認項目：

- Windows x64 bundle
- Windows arm64 bundle
- NSIS installer
- MSI installer
- portable zip
- launcher smoke test
- silent install
- updater E2E
- artifact upload

### 完了条件

- feature branchがリモートと同期
- x64/arm64成功
- updater E2E成功
- installer artifact生成成功
- 失敗ジョブなし

---

## 8. mainへ統合する

```bash
git fetch origin
git log --oneline --decorate origin/main..HEAD
git diff --stat origin/main...HEAD
```

既存の運用に従いPull Requestを作成する。

```bash
gh pr create \
  --repo murasakijs/murasaki \
  --base main \
  --head feat/win-linux-packaging \
  --title "feat: ship Windows packaging and automatic updates" \
  --body-file <PR本文ファイル>
```

レビューとCI確認後にmergeする。merge後：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
```

### 完了条件

- 実装が`origin/main`へ反映済み
- mainのCI成功
- feature branchだけに重要コードが残っていない

---

## 9. native packageを先に公開する

Murasaki本体より先にnativeを公開する。

タグ例：

```bash
git tag native-v0.32.0
git push origin native-v0.32.0
```

```bash
gh run list \
  --repo murasakijs/murasaki \
  --workflow native-release.yml \
  --limit 10
```

```bash
gh run watch <RUN_ID> \
  --repo murasakijs/murasaki \
  --exit-status
```

公開確認：

```bash
npm view @murasakijs/native@0.32.0 version
npm view @murasakijs/native@0.32.0 dist
npm pack @murasakijs/native@0.32.0 --dry-run
```

### 完了条件

- native workflow成功
- npmで新バージョン取得可能
- 全対象binding/launcherを収録
- provenance付きで公開

---

## 10. Murasakiとcreate-murasakiを公開する

native公開後に最終検証する。

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level high
pnpm build
pnpm --filter murasaki-docs types:check
pnpm --dir examples/updater-ui typecheck
pnpm --dir examples/updater-ui build
```

package内容：

```bash
cd packages/murasaki
npm pack --dry-run --json
cd ../create-murasaki
npm pack --dry-run --json
cd ../..
```

タグ例：

```bash
git tag v0.47.0
git push origin v0.47.0
```

```bash
gh run list \
  --repo murasakijs/murasaki \
  --workflow release.yml \
  --limit 10
```

```bash
gh run watch <RUN_ID> \
  --repo murasakijs/murasaki \
  --exit-status
```

公開確認：

```bash
npm view murasaki version
npm view create-murasaki version
npm view murasaki dependencies --json
```

### 完了条件

- `murasaki`新バージョン公開済み
- `create-murasaki`新バージョン公開済み
- 新native packageを参照
- provenanceあり

---

## 11. 公開版scaffoldをゼロから検証する

workspace symlinkを使わず、npm公開版だけで試す。

```bash
rm -rf /tmp/murasaki-public-smoke
mkdir -p /tmp/murasaki-public-smoke
cd /tmp/murasaki-public-smoke

npm create murasaki@latest demo
cd demo

npm run typecheck
npm run build
npm run bundle
npm run installer
```

確認項目：

- CLIが新バージョン
- native window起動
- routing
- native menu
- Server Actions
- API Routes
- production build
- bundle
- installer
- updaterの検出、検証、適用、再起動

### 完了条件

- 公開npmだけで成功
- インストール後のアプリが起動
- updaterが実際に新バージョンを適用可能

---

## 12. Docsを本番デプロイする

```bash
curl -I https://murasaki.ichi10.com/
curl -I https://murasaki.ichi10.com/en/docs
curl -I https://murasaki.ichi10.com/en/docs/guides/auto-update
curl -I https://murasaki.ichi10.com/sitemap.xml
curl -I https://murasaki.ichi10.com/robots.txt
curl -I https://murasaki.ichi10.com/opengraph-image
```

```bash
curl -LsS https://murasaki.ichi10.com/sitemap.xml | rg "auto-update"
```

### 完了条件

- Home、Docs、Auto Update Docs、sitemap、robots、OGPが200
- sitemapにAuto Updateページを収録
- 英語metadataが正しい
- GitHub、npm、Docsリンクが正しい

---

## 13. 公式Showcaseアプリを完成させる

`examples/updater-ui`をテスト画面のまま公開せず、PH訪問者向けShowcaseとして整える。必要なら`examples/showcase`へ分離する。

最低限デモする機能：

- Native window
- Native app menu
- Native context menu
- File-based routing
- React 19
- Server Actions
- API Routes
- Native dialogs
- Clipboard
- Notifications
- Auto Update UI
- Light/Dark mode
- About panel
- Installer/uninstaller

### 完了条件

- 初見でも各機能を試せる
- 壊れた操作がない
- Murasakiのデザイン言語と一致
- macOS/Windowsで見栄えが崩れない
- 画面収録に使える完成度

---

## 14. GitHub Releaseを作成する

添付する成果物：

- macOS `.dmg`
- macOS updater用`.app.zip`
- Windows x64 `-setup.exe`
- Windows x64 `.msi`
- Windows portable `.zip`
- update manifest
- signature
- SHA-256一覧

Release Notesには概要、Quick Start、Auto Update、Windows packaging、対応OS、制限事項、未署名バイナリの注意、Docs/npmリンクを書く。

```bash
gh release create v0.47.0 \
  --repo murasakijs/murasaki \
  --title "Murasaki v0.47.0" \
  --notes-file RELEASE_NOTES.md \
  <artifact paths>
```

```bash
gh release view v0.47.0 --repo murasakijs/murasaki
```

### 完了条件

- GitHub Releaseが存在
- macOS/Windows成果物をダウンロード可能
- Release Notesが英語
- 対応OSと制限事項を明記
- ダウンロードしたartifactが実際に起動

---

## 15. Product Hunt Gallery画像を作る

5〜6枚を推奨する。

1. Hero
   - `Murasaki`
   - `Next.js DX for native desktop apps`
   - `React 19 · Vite · OS WebView · No Chromium · No Rust required`
2. Development Experience
   - File-based routing
   - Server Actions
   - API Routes
   - React Fast Refresh
3. Native Experience
   - Native windows、menus、dialogs、context menus、notifications
4. Framework Comparison
   - Murasaki / Electron / Tauri
   - 検証可能な項目だけを比較
5. Ship It
   - macOS `.app/.dmg`
   - Windows `.zip/.exe/.msi`
   - Signed update manifests
   - Automatic updates
6. Quick Start
   - `npm create murasaki@latest my-app`

### 完了条件

- 英語で4〜6枚
- 縮小表示でも読める
- 実際のアプリ画面を使用
- favicon、OGP、サイトと同じデザイン言語
- 未実装機能を記載しない

---

## 16. 30〜60秒のデモ動画を作る

推奨シーケンス：

```text
0–4秒   Murasaki logo / tagline
4–10秒  npm create murasaki
10–18秒 Vite HMR / React Fast Refresh
18–27秒 file-based routing
27–35秒 native menu / context menu / dialog
35–42秒 Server Action
42–49秒 installer
49–56秒 UpdateButton → Restart to update
56–60秒 Docs / GitHub CTA
```

条件：

- 英語字幕
- 音声なしでも理解可能
- 実アプリを収録
- 横長
- 最初の3秒で価値が伝わる

---

## 17. Product Hunt投稿原稿を作る

### Product name

```text
Murasaki
```

### Tagline候補

```text
Next.js DX for native desktop apps
```

### Short description候補

```text
Build native desktop apps with React 19, Vite, file-based routing,
Server Actions, and native OS integrations—without bundling Chromium
or writing Rust.
```

### Maker commentに含める内容

- なぜ作ったか
- Electron/Tauriとの違い
- Nodeをbundleする設計理由
- Next.js開発者の学習コストを減らす思想
- 自作Rust bindingをTypeScriptから利用できること
- 対応OS
- pre-1.0であること
- 欲しいフィードバック

直接upvoteを依頼しない。

### FAQ

- Is this Electron?
- How is it different from Tauri?
- Do I need to write Rust?
- Does it bundle Chromium?
- Why does it bundle Node?
- Which platforms are supported?
- Can I ship signed apps?
- Does auto-update work?
- Is Linux supported?
- Is it production-ready?
- What is the installer size?

---

## 18. Product Hunt公開前の最終監査

```bash
git status --short
git log --oneline --decorate -10

npm view murasaki version
npm view create-murasaki version
npm view @murasakijs/native version

gh release list --repo murasakijs/murasaki

curl -I https://murasaki.ichi10.com/
curl -I https://murasaki.ichi10.com/en/docs
curl -I https://murasaki.ichi10.com/en/docs/guides/auto-update
curl -I https://murasaki.ichi10.com/sitemap.xml
```

最終チェック：

- [ ] High脆弱性0件
- [ ] READMEのバージョンが正しい
- [ ] Roadmapが実装状態と一致
- [ ] updater sampleが正式にコミット済み
- [ ] 巨大な生成物と秘密鍵がGitに混入していない
- [ ] native package公開済み
- [ ] murasaki package公開済み
- [ ] create-murasaki公開済み
- [ ] 公開版scaffold成功
- [ ] macOSアプリ起動成功
- [ ] Windowsアプリ起動成功
- [ ] Windows updater E2E成功
- [ ] Auto Update Docsが200
- [ ] GitHub Release公開済み
- [ ] `.dmg`をダウンロード可能
- [ ] `.exe`/`.msi`をダウンロード可能
- [ ] Gallery画像完成
- [ ] デモ動画完成
- [ ] PH本文完成
- [ ] Maker comment完成
- [ ] FAQ完成
- [ ] 対応OSと制限事項を明記
- [ ] 全リンクをログアウト状態またはシークレットウィンドウで確認

---

## 19. 完了報告の形式

```markdown
## 完了した作業

- ...

## 公開バージョン

- murasaki:
- create-murasaki:
- @murasakijs/native:

## 検証結果

- package build:
- Docs typecheck:
- npm audit:
- macOS bundle:
- Windows x64:
- Windows arm64:
- updater E2E:
- public scaffold:
- production Docs:

## 公開URL

- Website:
- Docs:
- Auto Update Docs:
- GitHub:
- GitHub Release:
- npm:
- Product Hunt draft:

## 残っている制限

- ...

## Product Hunt公開可否

READY / NOT READY

理由:
...
```

`READY`はコードが完成しただけでは付けない。公開npm、公開Docs、GitHub Release、ダウンロード可能なデモ、Product Hunt素材、全リンク確認まで完了した場合だけ付ける。
