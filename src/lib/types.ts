export type LeadStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "unqualified"
  | "converted";

export interface Lead {
  id: string;
  tenant_id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  website: string | null;
  industry: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: LeadStatus;
  score: number;
  owner_id: string | null;
  converted_deal_id: string | null;
  created_at: string;
  custom_fields?: Record<string, string> | null;
}

export interface Profile {
  id: string;
  tenant_id: string;
  full_name: string | null;
  email: string | null;
}

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "unqualified",
  "converted",
];

export type DealStatus = "open" | "won" | "lost";

export interface Pipeline {
  id: string;
  name: string;
  is_default: boolean;
  display_order: number;
}

export interface Stage {
  id: string;
  pipeline_id: string;
  name: string;
  display_order: number;
  probability: number;
  is_won: boolean;
  is_lost: boolean;
}

export interface Deal {
  id: string;
  tenant_id: string;
  name: string;
  account_id: string | null;
  contact_id: string | null;
  pipeline_id: string;
  stage_id: string;
  amount: number;
  currency: string;
  status: DealStatus;
  probability: number;
  lost_reason: string | null;
  expected_close_date: string | null;
  closed_at: string | null;
  owner_id: string | null;
  created_at: string;
  accounts?: { name: string } | null;
  custom_fields?: Record<string, string> | null;
}

export interface Account {
  id: string;
  tenant_id: string;
  name: string;
  website: string | null;
  industry: string | null;
  phone: string | null;
  owner_id: string | null;
  created_at: string;
  custom_fields?: Record<string, string> | null;
}

export interface Contact {
  id: string;
  tenant_id: string;
  account_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
  owner_id: string | null;
  created_at: string;
  accounts?: { name: string } | null;
  custom_fields?: Record<string, string> | null;
}

export type RelatedType = "lead" | "contact" | "account" | "deal";

export type TaskStatus = "open" | "done";
export type TaskPriority = "low" | "normal" | "high";

export interface Task {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  remind_at: string | null;
  related_to_type: RelatedType | null;
  related_to_id: string | null;
  assignee_id: string | null;
  owner_id: string | null;
  created_at: string;
}

export const TASK_PRIORITIES: TaskPriority[] = ["low", "normal", "high"];

export type NotificationType = "task_assigned" | "deal_won" | "quote_accepted";

