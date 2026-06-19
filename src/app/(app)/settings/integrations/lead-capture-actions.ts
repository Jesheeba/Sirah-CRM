"use server";

import { revalidatePath } from "next/cache";
import { getUserContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

function appBase() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function buildCaptureUrl(token: string) {
  return `${appBase()}/api/leads/capture?token=${token}`;
}

export async function regenerateCaptureToken(): Promise<{ ok: boolean; url?: string; error?: string }> {
  const ctx = await getUserContext();
  if (!ctx) return { ok: false, error: "Not authenticated." };
  if (!ctx.isAdmin) return { ok: false, error: "Admins only." };
  if (!ctx.tenantId) return { ok: false, error: "No organization found." };

  const admin = createAdminClient();

  const newToken = crypto.randomUUID();
  const { data, error } = await admin
    .from("tenants")
    .update({ lead_capture_token: newToken })
    .eq("id", ctx.tenantId)
    .select("lead_capture_token")
    .single();

  if (error || !data) return { ok: false, error: error?.message ?? "Failed to regenerate." };

  revalidatePath("/settings/integrations");
  return { ok: true, url: buildCaptureUrl(data.lead_capture_token as string) };
}
