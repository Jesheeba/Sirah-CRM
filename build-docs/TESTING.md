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

## meta-scopes (F10 prep) — 2026-11-18
`src/lib/meta-scopes.test.ts` (3): no `ads_management`; every requested scope is approved or submitted; privacy page lists each. Full suite 196 pass; `tsc` clean.

## ig-inbox (F3) — 2026-11-18
`social-list.test.ts` (11) and `__tests__/social-actions.test.ts` (11). Full suite 218 pass; `tsc` clean; `next build` OK.

| Acceptance criterion | Test | Result |
|---|---|---|
| Filters + paging via URL, survives reload | URL state › links keep only non-default values and survive a round trip | pass |
| Hostile search text sanitised | URL state › search text is sanitised… | pass |
| Rep cannot assign/ignore/refresh (server-checked) | assign › a manager may…; ignore › a rep cannot…; refresh › a rep cannot… | pass |
| Tenant isolation on every write | assign › cannot touch another organization's item / assign to someone in another organization | pass |
| Status rules | status rules (3) | pass |
| Opt-in module hidden for other tenants | Social module is opt-in (3) | pass |

Live check (Playwright, throwaway tenant): see the run recorded after deploy.

## ig-reply-workflow (F4) — 2026-11-18
`ig-reply.test.ts` (10) and `__tests__/ig-reply-actions.test.ts` (16). Full suite 246 pass; `tsc` clean; `next build` OK.

| Acceptance criterion | Test | Result |
|---|---|---|
| Under human approval nothing reaches Instagram until approved | human approval › a written reply waits… (asserts zero Graph calls) | pass |
| Rejected draft is never sent | › a rejected reply is never sent | pass |
| Approved posts exactly once even if approve is clicked twice | › approving twice (double click) posts exactly once | pass |
| Writer can't self-approve (unless allowed); rep can't approve | › the writer cannot approve…; …unless the organization allows… | pass |
| Every sent reply has actor + audit rows | › approving posts it once… audit trail drafted/approved/sent | pass |
| Instagram windows (24 h DM, one private reply in 7 days), channel limits | windows (3); rules enforced on the server (5) | pass |
| Failure → failed with reason → retry; disconnected account fails safely | failures, retry and isolation (2) | pass |
| Tenant isolation on submit / approve / reject; only admins change mode | › another organization can't…; › only admins change the reply mode | pass |

Not covered yet: real Graph calls (needs the IG keys, a connected test account and migration 0066). Live check planned after deploy.

## ig-keyword-rules (F9) — 2026-11-18
`ig-rules.test.ts` (52 incl. 35 sample comments), `__tests__/ig-rule-runner.test.ts` (10), `__tests__/ig-rules-actions.test.ts` (7).
Full suite 313 pass; `tsc` clean; `next build` OK.

| Acceptance criterion | Test | Result |
|---|---|---|
| ≥30 sample comments (EN/TA/HI, emoji, case, near-miss) give the expected rule or none | resolver — 35 sample comments | pass |
| Blocklist comment never auto-sends | runner › a blocklist word never auto-sends; resolver blocklist cases | pass |
| Own-account comment never triggers | resolver › own account never fires | pass |
| Same comment delivered twice → one reply | runner › the same item processed twice fires only once | pass |
| DM rule only by DM; tags skipped | runner › a DM rule answers by DM; tags are skipped… | pass |
| "Test a comment" = live resolver, sends nothing | actions › shows which rule fires… and sends nothing | pass |
| Kill switch, caps, per-person cooldown → queued, not sent | runner › kill switch / hourly cap / same person within 10 minutes | pass |
| Admin-only, tenant isolation | actions › managers and reps can't…; can't attach… another organization's | pass |

F4 live: 28/28 on the deployed site (see CHANGELOG).

## ig-to-issue (F5) — 2026-11-18
`__tests__/ig-issue.test.ts` (10). Full suite 323 pass; `tsc` clean; `next build` OK.

| Acceptance criterion | Test | Result |
|---|---|---|
| One click → exactly one lead with correct source and fields | create issue › one click creates exactly one lead… | pass |
| Second click returns the same lead | › a second click returns the same lead | pass |
| Same person within 30 days → attach, not duplicate (not old / converted / other person / deleted) | › the same person's recent open lead is reused…; › …but not an old or converted one…; › a deleted lead doesn't count | pass |
| Interaction status becomes issue; lead links back | › one click… (status issue, lead_id) | pass |
| Existing Meta-lead feed output unchanged | regressions › the Meta lead pull feed is unchanged… | pass |
| Tenant isolation | › can't turn another organization's item into a lead | pass |
