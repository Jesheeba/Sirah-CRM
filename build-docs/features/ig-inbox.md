# F3 — Inbox

## Purpose
One list where the team reads, filters, assigns and closes comments/mentions/tags.

## Architecture
- Page `/social` (name from tenant branding labels). Server-paged (50/page), URL state — same pattern as Leads (`leads-list.ts`).
- Filters: kind, status, assignee, post, date range, text search (sanitised). Sort newest / oldest.
- Row: author, text, post thumbnail/permalink, kind badge, status, assignee, reply state.
- Actions: assign, mark ignored, open detail (thread + reply panel from F4), convert (F5).
- Permissions: view/assign/ignore gated by new permission keys; tenant-scoped RLS.

## Impact map
- `permissions` seed, role editor UI, sidebar/nav, `(app)/loading.tsx` (reused), `leads-list.ts` pattern (copy, don't couple).

## Edge cases and failure modes
- Empty inbox / no account connected → guided empty state. Hostile search text → sanitised.
- Two people assign at once → last write wins, shown via refresh; no crash. Deleted post → placeholder.
- 10k+ interactions → still 50-row pages, indexed on (tenant_id, status, created_at).

## Acceptance criteria
- 120 seeded interactions page correctly; each filter returns exactly the matching rows; search state survives reload.
- Rep without permission cannot open `/social` or call its actions (server-checked).
- Phone width: no sideways page scroll.
