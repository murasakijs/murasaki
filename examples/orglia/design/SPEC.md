# Orglia visual specification

Source concepts: `overview-concept.png` and `crm-concept.png`.

## System

- True white `#ffffff` chrome over a cool canvas `#f5f7fa`; navy global rail `#082544`.
- Text `#172033`, muted `#667085`, border `#d8dee8`; almost no shadow.
- Module colors: projects `#2563eb`, CRM `#6d3de8`, orders `#ea580c`, inventory `#059669`,
  approvals `#d97706`, shifts `#0284c7`, incidents `#dc2626`, analytics `#4f46e5`.
- 4/8/12/16/24/32 spacing rhythm; panels use 8px radius and one-pixel borders.
- System sans stack, 12-14px control chrome, 20-24px page titles, tabular numbers.
- Lucide outline icons at 18-20px with 1.75px strokes; selected module adopts its identity color.

## Container and component rules

- 64px global rail, 220px module navigation, fluid content, 320px contextual panel.
- Use tables, lists, rails and open canvas regions. Avoid nested card mosaics.
- Primary workflow is a horizontal five-step rail and remains visible on overview and CRM.
- Buttons, fields, tabs, rows, status labels and timeline entries are reusable component families.
- Right panel is contextual, not a modal. On narrow desktop it becomes an overlay drawer; on mobile
  both sidebars collapse into accessible toolbar menus.
- Motion is limited to drawer transitions, selected-row feedback and live-region confirmation, and
  is disabled with `prefers-reduced-motion`.

## Allowed first-viewport copy

Orglia; 統合オペレーション; サンプルデータ; 今日; フィルター; エクスポート; 顧客; 案件;
受注; 在庫引当; 売上; 承認待ち; シフト不足; インシデント; 売上予測; 粗利率; 本日の業務;
English equivalents shown only after the locale is switched.

## Required interaction states

- Select a workflow stage or table row and show its linked record in the context panel.
- Convert the seeded opportunity into an order, allocate available inventory, then book revenue.
- Approve/return a request, generate/confirm a shift plan, escalate/resolve an incident.
- Filter and rearrange analytics widgets, export CSV, invoke the print/PDF flow.
- Switch tenant, role and locale; restricted controls remain visible but explain why disabled.
- Reset sample data with an explicit confirmation.
