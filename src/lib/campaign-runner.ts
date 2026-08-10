import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveEmailConfig, formatFrom } from "@/lib/integrations";
import { bodyToTrackedHtml, mergeTemplate } from "@/lib/email";

const BATCH_SIZE = 200;

interface CampaignRow {
  id: string;
  tenant_id: string;
  subject: string;
  body: string;
  owner_id: string;
}

interface RecipientRow {
  id: string;
  tenant_id: string;
  campaign_id: string;
  entity_type: "lead" | "contact";
  entity_id: string;
  email: string;
}

/**
 * Sends up to BATCH_SIZE pending recipients per sending campaign per run — a real bulk
 * send can be thousands of rows, well beyond one request; batching across daily runs
 * (see BUILD_BLOCKERS.md re: the Vercel Hobby daily cron) spreads it out instead of
 * timing out. A campaign is marked 'sent' once no pending recipients remain.
 */
export async function processEmailCampaigns(
  admin: SupabaseClient,
): Promise<{ campaignsProcessed: number; sent: number; failed: number }> {
  const { data: campaigns } = await admin
    .from("email_campaigns")
    .select("id, tenant_id, subject, body, owner_id")
    .eq("status", "sending");

  const rows = (campaigns ?? []) as CampaignRow[];
  if (!rows.length) return { campaignsProcessed: 0, sent: 0, failed: 0 };

  let totalSent = 0;
  let totalFailed = 0;

  for (const campaign of rows) {
    const { data: pending } = await admin
      .from("email_campaign_recipients")
      .select("id, tenant_id, campaign_id, entity_type, entity_id, email")
      .eq("campaign_id", campaign.id)
      .eq("status", "pending")
      .limit(BATCH_SIZE);

    const recipients = (pending ?? []) as RecipientRow[];

    if (recipients.length) {
      const cfg = await resolveEmailConfig(campaign.tenant_id);
      if (cfg.mode === "link" || !cfg.apiKey || !cfg.fromEmail) {
        // No provider configured — leave this batch pending, retried on tomorrow's run.
        continue;
      }

      for (const r of recipients) {
        const { data: entity } = await admin
          .from(r.entity_type === "lead" ? "leads" : "contacts")
          .select("first_name, last_name, company")
          .eq("id", r.entity_id)
          .maybeSingle();
        const vars = {
          first_name: (entity as { first_name?: string } | null)?.first_name ?? "",
          last_name: (entity as { last_name?: string } | null)?.last_name ?? "",
          company: (entity as { company?: string } | null)?.company ?? "",
        };
        const subject = mergeTemplate(campaign.subject, vars);
        const body = mergeTemplate(campaign.body, vars);

        const { data: commRow } = await admin
          .from("communications")
          .insert({
            tenant_id: campaign.tenant_id,
            channel: "email",
            direction: "outbound",
            status: "queued",
            to_email: r.email,
            from_email: cfg.fromEmail,
            subject,
            body,
            provider: "resend",
            related_to_type: r.entity_type,
            related_to_id: r.entity_id,
            owner_id: campaign.owner_id,
          })
          .select("id, open_token")
          .single();

        if (!commRow) {
          await admin.from("email_campaign_recipients").update({ status: "failed" }).eq("id", r.id);
          totalFailed++;
          continue;
        }

        const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
        const unsubscribeUrl = appUrl ? `${appUrl}/unsubscribe?t=${commRow.open_token}` : null;
        const pixel = appUrl
          ? `<img src="${appUrl}/api/email/open?t=${commRow.open_token}" width="1" height="1" alt="" style="display:none"/>`
          : "";
        const html = bodyToTrackedHtml(
          body,
          appUrl ? (url) => `${appUrl}/api/email/click?t=${commRow.open_token}&u=${encodeURIComponent(url)}` : undefined,
        );
        const footer = unsubscribeUrl
          ? `<p style="margin-top:24px;font-size:11px;color:#94a3b8;"><a href="${unsubscribeUrl}" style="color:#94a3b8;">Unsubscribe</a> from these emails.</p>`
          : "";

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: formatFrom(cfg.fromEmail, cfg.fromName),
            to: [r.email],
            subject,
            html: `${html}${pixel}${footer}`,
          }),
        });

        if (res.ok) {
          await admin.from("communications").update({ status: "sent" }).eq("id", commRow.id);
          await admin
            .from("email_campaign_recipients")
            .update({ status: "sent", communication_id: commRow.id })
            .eq("id", r.id);
          totalSent++;
        } else {
          await admin.from("communications").update({ status: "failed" }).eq("id", commRow.id);
          await admin
            .from("email_campaign_recipients")
            .update({ status: "failed", communication_id: commRow.id })
            .eq("id", r.id);
          totalFailed++;
        }
      }
    }

    const { count: remaining } = await admin
      .from("email_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id)
      .eq("status", "pending");

    if (!remaining) {
      const { count: sentCount } = await admin
        .from("email_campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .eq("status", "sent");
      const { count: failedCount } = await admin
        .from("email_campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", campaign.id)
        .eq("status", "failed");

      await admin
        .from("email_campaigns")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          sent_count: sentCount ?? 0,
          failed_count: failedCount ?? 0,
        })
        .eq("id", campaign.id);
    }
  }

  return { campaignsProcessed: rows.length, sent: totalSent, failed: totalFailed };
}
