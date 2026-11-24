// G3: what Finance staff are told after Record Payment, and when the G1 idempotency key may be reused.
// Covers lib/payments/manual-payment-outcome.ts and recordManualPaymentAction's result shapes.
// Run: node --experimental-transform-types --experimental-test-module-mocks --no-warnings scripts/g3-manual-payment-feedback.test.mts
// Mocks only: no network, no ToyyibPay call, no database.
import assert from "node:assert/strict";
import { register } from "node:module";
import { mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const loader = `export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/navigation" || specifier === "next/cache") return nextResolve(specifier + ".js", context);
  try { return await nextResolve(specifier, context); } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\\.(?:c|m)?[jt]sx?$/.test(specifier)) {
      for (const ext of [".ts", ".tsx"]) { try { return await nextResolve(specifier + ext, context); } catch {} }
      return nextResolve(specifier + ".js", context);
    }
    throw error;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

const root = process.cwd();
const url = (rel: string) => pathToFileURL(path.join(root, rel)).href;
type Rpc = { data?: unknown; error?: { message: string } | null };
type Read = { data: unknown; error: { message: string } | null };
const INVOICE = "11111111-1111-4111-8111-111111111111";
const KEY = "33333333-3333-4333-8333-333333333333";

const state = {
  calls: [] as string[],
  record: { data: { outcome: "recorded", payment_id: "p1", amount_paid: 400, status: "partially_paid" }, error: null } as Rpc,
  invoiceRead: { data: { status: "partially_paid", amount_paid: 400, balance_due: 600 }, error: null } as Read,
  revalidated: [] as string[],
};
function reset() {
  state.calls = [];
  state.revalidated = [];
  state.record = { data: { outcome: "recorded", payment_id: "p1", amount_paid: 400, status: "partially_paid" }, error: null };
  state.invoiceRead = { data: { status: "partially_paid", amount_paid: 400, balance_due: 600 }, error: null };
}

mock.module("next/cache.js", { namedExports: { revalidatePath: (p: string) => { state.revalidated.push(p); } } });
mock.module("next/navigation.js", { namedExports: { redirect: (to: string) => { throw new Error(`redirect:${to}`); } } });
mock.module(url("lib/auth/session.ts"), {
  namedExports: {
    requireRole: async (min: string) => { state.calls.push(`requireRole:${min}`); return { id: "admin" }; },
    requireModuleAccess: async (k: string, l: string) => { state.calls.push(`requireModuleAccess:${k}:${l}`); },
  },
});
mock.module(url("lib/payments/toyyibpay.ts"), { namedExports: { inactivateBill: async () => { throw new Error("no active bill in these tests"); } } });
mock.module(url("lib/supabase/server.ts"), {
  namedExports: {
    createSupabaseServerClient: async () => ({
      from: (table: string) => ({
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: async () => {
              state.calls.push(`select:${table}:${cols}`);
              if (table === "invoices" && cols.includes("balance_due")) return state.invoiceRead;
              return { data: { opportunity_id: null, quotation_id: null }, error: null };
            },
          }),
        }),
      }),
      rpc: async (name: string) => {
        state.calls.push(`rpc:${name}`);
        if (name === "get_active_toyyibpay_attempt") return { data: { has_active_attempt: false }, error: null };
        if (name === "record_manual_payment") return state.record;
        throw new Error(`unexpected rpc ${name}`);
      },
    }),
  },
});

const lib = await import("../lib/payments/manual-payment-outcome.ts");
const actions = await import("../app/admin/(protected)/invoices/actions.ts");
const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  const base: Record<string, string> = { payment_provider: "bank_transfer", payment_method: "Maybank", amount: "400", payment_date: "2026-11-24", payment_reference: "FT-123 456", notes: "", idempotency_key: KEY };
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== "__omit__") f.set(k, v);
  return f;
};
const pay = (f = form()) => actions.recordManualPaymentAction(INVOICE, {}, f);

// ---- G3-01: confirmed payments report the new invoice position --------------------------------------------------

test("successful partial payment: recorded, refreshed balance and status, success tone", async () => {
  reset();
  const r = await pay();
  assert.equal(r.message, undefined);
  assert.equal(r.unconfirmed, undefined);
  assert.deepEqual(r.payment, {
    outcome: "recorded", paymentId: "p1", provider: "bank_transfer", amount: 400,
    invoiceStatus: "partially_paid", amountPaid: 400, balanceDue: 600, refreshed: true,
  });
  const d = lib.describeManualPaymentResult(r.payment!);
  assert.equal(d.tone, "success");
  assert.equal(d.title, "Payment recorded");
  assert.match(d.detail, /RM 400\.00 by Bank Transfer was recorded\. Balance due is now RM 600\.00 \(Partially Paid\)\./);
  assert.match(d.next ?? "", /Generate the receipt/);
  assert.ok(state.revalidated.includes(`/admin/invoices/${INVOICE}`), "the invoice page is revalidated");
});

test("successful full payment: status Paid, balance RM 0.00, receipt prompt", async () => {
  reset();
  state.record = { data: { outcome: "recorded", payment_id: "p2", amount_paid: 1000, status: "paid" }, error: null };
  state.invoiceRead = { data: { status: "paid", amount_paid: 1000, balance_due: 0 }, error: null };
  const r = await pay(form({ payment_provider: "cash", payment_reference: "", amount: "1000" }));
  assert.equal(r.payment?.invoiceStatus, "paid");
  assert.equal(r.payment?.balanceDue, 0);
  const d = lib.describeManualPaymentResult(r.payment!);
  assert.equal(d.tone, "success");
  assert.match(d.detail, /RM 1,000\.00 by Cash was recorded\. Balance due is now RM 0\.00 \(Paid\)\./);
  assert.match(d.next ?? "", /fully paid/);
});

test("invoice is read back after the payment RPC, never before", async () => {
  reset();
  await pay();
  const rpcAt = state.calls.indexOf("rpc:record_manual_payment");
  const readAt = state.calls.indexOf("select:invoices:status, amount_paid, balance_due");
  assert.ok(rpcAt >= 0 && readAt > rpcAt, state.calls.join(" → "));
});

for (const [label, read] of [
  ["read error", { data: null, error: { message: "connection reset" } }],
  ["row not visible", { data: null, error: null }],
  ["malformed row", { data: { status: "paid", balance_due: "not a number" }, error: null }],
] as const) {
  test(`successful payment followed by refresh failure (${label}): still recorded, warning, says do not record again`, async () => {
    reset();
    state.invoiceRead = read as Read;
    const r = await pay();
    assert.equal(r.message, undefined, "a confirmed payment is never reported as an error");
    assert.equal(r.payment?.outcome, "recorded");
    assert.equal(r.payment?.refreshed, false);
    assert.equal(r.payment?.balanceDue, null, "a stale or unknown balance is never shown as current");
    const d = lib.describeManualPaymentResult(r.payment!);
    assert.equal(d.tone, "warning");
    assert.match(d.title, /Payment recorded — invoice details could not be refreshed/);
    assert.match(d.next ?? "", /Do not record this payment again/);
  });
}

// ---- G3-03: replays are reported as replays ----------------------------------------------------------------------

test("idempotent replay: notice kept for G1, result says no new payment, info tone, never 'Payment recorded'", async () => {
  reset();
  state.record = { data: { outcome: "duplicate_ignored", payment_id: "p1", amount_paid: 400, status: "partially_paid" }, error: null };
  const r = await pay();
  assert.equal(r.message, undefined);
  assert.match(r.notice ?? "", /already recorded/);
  assert.equal(r.payment?.outcome, "duplicate_ignored");
  assert.equal(r.payment?.refreshed, true, "replay also refreshes the invoice position");
  const d = lib.describeManualPaymentResult(r.payment!);
  assert.equal(d.tone, "info");
  assert.match(d.title, /Already recorded — no new payment was created/);
  assert.doesNotMatch(d.title, /^Payment recorded/);
  assert.doesNotMatch(d.detail, / by [A-Za-z ]+ was recorded/, "the new-payment sentence is never used for a replay");
  assert.match(d.detail, /Nothing new was recorded/);
});

test("replay with refresh failure: still a replay, asks for reload, says do not record again", async () => {
  reset();
  state.record = { data: { outcome: "duplicate_ignored", payment_id: "p1" }, error: null };
  state.invoiceRead = { data: null, error: { message: "timeout" } };
  const d = lib.describeManualPaymentResult((await pay()).payment!);
  assert.equal(d.tone, "info");
  assert.match(d.next ?? "", /Reload this page[\s\S]*Do not record this payment again/);
});

test("conflicting duplicate reference is a definite refusal, distinct from a replay", async () => {
  reset();
  state.record = { data: null, error: { message: "duplicate_payment_reference" } };
  const r = await pay();
  assert.match(r.message ?? "", /already recorded on this invoice/);
  assert.equal(r.payment, undefined);
  assert.equal(r.unconfirmed, undefined, "a known refusal is not 'unconfirmed'");
});

test("idempotency key conflict stays a definite refusal asking for a reload", async () => {
  reset();
  state.record = { data: null, error: { message: "idempotency_key_conflict" } };
  const r = await pay();
  assert.match(r.message ?? "", /Reload the page/);
  assert.equal(r.unconfirmed, undefined);
});

test("overpayment stays a definite refusal", async () => {
  reset();
  state.record = { data: null, error: { message: "payment_exceeds_balance" } };
  const r = await pay();
  assert.match(r.message ?? "", /exceeds the outstanding balance/);
  assert.equal(r.payment, undefined);
});

// ---- Unknown and ambiguous server responses ---------------------------------------------------------------------

for (const [label, rpc] of [
  ["null data", { data: null, error: null }],
  ["no outcome", { data: { payment_id: "p1" }, error: null }],
  ["unrecognised outcome", { data: { outcome: "queued" }, error: null }],
  ["dropped connection", { data: null, error: { message: "TypeError: fetch failed" } }],
  ["unmapped database error", { data: null, error: { message: "canceling statement due to statement timeout" } }],
] as const) {
  test(`unknown server response (${label}) is unconfirmed: no success, no new key, safe-retry wording`, async () => {
    reset();
    state.record = rpc as Rpc;
    const r = await pay();
    assert.equal(r.payment, undefined, "never shown as a payment");
    assert.equal(r.unconfirmed, true);
    assert.equal(r.message, lib.UNCONFIRMED_PAYMENT_MESSAGE);
    assert.match(r.message ?? "", /may or may not have been saved[\s\S]*cannot create a second payment/);
  });
}

// ---- G3-02: validation errors keep the form and name the field ---------------------------------------------------

test("validation errors return field errors only (no DB call) and the first error field is focus-ordered", async () => {
  reset();
  const r = await pay(form({ payment_reference: " - ", amount: "0" }));
  assert.ok(r.errors?.payment_reference && r.errors?.amount, JSON.stringify(r));
  assert.deepEqual(state.calls.filter((c) => c.startsWith("rpc:")), []);
  assert.equal(lib.firstErrorField(r.errors), "amount", "amount comes before reference on screen");
  assert.equal(lib.firstErrorField({ notes: "x", payment_reference: "y" }), "payment_reference");
  assert.equal(lib.firstErrorField(undefined), undefined);
  assert.equal(lib.firstErrorField({ idempotency_key: "expired" }), undefined, "the hidden key is not a focus target");
});

// ---- G1 key lifecycle ----------------------------------------------------------------------------------------------

test("key is reused for the same intent (retry, double click) and replaced for a different one", () => {
  let n = 0;
  const fresh = () => `k${++n}`;
  const a = lib.manualPaymentIntent({ payment_provider: "bank_transfer", amount: "400", payment_reference: "FT-1" });
  const first = lib.keyForSubmission({ key: "k0", intent: null }, a, fresh);
  assert.deepEqual(first, { key: "k0", intent: a }, "first submission uses the server-issued key");
  assert.deepEqual(lib.keyForSubmission(first, a, fresh), first, "same intent: same key (retry can only replay)");
  const same = lib.manualPaymentIntent({ payment_provider: "bank_transfer", amount: "400.00", payment_reference: "  FT-1 " });
  assert.equal(same, a, "formatting-only differences are the same intent");
  for (const changed of [
    { payment_provider: "bank_transfer", amount: "401", payment_reference: "FT-1" },
    { payment_provider: "cheque", amount: "400", payment_reference: "FT-1" },
    { payment_provider: "bank_transfer", amount: "400", payment_reference: "FT-2" },
  ]) {
    const next = lib.keyForSubmission(first, lib.manualPaymentIntent(changed), fresh);
    assert.notEqual(next.key, "k0", `a materially different payment gets a new key: ${JSON.stringify(changed)}`);
  }
});

test("network interruption: a rejected action becomes unconfirmed; navigation signals still propagate", async () => {
  const unconfirmed = () => ({ message: lib.UNCONFIRMED_PAYMENT_MESSAGE, unconfirmed: true });
  const dropped = lib.withUnconfirmedOnReject<[string], { message?: string; unconfirmed?: boolean }>(async () => { throw new TypeError("Failed to fetch"); }, unconfirmed);
  assert.deepEqual(await dropped("inv", {}, new FormData()), unconfirmed());
  const ok = lib.withUnconfirmedOnReject<[string], { ok?: boolean }>(async (_id, _p, _f) => ({ ok: true }), () => ({}));
  assert.deepEqual(await ok("inv", {}, new FormData()), { ok: true });
  const redirecting = lib.withUnconfirmedOnReject<[string], object>(async () => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/admin/no-access;307;" }); }, () => ({}));
  await assert.rejects(() => redirecting("inv", {}, new FormData()), /NEXT_REDIRECT/);
});

test("guards still run first and the RPC contract is unchanged (eight G1 arguments)", async () => {
  reset();
  await pay();
  assert.deepEqual(state.calls.slice(0, 2), ["requireRole:admin", "requireModuleAccess:invoices:edit"]);
  assert.deepEqual(state.calls.filter((c) => c.startsWith("rpc:")), ["rpc:get_active_toyyibpay_attempt", "rpc:record_manual_payment"]);
});
