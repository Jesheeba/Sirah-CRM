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

export default async function ContactDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: contact } = await supabase
    .from("contacts")
    .select("*, accounts(id, name)")
    .eq("id", id)
    .maybeSingle();
  if (!contact) notFound();

  const [dealsRes, notesRes, actsRes, tasksRes] = await Promise.all([
    supabase
      .from("deals")
      .select("id, name, amount, currency")
      .eq("contact_id", id)
      .is("deleted_at", null),
    supabase
      .from("notes")
      .select("id, body, created_at")
      .eq("related_to_type", "contact")
      .eq("related_to_id", id),
    supabase
      .from("activities")
      .select("id, subject, type, occurred_at")
      .eq("related_to_type", "contact")
      .eq("related_to_id", id),
    supabase
      .from("tasks")
      .select("id, title, status, created_at")
      .eq("related_to_type", "contact")
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

  const fullName =
    `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || "(no name)";
  const account = contact.accounts as { id: string; name: string } | null;
  const deals = dealsRes.data ?? [];
  const customFields = await customFieldDefsFor(supabase, "contacts");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/contacts" className="hover:underline">Contacts</Link>
        <span>/</span>
        <span className="font-medium text-slate-700">{fullName}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">{fullName}</h1>
        <div className="flex gap-2">
          {contact.email && (
            <Link
              href={`/email?compose=1&to=${encodeURIComponent(contact.email)}&name=${encodeURIComponent(
                fullName
              )}&rtype=contact&rid=${contact.id}`}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              ✉ Email
            </Link>
          )}
          {contact.phone && (
            <Link
              href={`/whatsapp?compose=1&to=${encodeURIComponent(contact.phone)}&name=${encodeURIComponent(
                fullName
              )}&rtype=contact&rid=${contact.id}`}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              💬 WhatsApp
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr_18rem]">
        <EditableFields
          table="contacts"
          id={contact.id}
          fields={[
            { key: "first_name", label: "First name" },
            { key: "last_name", label: "Last name" },
            { key: "title", label: "Title" },
            { key: "email", label: "Email", type: "email" },
            { key: "phone", label: "Phone" },
            ...customFields,
          ]}
          initial={contact}
        />

        <RecordTimeline
          recordType="contact"
          recordId={contact.id}
          userId={user!.id}
          initialItems={items}
        />

        <div className="space-y-4">
          <RelatedCard title="Account">
            {account ? (
              <Link
                href={`/accounts/${account.id}`}
                className="block rounded-md px-2 py-1 text-sm text-brand hover:bg-slate-50"
              >
                {account.name}
              </Link>
            ) : (
              <Empty />
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
