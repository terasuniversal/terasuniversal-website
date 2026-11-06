/**
 * CEO Dashboard figures: Booked, Billed, Collected (+ Refunded) and Outstanding.
 *
 * Pure functions only (no imports, no I/O) so the money rules can be tested
 * without a database. The server loader in executiveKpisLoader.ts fetches the
 * rows and calls computeExecutiveKpis().
 *
 * All values are GROSS (include SST). SST is reported separately where the
 * source row carries a tax amount (quotations and invoices). Payments carry no
 * tax split, so Collected is never split into net/SST (inventing a pro-rata
 * allocation would be an unsupported financial rule).
 *
 * Money is summed in integer cents so repeated additions never drift.
 *
 * Definitions (verified against the staging schema and RPCs):
 *   BOOKED       sales_quotations.status = 'accepted', not a test record, by
 *                accepted_at. reverse_won_opportunity() sets the accepted
 *                quotation to 'cancelled' (and the opportunity to 'cancelled'),
 *                so a reversed win drops out by status; an accepted quotation
 *                whose opportunity is cancelled/lost is also excluded as a
 *                defensive check. One accepted quotation per opportunity is
 *                enforced by a unique index; it is deduplicated here as well.
 *   BILLED       invoices.status in issued/partially_paid/paid, by issued_at.
 *                Draft and cancelled invoices are excluded. invoices.quotation_id
 *                is UNIQUE, so a quotation can never be billed twice.
 *   COLLECTED    invoice_payments.status = 'successful', by
 *                coalesce(paid_at, verified_at, created_at). Toyyibpay rows use
 *                verified_amount (matches app.recompute_invoice_balance), other
 *                providers use amount. HRDF payments are rows of
 *                invoice_payments (payment_source = 'hrdf'), counted once here;
 *                hrdf_claims is never read, so there is no second count.
 *   REFUNDED     payments with status 'refunded', same amount and date rules,
 *                reported separately and never added to Collected. There is no
 *                refund timestamp or partial-refund model, so this is "refunds
 *                of payments received in the period".
 *   OUTSTANDING  sum of balance_due on non-test issued/partially_paid/paid
 *                invoices where balance_due > 0, as a CURRENT balance (not
 *                period-based). A refund of the last payment leaves the stored
 *                status label unchanged ("paid") while balance_due is restored,
 *                so balance_due, not the label, decides; those rows are counted
 *                as stale-status invoices and still included.
 */

export interface PeriodBounds {
  /** Inclusive UTC instant. */
  startUtc: string;
  /** Exclusive UTC instant. */
  endUtc: string;
}

export const BILLABLE_INVOICE_STATUSES = ["issued", "partially_paid", "paid"] as const;

const MYT_OFFSET_MS = 8 * 60 * 60 * 1000;

export interface BookedQuotationRow {
  id: string;
  opportunity_id: string;
  status: string;
  total: unknown;
  tax: unknown;
  accepted_at: string | null;
  is_test: boolean;
  opportunity: { stage: string; is_test: boolean } | null;
}

export interface BillableInvoiceRow {
  id: string;
  status: string;
  grand_total: unknown;
  tax_amount: unknown;
  balance_due: unknown;
  issued_at: string | null;
  due_date: string | null;
  quotation: { is_test: boolean } | null;
}

export interface PaymentRow {
  id: string;
  invoice_id: string;
  status: string;
  payment_provider: string;
  amount: unknown;
  verified_amount: unknown;
  payment_source: string | null;
  paid_at: string | null;
  verified_at: string | null;
  created_at: string;
  invoice: { status: string; quotation: { is_test: boolean } | null } | null;
}

