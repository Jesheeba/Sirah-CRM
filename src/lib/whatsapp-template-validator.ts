// Pure, framework-agnostic validation for WhatsApp Business message templates.
// Runs both client-side (instant feedback in the create form) and server-side
// (defense in depth before we ever call Meta) — no DB or network access here.
// Duplicate name+language is checked separately (needs a DB query), see actions.ts.

export type TemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export const TEMPLATE_CATEGORIES: Array<{
  value: TemplateCategory;
  label: string;
  costNote: string;
}> = [
  {
    value: "UTILITY",
    label: "Utility",
    costNote: "Cheapest per-message rate — transactional updates the customer expects (order status, appointment reminders, account alerts).",
  },
  {
    value: "MARKETING",
    label: "Marketing",
    costNote: "Highest per-message rate — promotions and proactive outreach. Requires the recipient to have opted in.",
  },
  {
    value: "AUTHENTICATION",
    label: "Authentication",
    costNote: "Flat, low per-message rate — one-time passcodes only. Meta enforces a fixed OTP-style layout.",
  },
];

export interface TemplateButton {
  type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
  text: string;
  url?: string;
  phone_number?: string;
  example?: string[];
}

export interface TemplateHeaderComponent {
  type: "HEADER";
  format: "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  text?: string;
  example?: { header_text?: string[]; header_handle?: string[] };
}

export interface TemplateBodyComponent {
  type: "BODY";
  text: string;
  example?: { body_text?: string[][] };
}

export interface TemplateFooterComponent {
  type: "FOOTER";
  text: string;
}

export interface TemplateButtonsComponent {
  type: "BUTTONS";
  buttons: TemplateButton[];
}

export type TemplateComponent =
  | TemplateHeaderComponent
  | TemplateBodyComponent
  | TemplateFooterComponent
  | TemplateButtonsComponent;

export interface TemplateInput {
  name: string;
  language: string;
  category: TemplateCategory | "";
  components: TemplateComponent[];
}

const NAME_RE = /^[a-z0-9_]+$/;
const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;

/** Variable indices referenced in `text`, in the order Meta expects ({{1}}, {{2}}, …). */
export function extractVariables(text: string): number[] {
  const nums = new Set<number>();
  for (const m of text.matchAll(VAR_RE)) nums.add(Number(m[1]));
  return [...nums].sort((a, b) => a - b);
}

function isSequentialFromOne(nums: number[]): boolean {
  if (nums.length === 0) return true;
  return nums.every((n, i) => n === i + 1);
}

function startsOrEndsWithVariable(text: string): boolean {
  const trimmed = text.trim();
  return /^\{\{\s*\d+\s*\}\}/.test(trimmed) || /\{\{\s*\d+\s*\}\}$/.test(trimmed);
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Client-side-blockable validation rules — everything Meta would reject anyway,
 *  checked before we burn a submission attempt. Duplicate name+language is NOT
 *  checked here (needs the tenant's existing rows — see checkDuplicate in actions.ts). */
export function validateTemplate(input: TemplateInput): ValidationResult {
  const errors: string[] = [];

  if (!input.name.trim()) {
    errors.push("Template name is required.");
  } else if (!NAME_RE.test(input.name)) {
    errors.push("Template name may only contain lowercase letters, numbers, and underscores.");
  }

  if (!input.language.trim()) errors.push("Language is required.");
  if (!input.category) errors.push("Category is required.");

  const body = input.components.find((c): c is TemplateBodyComponent => c.type === "BODY");
  if (!body || !body.text.trim()) {
    errors.push("Body text is required.");
  } else {
    if (startsOrEndsWithVariable(body.text)) {
      errors.push("Body text cannot start or end with a variable — Meta rejects this automatically.");
    }
    const vars = extractVariables(body.text);
    if (!isSequentialFromOne(vars)) {
      errors.push("Body variables must be sequential starting at {{1}} with no gaps (e.g. {{1}}, {{2}}, {{3}}).");
    }
    if (vars.length > 0) {
      const examples = body.example?.body_text?.[0] ?? [];
      const missing = vars.some((_, i) => !examples[i]?.trim());
      if (examples.length < vars.length || missing) {
        errors.push("Every body variable needs an example value.");
      }
    }
  }

  const header = input.components.find((c): c is TemplateHeaderComponent => c.type === "HEADER");
  if (header?.format === "TEXT" && header.text) {
    const vars = extractVariables(header.text);
    if (vars.length > 1) {
      errors.push("Header text supports at most one variable.");
    } else if (vars.length === 1) {
      const example = header.example?.header_text?.[0];
      if (!example?.trim()) errors.push("The header variable needs an example value.");
    }
  }

  for (const btn of input.components.find((c): c is TemplateButtonsComponent => c.type === "BUTTONS")?.buttons ?? []) {
    if (!btn.text.trim()) errors.push("Every button needs label text.");
    if (btn.type === "URL") {
      if (!btn.url?.trim()) errors.push("URL buttons need a URL.");
      else {
        const vars = extractVariables(btn.url);
        if (vars.length > 1) errors.push("URL buttons support at most one variable.");
        else if (vars.length === 1 && !btn.example?.[0]?.trim()) {
          errors.push("The URL button variable needs an example value.");
        }
      }
    }
    if (btn.type === "PHONE_NUMBER" && !btn.phone_number?.trim()) {
      errors.push("Phone number buttons need a phone number.");
    }
  }

  return { valid: errors.length === 0, errors };
}
