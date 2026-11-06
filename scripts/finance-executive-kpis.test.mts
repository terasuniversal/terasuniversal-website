import assert from "node:assert/strict";
import {
  computeBooked,
  computeBilled,
  computeCollected,
  computeOutstanding,
  computeExecutiveKpis,
  formatRm,
  mytDateKey,
  toCents,
  type BillableInvoiceRow,
  type BookedQuotationRow,
  type PaymentRow,
} from "../lib/finance/executiveKpis.ts";

// Fixture-only checks of the CEO Dashboard money rules. No database, no live data.

// Period: November 2026 in Malaysia time = [2026-10-31T16:00Z, 2026-11-30T16:00Z).
const period = { startUtc: "2026-10-31T16:00:00.000Z", endUtc: "2026-11-30T16:00:00.000Z" };
const IN = "2026-11-10T04:00:00.000Z";

const quote = (o: Partial<BookedQuotationRow> & { id: string }): BookedQuotationRow => ({
  opportunity_id: `opp-${o.id}`,
  status: "accepted",
  total: 1000,
  tax: 0,
  accepted_at: IN,
  is_test: false,
  opportunity: { stage: "won", is_test: false },
  ...o,
});
const invoice = (o: Partial<BillableInvoiceRow> & { id: string }): BillableInvoiceRow => ({
  status: "issued",
  grand_total: 1000,
  tax_amount: 0,
  balance_due: 1000,
  issued_at: IN,
  due_date: "2026-12-15",
  quotation: { is_test: false },
  ...o,
});
const payment = (o: Partial<PaymentRow> & { id: string }): PaymentRow => ({
  invoice_id: "inv-1",
  status: "successful",
  payment_provider: "cash",
  amount: 500,
  verified_amount: null,
  payment_source: null,
  paid_at: IN,
  verified_at: null,
  created_at: IN,
  invoice: { status: "partially_paid", quotation: { is_test: false } },
  ...o,
});

// 0. Cents conversion is exact and rejects non-numbers.
assert.equal(toCents(1200), 120000);
assert.equal(toCents("1200.50"), 120050);
assert.equal(toCents(0.1 + 0.2), 30, "float noise is rounded away");
assert.equal(toCents(null), null);
assert.equal(toCents("abc"), null);
assert.equal(toCents(Number.NaN), null);
assert.equal(formatRm(123456), "RM 1,234.56");

// 1. BOOKED
{
  const rows = [
    quote({ id: "a", total: 1000, tax: 60 }),
    quote({ id: "superseded", status: "superseded" }),
    quote({ id: "cancelled", status: "cancelled" }),
    quote({ id: "draft", status: "draft" }),
    quote({ id: "test", is_test: true }),
    quote({ id: "oppTest", opportunity: { stage: "won", is_test: true } }),
    quote({ id: "reversed", opportunity: { stage: "cancelled", is_test: false } }),
    quote({ id: "lost", opportunity: { stage: "lost", is_test: false } }),
    quote({ id: "unlinked", opportunity: null }),
    quote({ id: "outside", accepted_at: "2026-10-31T15:59:59.999Z" }),
    quote({ id: "atEnd", accepted_at: "2026-11-30T16:00:00.000Z" }),
    quote({ id: "archivedWon", opportunity: { stage: "archived", is_test: false }, total: 250 }),
  ];
  const b = computeBooked(rows, period);
  assert.equal(b.grossCents, 125000, "only the valid accepted quotations are booked (archived real Won keeps its history)");
  assert.equal(b.count, 2);
  assert.equal(b.sstCents, 6000, "SST is reported separately");
  assert.equal(b.excludedReversedOrLost, 2, "reversed and lost are surfaced, not silently dropped");
  assert.equal(b.unlinked, 1);

  // One commitment per opportunity even if two accepted rows appear (defence in depth).
  const dup = computeBooked(
    [quote({ id: "r0", opportunity_id: "same", total: 900, accepted_at: "2026-11-02T04:00:00.000Z" }), quote({ id: "r1", opportunity_id: "same", total: 1000, accepted_at: "2026-11-05T04:00:00.000Z" })],
    period,
  );
  assert.equal(dup.grossCents, 100000);
  assert.equal(dup.count, 1);
}

