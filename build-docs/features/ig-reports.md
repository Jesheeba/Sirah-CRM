# F6 — Reports

## Purpose
Show volume, speed and outcomes so the office can manage the account.

## Architecture
- Page `/social/reports` with date range. Metrics: interactions per day by kind; status split; first-response time (median/p90);
  approval turnaround; AI vs human share; replies sent/failed; issues created and their status; top posts by comments.
- SQL views/RPCs (security invoker, tenant-scoped by RLS); CSV export (formula-injection-safe, reuse `csvCell`).

## Impact map
- `ig_interactions`, `ig_replies`, `leads`; reports section nav; export helper in `lead-feed.ts` (extract or copy `csvCell`).

## Edge cases and failure modes
- Empty range → zeros, not errors. Time zone = tenant timezone. Large range (1y, 100k rows) → aggregated in SQL, not in the browser.
- Deleted posts/leads → counted, labelled "deleted".

## Acceptance criteria
- Seeded dataset gives exactly the hand-computed counts and medians.
- CSV opens without formula execution for cells starting with `= + - @`.
- Tenant isolation test passes.
