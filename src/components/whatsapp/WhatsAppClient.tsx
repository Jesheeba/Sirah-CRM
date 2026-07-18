"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Communication, EmailTemplate } from "@/lib/types";
import WhatsAppComposer, { type WaPrefill } from "./WhatsAppComposer";
import { sendWhatsApp } from "@/app/(app)/whatsapp/actions";

// ── Types ─────────────────────────────────────────────────────────────────────

type Conversation = {
  phone: string;
  name: string | null;
  messages: Communication[]; // ascending by sent_at
  lastMessage: Communication;
  unread: number; // inbound since last outbound reply
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByPhone(comms: Communication[]): Conversation[] {
  const map = new Map<string, Communication[]>();
  for (const c of comms) {
    const phone = c.to_phone ?? "unknown";
    if (!map.has(phone)) map.set(phone, []);
    map.get(phone)!.push(c);
  }

  const result: Conversation[] = [];
  for (const [phone, msgs] of map) {
    const sorted = [...msgs].sort(
      (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime(),
    );
    const name = sorted.find((m) => m.to_name)?.to_name ?? null;
    const lastOutbound = [...sorted].reverse().find((m) => m.direction === "outbound");
    const unread = lastOutbound
      ? sorted.filter(
          (m) =>
            m.direction === "inbound" &&
            new Date(m.sent_at) > new Date(lastOutbound.sent_at),
        ).length
      : sorted.filter((m) => m.direction === "inbound").length;

    result.push({
      phone,
      name,
      messages: sorted,
      lastMessage: sorted[sorted.length - 1],
      unread,
    });
  }

  return result.sort(
    (a, b) =>
      new Date(b.lastMessage.sent_at).getTime() -
      new Date(a.lastMessage.sent_at).getTime(),
  );
}

function fmt(dateStr: string) {
  const d = new Date(dateStr);
  const isToday = d.toDateString() === new Date().toDateString();
  return isToday
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

function avatar(label: string) {
  return label.replace(/\D/g, "").slice(-2) || label.slice(0, 2).toUpperCase();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function WhatsAppClient({
  initial,
  templates,
  providerEnabled,
  initialCompose,
}: {
  initial: Communication[];
  templates: EmailTemplate[];
  providerEnabled: boolean;
  initialCompose?: WaPrefill | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [composing, setComposing] = useState<WaPrefill | null>(
    initialCompose ?? null,
  );
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const conversations = groupByPhone(initial);
  const q = search.trim().toLowerCase();
  const filtered = q
    ? conversations.filter(
        (c) =>
          c.phone.includes(q) ||
          (c.name ?? "").toLowerCase().includes(q) ||
          c.messages.some((m) => (m.body ?? "").toLowerCase().includes(q)),
      )
    : conversations;

  const activeConvo = selected
    ? conversations.find((c) => c.phone === selected) ?? null
    : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selected, initial.length]);

  async function sendReply() {
    if (!selected || !replyBody.trim()) return;
    setSending(true);
    setReplyError(null);
    const res = await sendWhatsApp({
      to_phone: selected,
      to_name: activeConvo?.name ?? null,
      body: replyBody.trim(),
    });
    setSending(false);
    if (!res.ok) {
      setReplyError(res.error ?? "Send failed.");
      return;
    }
    setReplyBody("");
    router.refresh();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendReply();
    }
  }

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 100px)" }}>
      {/* ── Top bar ── */}
      <div className="mb-3 flex flex-shrink-0 flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">WhatsApp</h1>
        <div className="flex gap-2">
          <Link
            href="/whatsapp/templates"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            Templates
          </Link>
          <button
            onClick={() => setComposing({})}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            + New message
          </button>
        </div>
      </div>

      {!providerEnabled && (
        <div className="mb-3 flex-shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          No WhatsApp provider configured —{" "}
          <Link href="/settings/integrations" className="underline">
            set it up here
          </Link>
          .
        </div>
      )}

      {/* ── Two-panel layout ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {/* ── Left: conversation list ── */}
        <div className="flex w-72 flex-shrink-0 flex-col border-r border-slate-200 xl:w-80">
          <div className="border-b border-slate-100 p-3">
            <input
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-green-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <p className="py-10 text-center text-sm text-slate-400">
                {conversations.length === 0
                  ? "No conversations yet."
                  : "No matches."}
              </p>
            )}

            {filtered.map((convo) => (
              <button
                key={convo.phone}
                onClick={() => setSelected(convo.phone)}
                className={`w-full border-b border-slate-100 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                  selected === convo.phone
                    ? "border-l-4 border-l-green-500 bg-green-50"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-sm font-semibold text-green-700">
                      {avatar(convo.name ?? convo.phone)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {convo.name ?? convo.phone}
                      </p>
                      {convo.name && (
                        <p className="truncate text-xs text-slate-400">
                          {convo.phone}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-shrink-0 flex-col items-end gap-1">
                    <span className="text-xs text-slate-400">
                      {fmt(convo.lastMessage.sent_at)}
                    </span>
                    {convo.unread > 0 && (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-xs font-medium text-white">
                        {convo.unread > 9 ? "9+" : convo.unread}
                      </span>
                    )}
                  </div>
                </div>
                <p className="mt-1 truncate pl-11 text-xs text-slate-500">
                  {convo.lastMessage.direction === "outbound" ? "You: " : ""}
                  {convo.lastMessage.body || "Template message"}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* ── Right: chat thread ── */}
        {!activeConvo ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
            Select a conversation to view messages
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Chat header */}
            <div className="flex flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-green-100 text-sm font-semibold text-green-700">
                {avatar(activeConvo.name ?? activeConvo.phone)}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {activeConvo.name ?? activeConvo.phone}
                </p>
                {activeConvo.name && (
                  <p className="text-xs text-slate-400">{activeConvo.phone}</p>
                )}
              </div>
            </div>

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto space-y-1 p-4"
              style={{ background: "#efeae2" }}
            >
              {activeConvo.messages.map((msg) => {
                const isOut = msg.direction === "outbound";
                return (
                  <div
                    key={msg.id}
                    className={`flex ${isOut ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`relative max-w-[72%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                        isOut
                          ? "rounded-tr-sm bg-[#d9fdd3] text-slate-800"
                          : "rounded-tl-sm bg-white text-slate-800"
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words leading-snug">
                        {msg.body || (
                          <em className="text-slate-400">Template message</em>
                        )}
                      </p>
                      <div
                        className={`mt-0.5 flex items-center gap-0.5 ${isOut ? "justify-end" : "justify-start"}`}
                      >
                        <span className="text-[10px] text-slate-400">
                          {fmt(msg.sent_at)}
                        </span>
                        {isOut && (
                          <span
                            className={`text-[11px] font-medium ${
                              msg.status === "opened"
                                ? "text-blue-500"
                                : msg.status === "delivered"
                                  ? "text-slate-500"
                                  : msg.status === "failed"
                                    ? "text-red-400"
                                    : "text-slate-400"
                            }`}
                          >
                            {msg.status === "failed"
                              ? " ✗"
                              : msg.status === "sent"
                                ? " ✓"
                                : " ✓✓"}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>

            {/* Reply box */}
            <div className="flex-shrink-0 border-t border-slate-200 bg-white px-3 py-3">
              {replyError && (
                <p className="mb-1 text-xs text-red-600">{replyError}</p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
                  rows={1}
                  style={{ minHeight: "40px", maxHeight: "120px" }}
                  className="flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-2 text-sm outline-none focus:border-green-500"
                />
                <button
                  onClick={sendReply}
                  disabled={sending || !replyBody.trim()}
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-500 text-white hover:bg-green-600 disabled:opacity-40"
                >
                  {sending ? (
                    <span className="text-xs">…</span>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="h-5 w-5"
                    >
                      <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {composing && (
        <WhatsAppComposer
          templates={templates}
          providerEnabled={providerEnabled}
          prefill={composing}
          onClose={() => setComposing(null)}
          onSent={() => router.refresh()}
        />
      )}
    </div>
  );
}