// 2. BILLED
{
  const rows = [
    invoice({ id: "i1", grand_total: 1000, tax_amount: 60 }),
    invoice({ id: "i2", status: "partially_paid", grand_total: 500, balance_due: 200 }),
    invoice({ id: "i3", status: "paid", grand_total: 700, balance_due: 0 }),
    invoice({ id: "draft", status: "draft" }),
    invoice({ id: "cancelled", status: "cancelled" }),
    invoice({ id: "test", quotation: { is_test: true } }),
    invoice({ id: "unlinked", quotation: null }),
    invoice({ id: "noIssued", issued_at: null }),
    invoice({ id: "outside", issued_at: "2026-12-01T00:00:00.000Z" }),
    invoice({ id: "i1", grand_total: 1000 }), // duplicate row for the same invoice
  ];
  const b = computeBilled(rows, period);
  assert.equal(b.grossCents, 220000, "issued, partially paid and paid are billed once each");
  assert.equal(b.count, 3);
  assert.equal(b.sstCents, 6000);
  assert.equal(b.unlinked, 1);
}

// 3. COLLECTED (+ refunded, HRDF, retries)
{
  const rows = [
    payment({ id: "cash", amount: 500 }),
    payment({ id: "bank", payment_provider: "bank_transfer", amount: 300.25 }),
    payment({ id: "toy", payment_provider: "toyyibpay", amount: 999, verified_amount: 400 }),
    payment({ id: "toyUnverified", payment_provider: "toyyibpay", amount: 800, verified_amount: null }),
    payment({ id: "hrdf", payment_source: "hrdf", amount: 1000 }),
    payment({ id: "refunded", status: "refunded", amount: 200 }),
    payment({ id: "failed", status: "failed" }),
    payment({ id: "pending", status: "pending" }),
    payment({ id: "superseded", status: "superseded" }),
    payment({ id: "cancelled", status: "cancelled" }),
    payment({ id: "test", invoice: { status: "paid", quotation: { is_test: true } } }),
    payment({ id: "draftInvoice", invoice: { status: "draft", quotation: { is_test: false } } }),
    payment({ id: "unlinked", invoice: null }),
    payment({ id: "cash", amount: 500 }), // duplicate callback/row for the same payment id
    payment({ id: "verifiedOnly", paid_at: null, verified_at: IN, amount: 100 }),
    payment({ id: "createdOnly", paid_at: null, verified_at: null, created_at: IN, amount: 50 }),
    payment({ id: "outsideByPaidAt", paid_at: "2026-12-05T00:00:00.000Z", created_at: IN }),
  ];
  const c = computeCollected(rows, period);
  // cash 500 + bank 300.25 + toy 400 + hrdf 1000 + verifiedOnly 100 + createdOnly 50
  assert.equal(c.collectedCents, 235025);
  assert.equal(c.collectedCount, 6);
  assert.equal(c.hrdfCents, 100000, "HRDF is a subset of Collected, counted once");
  assert.equal(c.hrdfCount, 1);
  assert.equal(c.refundedCents, 20000, "refunds are reported separately");
  assert.equal(c.refundedCount, 1);
  assert.equal(c.unverifiedToyyibpay, 1, "an unverified Toyyibpay amount is never counted");
  assert.equal(c.unlinked, 1);
}

// 4. OUTSTANDING (current balance, partials, stale paid status)
{
  const rows = [
    invoice({ id: "o1", status: "issued", balance_due: 1000, due_date: "2026-12-15" }),
    invoice({ id: "o2", status: "partially_paid", balance_due: 300.5, due_date: "2026-10-01" }),
    invoice({ id: "o3", status: "paid", balance_due: 0 }),
    invoice({ id: "stale", status: "paid", balance_due: 700, due_date: "2026-11-20" }),
    invoice({ id: "cancelled", status: "cancelled", balance_due: 999 }),
    invoice({ id: "draft", status: "draft", balance_due: 999 }),
    invoice({ id: "test", balance_due: 999, quotation: { is_test: true } }),
    invoice({ id: "unlinked", balance_due: 999, quotation: null }),
    invoice({ id: "o1", status: "issued", balance_due: 1000 }), // duplicate
  ];
  const o = computeOutstanding(rows, "2026-11-25");
  assert.equal(o.balanceCents, 100000 + 30050 + 70000);
  assert.equal(o.count, 3);
  assert.equal(o.overdueCents, 100050, "past due_date is overdue (o2 300.50 + stale 700.00, Malaysia date)");
  assert.equal(o.overdueCount, 2);
  assert.equal(o.notYetDueCents, 100000);
  assert.equal(o.staleStatusInvoices, 1, "a Paid label with a balance is surfaced");
  assert.equal(o.staleStatusCents, 70000);
  assert.equal(o.unlinked, 1);
  // Due today is not overdue.
  const today = computeOutstanding([invoice({ id: "t", balance_due: 10, due_date: "2026-11-25" })], "2026-11-25");
  assert.equal(today.overdueCount, 0);
}

