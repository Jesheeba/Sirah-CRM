# F9 — Keyword rules (public reply, private reply, DM)

## Purpose
Answer the common, repeatable questions automatically and predictably, without AI, so the reviewer sees a clear,
controlled automation and the office saves time.

## Architecture
- Table `ig_rules`: tenant_id, ig_account_id, applies_to (comment | dm), ig_media_id (null = all posts),
  rule_type (keyword | always), match_keywords text[], match_mode (any | all), priority, is_enabled,
  action (public_reply | private_reply | both | dm_reply), reply_text, dm_text,
  send_mode (auto | needs_approval), blocklist_hit_action (human).
- Pure resolver `resolveIgRule({event, rules, blocklist})` — no network/DB, unit-testable (same pattern as `instagram-comment-automation.ts`).
- Matching: lower-cased, Unicode-normalised, trimmed; `any`/`all` keywords; whole-word option so "fee" does not match "coffee";
  Tamil/Hindi text matched as written. Media-specific rules before wildcard rules, then priority.
- Tenant **blocklist** (complaint, bribe, caste words…): any hit forces a person, whatever rules say.
- Execution: `needs_approval` → creates an `ig_replies` draft (F4); `auto` → posts via Graph:
  public reply `POST /{comment-id}/replies`, private reply `POST /{ig-id}/messages` with `recipient.comment_id`, DM reply with `recipient.id`.
- Safety: never reply to own account; one rule fire per comment; max 1 private reply per comment (7-day limit);
  DM only inside the 24 h window; per-author cooldown; hourly/daily caps; kill switch; full audit row per fire.
- UI: rule list/editor + **"Test a comment" box** that shows which rule would fire and what would be sent, without sending.

## Impact map
- `ig_interactions` (status), `ig_replies`, notifications, permissions (`ig.rules.manage`), settings page; existing Facebook-Login comment rules unchanged.

## Edge cases and failure modes
- Two rules match → highest priority wins, others ignored (shown in test box). Empty keyword list on keyword rule → rejected on save.
- Reply text >2200 chars or empty → rejected. Comment deleted before send → `failed`, no retry loop.
- Outside 24 h / 7 d windows → not sent, marked `window_expired`, goes to a person.
- Duplicate webhook → one fire (idempotent on interaction id + rule id). Token expired → rule paused, tenant notified.
- Reply that itself contains a trigger word → own-account guard prevents loops.

## Acceptance criteria
- Table-driven tests: ≥30 sample comments (EN/TA/HI, emoji, mixed case, near-miss words) give the expected rule or "none".
- Blocklist comment never auto-sends. Own-account comment never triggers.
- Same comment delivered twice → one reply. DM after 24 h → not sent, flagged.
- "Test a comment" box matches what the live resolver does (same function).
