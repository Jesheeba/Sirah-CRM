import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EditableFields from "@/components/record/EditableFields";
import RecordTimeline from "@/components/record/RecordTimeline";
import { customFieldDefsFor } from "@/lib/customFields";
import type { TimelineItem } from "@/lib/types";

function RelatedCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

const Empty = () => <p className="px-2 py-1 text-sm text-slate-400">None yet.</p>;

export default async function AccountDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: account } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!account) notFound();

  const [contactsRes, dealsRes, notesRes, actsRes, tasksRes] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, first_name, last_name, title")
      .eq("account_id", id)
      .is("deleted_at", null),
    supabase
      .from("deals")
      .select("id, name, amount, currency")
      .eq("account_id", id)
      .is("deleted_at", null),
    supabase
      .from("notes")
      .select("id, body, created_at")
      .eq("related_to_type", "account")
      .eq("related_to_id", id),
    supabase
      .from("activities")
      .select("id, subject, type, occurred_at")
      .eq("related_to_type", "account")
      .eq("related_to_id", id),
    supabase
      .from("tasks")
      .select("id, title, status, created_at")
      .eq("related_to_type", "account")
      .eq("related_to_id", id)
      .is("deleted_at", null),
  ]);

  const items: TimelineItem[] = [
    ...(notesRes.data ?? []).map((n) => ({
      id: n.id, kind: "note" as const, text: n.body, at: n.created_at,
    })),
    ...(actsRes.data ?? []).map((a) => ({
      id: a.id, kind: "activity" as const, text: a.subject ?? a.type, meta: a.type, at: a.occurred_at,
    })),
    ...(tasksRes.data ?? []).map((t) => ({
      id: t.id, kind: "task" as const, text: t.title, meta: t.status, at: t.created_at,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const contacts = contactsRes.data ?? [];
  const deals = dealsRes.data ?? [];
  const customFields = await customFieldDefsFor(supabase, "accounts");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/accounts" className="hover:underline">Accounts</Link>
        <span>/</span>
        <span className="font-medium text-slate-700">{account.name}</span>
      </div>
      <h1 className="text-xl font-bold text-slate-800">{account.name}</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr_18rem]">
        <EditableFields
          table="accounts"
          id={account.id}
          fields={[
            { key: "name", label: "Name" },
            { key: "industry", label: "Industry" },
            { key: "website", label: "Website", type: "url" },
            { key: "phone", label: "Phone" },
            ...customFields,
          ]}
          initial={account}
        />

        <RecordTimeline
          recordType="account"
          recordId={account.id}
          userId={user!.id}
          initialItems={items}
        />

        <div className="space-y-4">
          <RelatedCard title={`Contacts (${contacts.length})`}>
            {contacts.length === 0 ? (
              <Empty />
            ) : (
              contacts.map((c) => (
                <Link
                  key={c.id}
                  href={`/contacts/${c.id}`}
                  className="block rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                >
                  {`${c.first_name ?? ""} ${c.last_name ?? ""}`.trim() || "(no name)"}
                  {c.title ? <span className="text-slate-400"> · {c.title}</span> : null}
                </Link>
              ))
            )}
          </RelatedCard>

          <RelatedCard title={`Deals (${deals.length})`}>
            {deals.length === 0 ? (
              <Empty />
            ) : (
              deals.map((d) => (
                <div key={d.id} className="flex justify-between gap-2 rounded-md px-2 py-1 text-sm">
                  <span className="truncate text-slate-700">{d.name}</span>
                  <span className="shrink-0 text-slate-500">
                    {d.currency} {d.amount}
                  </span>
                </div>
              ))
            )}
          </RelatedCard>
        </div>
      </div>
    </div>
  );
}
