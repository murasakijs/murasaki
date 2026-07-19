import type { Locale, ModuleId, Role } from '@/domain/types'

const ja = {
  overview: '統合オペレーション', projects: 'プロジェクト', crm: 'CRM', orders: '受注', inventory: '在庫', approvals: '社内申請', shifts: 'シフト', incidents: 'インシデント', analytics: 'アナリティクス', admin: '管理',
  today: '今日', filter: 'フィルター', export: 'エクスポート', customer: '顧客', opportunity: '案件', order: '受注', allocation: '在庫引当', revenue: '売上', pendingApproval: '承認待ち', shiftGap: 'シフト不足', sample: 'これはサンプルデータです。実在のデータではありません。', reset: 'サンプルをリセット', audit: '監査ログ', save: '保存', role: 'ロール', tenant: 'テナント', language: '言語', restricted: 'このロールには操作権限がありません。', noData: '表示できるデータがありません。', details: '詳細', status: '状態', owner: '担当', due: '期限', amount: '金額', action: '操作', all: 'すべて',
  login: 'ログイン', logout: 'ログアウト', email: 'メールアドレス', password: 'パスワード', signingIn: '確認中…', saved: 'サーバーへ保存しました。', saving: '保存中…', offline: 'オフラインです。変更は送信されていません。', conflict: '他のユーザーが先に更新しました。最新データを取得したため、操作を再実行してください。', retry: '再実行', dismiss: '閉じる', refresh: '再読込', synced: '同期済み', sessionSecurity: '認証済みセッション', close: '閉じる', cancel: 'キャンセル', submit: '送信', comment: 'コメント', edit: '編集', resubmit: '再申請', reject: '却下', return: '差し戻し', approve: '承認', publish: '公開', create: '作成',
} as const

const en: Record<keyof typeof ja, string> = {
  overview: 'Operations overview', projects: 'Projects', crm: 'CRM', orders: 'Orders', inventory: 'Inventory', approvals: 'Approvals', shifts: 'Shifts', incidents: 'Incidents', analytics: 'Analytics', admin: 'Admin',
  today: 'Today', filter: 'Filter', export: 'Export', customer: 'Customer', opportunity: 'Opportunity', order: 'Order', allocation: 'Allocation', revenue: 'Revenue', pendingApproval: 'Pending approvals', shiftGap: 'Shift gaps', sample: 'Sample data is shown. It does not represent a real business.', reset: 'Reset sample', audit: 'Audit log', save: 'Save', role: 'Role', tenant: 'Tenant', language: 'Language', restricted: 'Your role cannot perform this action.', noData: 'No records to display.', details: 'Details', status: 'Status', owner: 'Owner', due: 'Due', amount: 'Amount', action: 'Action', all: 'All',
  login: 'Sign in', logout: 'Sign out', email: 'Email', password: 'Password', signingIn: 'Signing in…', saved: 'Saved to the server.', saving: 'Saving…', offline: 'You are offline. No change was sent.', conflict: 'Another user updated the data first. Latest data is loaded; retry your action.', retry: 'Retry', dismiss: 'Dismiss', refresh: 'Refresh', synced: 'Synced', sessionSecurity: 'Authenticated session', close: 'Close', cancel: 'Cancel', submit: 'Submit', comment: 'Comment', edit: 'Edit', resubmit: 'Resubmit', reject: 'Reject', return: 'Return', approve: 'Approve', publish: 'Publish', create: 'Create',
}

export type TranslationKey = keyof typeof ja
export const translate = (locale: Locale, key: TranslationKey) => (locale === 'ja' ? ja : en)[key]
export const copy = (locale: Locale, japanese: string, english: string) => locale === 'ja' ? japanese : english
export const moduleLabel = (locale: Locale, id: ModuleId) => translate(locale, id)
export const roleLabel = (locale: Locale, role: Role) => {
  if (locale === 'en') return role[0].toUpperCase() + role.slice(1)
  return ({ admin: '管理者', manager: 'マネージャー', sales: '営業', operations: 'オペレーション', approver: '承認者', viewer: '閲覧者' } as const)[role]
}
