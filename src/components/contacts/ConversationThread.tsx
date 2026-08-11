"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { sendEmail } from "@/app/(app)/email/actions";
import { sendWhatsApp } from "@/app/(app)/whatsapp/actions";
import { COMM_STATUS_STYLE } from "@/lib/email";
import type { Communication } from "@/lib/types";

type Channel = "email" | "whatsapp";

function fmt(at: string) {
  try { return new Date(at).toLocaleString(); } catch { return at; }
}

export default function ConversationThread({
  contactId,
  contactName,
  contactEmail,
  contactPhone,
}: {
  contactId: string;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string | null;
}) {
  const supabase = createClient();
  const [items, setItems] = useState<Communication[]>([]);
  const [loading, setLoading] = useState(true);
  const [channel, setChannel] = useState<Channel>(contactEmail ? "email" : "whatsapp");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("communications")
        .select("*")
        .eq("related_to_type", "contact")
        .eq("related_to_id", contactId)
        .in("channel", ["email", "whatsapp"])
        .order("created_at", { ascending: true })
        .limit(200);
      if (cancelled) return;
      const rows = (data ?? []) as Communication[];
      setItems(rows);
      setLoading(false);

      // Opening the thread reads it — mark any unread inbound rows read.
      const unreadIds = rows.filter((r) => r.direction === "inbound" && !r.is_read).map((r) => r.id);
      if (unreadIds.length) {
        await supabase.from("communications").update({ is_read: true }).in("id", unreadIds);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  // Live updates for this contact's thread. postgres_changes only supports one filter
  // column, so we filter on related_to_id here (most selective) and check
  // related_to_type/channel client-side. RLS (comm_read) already scopes this to the
  // signed-in user's own tenant — no manual tenant_id filter needed.
  useEffect(() => {
    const rtChannel = supabase
      .channel(`contact-thread-${contactId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "communications", filter: `related_to_id=eq.${contactId}` },
        (payload) => {
          const row = payload.new as Communication;
          if (row.related_to_type !== "contact" || !["email", "whatsapp"].includes(row.channel)) return;
          setItems((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "communications", filter: `related_to_id=eq.${contactId}` },
        (payload) => {
          const row = payload.new as Communication;
          if (row.related_to_type !== "contact" || !["email", "whatsapp"].includes(row.channel)) return;
          setItems((prev) => prev.map((m) => (m.id === row.id ? row : m)));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(rtChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactId]);

  const canEmail = !!contactEmail;
  const canWhatsapp = !!contactPhone;

  async function send() {
    if (!body.trim()) return;
    setSending(true);
    setError(null);

    if (channel === "email") {
      const res = await sendEmail({
        to_email: contactEmail!,
        to_name: contactName,
        subject: subject.trim() || "(no subject)",
        body: body.trim(),
        related_to_type: "contact",
        related_to_id: contactId,
      });
      setSending(false);
      if (!res.ok) return setError(res.error ?? "Send failed.");
      if (res.mailto) window.location.href = res.mailto;
      setItems((xs) => [
        ...xs,
        {
          id: `local-${Date.now()}`, tenant_id: "", channel: "email", direction: "outbound",
          status: (res.status as Communication["status"]) ?? "sent", to_email: contactEmail, to_phone: null,
          to_name: contactName, from_email: null, cc: null, bcc: null, subject: subject.trim() || "(no subject)",
          body: body.trim(), template_id: null, related_to_type: "contact", related_to_id: contactId,
          quotation_id: null, provider: null, provider_message_id: null, open_token: "", sent_at: new Date().toISOString(),
          opened_at: null, clicked_at: null, owner_id: null, created_at: new Date().toISOString(), is_read: true,
        } as Communication,
      ]);
      setSubject("");
      setBody("");
    } else {
      const res = await sendWhatsApp({
        to_phone: contactPhone!,
        to_name: contactName,
        body: body.trim(),
        related_to_type: "contact",
        related_to_id: contactId,
      });
      setSending(false);
      if (!res.ok) return setError(res.error ?? "Send failed.");
      if (res.waUrl) window.open(res.waUrl, "_blank");
      setItems((xs) => [
        ...xs,
        {
          id: `local-${Date.now()}`, tenant_id: "", channel: "whatsapp", direction: "outbound",
          status: (res.status as Communication["status"]) ?? "sent", to_email: null, to_phone: contactPhone,
          to_name: contactName, from_email: null, cc: null, bcc: null, subject: null, body: body.trim(),
          template_id: null, related_to_type: "contact", related_to_id: contactId, quotation_id: null,
          provider: null, provider_message_id: null, open_token: "", sent_at: new Date().toISOString(),
          opened_at: null, clicked_at: null, owner_id: null, created_at: new Date().toISOString(), is_read: true,
        } as Communication,
      ]);
      setBody("");
    }
  }

  const empty = !loading && items.length === 0;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-sm font-semibold text-slate-700">Conversation</h3>

      <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
        {loading && <p className="text-sm text-slate-400">Loading…</p>}
        {empty && <p className="text-sm text-slate-400">No email or WhatsApp messages yet.</p>}
        {items.map((c) => {
          const outbound = c.direction === "outbound";
          return (
            <div key={c.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${
                  outbound ? "bg-brand text-white" : "bg-slate-100 text-slate-800"
                } ${!c.is_read && !outbound ? "ring-2 ring-amber-400" : ""}`}
              >
                <div className={`mb-1 flex items-center gap-1.5 text-xs ${outbound ? "text-white/70" : "text-slate-400"}`}>
                  <span>{c.channel === "email" ? "✉" : "💬"}</span>
                  <span>{fmt(c.created_at)}</span>
                  {outbound && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${COMM_STATUS_STYLE[c.status]}`}>
                      {c.status}
                    </span>
                  )}
                </div>
                {c.subject && <p className="mb-0.5 font-semibold">{c.subject}</p>}
                <p className="whitespace-pre-wrap">{c.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
        <div className="flex gap-1.5">
          <button
            onClick={() => setChannel("email")}
            disabled={!canEmail}
            className={`rounded-full px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
              channel === "email" ? "bg-brand text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            ✉ Email
          </button>
          <button
            onClick={() => setChannel("whatsapp")}
            disabled={!canWhatsapp}
            className={`rounded-full px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${
              channel === "whatsapp" ? "bg-brand text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            💬 WhatsApp
          </button>
        </div>
        {channel === "email" && (
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
        )}
        <div className="flex gap-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={channel === "email" ? "Write a reply…" : "Write a WhatsApp message…"}
            rows={2}
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand"
          />
          <button
            onClick={send}
            disabled={sending || !body.trim() || (channel === "email" ? !canEmail : !canWhatsapp)}
            className="self-end rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
