import { createAdminClient } from "@/lib/supabase/admin";
import { parseIgWebhook } from "@/lib/ig-webhook";
import { ingestIgEvents } from "@/lib/ig-ingest";
import { applyIgRules } from "@/lib/ig-rule-runner";

/**
 * Feeds an already signature-verified Instagram webhook body into the social desk.
 * Called from both /api/ig/webhook and /api/meta/instagram-webhook: Meta allows one callback
 * URL per webhook object, and the `instagram` object's URL is shared by the Page-linked DM
 * integration and the Unified-login desk. Only events for active `ig_accounts` are kept,
 * ingest is idempotent, and rules fire only on newly created items. Never throws.
 */
export async function processIgDeskBody(raw: string): Promise<void> {
  try {
    const events = parseIgWebhook(JSON.parse(raw));
    if (!events.length) return;
    const admin = createAdminClient();
    const { created } = await ingestIgEvents(admin, events);
    if (created.length) await applyIgRules(admin, created).catch(() => null);
  } catch {
    // swallow — webhook routes always answer 200
  }
}
