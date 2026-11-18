import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Instagram Login "Deauthorize" and "Data deletion" callbacks (MLA desk F8). Meta POSTs a
 * `signed_request` signed with the Instagram app secret; `user_id` is the Instagram account.
 */

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

export function verifyIgSignedRequest(
  signedRequest: string,
  secret = process.env.IG_APP_SECRET ?? "",
): { user_id: string; issued_at?: number } | null {
  if (!secret || typeof signedRequest !== "string") return null;
  const [sig, payload] = signedRequest.split(".", 2);
  if (!sig || !payload) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  const given = b64url(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(b64url(payload).toString("utf8")) as { algorithm?: string; user_id?: unknown; issued_at?: number };
    if (String(data.algorithm).toUpperCase() !== "HMAC-SHA256") return null;
    if (data.user_id === undefined || data.user_id === null || data.user_id === "") return null;
    return { user_id: String(data.user_id), issued_at: data.issued_at };
  } catch {
    return null;
  }
}

/** Deauthorize: stop using the account at once — token wiped, marked revoked. History is kept until a deletion request. */
export async function revokeIgUser(admin: SupabaseClient, igUserId: string): Promise<number> {
  const { data } = await admin
    .from("ig_accounts")
    .update({ status: "revoked", access_token: "", webhook_subscribed: false })
    .eq("ig_user_id", igUserId)
    .select("id");
  return ((data ?? []) as unknown[]).length;
}

/**
 * Data deletion: removes the connected account and, through the database's cascades, every
 * comment / mention / DM / tag stored for it, the replies and their audit trail, and rules scoped
 * to it. Leads the organization chose to create stay (they are its own CRM records).
 */
export async function deleteIgUserData(admin: SupabaseClient, igUserId: string): Promise<number> {
  const { data } = await admin.from("ig_accounts").delete().eq("ig_user_id", igUserId).select("id");
  return ((data ?? []) as unknown[]).length;
}
