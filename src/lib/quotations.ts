import type { DiscountType, QuotationStatus } from "@/lib/types";

/** Display form of the per-tenant sequential number, e.g. 7 -> "Q-00007". */
export function quoteNumber(n: number | null | undefined): string {
  if (n == null) return "Q-—";
  return `Q-${String(n).padStart(5, "0")}`;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A single editor line (strings allowed so inputs bind directly). */
export interface LineInput {
  quantity: number | string;
  unit_price: number | string;
  discount: number | string; // %
  tax_rate: number | string; // %
}

export function lineNet(l: LineInput): number {
  const qty = Number(l.quantity) || 0;
  const price = Number(l.unit_price) || 0;
  const disc = Number(l.discount) || 0;
  return qty * price * (1 - disc / 100);
}

export function lineTax(l: LineInput): number {
  return lineNet(l) * ((Number(l.tax_rate) || 0) / 100);
}

export function lineTotal(l: LineInput): number {
  return round2(lineNet(l) + lineTax(l));
}

/**
 * Recomputes header totals from lines + the header discount — identical to the
 * SQL `fn_recalc_quotation` so the live editor matches what the database stores.
 */
export function computeTotals(
  lines: LineInput[],
  discountType: DiscountType,
  discountValue: number | string
): { subtotal: number; discountAmount: number; taxAmount: number; total: number } {
  const subtotal = lines.reduce((s, l) => s + lineNet(l), 0);
  const taxAmount = lines.reduce((s, l) => s + lineTax(l), 0);
  const dv = Number(discountValue) || 0;
  const discountAmount =
    discountType === "percent"
      ? (subtotal * dv) / 100
      : discountType === "amount"
        ? Math.min(dv, subtotal)
        : 0;
  return {
    subtotal: round2(subtotal),
    discountAmount: round2(discountAmount),
    taxAmount: round2(taxAmount),
    total: round2(subtotal - discountAmount + taxAmount),
  };
}

export const QUOTE_STATUS_STYLE: Record<QuotationStatus, string> = {
  draft: "bg-slate-100 text-slate-600",
  sent: "bg-blue-100 text-blue-700",
  accepted: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  expired: "bg-amber-100 text-amber-700",
};
