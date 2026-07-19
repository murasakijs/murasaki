import type { Locale } from './domain/types'

const en = {
  search: 'Search pages, tags, and text', favorites: 'Favorites', pages: 'Pages', tags: 'Tags', databases: 'Databases', settings: 'Settings',
  fileMenu: 'File', viewMenu: 'View', duplicate: 'Duplicate', delete: 'Delete',
  saved: 'Saved locally', saving: 'Saving…', saveFailed: 'Save failed', offline: 'Local only', connected: 'Self-hosted sync connected', reconnecting: 'Sync reconnecting', syncError: 'Sync rejected',
  sampleData: 'Sample data', personalData: 'Personal workspace', emptyTitle: 'Your paper is ready', emptyBody: 'Create a page or import Markdown to begin with a clean workspace.', opening: 'Opening your local workspace…', newPage: 'New page', newChild: 'New child page', untitledPage: 'Untitled page', copySuffix: 'copy', import: 'Import Markdown', export: 'Export Markdown',
  backlinks: 'Backlinks', noBacklinks: 'No pages link here yet.', pageTags: 'Page tags', database: 'Project database', table: 'Table', board: 'Board', calendar: 'Calendar', editor: 'Document',
  resetSample: 'Reset sample data', clearAll: 'Start without samples', resetBody: 'Restore the realistic demo dataset or start with an empty workspace.', resetConfirm: 'Replace the current workspace? A copy of deleted pages remains in Trash.', cancel: 'Cancel', confirm: 'Replace workspace',
  addBlock: 'Add block', deleteBlock: 'Delete block', addAttachment: 'Attach file', blockType: 'Block type', close: 'Close', storage: 'SQLite local store',
  heading: 'Heading', text: 'Text', todo: 'To-do', callout: 'Callout', attachment: 'Attachment', typeCommand: "Type '/' for commands", blockText: 'Block text', taskToggle: 'Toggle task completion', dragBlock: 'Reorder block', moveUp: 'Move block up', moveDown: 'Move block down',
  deletePageConfirm: 'Move this page and all nested pages to Trash?', trash: 'Trash', restoreTrash: 'Restore trashed pages', trashEmpty: 'Trash is empty.', deleteMoved: 'Page moved to Trash.', undo: 'Undo',
  addTag: 'Add tag', removeTag: 'Remove tag', favorite: 'Favorite page', menu: 'Open navigation', databaseView: 'Database view', moveCard: 'Move',
  milestone: 'Milestone', owner: 'Owner', dueDate: 'Due date', status: 'Status', notStarted: 'Not started', inProgress: 'In progress', done: 'Done', databaseSampleNotice: 'This collection contains sample records.',
  addRecord: 'Add record', deleteRecord: 'Delete record',
  pagesCount: 'Pages', sampleState: 'Sample data', on: 'On', off: 'Off', format: 'Format', collaboration: 'Self-hosted collaboration', launchFlags: 'Empty launch',
  collaborationHelp: 'Copy .env.example to .env, set a strong room token, then run docker compose up --build. Local editing remains available while disconnected.',
  launchHelp: 'Use murasaki dev -- --no-sample-data in development, or --no-sample-data on a packaged cold start, to open a separate empty workspace without overwriting your primary workspace.',
  recovery: 'Recovery', recoveryBody: 'Papelle quarantined unreadable workspace data instead of overwriting it.', recoveryDownload: 'Download quarantined data', persistenceWarning: 'Local persistence warning',
  attachmentTooLarge: 'This file does not fit within the remaining local workspace limit.', attachmentReadFailed: 'The attachment could not be read.', importTooLarge: 'Markdown imports are limited to 2 MiB.', pageTitle: 'Page title', sampleDescription: 'This record is sample content. Its origin remains labelled after editing.',
} as const

