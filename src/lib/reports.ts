import { LEAD_STATUSES, type ReportType } from "@/lib/types";

export interface ReportColumn {
  key: string;
  label: string;
  kind?: "text" | "number" | "currency" | "date" | "status" | "member";
  compute?: (row: Record<string, any>) => string;
}

export interface ReportFilterDef {
  key: string;
  label: string;
  type: "select" | "member";
  options?: string[];
}

export interface ReportDef {
  type: ReportType;
  label: string;
  table: string;
  select: string;
  dateField: string;
  dateLabel: string;
  ownerField: string; // used to scope Reps to their own records
  hasDeletedAt: boolean;
  baseFilter?: Record<string, string>;
  columns: ReportColumn[];
  filters: ReportFilterDef[];
  sumField?: string; // currency summary (e.g. amount)
}

const leadName = (r: Record<string, any>) =>
  `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || r.company || "(no name)";

export const REPORT_TYPES: ReportType[] = ["leads", "deals", "tasks", "activities", "sales"];

export const REPORT_DEFS: Record<ReportType, ReportDef> = {
  leads: {
    type: "leads",
    label: "Leads",
    table: "leads",
    select: "id, first_name, last_name, company, email, status, source, score, owner_id, created_at",
    dateField: "created_at",
    dateLabel: "Created",
    ownerField: "owner_id",
    hasDeletedAt: true,
    columns: [
      { key: "name", label: "Name", compute: leadName },
      { key: "company", label: "Company" },
      { key: "status", label: "Status", kind: "status" },
      { key: "source", label: "Source" },
      { key: "score", label: "Score", kind: "number" },
      { key: "owner_id", label: "Owner", kind: "member" },
      { key: "created_at", label: "Created", kind: "date" },
    ],
    filters: [
      { key: "status", label: "Status", type: "select", options: [...LEAD_STATUSES] },
      { key: "owner_id", label: "Owner", type: "member" },
    ],
  },
  deals: {
    type: "deals",
    label: "Deals",
    table: "deals",
    select: "id, name, amount, currency, status, expected_close_date, owner_id, created_at",
    dateField: "created_at",
    dateLabel: "Created",
    ownerField: "owner_id",
    hasDeletedAt: true,
    columns: [
      { key: "name", label: "Deal" },
      { key: "amount", label: "Amount", kind: "currency" },
      { key: "status", label: "Status", kind: "status" },
      { key: "expected_close_date", label: "Close date", kind: "date" },
      { key: "owner_id", label: "Owner", kind: "member" },
      { key: "created_at", label: "Created", kind: "date" },
    ],
    filters: [
      { key: "status", label: "Status", type: "select", options: ["open", "won", "lost"] },
      { key: "owner_id", label: "Owner", type: "member" },
    ],
    sumField: "amount",
  },
  tasks: {
    type: "tasks",
    label: "Tasks",
    table: "tasks",
    select: "id, title, status, priority, due_at, assignee_id, owner_id, created_at",
    dateField: "created_at",
    dateLabel: "Created",
    ownerField: "assignee_id",
    hasDeletedAt: true,
    columns: [
      { key: "title", label: "Task" },
      { key: "status", label: "Status", kind: "status" },
      { key: "priority", label: "Priority", kind: "status" },
      { key: "assignee_id", label: "Assignee", kind: "member" },
      { key: "due_at", label: "Due", kind: "date" },
      { key: "created_at", label: "Created", kind: "date" },
    ],
    filters: [
      { key: "status", label: "Status", type: "select", options: ["open", "done"] },
      { key: "priority", label: "Priority", type: "select", options: ["low", "normal", "high"] },
      { key: "assignee_id", label: "Assignee", type: "member" },
    ],
  },
  activities: {
    type: "activities",
    label: "Activities",
    table: "activities",
    select: "id, subject, type, owner_id, occurred_at",
    dateField: "occurred_at",
    dateLabel: "Occurred",
    ownerField: "owner_id",
    hasDeletedAt: false,
    columns: [
      { key: "subject", label: "Subject" },
      { key: "type", label: "Type", kind: "status" },
      { key: "owner_id", label: "Owner", kind: "member" },
      { key: "occurred_at", label: "Occurred", kind: "date" },
    ],
    filters: [
      { key: "type", label: "Type", type: "select", options: ["call", "meeting", "email"] },
      { key: "owner_id", label: "Owner", type: "member" },
    ],
  },
  sales: {
    type: "sales",
    label: "Sales (Won)",
    table: "deals",
    select: "id, name, amount, currency, owner_id, closed_at",
    dateField: "closed_at",
    dateLabel: "Closed",
    ownerField: "owner_id",
    hasDeletedAt: true,
    baseFilter: { status: "won" },
    columns: [
      { key: "name", label: "Deal" },
      { key: "amount", label: "Revenue", kind: "currency" },
      { key: "owner_id", label: "Owner", kind: "member" },
      { key: "closed_at", label: "Closed", kind: "date" },
    ],
    filters: [{ key: "owner_id", label: "Owner", type: "member" }],
    sumField: "amount",
  },
};

export function money(n: number, currency = "INR") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

function csvEscape(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(headers: string[], rows: string[][]) {
  return [headers, ...rows].map((r) => r.map((c) => csvEscape(c ?? "")).join(",")).join("\n");
}
