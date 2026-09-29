-- 0059 Instagram DM automation: follower-gated rules + image/link replies.
-- Run after 0001-0058. Idempotent.
--
-- Lets a rule require the sender to already follow the connected Instagram Business
-- Account before it fires (the common "follow me, then I'll DM you" influencer pattern),
-- and lets a reply include an image attachment and/or a link — on top of the existing
-- plain text / quick-reply buttons. No new Meta permission is needed: follow status is
-- read via the Instagram User Profile fields already covered by instagram_manage_messages,
-- and images/links are sent through the same Send API call as a text reply.

alter table public.instagram_automation_rules
  add column if not exists require_follower boolean not null default false,
  add column if not exists reply_image_url text,
  add column if not exists reply_link_url text,
  add column if not exists reply_link_title text;