// 5. Malaysia timezone boundaries
{
  assert.equal(mytDateKey(new Date("2026-11-25T15:59:59.000Z")), "2026-11-25");
  assert.equal(mytDateKey(new Date("2026-11-25T16:00:00.000Z")), "2026-11-26", "16:00Z is midnight in Malaysia");
  const first = computeBooked([quote({ id: "first", accepted_at: "2026-10-31T16:00:00.000Z" })], period);
  assert.equal(first.count, 1, "start instant is inclusive (1 Nov 00:00 MYT)");
  const last = computeBooked([quote({ id: "last", accepted_at: "2026-11-30T15:59:59.999Z" })], period);
  assert.equal(last.count, 1, "30 Nov 23:59:59 MYT is inside November");
  const next = computeBooked([quote({ id: "next", accepted_at: "2026-11-30T16:00:00.000Z" })], period);
  assert.equal(next.count, 0, "1 Dec 00:00 MYT is outside November");
}

// 6. Period independence: Outstanding ignores the period; the other three follow it.
{
  const data = {
    quotations: [quote({ id: "q" })],
    billedInvoices: [invoice({ id: "b" })],
    openInvoices: [invoice({ id: "open", balance_due: 400, issued_at: "2025-01-01T00:00:00.000Z" })],
    payments: [payment({ id: "p" })],
    now: new Date("2026-11-25T04:00:00.000Z"),
  };
  const november = computeExecutiveKpis({ period, ...data });
  const december = computeExecutiveKpis({ period: { startUtc: "2026-11-30T16:00:00.000Z", endUtc: "2026-12-31T16:00:00.000Z" }, ...data });
  assert.equal(november.booked.grossCents, 100000);
  assert.equal(december.booked.grossCents, 0);
  assert.equal(december.billed.grossCents, 0);
  assert.equal(december.collected.grossCents, 0);
  assert.equal(november.outstanding.balanceCents, 40000);
  assert.equal(december.outstanding.balanceCents, 40000, "Outstanding is a current balance, not a period figure");
  assert.equal(november.asOfDate, "2026-11-25");
}

// 7. Empty data is all zeros, never NaN.
{
  const empty = computeExecutiveKpis({ period, quotations: [], billedInvoices: [], openInvoices: [], payments: [], now: new Date("2026-11-25T04:00:00.000Z") });
  for (const v of [empty.booked.grossCents, empty.billed.grossCents, empty.collected.grossCents, empty.refunded.cents, empty.outstanding.balanceCents, empty.dataQuality.staleStatusInvoices]) assert.equal(v, 0);
}

// 8. The staging reference case (1 accepted, billed, paid RM 1,200.00) reproduces end to end.
{
  const k = computeExecutiveKpis({
    period,
    quotations: [quote({ id: "ref", total: "1200.00" })],
    billedInvoices: [invoice({ id: "ref", status: "paid", grand_total: "1200.00", balance_due: "0.00" })],
    openInvoices: [],
    payments: [payment({ id: "ref", amount: "1200.00", invoice: { status: "paid", quotation: { is_test: false } } })],
    now: new Date("2026-11-25T04:00:00.000Z"),
  });
  assert.deepEqual([k.booked.grossCents, k.billed.grossCents, k.collected.grossCents, k.outstanding.balanceCents], [120000, 120000, 120000, 0]);
}

console.log("Finance executive KPI tests passed.");
