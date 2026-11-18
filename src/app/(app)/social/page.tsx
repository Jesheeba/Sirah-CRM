import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import { SOCIAL_PAGE_SIZE, parseSocialQuery } from "@/lib/social-list";
import SocialInbox, { type SocialItem } from "@/components/social/SocialInbox";

const COLUMNS =
  "id, ig_account_id, kind, author_handle, text, permalink, media_id, created_at_provider, received_at, status, assigned_to";

/** Instagram social inbox: comments, @mentions, tagged posts and DMs (MLA desk F3). */
export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = (await getUserContext())!;
  const supabase = await createClient();
  const q = parseSocialQuery(await searchParams);

  let query = supabase.from("ig_interactions").select(COLUMNS, { count: "exact" });
  if (q.kind) query = query.eq("kind", q.kind);
  if (q.status === "") query = query.in("status", ["new", "assigned"]);
  else if (q.status !== "all") query = query.eq("status", q.status);
  if (q.mine) query = query.eq("assigned_to", ctx.userId);
  if (q.q) query = query.or(`text.ilike.%${q.q}%,author_handle.ilike.%${q.q}%`);
  const from = (q.page - 1) * SOCIAL_PAGE_SIZE;
  query = query.order("received_at", { ascending: false }).range(from, from + SOCIAL_PAGE_SIZE - 1);

  const [{ data, count }, { data: accounts }, { data: members }, { data: tenant }] = await Promise.all([
    query,
    supabase.from("ig_accounts").select("id, username, status").neq("status", "revoked"),
    supabase.from("profiles").select("id, full_name, email"),
    supabase.from("tenants").select("timezone").eq("id", ctx.tenantId!).maybeSingle(),
  ]);

  return (
    <SocialInbox
      items={(data ?? []) as SocialItem[]}
      total={count ?? 0}
      query={q}
      accounts={(accounts ?? []) as { id: string; username: string | null; status: string }[]}
      members={(members ?? []) as { id: string; full_name: string | null; email: string | null }[]}
      canManage={ctx.isAdmin || ctx.isManager}
      timeZone={(tenant?.timezone as string | null) || "Asia/Kolkata"}
    />
  );
}
