# F5 — Interaction → lead / citizen issue

## Purpose
Turn a comment or mention that needs action into a tracked CRM record with an owner.

## Architecture
- Action "Create issue" on an interaction → inserts a `leads` row: source "Instagram Comment" / "Instagram Mention",
  name from handle, custom_fields {ig_handle, ig_permalink, ig_text, ig_interaction_id}, owner = assignee.
- Link both ways: `ig_interactions.lead_id`, lead page shows the originating comment + link.
- Dedupe: same handle open issue within 30 days → offer "attach to existing" instead of a new lead.
- Tenant labels (branding) may rename "Lead" to "Issue"/"Citizen request" — reuse existing labels system.

## Impact map
- `leads` (insert path, scoring rules), `leads/[id]` page (new Facts rows), Leads list filter (source), convert-lead flow, lead feed export (should not leak IG fields to FB feed), RLS.

## Edge cases and failure modes
- No phone/email → lead allowed (handle is the identifier); duplicate click → one lead. Deleted comment → lead keeps stored text.
- Lead deleted → interaction link cleared. Converted lead → comment reply still allowed.

## Acceptance criteria
- One click creates exactly one lead with correct source and fields; second click returns the same lead.
- Lead page links back to the comment; interaction status becomes `issue`.
- Existing Meta-lead feed output unchanged (regression test).
