import type {
  ActionType,
  ConditionOperator,
  EntityType,
  TriggerType,
} from "@/lib/types";

/**
 * Valid columns per entity for conditions + update_field actions. Drives every
 * dropdown so the builder stays metadata-driven and can't reference a column
 * that doesn't exist (the DB engine also allow-lists the field name).
 */
export const ENTITY_FIELDS: Record<EntityType, { key: string; label: string }[]> = {
  leads: [
    { key: "status", label: "Status" },
    { key: "score", label: "Score" },
    { key: "source", label: "Source" },
    { key: "company", label: "Company" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "owner_id", label: "Owner (user id)" },
  ],
  contacts: [
    { key: "title", label: "Title" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "account_id", label: "Account (id)" },
    { key: "owner_id", label: "Owner (user id)" },
  ],
  accounts: [
    { key: "name", label: "Name" },
    { key: "industry", label: "Industry" },
    { key: "website", label: "Website" },
    { key: "phone", label: "Phone" },
    { key: "owner_id", label: "Owner (user id)" },
  ],
  deals: [
    { key: "status", label: "Status" },
    { key: "amount", label: "Amount" },
    { key: "currency", label: "Currency" },
    { key: "stage_id", label: "Stage (id)" },
    { key: "expected_close_date", label: "Expected close date" },
    { key: "owner_id", label: "Owner (user id)" },
  ],
};

export const TRIGGER_TYPES: TriggerType[] = [
  "record_created",
  "record_updated",
  "field_changed",
];

export const CONDITION_OPERATORS: ConditionOperator[] = [
  "eq",
  "neq",
  "gt",
  "lt",
  "contains",
  "is_empty",
  "changed_to",
];

export const ACTION_TYPES: ActionType[] = ["create_task", "update_field"];

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  record_created: "Record created",
  record_updated: "Record updated",
  field_changed: "Field changed",
};

export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  eq: "equals",
  neq: "not equals",
  gt: "greater than",
  lt: "less than",
  contains: "contains",
  is_empty: "is empty",
  changed_to: "changed to",
};

export const ACTION_LABELS: Record<ActionType, string> = {
  create_task: "Create task",
  update_field: "Update field",
};

export const ENTITY_LABEL: Record<EntityType, string> = {
  leads: "Leads",
  contacts: "Contacts",
  accounts: "Accounts",
  deals: "Deals",
};