const ja: { [K in keyof typeof en]: string } = {
  search: 'ページ・タグ・本文を検索', favorites: 'お気に入り', pages: 'ページ', tags: 'タグ', databases: 'データベース', settings: '設定',
  fileMenu: 'ファイル', viewMenu: '表示', duplicate: '複製', delete: '削除',
  saved: 'ローカルに保存済み', saving: '保存中…', saveFailed: '保存に失敗しました', offline: 'ローカルのみ', connected: 'セルフホスト同期に接続済み', reconnecting: '同期に再接続中', syncError: '同期が拒否されました',
  sampleData: 'サンプルデータ', personalData: '個人ワークスペース', emptyTitle: 'まっさらな紙を用意しました', emptyBody: '新しいページを作るか、Markdownを読み込んで始めましょう。', opening: 'ローカルワークスペースを開いています…', newPage: '新規ページ', newChild: '子ページを追加', untitledPage: '無題のページ', copySuffix: 'のコピー', import: 'Markdownを読み込む', export: 'Markdownを書き出す',
  backlinks: 'バックリンク', noBacklinks: 'このページへのリンクはまだありません。', pageTags: 'ページのタグ', database: 'プロジェクトデータベース', table: 'テーブル', board: 'ボード', calendar: 'カレンダー', editor: 'ドキュメント',
  resetSample: 'サンプルを初期状態に戻す', clearAll: 'サンプルなしで始める', resetBody: '現実的なデモデータへ戻すか、空のワークスペースで始められます。', resetConfirm: '現在のワークスペースを置き換えますか？削除したページはゴミ箱に残ります。', cancel: 'キャンセル', confirm: '置き換える',
  addBlock: 'ブロックを追加', deleteBlock: 'ブロックを削除', addAttachment: 'ファイルを添付', blockType: 'ブロックの種類', close: '閉じる', storage: 'SQLiteローカルストア',
  heading: '見出し', text: 'テキスト', todo: 'To-do', callout: 'コールアウト', attachment: '添付', typeCommand: '「/」でコマンドを表示', blockText: 'ブロック本文', taskToggle: 'タスクの完了状態を切り替え', dragBlock: 'ブロックを並べ替え', moveUp: 'ブロックを上へ', moveDown: 'ブロックを下へ',
  deletePageConfirm: 'このページと配下のページをゴミ箱へ移動しますか？', trash: 'ゴミ箱', restoreTrash: 'ゴミ箱のページを復元', trashEmpty: 'ゴミ箱は空です。', deleteMoved: 'ページをゴミ箱へ移動しました。', undo: '元に戻す',
  addTag: 'タグを追加', removeTag: 'タグを削除', favorite: 'お気に入りページ', menu: 'ナビゲーションを開く', databaseView: 'データベース表示', moveCard: '移動',
  milestone: 'マイルストーン', owner: '担当者', dueDate: '期限', status: '状態', notStarted: '未着手', inProgress: '進行中', done: '完了', databaseSampleNotice: 'このコレクションにはサンプルレコードが含まれます。',
  addRecord: 'レコードを追加', deleteRecord: 'レコードを削除',
  pagesCount: 'ページ数', sampleState: 'サンプルデータ', on: 'あり', off: 'なし', format: '形式', collaboration: 'セルフホスト共同編集', launchFlags: '空の状態で起動',
  collaborationHelp: '.env.example を .env にコピーして強いルームトークンを設定し、docker compose up --build を実行してください。切断中もローカル編集は利用できます。',
  launchHelp: '開発時は murasaki dev -- --no-sample-data、パッケージ版のコールドスタート時は --no-sample-data で、メインを上書きせず別の空ワークスペースを開きます。',
  recovery: '復旧', recoveryBody: '読み取れないワークスペースを上書きせず隔離しました。', recoveryDownload: '隔離データをダウンロード', persistenceWarning: 'ローカル保存の警告',
  attachmentTooLarge: 'このファイルはワークスペースの残り容量に収まりません。', attachmentReadFailed: '添付ファイルを読み取れませんでした。', importTooLarge: 'Markdownの読み込み上限は2 MiBです。', pageTitle: 'ページタイトル', sampleDescription: 'このレコードはサンプルです。編集後も出所を明確に表示します。',
}

export function t(locale: Locale) { return locale === 'ja' ? ja : en }
