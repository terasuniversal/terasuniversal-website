import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amountPaidThroughPayment, assertReceiptCurrency, assertReceiptPaymentHistory, isReceiptEligiblePayment, receiptPaymentAmount, type ReceiptPaymentState } from "../lib/documents/receipt.ts";

const migration = readFileSync(new URL("../supabase/migrations/20260919230000_receipts_v1.sql", import.meta.url), "utf8");
const receiptRoute = readFileSync(new URL("../app/admin/receipt-pdf/[id]/page.tsx", import.meta.url), "utf8");
const invoicePage = readFileSync(new URL("../app/admin/(protected)/invoices/[id]/page.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("../app/admin/(protected)/invoices/actions.ts", import.meta.url), "utf8");
const header = readFileSync(new URL("../components/admin/documents/DocumentHeader.tsx", import.meta.url), "utf8");

assert.match(migration, /create table if not exists public\.receipts/);
assert.match(migration, /unique references public\.invoice_payments\(id\)/);
assert.match(migration, /create sequence if not exists app\.sales_receipt_seq/);
assert.match(migration, /RCPT-' \|\| to_char\(current_date, 'YYYY'\)/);
assert.match(migration, /generate_receipt_for_payment\(p_payment_id uuid\)/);
assert.match(migration, /if not app\.is_admin\(\)/);
assert.match(migration, /v_payment\.status <> 'successful'/);
assert.match(migration, /v_payment\.payment_provider = 'toyyibpay'/);
assert.match(migration, /v_payment\.verified_amount/);
assert.match(migration, /v_payment\.paid_at is null/);
assert.match(migration, /p\.paid_at < v_payment\.paid_at/);
assert.match(migration, /p\.created_at < v_payment\.created_at/);
assert.match(migration, /p\.id <= v_payment\.id/);
assert.match(migration, /hrdf_receipt_unavailable/);
assert.match(migration, /old\.status = 'successful' and new\.status = 'refunded'/);
assert.match(migration, /status in \('issued', 'refunded', 'voided'\)/);
assert.match(migration, /revoke all on function app\.next_receipt_number\(\) from public, anon, authenticated/);
assert.doesNotMatch(migration, /grant execute on function app\.next_receipt_number\(\) to authenticated/);
assert.match(migration, /receipt_currency_mismatch/);
assert.match(migration, /status in \('issued', 'refunded', 'voided'\)/);
assert.match(migration, /refunded_at timestamptz/);
assert.match(migration, /set status = 'refunded'/);
assert.match(migration, /refunded_at = coalesce\(refunded_at, now\(\)\)/);
assert.match(migration, /log_event_as_service/);
assert.match(migration, /'receipts'/);
assert.match(migration, /'receipt_issued'/);
assert.match(migration, /receipt_payment_history_invalid/);
assert.match(migration, /REFUND_MUTATION_FLOW = DEFERRED/);
assert.match(migration, /CRM activity is secondary context/);
assert.doesNotMatch(migration, /raise exception 'receipt_activity_context_missing'/);
assert.match(migration, /if v_lead_metadata_id is not null then/);
assert.match(migration, /when others then/);
assert.match(migration, /revoke insert, update, delete on public\.receipts from authenticated/);
assert.equal(migration.split("log_event_as_service").length - 1, 1, "exactly one receipt issuance audit call is expected");

assert.match(receiptRoute, /requireRole\("editor"\)/);
assert.match(receiptRoute, /requireModuleAccess\("invoices"\)/);
assert.match(receiptRoute, /DocumentHeader type="RECEIPT"/);
assert.match(receiptRoute, /Amount Received/);
assert.match(receiptRoute, /Total Paid To Date/);
assert.match(receiptRoute, /Balance Remaining/);
assert.match(receiptRoute, /REFUNDED RECEIPT/);
assert.match(receiptRoute, /VOIDED RECEIPT/);
assert.match(receiptRoute, /PAID IN FULL/);
assert.match(invoicePage, /generateReceiptAction/);
assert.match(invoicePage, /HRDF receipt unavailable in Receipt V1/);
assert.match(actions, /requireRole\("admin"\)/);
assert.match(actions, /generate_receipt_for_payment/);
assert.match(header, /"RECEIPT"/);

const payment = (overrides: Partial<ReceiptPaymentState>): ReceiptPaymentState => ({
  id: "00000000-0000-0000-0000-000000000001",
  payment_provider: "bank_transfer",
  status: "successful",
  amount: 2000,
  verified_amount: null,
  provider_transaction_id: null,
  verified_at: null,
  paid_at: "2026-01-01T10:00:00.000Z",
  created_at: "2026-01-01T10:00:01.000Z",
  payment_source: "customer",
  ...overrides,
});
const paymentA = payment({ id: "00000000-0000-0000-0000-000000000001", amount: 2000 });
const paymentB = payment({ id: "00000000-0000-0000-0000-000000000002", amount: 3000, paid_at: "2026-01-02T10:00:00.000Z" });
assert.equal(amountPaidThroughPayment([paymentB, paymentA], paymentA.id), 2000);
assert.equal(amountPaidThroughPayment([paymentA, paymentB], paymentB.id), 5000);
assert.equal(receiptPaymentAmount(paymentA), 2000);
assert.doesNotThrow(() => assertReceiptCurrency("MYR", "MYR"));
assert.throws(() => assertReceiptCurrency("USD", "MYR"), /receipt_currency_mismatch/);
assert.throws(() => assertReceiptPaymentHistory([
  paymentA,
  payment({ payment_provider: "toyyibpay", verified_amount: null, provider_transaction_id: null, verified_at: null, paid_at: "2026-01-01T11:00:00.000Z" }),
], paymentB), /receipt_payment_history_invalid/);
assert.equal(isReceiptEligiblePayment(payment({ status: "pending" })), false);
assert.equal(isReceiptEligiblePayment(payment({ status: "failed" })), false);
assert.equal(isReceiptEligiblePayment(payment({ status: "cancelled" })), false);
assert.equal(isReceiptEligiblePayment(payment({ status: "refunded" })), false);
assert.equal(isReceiptEligiblePayment(payment({ status: "superseded" })), false);
assert.equal(isReceiptEligiblePayment(payment({ payment_source: "hrdf" })), false);
assert.equal(isReceiptEligiblePayment(payment({ payment_provider: "toyyibpay", verified_amount: null })), false);
assert.equal(isReceiptEligiblePayment(payment({ payment_provider: "toyyibpay", verified_amount: 100, provider_transaction_id: "TX-1", verified_at: "2026-01-01T10:01:00.000Z" })), true);

console.log("Receipt V1 contract: PASS");