export interface ExecutiveKpis {
  period: PeriodBounds;
  /** Malaysia calendar date (YYYY-MM-DD) used as "today" for the overdue split. */
  asOfDate: string;
  booked: { grossCents: number; sstCents: number; count: number };
  billed: { grossCents: number; sstCents: number; count: number };
  collected: { grossCents: number; count: number; hrdfCents: number; hrdfCount: number };
  refunded: { cents: number; count: number };
  outstanding: {
    balanceCents: number;
    count: number;
    overdueCents: number;
    overdueCount: number;
    notYetDueCents: number;
    notYetDueCount: number;
  };
  /** Rows the figures could not safely use. Shown to the CEO, never silently dropped. */
  dataQuality: {
    bookedExcludedReversedOrLost: number;
    bookedUnlinked: number;
    billedUnlinked: number;
    collectedUnlinked: number;
    unverifiedToyyibpay: number;
    staleStatusInvoices: number;
    staleStatusCents: number;
  };
}

/** Cents from a numeric column (number or numeric string). null when not a finite number. */
export function toCents(value: unknown): number | null {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function inPeriod(iso: string | null | undefined, period: PeriodBounds): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= Date.parse(period.startUtc) && t < Date.parse(period.endUtc);
}

/** Malaysia calendar date for an instant, as YYYY-MM-DD. */
export function mytDateKey(now: Date): string {
  return new Date(now.getTime() + MYT_OFFSET_MS).toISOString().slice(0, 10);
}

function isBillable(status: string): boolean {
  return (BILLABLE_INVOICE_STATUSES as readonly string[]).includes(status);
}

export function computeBooked(rows: readonly BookedQuotationRow[], period: PeriodBounds) {
  const out = { grossCents: 0, sstCents: 0, count: 0, excludedReversedOrLost: 0, unlinked: 0 };
  // One commitment per opportunity: keep the latest accepted quotation.
  const byOpportunity = new Map<string, BookedQuotationRow>();
  for (const q of rows) {
    if (q.status !== "accepted" || q.is_test || !inPeriod(q.accepted_at, period)) continue;
    if (!q.opportunity) {
      out.unlinked += 1;
      continue;
    }
    if (q.opportunity.is_test) continue;
    if (q.opportunity.stage === "cancelled" || q.opportunity.stage === "lost") {
      out.excludedReversedOrLost += 1;
      continue;
    }
    const current = byOpportunity.get(q.opportunity_id);
    if (!current || Date.parse(q.accepted_at as string) > Date.parse(current.accepted_at as string)) byOpportunity.set(q.opportunity_id, q);
  }
  for (const q of byOpportunity.values()) {
    const gross = toCents(q.total);
    if (gross === null) continue;
    out.grossCents += gross;
    out.sstCents += toCents(q.tax) ?? 0;
    out.count += 1;
  }
  return out;
}

export function computeBilled(rows: readonly BillableInvoiceRow[], period: PeriodBounds) {
  const out = { grossCents: 0, sstCents: 0, count: 0, unlinked: 0 };
  const seen = new Set<string>();
  for (const inv of rows) {
    if (seen.has(inv.id)) continue;
    seen.add(inv.id);
    if (!isBillable(inv.status) || !inPeriod(inv.issued_at, period)) continue;
    if (!inv.quotation) {
      out.unlinked += 1;
      continue;
    }
    if (inv.quotation.is_test) continue;
    const gross = toCents(inv.grand_total);
    if (gross === null) continue;
    out.grossCents += gross;
    out.sstCents += toCents(inv.tax_amount) ?? 0;
    out.count += 1;
  }
  return out;
}

export function computeCollected(rows: readonly PaymentRow[], period: PeriodBounds) {
  const out = {
    collectedCents: 0,
    collectedCount: 0,
    hrdfCents: 0,
    hrdfCount: 0,
    refundedCents: 0,
    refundedCount: 0,
    unlinked: 0,
    unverifiedToyyibpay: 0,
  };
  const seen = new Set<string>();
  for (const p of rows) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    if (p.status !== "successful" && p.status !== "refunded") continue;
    if (!inPeriod(p.paid_at ?? p.verified_at ?? p.created_at, period)) continue;
    if (!p.invoice || !p.invoice.quotation) {
      out.unlinked += 1;
      continue;
    }
    if (p.invoice.quotation.is_test || !isBillable(p.invoice.status)) continue;
    const cents = p.payment_provider === "toyyibpay" ? toCents(p.verified_amount) : toCents(p.amount);
    if (cents === null || cents <= 0) {
      if (p.payment_provider === "toyyibpay") out.unverifiedToyyibpay += 1;
      continue;
    }
    if (p.status === "refunded") {
      out.refundedCents += cents;
      out.refundedCount += 1;
      continue;
    }
    out.collectedCents += cents;
    out.collectedCount += 1;
    if (p.payment_source === "hrdf") {
      out.hrdfCents += cents;
      out.hrdfCount += 1;
    }
  }
  return out;
}

