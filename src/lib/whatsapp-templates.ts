import { WHATSAPP_GRAPH } from "@/lib/whatsapp";
import type { TemplateComponent } from "@/lib/whatsapp-template-validator";

/**
 * Server-only Graph API calls for WhatsApp Business message-template management
 * (create/list/edit/delete). Takes the tenant's own access token — resolved via
 * resolveWhatsAppConfig() — never a deployment-wide credential.
 */
if (typeof window !== "undefined") {
  throw new Error("lib/whatsapp-templates.ts is server-only and must not be imported in the browser.");
}

export class WhatsAppTemplateApiError extends Error {}

async function metaFetch(
  path: string,
  accessToken: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://graph.facebook.com/${WHATSAPP_GRAPH}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = json.error as { message?: string } | undefined;
  if (!res.ok || err) {
    throw new WhatsAppTemplateApiError(err?.message ?? `WhatsApp template API error (HTTP ${res.status})`);
  }
  return json;
}

export interface CreateTemplatePayload {
  name: string;
  language: string;
  category: string;
  components: TemplateComponent[];
}

export interface MetaTemplateResult {
  id: string;
  status?: string;
  category?: string;
}

/** POST /{waba_id}/message_templates — submits a new template for review. */
export async function createMetaTemplate(
  wabaId: string,
  accessToken: string,
  payload: CreateTemplatePayload,
): Promise<MetaTemplateResult> {
  const json = await metaFetch(`${wabaId}/message_templates`, accessToken, {
    method: "POST",
    // parameter_format: "named" (lowercase — confirmed against Meta's own docs) tells
    // Meta to parse {{customer_name}} tokens instead of assuming positional {{1}}.
    // Meta reclassifies templates it disagrees with (e.g. MARKETING content filed as
    // UTILITY) — without allow_category_change it rejects the submission outright instead.
    body: JSON.stringify({ ...payload, parameter_format: "named", allow_category_change: true }),
  });
  return { id: String(json.id ?? ""), status: json.status as string | undefined, category: json.category as string | undefined };
}

export interface MetaTemplateListItem {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: TemplateComponent[];
  rejected_reason?: string;
  quality_score?: { score?: string } | string;
}

/** GET /{waba_id}/message_templates — full list (cursor-paginated), used to sync status. */
export async function listMetaTemplates(wabaId: string, accessToken: string): Promise<MetaTemplateListItem[]> {
  const items: MetaTemplateListItem[] = [];
  let after: string | undefined;
  do {
    const url = new URL(`https://graph.facebook.com/${WHATSAPP_GRAPH}/${wabaId}/message_templates`);
    url.searchParams.set("fields", "id,name,language,category,status,components,rejected_reason,quality_score");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const err = json.error as { message?: string } | undefined;
    if (!res.ok || err) {
      throw new WhatsAppTemplateApiError(err?.message ?? `WhatsApp template list failed (HTTP ${res.status})`);
    }
    items.push(...((json.data ?? []) as MetaTemplateListItem[]));
    const paging = json.paging as { cursors?: { after?: string }; next?: string } | undefined;
    after = paging?.next && paging.cursors?.after ? paging.cursors.after : undefined;
  } while (after);
  return items;
}

export interface EditTemplatePayload {
  category?: string;
  components: TemplateComponent[];
}

/** POST /{template_id} — edits an already-submitted template; Meta returns it to PENDING. */
export async function editMetaTemplate(
  metaTemplateId: string,
  accessToken: string,
  payload: EditTemplatePayload,
): Promise<void> {
  await metaFetch(metaTemplateId, accessToken, {
    method: "POST",
    // Meta's docs don't explicitly say parameter_format must be re-sent on edit (it may
    // be immutable after creation), but every template this app creates now uses named
    // params — including it here too is the conservative choice against a silent
    // fallback-to-positional misparse of the edited {{name}} tokens.
    body: JSON.stringify({ ...payload, parameter_format: "named", allow_category_change: true }),
  });
}

/** DELETE /{waba_id}/message_templates?name= — deletes all language variants of a name. */
export async function deleteMetaTemplate(wabaId: string, accessToken: string, name: string): Promise<void> {
  const url = new URL(`https://graph.facebook.com/${WHATSAPP_GRAPH}/${wabaId}/message_templates`);
  url.searchParams.set("name", name);
  const res = await fetch(url, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const err = json.error as { message?: string } | undefined;
  // Meta 404s if the template was already removed remotely — treat that as success so
  // a local row that's drifted from Meta can still be cleaned up.
  if (!res.ok && res.status !== 404) {
    throw new WhatsAppTemplateApiError(err?.message ?? `WhatsApp template delete failed (HTTP ${res.status})`);
  }
}
