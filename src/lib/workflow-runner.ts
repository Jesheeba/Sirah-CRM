/**
 * Workflow async action executors — runs in the tick API route (server-only).
 * Each executor receives the run's `context` JSONB and the admin Supabase client,
 * executes the action, and returns { ok, error? }.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { resolveEmailConfig, resolveWhatsAppConfig, formatFrom } from "@/lib/integrations";
import { bodyToHtml, mergeTemplate } from "@/lib/email";
import { normalizePhone } from "@/lib/whatsapp";

export interface RunContext {
  action_id: string;
  action_type: string;
  config: Record<string, string | number | null | undefined>;
  entity_type: string;
  entity_id: string;
  record: Record<string, unknown>;
  tenant_id: string;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

// ─── send_email ──────────────────────────────────────────────────────────────

async function execSendEmail(ctx: RunContext): Promise<ActionResult> {
  const admin = createAdminClient();
  const cfg = await resolveEmailConfig(ctx.tenant_id);

  if (cfg.mode === "link") {
    return { ok: false, error: "No email provider configured for this tenant." };
  }

  const record = ctx.record as Record<string, string | null>;
  const to_email =
    String(ctx.config.to_email_field
      ? (record[String(ctx.config.to_email_field)] ?? "")
      : (ctx.config.to_email ?? "")
    ).trim();

  if (!to_email) {
    return { ok: false, error: "No recipient email resolved from config or record." };
  }

  const vars: Record<string, string | null> = {
    to_name: String(record.name ?? record.first_name ?? ""),
    first_name: String(record.first_name ?? record.name ?? "").split(" ")[0],
    account: String(record.company ?? record.account_name ?? ""),
  };

  const subject = mergeTemplate(String(ctx.config.subject ?? "(no subject)"), vars);
  const body = mergeTemplate(String(ctx.config.body ?? ""), vars);

  const { data: row, error: insErr } = await admin
    .from("communications")
    .insert({
      channel: "email",
      direction: "outbound",
      status: "queued",
      to_email,
      from_email: cfg.fromEmail,
      subject,
      body,
      provider: "resend",
      related_to_type: ctx.entity_type.replace(/s$/, "") as "lead" | "contact" | "account" | "deal",
      related_to_id: ctx.entity_id,
    })
    .select("id, open_token")
    .single();

  if (insErr || !row) {
    return { ok: false, error: insErr?.message ?? "Failed to log email." };
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const pixel = appUrl
    ? `<img src="${appUrl}/api/email/open?t=${row.open_token}" width="1" height="1" alt="" style="display:none"/>`
    : "";

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: formatFrom(cfg.fromEmail!, cfg.fromName),
      to: [to_email],
      subject: subject || "(no subject)",
      html: `${bodyToHtml(body)}${pixel}`,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };

  if (!res.ok) {
    await admin.from("communications").update({ status: "failed" }).eq("id", row.id);
    return { ok: false, error: json.message ?? `Resend error ${res.status}` };
  }

  await admin
    .from("communications")
    .update({ status: "sent", provider_message_id: json.id ?? null })
    .eq("id", row.id);

  return { ok: true };
}

// ─── send_whatsapp ───────────────────────────────────────────────────────────

async function execSendWhatsApp(ctx: RunContext): Promise<ActionResult> {
  const admin = createAdminClient();
  const cfg = await resolveWhatsAppConfig(ctx.tenant_id);

  if (cfg.mode === "link") {
    return { ok: false, error: "No WhatsApp provider configured for this tenant." };
  }

  const record = ctx.record as Record<string, string | null>;
  const rawPhone =
    String(ctx.config.to_phone_field
      ? (record[String(ctx.config.to_phone_field)] ?? "")
      : (ctx.config.to_phone ?? "")
    ).trim();

  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return { ok: false, error: "No phone number resolved from config or record." };
  }

  const vars: Record<string, string | null> = {
    to_name: String(record.name ?? record.first_name ?? ""),
    first_name: String(record.first_name ?? record.name ?? "").split(" ")[0],
  };

  const body = mergeTemplate(String(ctx.config.body ?? ""), vars);

  const { data: row, error: insErr } = await admin
    .from("communications")
    .insert({
      channel: "whatsapp",
      direction: "outbound",
      status: "queued",
      to_phone: phone,
      body,
      provider: cfg.mode === "tenant_device" ? "whatsapp_device" : "whatsapp_cloud",
      related_to_type: ctx.entity_type.replace(/s$/, "") as "lead" | "contact" | "account" | "deal",
      related_to_id: ctx.entity_id,
    })
    .select("id")
    .single();

  if (insErr || !row) {
    return { ok: false, error: insErr?.message ?? "Failed to log message." };
  }

  try {
    let res: Response;

    if (cfg.mode === "tenant_device") {
      const base = (cfg.apiEndpoint ?? "https://api.ultramsg.com").replace(/\/+$/, "");
      res = await fetch(`${base}/${cfg.phoneId}/messages/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: cfg.accessToken, to: phone, body }),
      });
    } else {
      res = await fetch(`https://graph.facebook.com/v22.0/${cfg.phoneId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body },
        }),
      });
    }

    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
      id?: string;
      sent?: boolean;
      error?: string | { message?: string };
    };

    if (!res.ok) {
      await admin.from("communications").update({ status: "failed" }).eq("id", row.id);
      const errMsg =
        typeof json.error === "string"
          ? json.error
          : (json.error as { message?: string })?.message ?? `Send failed ${res.status}`;
      return { ok: false, error: errMsg };
    }

    const msgId = json.messages?.[0]?.id ?? json.id ?? null;
    await admin
      .from("communications")
      .update({ status: "sent", provider_message_id: msgId })
      .eq("id", row.id);

    return { ok: true };
  } catch (e) {
    await admin.from("communications").update({ status: "failed" }).eq("id", row.id);
    return { ok: false, error: e instanceof Error ? e.message : "Send failed." };
  }
}

// ─── assign_owner ────────────────────────────────────────────────────────────

async function execAssignOwner(ctx: RunContext): Promise<ActionResult> {
  const admin = createAdminClient();
  const { entity_type, entity_id, tenant_id, config } = ctx;

  if (config.strategy === "round_robin") {
    // Fetch all active users for this tenant, sorted by least-recently-assigned.
    const { data: users } = await admin
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", tenant_id)
      .eq("status", "active")
      .order("created_at");

    if (!users?.length) {
      return { ok: false, error: "No active users to assign to." };
    }

    // Pick the user with fewest leads assigned (simple round-robin by count).
    const { data: counts } = await admin
      .from(entity_type as "leads" | "contacts" | "accounts" | "deals")
      .select("owner_id")
      .eq("tenant_id", tenant_id)
      .in(
        "owner_id",
        users.map((u) => u.user_id),
      );

    const countMap = new Map<string, number>();
    for (const u of users) countMap.set(u.user_id, 0);
    for (const row of counts ?? []) {
      if (row.owner_id) countMap.set(row.owner_id, (countMap.get(row.owner_id) ?? 0) + 1);
    }

    const winner = [...countMap.entries()].sort((a, b) => a[1] - b[1])[0][0];

    const { error } = await admin
      .from(entity_type as "leads" | "contacts" | "accounts" | "deals")
      .update({ owner_id: winner })
      .eq("id", entity_id)
      .eq("tenant_id", tenant_id);

    return error ? { ok: false, error: error.message } : { ok: true };
  }

  // Specific user assignment
  const owner_id = String(config.owner_id ?? "").trim();
  if (!owner_id) {
    return { ok: false, error: "assign_owner: no owner_id or strategy in config." };
  }

  const { error } = await admin
    .from(entity_type as "leads" | "contacts" | "accounts" | "deals")
    .update({ owner_id })
    .eq("id", entity_id)
    .eq("tenant_id", tenant_id);

  return error ? { ok: false, error: error.message } : { ok: true };
}

// ─── webhook ─────────────────────────────────────────────────────────────────

async function execWebhook(ctx: RunContext): Promise<ActionResult> {
  const url = String(ctx.config.url ?? "").trim();
  if (!url) return { ok: false, error: "webhook: no URL in config." };

  const method = String(ctx.config.method ?? "POST").toUpperCase();
  const payload = {
    event: "workflow_action",
    action_type: "webhook",
    entity_type: ctx.entity_type,
    entity_id: ctx.entity_id,
    tenant_id: ctx.tenant_id,
    record: ctx.record,
    config: ctx.config,
  };

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    return { ok: false, error: `Webhook returned ${res.status}` };
  }
  return { ok: true };
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export async function executeAction(ctx: RunContext): Promise<ActionResult> {
  switch (ctx.action_type) {
    case "send_email":
      return execSendEmail(ctx);
    case "send_whatsapp":
      return execSendWhatsApp(ctx);
    case "assign_owner":
      return execAssignOwner(ctx);
    case "webhook":
      return execWebhook(ctx);
    default:
      return { ok: false, error: `Unknown async action type: ${ctx.action_type}` };
  }
}
