# ig-mention-alerts — bell notification when someone @mentions or tags the account

**Purpose:** the MLA wants to know at once when people mention them in other people's posts/comments, not only by opening Social.

**Architecture**
- `src/lib/ig-notify.ts` `notifyIgMentions(admin, items)` — called at the end of `ingestIgEvents` (covers webhook mentions and polled tags).
- Recipients: tenant users with role Admin or Manager (`roles` → `user_roles`), minus those who turned off `ig_mention` in notification preferences.
- Writes `notifications` rows (existing table, realtime bell): type `ig_mention`, title `@handle mentioned you` / `@handle tagged you in a post`, body = first 140 chars, link `/social/{id}`, entity `ig_interaction`.
- No migration (type is free text). `NotificationType` + preference list gain `ig_mention`.

**Impact map**
- `ig-ingest.ts` (calls notify; `CreatedInteraction` gains `author_handle`), webhook routes and tag polling (indirect), notification bell + preferences UI (new type shown), `rule-runner` tests (type only).

**Edge cases**
- First tag poll imports old tags → only items whose provider time is within 48 h (or unknown) notify.
- Burst (> 5 in one delivery for a tenant) → one summary notification per user ("N new mentions or tags").
- Comments/DMs don't notify (inbox handles them); own items are never in `created`.
- Notify failure never breaks ingest (caught). Duplicate deliveries create no item → no second alert.
- Other tenants' users never receive it (recipients scoped by tenant).

**Acceptance criteria**
1. A new mention → each Admin/Manager of that tenant gets one bell notification linking to the item; Sales Reps don't.
2. A user who disabled `ig_mention` gets none.
3. A tag older than 48 h (first poll) → no notification.
4. 6+ in one delivery → one summary per user.
5. Comment or DM → no notification. Redelivery → no second notification.
