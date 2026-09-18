import type { SalesTaskRow } from "./crm";

export type QuotationExpiryState = "none" | "valid" | "expiring_soon" | "expired";

export const QUOTATION_EXPIRY_LABELS: Record<QuotationExpiryState, string> = {
  none: "No expiry",
  valid: "Valid",
  expiring_soon: "Expiring soon",
  expired: "Expired",
};

function mytDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kuala_Lumpur",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addCalendarDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Date-only quotation expiry classification using the Malaysia calendar day. */
export function quotationExpiryState(validUntil: string | null, now = new Date()): QuotationExpiryState {
  if (!validUntil) return "none";
  const today = mytDateKey(now);
  if (validUntil < today) return "expired";
  return validUntil <= addCalendarDays(today, 7) ? "expiring_soon" : "valid";
}

export function compareQuotationTasks(a: SalesTaskRow, b: SalesTaskRow): number {
  if (a.due_at === null && b.due_at !== null) return 1;
  if (a.due_at !== null && b.due_at === null) return -1;
  if (a.due_at !== b.due_at) return (a.due_at ?? "").localeCompare(b.due_at ?? "");
  if (a.created_at !== b.created_at) return a.created_at.localeCompare(b.created_at);
  return a.id.localeCompare(b.id);
}

export function pickNextQuotationTask(tasks: SalesTaskRow[]): SalesTaskRow | null {
  return [...tasks]
    .filter((task) => task.deleted_at === null && !["completed", "cancelled"].includes(task.status))
    .sort(compareQuotationTasks)[0] ?? null;
}

export function invoiceStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function paymentVisibilityLabel(invoiceStatus: string, paymentStatuses: string[]): string {
  if (invoiceStatus === "paid") return "Paid";
  if (invoiceStatus === "partially_paid") return "Partially paid";
  if (paymentStatuses.includes("pending")) return "ToyyibPay pending";
  if (paymentStatuses.includes("successful")) return "Payment recorded";
  if (paymentStatuses.includes("failed") || paymentStatuses.includes("cancelled")) return "Payment attempt ended";
  return "No payment yet";
}
