import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserContext } from "@/lib/auth";
import RulesManager from "@/components/social/RulesManager";
import type { IgRule } from "@/lib/ig-rules";

/** Automatic replies (keyword rules) for the Instagram social desk — admins only (F9). */
export default async function SocialRulesPage() {
  const ctx = await getUserContext();
  if (!ctx?.isAdmin) redirect("/social");
  const supabase = await createClient();
  const [{ data: rules }, { data: settings }, { data: accounts }] = await Promise.all([
    supabase.from("ig_rules").select("*").order("priority", { ascending: true }).order("name"),
    supabase.from("ig_desk_settings").select("blocklist, auto_paused, auto_hourly_cap, auto_daily_cap").maybeSingle(),
    supabase.from("ig_accounts").select("id, username").neq("status", "revoked"),
  ]);
  const s = settings as { blocklist?: string[]; auto_paused?: boolean; auto_hourly_cap?: number; auto_daily_cap?: number } | null;

  return (
    <div className="space-y-4">
      <Link href="/social" className="text-sm text-slate-500 hover:text-brand">← Back to Social</Link>
      <RulesManager
        rules={(rules ?? []) as IgRule[]}
        accounts={(accounts ?? []) as { id: string; username: string | null }[]}
        settings={{
          blocklist: s?.blocklist ?? [],
          autoPaused: s?.auto_paused ?? false,
          hourlyCap: s?.auto_hourly_cap ?? 30,
          dailyCap: s?.auto_daily_cap ?? 200,
        }}
      />
    </div>
  );
}
