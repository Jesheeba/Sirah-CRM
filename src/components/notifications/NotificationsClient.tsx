"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { NOTIFICATION_TYPE_META, type Notification } from "@/lib/types";

type ChannelPrefs = { in_app: boolean; email: boolean };

export default function NotificationsClient({
  initial,
  initialPrefs,
  userId,
}: {
  initial: Notification[];
  initialPrefs: Record<string, ChannelPrefs>;
  userId: string;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [items, setItems] = useState<Notification[]>(initial);
  const [prefs, setPrefs] = useState<Record<string, ChannelPrefs>>(initialPrefs);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [showPrefs, setShowPrefs] = useState(false);

  const unread = items.filter((n) => !n.is_read).length;
  const visible = useMemo(
    () => (tab === "unread" ? items.filter((n) => !n.is_read) : items),
    [items, tab]
  );

  async function open(n: Notification) {
    if (!n.is_read) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
    }
    if (n.link) router.push(n.link);
  }

  async function markAll() {
    const ids = items.filter((n) => !n.is_read).map((n) => n.id);
    if (!ids.length) return;
    setItems((xs) => xs.map((x) => ({ ...x, is_read: true })));
    await supabase.from("notifications").update({ is_read: true }).in("id", ids);
  }

  // In-app defaults to enabled with no stored row (matches fn_should_notify's DB default);
  // email defaults to OFF (opt-in — matches the notification_preferences.email column default).
  const channelEnabled = (type: string, channel: keyof ChannelPrefs) =>
    prefs[type]?.[channel] ?? (channel === "in_app");

  async function toggleChannel(type: string, channel: keyof ChannelPrefs) {
    const current = prefs[type] ?? { in_app: true, email: false };
    const next = { ...current, [channel]: !current[channel] };
    setPrefs((p) => ({ ...p, [type]: next }));
    const { error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, type, in_app: next.in_app, email: next.email }, { onConflict: "user_id,type" });
    if (error) setPrefs((p) => ({ ...p, [type]: current })); // revert on failure
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-800">Notifications</h1>
        <div className="flex items-center gap-2">
          {unread > 0 && (
            <button onClick={markAll} className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Mark all read
            </button>
          )}
          <button
            onClick={() => setShowPrefs((s) => !s)}
            className={`rounded-lg border px-3 py-2 text-sm ${
              showPrefs ? "border-brand bg-brand-50 text-brand" : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            Preferences
          </button>
        </div>
      </div>

      {showPrefs && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Notification preferences</h2>
            <div className="flex gap-6 pr-[3.25rem] text-xs font-medium uppercase tracking-wide text-slate-400">
              <span>In-app</span>
              <span>Email</span>
            </div>
          </div>
          {NOTIFICATION_TYPE_META.map((m) => (
            <div key={m.type} className="flex items-center justify-between gap-3 border-b border-slate-50 py-2 last:border-0">
              <span>
                <span className="block text-sm text-slate-700">{m.label}</span>
                <span className="block text-xs text-slate-400">{m.description}</span>
              </span>
              <div className="flex shrink-0 gap-6">
                {(["in_app", "email"] as const).map((channel) => (
                  <button
                    key={channel}
                    onClick={() => toggleChannel(m.type, channel)}
                    role="switch"
                    aria-label={`${channel === "in_app" ? "In-app" : "Email"} notifications for ${m.label}`}
                    aria-checked={channelEnabled(m.type, channel)}
                    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                      channelEnabled(m.type, channel) ? "bg-brand" : "bg-slate-300"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                        channelEnabled(m.type, channel) ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-slate-400">
            Email notifications are sent as a daily digest, not instantly.
          </p>
        </div>
      )}

      <div className="flex gap-1 rounded-lg border border-slate-200 p-1 sm:w-fit">
        {(["all", "unread"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize ${
              tab === t ? "bg-brand-50 text-brand" : "text-slate-500 hover:bg-slate-50"
            }`}
          >
            {t}
            {t === "unread" && unread > 0 ? ` (${unread})` : ""}
          </button>
        ))}
      </div>

      <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        {visible.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            {tab === "unread" ? "You're all caught up." : "No notifications yet."}
          </p>
        )}
        {visible.map((n) => (
          <button
            key={n.id}
            onClick={() => open(n)}
            className={`flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50 ${
              n.is_read ? "" : "bg-brand-50/40"
            }`}
          >
            {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />}
            <span className={n.is_read ? "pl-5" : ""}>
              <span className="block text-sm text-slate-700">{n.title}</span>
              {n.body && <span className="block text-xs text-slate-500">{n.body}</span>}
              <span className="block text-xs text-slate-400">{new Date(n.created_at).toLocaleString()}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