export interface Notification {
  id: string;
  tenant_id: string;
  user_id: string;
  type: NotificationType | string;
  title: string;
  body: string | null;
  link: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

/** User-configurable notification types (shown in preferences). */
export const NOTIFICATION_TYPE_META: { type: NotificationType; label: string; description: string }[] = [
  { type: "task_assigned", label: "Task assigned to me", description: "When a task is assigned to you." },
  { type: "deal_won", label: "Deal won", description: "When one of your deals is marked won." },
  { type: "quote_accepted", label: "Quotation accepted", description: "When one of your quotes is accepted." },
];

export interface NotificationPreference {
  id: string;
  tenant_id: string;
  user_id: string;
  type: string;
  in_app: boolean;
  email: boolean;
  created_at: string;
  updated_at: string;
}

// ---- Reporting (Phase 2) ----------------------------------------------------
export type ReportType = "leads" | "deals" | "tasks" | "activities" | "sales";

export interface ReportConfig {
  from?: string;
  to?: string;
  filters?: Record<string, string>;
}

export interface SavedReport {
  id: string;
  tenant_id: string;
  owner_id: string | null;
  name: string;
  report_type: ReportType;
  config: ReportConfig;
  created_at: string;
}

// ---- Products (Phase 4) -----------------------------------------------------
export type ProductStatus = "active" | "inactive" | "archived";
export const PRODUCT_STATUSES: ProductStatus[] = ["active", "inactive", "archived"];

export interface ProductCategory {
  id: string;
  tenant_id: string;
  name: string;
  created_at: string;
}

export interface Product {
  id: string;
  tenant_id: string;
  name: string;
  sku: string | null;
  description: string | null;
  category_id: string | null;
  unit_price: number;
  currency: string;
  tax_rate: number;
  status: ProductStatus;
  created_at: string;
  product_categories?: { name: string } | null;
}

// ---- Quotations (Phase 5) ---------------------------------------------------
export type QuotationStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";
export const QUOTATION_STATUSES: QuotationStatus[] = [
  "draft",
  "sent",
  "accepted",
  "rejected",
  "expired",
];

export type DiscountType = "none" | "percent" | "amount";
export const DISCOUNT_TYPES: DiscountType[] = ["none", "percent", "amount"];

export interface QuotationItem {
  id: string;
  tenant_id: string;
  quotation_id: string;
  product_id: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  discount: number; // line discount %
  tax_rate: number; // line tax %
  line_total: number; // generated column
  position: number;
  created_at: string;
}

export interface Quotation {
  id: string;
  tenant_id: string;
  quote_number: number | null;
  title: string;
  status: QuotationStatus;
  deal_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  currency: string;
  valid_until: string | null;
  discount_type: DiscountType;
  discount_value: number;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  // embedded relations (optional, depending on the query)
  accounts?: { name: string } | null;
  deals?: { name: string } | null;
  quotation_items?: QuotationItem[];
}

// ---- Invoices ---------------------------------------------------------------
export type InvoiceStatus = "draft" | "sent" | "overdue" | "cancelled";
export type PaymentStatus = "unpaid" | "partial" | "paid";

export interface InvoiceItem {
  id: string;
  tenant_id: string;
  invoice_id: string;
  product_id: string | null;
  name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  line_total: number;
  hsn_sac: string | null;
  position: number;
  created_at: string;
}

export interface Invoice {
  id: string;
  tenant_id: string;
  invoice_number: number | null;
  title: string;
  status: InvoiceStatus;
  payment_status: PaymentStatus;
  quotation_id: string | null;
  deal_id: string | null;
  account_id: string | null;
  contact_id: string | null;
  currency: string;
  invoice_date: string;
  due_date: string | null;
  discount_type: DiscountType;
  discount_value: number;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  paid_amount: number;
  customer_gstin: string | null;
  place_of_supply: string | null;
  notes: string | null;
  terms: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  accounts?: { name: string } | null;
  deals?: { name: string } | null;
  invoice_items?: InvoiceItem[];
}

// ---- Email / Communications (Phase 6) ---------------------------------------
export type CommChannel = "email" | "whatsapp" | "sms";
export type CommDirection = "outbound" | "inbound";
export type CommStatus =
  | "draft"
  | "queued"
  | "sent"
  | "failed"
  | "delivered"
  | "opened"
  | "clicked"
  | "received";

export const COMM_STATUSES: CommStatus[] = [
  "draft",
  "queued",
  "sent",
  "failed",
  "delivered",
  "opened",
  "clicked",
  "received",
];

export type CommRelatedType = "lead" | "contact" | "account" | "deal" | "quotation";

export interface EmailTemplate {
  id: string;
  tenant_id: string;
  name: string;
  channel: CommChannel;
  category: string | null;
  subject: string;
  body: string;
  is_active: boolean;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface Communication {
  id: string;
  tenant_id: string;
  channel: CommChannel;
  direction: CommDirection;
  status: CommStatus;
  to_email: string | null;
  to_phone: string | null;
  to_name: string | null;
  from_email: string | null;
  cc: string | null;
  bcc: string | null;
  subject: string | null;
  body: string | null;
  template_id: string | null;
  related_to_type: CommRelatedType | null;
  related_to_id: string | null;
  quotation_id: string | null;
  provider: string | null;
  provider_message_id: string | null;
  open_token: string;
  sent_at: string;
  opened_at: string | null;
  clicked_at: string | null;
  owner_id: string | null;
  created_at: string;
}

// ---- Integration settings (per-tenant provider config) ----------------------
export type IntegrationChannel = "email" | "whatsapp" | "sms" | "whatsapp_device";
export const INTEGRATION_CHANNELS: IntegrationChannel[] = ["email", "whatsapp", "sms", "whatsapp_device"];

/**
 * Non-secret view of a tenant's integration config. Secret columns
 * (api_key / access_token) are intentionally absent — they must never be fetched
 * client-side. Use `secret_set` / `secret_last4` to show configured status.
 */
export interface IntegrationSetting {
  id: string;
  channel: IntegrationChannel;
  is_enabled: boolean;
  from_email: string | null;
  from_name: string | null;
  phone_id: string | null;
  business_account_id: string | null;
  sms_sender_id: string | null;
  api_endpoint: string | null;
  secret_set: boolean;
  secret_last4: string | null;
  app_secret_set: boolean;
}

// ---- Meta (Facebook/Instagram) Lead Ads (0023) ------------------------------
/**
 * Non-secret view of a connected Facebook Page. The Page Access Token lives in a
 * column the browser client cannot read (service-role only), so it's absent here.
 */
export interface MetaLeadPage {
  id: string;
  page_id: string;
  page_name: string | null;
  is_enabled: boolean;
  subscribed: boolean;
  default_owner_id: string | null;
  connected_by: string | null;
  created_at: string;
  updated_at: string;
}

// ---- Calendar (Phase 8) -----------------------------------------------------
export type EventType = "meeting" | "call" | "event" | "reminder";
export const EVENT_TYPES: EventType[] = ["meeting", "call", "event", "reminder"];

export interface CalendarEvent {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  location: string | null;
  event_type: EventType;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  related_to_type: CommRelatedType | null;
  related_to_id: string | null;
  attendees: string | null;
  owner_id: string | null;
  external_provider: string | null;
  external_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TimelineItem {
  id: string;
  kind: "note" | "activity" | "task";
  text: string;
  meta?: string | null;
  at: string;
}

// ---- Custom fields (metadata-driven) ----------------------------------------
// entity_type uses the table name so it matches `EditableFields table=` and queries.
export type EntityType = "leads" | "contacts" | "accounts" | "deals";

export type CustomFieldType =
  | "text"
  | "number"
  | "date"
  | "email"
  | "url"
  | "tel"
  | "select";

export interface CustomFieldDef {
  id: string;
  entity_type: EntityType;
  field_key: string;
  label: string;
  data_type: CustomFieldType;
  options: string[] | null;
  is_required: boolean;
  display_order: number;
}

export const ENTITY_TYPES: EntityType[] = ["leads", "contacts", "accounts", "deals"];

export const CUSTOM_FIELD_TYPES: CustomFieldType[] = [
  "text",
  "number",
  "date",
  "email",
  "url",
  "tel",
  "select",
];

// ---- Workflow automation (Module 8) -----------------------------------------
export type TriggerType =
  | "record_created"
  | "record_updated"
  | "field_changed"
  | "schedule"
  | "event";
export type ConditionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "lt"
  | "contains"
  | "is_empty"
  | "changed_to";
export type ActionType =
  | "create_task"
  | "update_field"
  | "send_email"
  | "send_whatsapp"
  | "assign_owner"
  | "webhook";

export interface Workflow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  entity_type: EntityType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface WorkflowTrigger {
  id: string;
  workflow_id: string;
  trigger_type: TriggerType;
  config: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowCondition {
  id: string;
  workflow_id: string;
  group_no: number;
  field: string;
  operator: ConditionOperator;
  value: unknown;
  created_at: string;
}

export interface WorkflowAction {
  id: string;
  workflow_id: string;
  action_type: ActionType;
  config: Record<string, unknown>;
  execution_order: number;
  created_at: string;
}

export interface WorkflowRunLog {
  id: string;
  workflow_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  trigger_type: string | null;
  status: "success" | "error";
  detail: Record<string, unknown> | null;
  created_at: string;
}
