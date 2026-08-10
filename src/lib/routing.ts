import type { RoutingStrategy } from "@/lib/types";
import { CONDITION_OPERATORS, OPERATOR_LABELS } from "@/lib/workflows";

export { CONDITION_OPERATORS, OPERATOR_LABELS };

/**
 * Plain lead columns a routing condition can match on. Anything tenant-specific
 * (e.g. a "City" field for territory routing) goes through `custom_fields.<key>`
 * instead — the routing engine reads that path directly (see fn_route_lead, 0041),
 * matching this app's convention of never adding ad-hoc columns for tenant-specific
 * fields. The custom-fields options are appended by the caller (which has access to
 * the tenant's custom field definitions for the leads entity).
 */
export const ROUTING_LEAD_FIELDS: { key: string; label: string }[] = [
  { key: "source", label: "Source" },
  { key: "company", label: "Company" },
  { key: "industry", label: "Industry" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "score", label: "Score" },
];

/** Same field-picker convention, for the Contacts entity (used by Campaign segments). */
export const CONTACT_FIELDS: { key: string; label: string }[] = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "title", label: "Title" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
];

export const ROUTING_STRATEGIES: RoutingStrategy[] = ["round_robin", "load", "specific"];

export const ROUTING_STRATEGY_LABELS: Record<RoutingStrategy, string> = {
  round_robin: "Round robin (rotate evenly)",
  load: "Least loaded (fewest open leads)",
  specific: "Specific rep (first user in the list)",
};
