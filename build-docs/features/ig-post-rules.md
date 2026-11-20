# Feature: per-post auto-reply rules (post picker)

## Purpose
Each reel needs its own "Link" reply (saree reel → saree link, DifAi reel → DifAi link). Rules already support
`ig_media_id`, but admins had to type Instagram's numeric media id, which nothing showed them.

## Architecture
- `src/lib/ig-graph.ts` `fetchMedia(igUserId, token, limit)` → GET `/{ig-user}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp` (instagram_basic, already granted).
- `src/app/(app)/social/rules/actions.ts` `listIgPosts()` → admin only; reads the tenant's active `ig_accounts`, fetches each account's recent media, returns newest first with `@username`. No DB writes.
- `RulesManager`: comment rules get a "Choose from recent posts" grid (thumbnail, caption, date). Picking one sets `ig_media_id`;
  the form shows the chosen post with Clear. The manual ID box stays as a fallback.
- Comment page (`/social/[id]`): "Auto-reply rule for this post" link → `/social/rules?media=<media_id>` opens a new comment rule pre-set to that post.
- Matching is unchanged: post-specific rules already win over general ones (`ig-rules.ts`).

## Impact map
- `ig-graph.ts` (new function only), rules `actions.ts` (new action), `rules/page.tsx` (reads `?media=`), `RulesManager.tsx` (form UI), `social/[id]/page.tsx` (link).
- No schema change. Rule validation/matching untouched → existing ig-rules tests guard regressions.

## Edge cases
- No connected account / revoked token → action returns an error; UI shows it, manual ID still works.
- Account with no posts → "No posts found".
- Video posts have no `media_url` image → use `thumbnail_url`; neither → text-only tile.
- `?media=` with junk → only digits accepted, else ignored.
- Non-admins: page already redirects; action re-checks admin.

## Acceptance criteria
1. `fetchMedia` maps id/caption/thumbnail (thumbnail_url for videos, media_url for images)/permalink/timestamp; drops items without id.
2. Token never appears in thrown errors (uses `igJson`).
3. Picking a post in the rule form saves the rule with that `ig_media_id`.
4. `/social/rules?media=123` opens a new comment rule with `ig_media_id = 123`; non-digit values ignored.
5. Rules list shows which post a rule is limited to (caption snippet when known, else "one post").
