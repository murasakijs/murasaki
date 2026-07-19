const tenants = [
  { id: 'tn-kanto', name: 'Orglia サンプル株式会社', region: 'kanto' },
  { id: 'tn-kansai', name: 'Orglia 西日本デモ', region: 'kansai' },
]

const user = (id, tenantId, name, email, role, team) => ({ id, tenantId, name, email, role, team })

export function bootstrapData(tenantId = 'tn-kanto', withSample = true) {
  const tenant = tenants.find((item) => item.id === tenantId) ?? tenants[0]
  const admin = tenantId === 'tn-kanto'
    ? user('usr-admin', tenantId, '田中 太郎', 'admin@kanto.orglia.local', 'admin', 'management')
    : user('usr-west', tenantId, '中村 美咲', 'admin@kansai.orglia.local', 'admin', 'management')
  const empty = {
    tenants: [tenant], users: [admin], customers: [], opportunities: [], orders: [], inventory: [], projects: [],
    approvals: [], shifts: [], incidents: [], revenueTargets: [], sampleData: false,
  }
  if (!withSample) return empty

  if (tenantId === 'tn-kansai') return {
    ...empty,
    sampleData: true,
    users: [admin, user('usr-west-sales', tenantId, '吉田 奈緒', 'sales@kansai.orglia.local', 'sales', 'sales')],
    customers: [{ id: 'cus-west', tenantId, name: 'なにわ商事株式会社', industry: 'retail', ownerId: 'usr-west-sales', rank: 'A', email: 'hello@naniwa.example', phone: '06-1234-1010' }],
    opportunities: [{ id: 'opp-west', tenantId, customerId: 'cus-west', title: '店舗在庫最適化', amount: 12_400_000, probability: 70, stage: 'proposal', ownerId: 'usr-west-sales', due: '2026-09-05', nextAction: '役員提案', sku: 'POS-WEST-01', quantity: 4, createdAt: '2026-07-08T04:00:00.000Z' }],
    inventory: [{ sku: 'POS-WEST-01', tenantId, name: '店舗POSキット', onHand: 12, reserved: 4, reorderPoint: 5, location: '大阪倉庫' }],
    projects: [],
    revenueTargets: [{ month: '2026-07', target: 10_000_000 }, { month: '2026-08', target: 13_000_000 }],
  }

  return {
    ...empty,
    sampleData: true,
    users: [
      admin,
      user('usr-manager', tenantId, '高橋 美咲', 'manager@kanto.orglia.local', 'manager', 'management'),
      user('usr-sales', tenantId, '佐藤 花子', 'sales@kanto.orglia.local', 'sales', 'sales'),
      user('usr-ops', tenantId, '山田 次郎', 'operations@kanto.orglia.local', 'operations', 'operations'),
      user('usr-approver', tenantId, '鈴木 一郎', 'approver@kanto.orglia.local', 'approver', 'finance'),
      user('usr-viewer', tenantId, '加藤 結衣', 'viewer@kanto.orglia.local', 'viewer', 'audit'),
    ],
    customers: [
      { id: 'cus-tech', tenantId, name: '株式会社テクノソリューションズ', industry: 'technology', ownerId: 'usr-sales', rank: 'A', email: 'info@techno-sol.example', phone: '03-1234-5678' },
      { id: 'cus-mirai', tenantId, name: '株式会社ミライロジ', industry: 'logistics', ownerId: 'usr-sales', rank: 'B', email: 'ops@mirai-logi.example', phone: '03-5555-0182' },
    ],
    opportunities: [
      { id: 'opp-45', tenantId, customerId: 'cus-tech', title: '基幹システム刷新プロジェクト', amount: 12_800_000, probability: 100, stage: 'won', ownerId: 'usr-sales', due: '2026-08-30', nextAction: '在庫引当', sku: 'SRV-BASE-001', quantity: 5, projectId: 'prj-03', orderId: 'ord-128', createdAt: '2026-06-28T03:00:00.000Z' },
      { id: 'opp-38', tenantId, customerId: 'cus-tech', title: 'クラウド移行支援サービス', amount: 6_800_000, probability: 60, stage: 'estimate', ownerId: 'usr-sales', due: '2026-08-20', nextAction: '見積フォロー', sku: 'SUP-ENTERPRISE', quantity: 1, createdAt: '2026-07-11T06:30:00.000Z' },
      { id: 'opp-27', tenantId, customerId: 'cus-mirai', title: 'データ分析基盤構築', amount: 9_200_000, probability: 100, stage: 'won', ownerId: 'usr-sales', due: '2026-07-12', nextAction: '運用引継ぎ', sku: 'DEV-EDGE-100', quantity: 2, projectId: 'prj-08', orderId: 'ord-110', createdAt: '2026-05-18T02:00:00.000Z' },
    ],
    orders: [
      { id: 'ord-128', tenantId, customerId: 'cus-tech', opportunityId: 'opp-45', projectId: 'prj-03', amount: 12_800_000, status: 'pending', sku: 'SRV-BASE-001', quantity: 5, ownerId: 'usr-sales', due: '2026-08-30', createdAt: '2026-07-15T01:12:00.000Z' },
      { id: 'ord-121', tenantId, customerId: 'cus-mirai', opportunityId: 'opp-27', projectId: 'prj-08', amount: 6_540_000, status: 'allocated', sku: 'DEV-EDGE-100', quantity: 2, ownerId: 'usr-sales', due: '2026-08-12', createdAt: '2026-06-10T04:00:00.000Z', allocatedAt: '2026-06-11T04:00:00.000Z' },
      { id: 'ord-110', tenantId, customerId: 'cus-mirai', opportunityId: 'opp-27', projectId: 'prj-08', amount: 9_200_000, status: 'booked', sku: 'DEV-EDGE-100', quantity: 2, ownerId: 'usr-sales', due: '2026-07-12', createdAt: '2026-06-22T02:30:00.000Z', allocatedAt: '2026-06-23T02:30:00.000Z', bookedAt: '2026-07-03T02:30:00.000Z' },
    ],
    inventory: [
      { sku: 'SRV-BASE-001', tenantId, name: '基幹システムライセンス', onHand: 3, reserved: 0, reorderPoint: 4, location: '東京DC' },
      { sku: 'DEV-EDGE-100', tenantId, name: 'エッジ端末 100', onHand: 18, reserved: 4, reorderPoint: 6, location: '横浜倉庫' },
      { sku: 'SUP-ENTERPRISE', tenantId, name: '年間サポート', onHand: 40, reserved: 12, reorderPoint: 10, location: 'デジタル在庫' },
    ],
    projects: [
      { id: 'prj-03', tenantId, name: '基幹システム刷新プロジェクト', customerId: 'cus-tech', opportunityId: 'opp-45', ownerId: 'usr-ops', status: 'risk', progress: 18, due: '2026-08-30' },
      { id: 'prj-08', tenantId, name: 'データ分析基盤構築', customerId: 'cus-mirai', opportunityId: 'opp-27', ownerId: 'usr-ops', status: 'on-track', progress: 88, due: '2026-07-26' },
    ],
    approvals: [
      { id: 'apr-67', tenantId, title: '大阪出張申請', amount: 86_000, applicantId: 'usr-sales', status: 'pending', risk: 'low', reason: '顧客ワークショップ', updatedAt: '2026-07-19T00:42:00.000Z', steps: [{ label: 'manager-approval', role: 'manager', status: 'approved', actorId: 'usr-manager', at: '2026-07-19T00:42:00.000Z' }, { label: 'finance-approval', role: 'approver', status: 'pending' }], comments: [] },
      { id: 'apr-72', tenantId, title: '検証機材購入', amount: 1_240_000, applicantId: 'usr-ops', status: 'pending', risk: 'high', reason: '新規案件の負荷検証', updatedAt: '2026-07-18T07:00:00.000Z', steps: [{ label: 'manager-approval', role: 'manager', status: 'pending' }, { label: 'finance-approval', role: 'approver', status: 'pending' }], comments: [] },
    ],
    shifts: [
      { id: 'sft-1', tenantId, person: '高橋 葵', team: 'support', skills: ['first-line', 'english'], wish: 'early', assigned: 'early', unavailable: [], conflict: null, published: false },
      { id: 'sft-2', tenantId, person: '伊藤 翔', team: 'support', skills: ['incident'], wish: 'off', assigned: 'late', unavailable: ['late'], conflict: 'unavailable', published: false },
      { id: 'sft-3', tenantId, person: '小林 凛', team: 'support', skills: ['first-line'], wish: 'late', assigned: 'late', unavailable: [], conflict: null, published: false },
      { id: 'sft-4', tenantId, person: '森 悠人', team: 'support', skills: ['incident', 'english'], wish: 'day', assigned: 'day', unavailable: [], conflict: null, published: false },
    ],
    incidents: [
      { id: 'inc-07', tenantId, title: 'POSレジ 接続エラー', severity: 2, ownerId: 'usr-ops', due: '2026-07-19T06:00:00.000Z', status: 'open', postmortem: null, timeline: [{ at: '2026-07-19T00:30:00.000Z', actor: '監視システム', body: '大阪店舗でエラー率がしきい値を超過' }, { at: '2026-07-19T00:34:00.000Z', actor: '山田 次郎', body: '一次切り分けを開始' }] },
      { id: 'inc-11', tenantId, title: '夜間バッチ遅延', severity: 3, ownerId: 'usr-ops', due: '2026-07-20T01:00:00.000Z', status: 'escalated', postmortem: null, timeline: [{ at: '2026-07-18T21:12:00.000Z', actor: '監視システム', body: '完了予定を45分超過' }] },
    ],
    revenueTargets: [
      { month: '2026-04', target: 8_000_000 }, { month: '2026-05', target: 9_000_000 }, { month: '2026-06', target: 10_000_000 },
      { month: '2026-07', target: 12_000_000 }, { month: '2026-08', target: 13_400_000 }, { month: '2026-09', target: 14_100_000 },
    ],
  }
}

export function accountsFor(data) {
  return data.users.map(({ id: userId, tenantId, email, role }) => ({ userId, tenantId, email, role }))
}

export const tenantIds = tenants.map((tenant) => tenant.id)
