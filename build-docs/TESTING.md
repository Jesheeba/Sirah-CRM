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