export function computeOutstanding(rows: readonly BillableInvoiceRow[], asOfDate: string) {
  const out = {
    balanceCents: 0,
    count: 0,
    overdueCents: 0,
    overdueCount: 0,
    notYetDueCents: 0,
    notYetDueCount: 0,
    staleStatusInvoices: 0,
    staleStatusCents: 0,
    unlinked: 0,
  };
  const seen = new Set<string>();
  for (const inv of rows) {
    if (seen.has(inv.id)) continue;
    seen.add(inv.id);
    if (!isBillable(inv.status)) continue;
    if (!inv.quotation) {
      out.unlinked += 1;
      continue;
    }
    if (inv.quotation.is_test) continue;
    const balance = toCents(inv.balance_due);
    if (balance === null || balance <= 0) continue;
    out.balanceCents += balance;
    out.count += 1;
    // due_date is a plain calendar date; comparing YYYY-MM-DD strings is a valid date order.
    if (inv.due_date && inv.due_date < asOfDate) {
      out.overdueCents += balance;
      out.overdueCount += 1;
    } else {
      out.notYetDueCents += balance;
      out.notYetDueCount += 1;
    }
    if (inv.status === "paid") {
      out.staleStatusInvoices += 1;
      out.staleStatusCents += balance;
    }
  }
  return out;
}

export function computeExecutiveKpis(input: {
  period: PeriodBounds;
  /** Accepted quotations (any period; filtered here). */
  quotations: readonly BookedQuotationRow[];
  /** Billable invoices (any period; filtered here for Billed). */
  billedInvoices: readonly BillableInvoiceRow[];
  /** Billable invoices with balance_due > 0 (current balance; period ignored). */
  openInvoices: readonly BillableInvoiceRow[];
  payments: readonly PaymentRow[];
  now: Date;
}): ExecutiveKpis {
  const asOfDate = mytDateKey(input.now);
  const booked = computeBooked(input.quotations, input.period);
  const billed = computeBilled(input.billedInvoices, input.period);
  const paid = computeCollected(input.payments, input.period);
  const open = computeOutstanding(input.openInvoices, asOfDate);
  return {
    period: input.period,
    asOfDate,
    booked: { grossCents: booked.grossCents, sstCents: booked.sstCents, count: booked.count },
    billed: { grossCents: billed.grossCents, sstCents: billed.sstCents, count: billed.count },
    collected: { grossCents: paid.collectedCents, count: paid.collectedCount, hrdfCents: paid.hrdfCents, hrdfCount: paid.hrdfCount },
    refunded: { cents: paid.refundedCents, count: paid.refundedCount },
    outstanding: {
      balanceCents: open.balanceCents,
      count: open.count,
      overdueCents: open.overdueCents,
      overdueCount: open.overdueCount,
      notYetDueCents: open.notYetDueCents,
      notYetDueCount: open.notYetDueCount,
    },
    dataQuality: {
      bookedExcludedReversedOrLost: booked.excludedReversedOrLost,
      bookedUnlinked: booked.unlinked,
      billedUnlinked: billed.unlinked + open.unlinked,
      collectedUnlinked: paid.unlinked,
      unverifiedToyyibpay: paid.unverifiedToyyibpay,
      staleStatusInvoices: open.staleStatusInvoices,
      staleStatusCents: open.staleStatusCents,
    },
  };
}

export function formatRm(cents: number): string {
  return `RM ${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
