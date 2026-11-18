import type { SupabaseClient } from "@supabase/supabase-js";
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

export const QUOTATION_EXPIRED_ACCEPT_MESSAGE =
  "This quotation has expired and cannot be accepted. Create a revision, update its validity date, and send it to the client again.";

/**
 * Application-layer acceptance gate (Slice 1). It uses the same Malaysia calendar-day
 * rule as the Expired label, so the screen and the Server Action always agree. The
 * accept_quotation RPC does not check expiry yet, so this is not full backend
 * enforcement: a direct RPC call by an admin is still outside this gate.
 */
export function quotationAcceptExpiryBlock(validUntil: string | null, now = new Date()): string | null {
  return quotationExpiryState(validUntil, now) === "expired" ? QUOTATION_EXPIRED_ACCEPT_MESSAGE : null;
}

export type QuotationAcceptResult =
  | { ok: true; opportunityId: string | null }
  | { ok: false; message: string };

export const QUOTATION_ACCEPT_READ_ERROR_MESSAGE =
  "The quotation could not be loaded to confirm its validity. Reload the page and try again.";
export const QUOTATION_ACCEPT_NOT_FOUND_MESSAGE =
  "This quotation could not be found. Reload the page and try again.";

/**
 * Acceptance after the caller's role and module guards have passed. Every path that
 * cannot confirm the quotation is unexpired stops before the RPC: a failed read, a
 * missing row (which also covers a row RLS hides from this user while the
 * SECURITY DEFINER RPC could still see it), and an expired validity date.
 */
export async function runQuotationAccept(supabase: SupabaseClient, quotationId: string, now = new Date()): Promise<QuotationAcceptResult> {
  const { data: existing, error: readError } = await supabase
    .from("sales_quotations")
    .select("opportunity_id, valid_until")
    .eq("id", quotationId)
    .maybeSingle();
  if (readError) return { ok: false, message: QUOTATION_ACCEPT_READ_ERROR_MESSAGE };
  if (!existing) return { ok: false, message: QUOTATION_ACCEPT_NOT_FOUND_MESSAGE };

  const row = existing as { opportunity_id: string | null; valid_until: string | null };
  const expiryBlock = quotationAcceptExpiryBlock(row.valid_until, now);
  if (expiryBlock) return { ok: false, message: expiryBlock };

  const { error } = await supabase.rpc("accept_quotation", { p_quotation_id: quotationId });
  if (error) return { ok: false, message: error.message };
  return { ok: true, opportunityId: row.opportunity_id };
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
