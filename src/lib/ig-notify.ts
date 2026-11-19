import type { SupabaseClient } from "@supabase/supabase-js";

export interface MentionItem {
  id: string;
  tenant_id: string;
  kind: string;
  author_handle?: string | null;
  text: string | null;
  created_at_provider: string | null;
}

const RECENT_MS = 48 * 3600_000; // older items (e.g. the first tag poll) are history, not news
const BURST = 5;

/**
 * Bell notification for new @mentions and tags, to every Admin/Manager of the tenant who hasn't
 * turned `ig_mention` off. Called from ingest with newly created items only, so a redelivery
 * never alerts twice. Never throws.
 */
export async function notifyIgMentions(admin: SupabaseClient, items: MentionItem[], now = Date.now()): Promise<number> {
  const news = items.filter(
    (i) => (i.kind === "mention" || i.kind === "tag") &&
      (!i.created_at_provider || now - new Date(i.created_at_provider).getTime() < RECENT_MS),
  );
  if (!news.length) return 0;

  let sent = 0;
  const byTenant = new Map<string, MentionItem[]>();
  for (const i of news) byTenant.set(i.tenant_id, [...(byTenant.get(i.tenant_id) ?? []), i]);

  for (const [tenantId, list] of byTenant) {
    try {
      const users = await recipients(admin, tenantId);
      const rows =
        list.length > BURST
          ? [{ title: `${list.length} new Instagram mentions or tags`, body: null, link: "/social", entity_id: null }]
          : list.map((i) => ({
              title: `${i.author_handle ? "@" + i.author_handle : "Someone"} ${i.kind === "tag" ? "tagged you in a post" : "mentioned you"}`,
              body: i.text ? i.text.slice(0, 140) : null,
              link: `/social/${i.id}`,
              entity_id: i.id,
            }));
      for (const user_id of users) {
        for (const r of rows) {
          const { error } = await admin.from("notifications").insert({
            tenant_id: tenantId, user_id, type: "ig_mention", entity_type: "ig_interaction", ...r,
          });
          if (!error) sent++;
        }
      }
    } catch {
      // a failed alert must never lose the ingested item
    }
  }
  return sent;
}

async function recipients(admin: SupabaseClient, tenantId: string): Promise<string[]> {
  const { data: roles } = await admin.from("roles").select("id").eq("tenant_id", tenantId).in("name", ["Admin", "Manager"]);
  const roleIds = ((roles ?? []) as { id: string }[]).map((r) => r.id);
  if (!roleIds.length) return [];
  const { data: ur } = await admin.from("user_roles").select("user_id").eq("tenant_id", tenantId).in("role_id", roleIds);
  const users = [...new Set(((ur ?? []) as { user_id: string }[]).map((r) => r.user_id))];
  if (!users.length) return [];
  const { data: off } = await admin
    .from("notification_preferences").select("user_id").eq("type", "ig_mention").eq("in_app", false).in("user_id", users);
  const muted = new Set(((off ?? []) as { user_id: string }[]).map((r) => r.user_id));
  return users.filter((u) => !muted.has(u));
}
