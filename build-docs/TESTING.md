# Testing

## Strategy
- Runner: **vitest**, `node` environment (`vitest.config.mts`). No React Testing Library, so
  client components are not unit-tested — testable logic belongs in `src/lib/`.
- Typecheck: `npx tsc --noEmit`.
- Commands: `npx vitest run`, or `npx vitest run <file>` for one suite.

## Per-feature results

### Meta lead ad attribution (2026-11-06)
Suite: full run — **10 files, 104 tests passed**. `tsc --noEmit` clean.

| Acceptance criterion | Test | Result |
|---|---|---|
| `fetchAdName` returns the trimmed ad name | `meta-formname.test.ts` › returns the trimmed ad name | pass |
| Graph refusal must not lose the lead | › returns null when Meta refuses the ad node | pass |
| Blank/missing name → null | › returns null for a missing or blank name | pass |
| Network throw → null | › returns null when the network call throws | pass |
| Feed exposes `ad_name` (JSON) | `lead-feed.test.ts` › flattens routing metadata | pass |
| Feed exposes `ad_name` (CSV header + value) | › emits base columns plus one column per answer key | pass |
| Missing metadata tolerated | › tolerates missing custom_fields and unknown pages | pass |

Failures found and fixed during the change:
- My first edit to `LeadsClient.tsx` wrote a literal newline inside a `.join("…")` string literal,
  breaking JSX parsing (TS17002). Root cause: heredoc escaping in the edit script, not the logic.
  Fixed by writing the `\n` escape properly; `tsc` then clean.

Not covered by tests:
- The webhook and backfill code paths that call `fetchAdName` (no integration test against Meta;
  these paths have no test harness in this repo).
- The leads-list Ad column and ad filter (client component — see strategy above).

### Backfill ad names onto existing leads (2026-11-06)
Suite: full run — **11 files, 113 tests passed**. `tsc --noEmit` clean, `next build` compiles.

| Acceptance criterion | Test | Result |
|---|---|---|
| AC2 preserves all other custom_fields | `ad-name-backfill.test.ts` › writes the name while preserving every other field | pass |
| AC3 writes nothing when Meta refuses | › returns null when Meta refused the ad | pass |
| AC4 one Graph call per distinct ad | › returns one entry per distinct ad, not per lead | pass |
| AC6 idempotent on re-run | › skips leads that already have a name | pass |
| no mutation of input | › never mutates the row it was given | pass |
| blank / missing ad id ignored | › ignores a blank ad id, › skips leads with no ad id | pass |

Verified by rendering `MetaLeadsCard` server-side: the "Fill in ad names" button appears alongside
"Import past leads", and all five result messages (all-resolved, partial, no-ads-access,
nothing-to-do, failed) were dumped and read for clarity.

Not covered by tests: the server action's Supabase queries and the Graph calls (no harness).

Design note: the "already has a name" filter was initially written as a
`.is("custom_fields->>fb_ad_name", null)` clause. Moved into the unit-tested code path instead,
because a JSONB `->>` null filter that silently matches nothing would make the backfill look like
a no-op success rather than fail loudly.

## ig-login-connect (F1) — 2026-11-18
`src/lib/ig-login.test.ts` (15) and `src/lib/__tests__/ig-oauth-callback.test.ts` (9). Full suite 150 pass; `tsc` clean; `next build` OK.

| Acceptance criterion | Test | Result |
|---|---|---|
| Professional account connects and shows username | callback › connects a professional account… | pass |
| Personal account refused, nothing saved | callback › refuses a personal account…; ig-login › accepts Business and Creator… | pass |
| Token stored only server-side | ig-login › revokes client access and grants only non-secret columns | pass |
| Token refreshed before expiry (mocked clock) | refresh window; daily refresh job › refreshes only tokens inside the window… | pass |
| Expired state visible | job › marks a token already past expiry as expired… | pass |
| Second tenant cannot attach same account | callback › a second tenant cannot attach…; unique ig_user_id | pass |
| Edge: CSRF state tamper/missing, denied consent, exchange failure, non-admin, subscribe failure, reconnect | callback › rejects…, handles…, reports…, is admin-only, still connects…, reconnecting… | pass |

Not covered: real calls to Instagram (needs IG_APP_ID/SECRET and a test account). Verify on the live
site after the env vars and migration 0064 are in place: Connect → consent → card shows @handle.

## ig-ingest (F2) — 2026-11-18
`ig-webhook.test.ts` (25) and `__tests__/ig-ingest.test.ts` (18). Full suite 193 pass; `tsc` clean; `next build` OK.

| Acceptance criterion | Test | Result |
|---|---|---|
| Same event 3× → one row | ingest › …delivered 3 times…; route › redelivery… | pass |
| Tampered signature → no row | route › tampered signature…; signature › rejects… | pass |
| Comment, mention, DM, tag each typed correctly | parse › comments/mentions/direct messages; ingest › stores a comment, a mention and a tag… | pass |
| Tenant A never sees tenant B's rows | ingest › tenant isolation…; security › RLS + raw not granted | pass |
| Edge: unknown/revoked account, own comment, echo, hostile payloads, enrichment failure, duplicates in one delivery, emoji/Tamil/long text | ingest › drops…, own comment…, mention whose lookup fails…; parse › never throw, keeps emoji… | pass |

Not covered: real Graph calls (mention lookup, `/tags`) and the live webhook handshake — needs IG_APP_SECRET, a
connected test account and migration 0065. Verify on the live site: comment from a second account → row appears.
