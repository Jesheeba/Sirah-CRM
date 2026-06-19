import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import EditableFields from "@/components/record/EditableFields";
import RecordTimeline from "@/components/record/RecordTimeline";
import DealStageBar from "@/components/deals/DealStageBar";
import NewQuotationButton from "@/components/quotations/NewQuotationButton";
import { customFieldDefsFor } from "@/lib/customFields";
import { money } from "@/lib/reports";
import { quoteNumber, QUOTE_STATUS_STYLE } from "@/lib/quotations";
import type { DealStatus, Quotation, Stage, TimelineItem } from "@/lib/types";

function RelatedCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-sm font-semibold text-slate-700">{title}</h3>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

const Empty = () => <p className="px-2 py-1 text-sm text-slate-400">None.</p>;

export default async function DealDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: deal } = await supabase
    .from("deals")
    .select("*, accounts(id, name), contacts(id, first_name, last_name)")
    .eq("id", id)
    .maybeSingle();
  if (!deal) notFound();

  const [stagesRes, notesRes, actsRes, tasksRes, quotesRes] = await Promise.all([
    supabase.from("stages").select("*").eq("pipeline_id", deal.pipeline_id).order("display_order"),
    supabase
      .from("notes")
      .select("id, body, created_at")
      .eq("related_to_type", "deal")
      .eq("related_to_id", id),
    supabase
      .from("activities")
      .select("id, subject, type, occurred_at")
      .eq("related_to_type", "deal")
      .eq("related_to_id", id),
    supabase
      .from("tasks")
      .select("id, title, status, created_at")
      .eq("related_to_type", "deal")
      .eq("related_to_id", id)
      .is("deleted_at", null),
    supabase
      .from("quotations")
      .select("id, quote_number, title, status, total, currency")
      .eq("deal_id", id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);
  const quotes = (quotesRes.data ?? []) as Quotation[];

  const items: TimelineItem[] = [
    ...((notesRes.data ?? []) as any[]).map((n) => ({
      id: n.id, kind: "note" as const, text: n.body, at: n.created_at,
    })),
    ...((actsRes.data ?? []) as any[]).map((a) => ({
      id: a.id, kind: "activity" as const, text: a.subject ?? a.type, meta: a.type, at: a.occurred_at,
    })),
    ...((tasksRes.data ?? []) as any[]).map((t) => ({
      id: t.id, kind: "task" as const, text: t.title, meta: t.status, at: t.created_at,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const account = deal.accounts as { id: string; name: string } | null;
  const contact = deal.contacts as {
    id: string;
    first_name: string | null;
    last_name: string | null;
  } | null;
  const contactName = contact
    ? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim() || "(no name)"
    : null;
  const customFields = await customFieldDefsFor(supabase, "deals");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link href="/deals" className="hover:underline">Deals</Link>
        <span>/</span>
        <span className="font-medium text-slate-700">{deal.name}</span>
      </div>
      <h1 className="text-xl font-bold text-slate-800">{deal.name}</h1>

      <DealStageBar
        dealId={deal.id}
        stages={(stagesRes.data ?? []) as Stage[]}
        currentStageId={deal.stage_id}
        currentStatus={deal.status as DealStatus}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr_18rem]">
        <EditableFields
          table="deals"
          id={deal.id}
          fields={[
            { key: "name", label: "Name" },
            { key: "amount", label: "Amount", type: "number" },
            { key: "expected_close_date", label: "Close date", type: "date" },
            ...customFields,
          ]}
          initial={deal}
        />

        <RecordTimeline
          recordType="deal"
          recordId={deal.id}
          userId={user!.id}
          initialItems={items}
        />

        <div className="space-y-4">
          <RelatedCard title="Related">
            {account ? (
              <Link
                href={`/accounts/${account.id}`}
                className="block rounded-md px-2 py-1 text-sm text-brand hover:bg-slate-50"
              >
                🏢 {account.name}
              </Link>
            ) : null}
            {contact ? (
              <Link
                href={`/contacts/${contact.id}`}
                className="block rounded-md px-2 py-1 text-sm text-brand hover:bg-slate-50"
              >
                👤 {contactName}
              </Link>
            ) : null}
            {!account && !contact && <Empty />}
          </RelatedCard>

          <RelatedCard title="Quotations">
            {quotes.length === 0 && <Empty />}
            {quotes.map((qt) => (
              <Link
                key={qt.id}
                href={`/quotations/${qt.id}`}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50"
              >
                <span className="truncate text-brand">
                  <span className="font-mono text-xs text-slate-400">{quoteNumber(qt.quote_number)}</span>{" "}
                  {qt.title}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs capitalize ${QUOTE_STATUS_STYLE[qt.status]}`}>
                  {qt.status}
                </span>
              </Link>
            ))}
            {quotes.length > 0 && (
              <div className="px-2 pt-1 text-xs text-slate-400">
                Total quoted:{" "}
                {money(
                  quotes.reduce((s, qt) => s + Number(qt.total), 0),
                  quotes[0]?.currency ?? deal.currency
                )}
              </div>
            )}
            <div className="pt-2">
              <NewQuotationButton
                dealId={deal.id}
                accountId={deal.account_id}
                contactId={deal.contact_id}
                defaultTitle={deal.name}
                label="+ Create quotation"
                className="w-full rounded-lg border border-brand px-3 py-2 text-center text-sm font-medium text-brand hover:bg-brand-50"
              />
            </div>
          </RelatedCard>

          <RelatedCard title="Facts">
            <div className="px-2 py-1 text-sm text-slate-600">
              Currency: <span className="font-medium text-slate-800">{deal.currency}</span>
            </div>
          </RelatedCard>
        </div>
      </div>
    </div>
  );
}
