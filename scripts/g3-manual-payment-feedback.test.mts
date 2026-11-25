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
  paymentLookup: { data: null, error: null } as Read,
  lookupFilters: [] as Array<[string, unknown]>,
  revalidated: [] as string[],
};
function reset() {
  state.calls = [];
  state.revalidated = [];
  state.lookupFilters = [];
  state.record = { data: { outcome: "recorded", payment_id: "p1", amount_paid: 400, status: "partially_paid" }, error: null };
  state.invoiceRead = { data: { status: "partially_paid", amount_paid: 400, balance_due: 600 }, error: null };
  state.paymentLookup = { data: null, error: null };
}

mock.module("next/cache.js", { namedExports: { revalidatePath: (p: string) => { state.revalidated.push(p); } } });
mock.module("next/navigation.js", { namedExports: { redirect: (to: string) => { throw new Error(`redirect:${to}`); } } });
mock.module(url("lib/auth/session.ts"), {
  namedExports: {
    requireRole: async (min: string) => { state.calls.push(`requireRole:${min}`); return { id: "admin" }; },
    requireModuleCapability: async (k: string, l: string) => { state.calls.push(`requireModuleCapability:${k}:${l}`); return { id: "admin", role: "admin", is_active: true, access_control_enabled: true }; },
    requireModuleAccess: async (k: string, l: string) => { state.calls.push(`requireModuleAccess:${k}:${l}`); },
  },
});
mock.module(url("lib/payments/toyyibpay.ts"), { namedExports: { inactivateBill: async () => { throw new Error("no active bill in these tests"); } } });
mock.module(url("lib/supabase/server.ts"), {
  namedExports: {
    createSupabaseServerClient: async () => ({
      from: (table: string) => ({
        select: (cols: string) => {
          const chain = {
            eq: (col: string, val: unknown) => {
              if (table === "invoice_payments") state.lookupFilters.push([col, val]);
              return chain;
            },
            maybeSingle: async () => {
              state.calls.push(`select:${table}:${cols}`);
              if (table === "invoice_payments") return state.paymentLookup;
              if (table === "invoices" && cols.includes("balance_due")) return state.invoiceRead;
              return { data: { opportunity_id: null, quotation_id: null }, error: null };
            },
          };
          return chain;
        },
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
  assert.deepEqual(state.calls.slice(0, 1), ["requireModuleCapability:invoices:edit"]);
  assert.deepEqual(state.calls.filter((c) => c.startsWith("rpc:")), ["rpc:get_active_toyyibpay_attempt", "rpc:record_manual_payment"]);
});

// ---- R-1: unresolved attempts (acceptance tests A-T1 .. A-T11, node-level parts) -------------------------------------
const USER = "aaaaaaaa-0000-4000-8000-00000000a001";
const OTHER_USER = "aaaaaaaa-0000-4000-8000-00000000a002";
const OTHER_INVOICE = "22222222-2222-4222-8222-222222222222";
const attempt = { key: KEY, provider: "cash", amount: "20.00", reference: "", paymentDate: "2026-11-24", createdAt: 1_800_000_000_000 };
const storedWith = (over: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(lib.serializePending(USER, INVOICE, attempt)), ...over });

test("A-T1/A-T2 (key rule): while unresolved the key never changes, even when the intent differs", () => {
  const a = lib.manualPaymentIntent({ payment_provider: "cash", amount: "20", payment_reference: "" });
  const b = lib.manualPaymentIntent({ payment_provider: "cash", amount: "25", payment_reference: "" });
  const fresh = () => "NEW";
  assert.deepEqual(lib.keyForSubmission({ key: KEY, intent: a }, b, fresh, true), { key: KEY, intent: a }, "unresolved: same key, original intent");
  assert.equal(lib.keyForSubmission({ key: KEY, intent: a }, b, fresh, false).key, "NEW", "resolved: a different payment gets a new key");
  assert.equal(lib.keyForSubmission({ key: KEY, intent: a }, a, fresh, true).key, KEY, "A-T3: retry of the same intent keeps the key");
});

test("A-T1/A-T2/A-T9 (evidence): only refusals raised after the G1 key check prove not recorded", () => {
  for (const code of ["invoice_not_payable", "payment_exceeds_balance", "duplicate_payment_reference"]) assert.equal(lib.keyStatusForCode(code), "not_recorded", code);
  assert.equal(lib.keyStatusForCode("idempotency_key_conflict"), "used");
  for (const code of ["not_authorized", "invalid_payment_provider", "invalid_amount", "payment_reference_required", "invoice_not_found", "idempotency_key_required", "TypeError: fetch failed"]) {
    assert.equal(lib.keyStatusForCode(code), undefined, `${code} raised before the key check proves nothing`);
  }
  assert.equal(lib.resolveUnresolvedAttempt({ payment: {} }), "confirmed");
  assert.equal(lib.resolveUnresolvedAttempt({ keyStatus: "not_recorded" }), "not_recorded");
  assert.equal(lib.resolveUnresolvedAttempt({ keyStatus: "used" }), "key_used");
  assert.equal(lib.resolveUnresolvedAttempt({ unconfirmed: true }), "unresolved", "lost response settles nothing");
  assert.equal(lib.resolveUnresolvedAttempt({}), "unresolved", "validation error settles nothing");
});

for (const [code, status] of [["payment_exceeds_balance", "not_recorded"], ["invoice_not_payable", "not_recorded"], ["duplicate_payment_reference", "not_recorded"], ["idempotency_key_conflict", "used"], ["payment_reference_required", undefined], ["not_authorized", undefined]] as const) {
  test(`A-T1/A-T9: action reports keyStatus=${status ?? "none"} for ${code}`, async () => {
    reset();
    state.record = { data: null, error: { message: code } };
    const r = await pay();
    assert.equal(r.keyStatus, status);
    assert.ok(r.message, "still a staff message");
    assert.equal(r.payment, undefined);
  });
}

test("A-T5/A-T8: storage key is scoped to user and invoice; serialised data is minimal", () => {
  const k = lib.pendingStorageKey(USER, INVOICE);
  assert.ok(k.includes(USER) && k.includes(INVOICE));
  assert.notEqual(k, lib.pendingStorageKey(OTHER_USER, INVOICE));
  assert.notEqual(k, lib.pendingStorageKey(USER, OTHER_INVOICE));
  const raw = lib.serializePending(USER, INVOICE, attempt);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ["a", "d", "i", "k", "p", "r", "t", "u", "v"], "key, replay identity, date, owner, time only");
  assert.doesNotMatch(raw, /notes|payment_method|token|password/i);
});

test("A-T5: a stored attempt round-trips and restores the same key", () => {
  const raw = lib.serializePending(USER, INVOICE, attempt);
  const parsed = lib.parsePending(raw, USER, INVOICE, attempt.createdAt + 60_000);
  assert.equal(parsed.state, "ok");
  assert.deepEqual(parsed.state === "ok" && parsed.attempt, attempt);
  assert.equal(lib.pendingIntent(attempt), lib.manualPaymentIntent({ payment_provider: "cash", amount: "20", payment_reference: "" }));
});

test("A-T8/A-T13: a stored attempt claiming another user or invoice is corrupt (blocked), never trusted or dropped", () => {
  const raw = lib.serializePending(USER, INVOICE, attempt);
  assert.deepEqual(lib.parsePending(raw, OTHER_USER, INVOICE, attempt.createdAt), { state: "corrupt", key: KEY });
  assert.deepEqual(lib.parsePending(raw, USER, OTHER_INVOICE, attempt.createdAt), { state: "corrupt", key: KEY });
});

for (const [label, raw, key] of [
  ["not JSON", "{oops", null],
  ["array", "[]", null],
  ["null literal", "null", null],
  ["wrong version", storedWith({ v: 2 }), KEY],
  ["bad key", storedWith({ k: "not-a-uuid" }), null],
  ["missing key", storedWith({ k: undefined }), null],
  ["bad provider", storedWith({ p: "toyyibpay" }), KEY],
  ["negative amount", storedWith({ a: "-5" }), KEY],
  ["zero amount", storedWith({ a: "0" }), KEY],
  ["oversized reference", storedWith({ r: "x".repeat(201) }), KEY],
] as const) {
  test(`A-T13/A-T14: corrupted stored attempt (${label}) is corrupt; readable key kept only for a read-only check`, () => {
    assert.deepEqual(lib.parsePending(raw, USER, INVOICE, attempt.createdAt), { state: "corrupt", key });
  });
}

test("A-T12: an expired (older than 7 days) attempt is restored with its key and locked; age never unlocks", () => {
  const raw = lib.serializePending(USER, INVOICE, attempt);
  const old = lib.parsePending(raw, USER, INVOICE, attempt.createdAt + lib.PENDING_TTL_MS + 1);
  assert.equal(old.state, "ok");
  assert.ok(old.state === "ok" && old.stale && old.attempt.key === KEY && old.attempt.amount === "20.00");
  const fresh = lib.parsePending(raw, USER, INVOICE, attempt.createdAt + lib.PENDING_TTL_MS - 1);
  assert.ok(fresh.state === "ok" && !fresh.stale);
  assert.equal(lib.parsePending(null, USER, INVOICE, attempt.createdAt).state, "none");
});

test("A-T12: non-identity fields (date, time) never invalidate the record; bad time counts as old", () => {
  const badDate = lib.parsePending(storedWith({ d: "24/11/2026" }), USER, INVOICE, attempt.createdAt);
  assert.ok(badDate.state === "ok" && badDate.attempt.paymentDate === "" && badDate.attempt.key === KEY);
  const future = lib.parsePending(storedWith({ t: attempt.createdAt + 10 * 60_000 }), USER, INVOICE, attempt.createdAt);
  assert.ok(future.state === "ok" && future.stale, "a future timestamp is untrusted: treated as old, still locked");
  const noTime = lib.parsePending(storedWith({ t: "yesterday" }), USER, INVOICE, attempt.createdAt);
  assert.ok(noTime.state === "ok" && noTime.stale);
});

const recorded = (over: Partial<Record<string, unknown>> = {}) => ({ invoiceId: INVOICE, idempotencyKey: KEY, provider: "cash", amount: 20, reference: null, status: "successful", ...over }) as Parameters<typeof lib.matchRecordedPayment>[0];

test("A-T16: exact match (invoice, key, method, amount to the cent, normalised reference, successful) settles", () => {
  assert.equal(lib.matchRecordedPayment(recorded(), { invoiceId: INVOICE, attempt }), "match");
  const bank = { ...attempt, provider: "bank_transfer", amount: "400.00", reference: "FT-123 456" };
  assert.equal(lib.matchRecordedPayment(recorded({ provider: "bank_transfer", amount: 400, reference: "ft123456" }), { invoiceId: INVOICE, attempt: bank }), "match",
    "reference compared with the G1 normalisation");
  assert.equal(lib.matchRecordedPayment(recorded({ idempotencyKey: KEY.toUpperCase() }), { invoiceId: INVOICE, attempt }), "match", "UUID case-insensitive");
});

for (const [label, over] of [
  ["other invoice", { invoiceId: OTHER_INVOICE }],
  ["other key", { idempotencyKey: "44444444-4444-4444-8444-444444444444" }],
  ["other method", { provider: "other" }],
  ["other amount", { amount: 20.01 }],
  ["other reference", { reference: "X-1" }],
  ["not successful", { status: "refunded" }],
  ["amount not a number", { amount: Number.NaN }],
] as const) {
  test(`A-T17: ${label} is a mismatch (recording stays blocked; never Already recorded)`, () => {
    assert.equal(lib.matchRecordedPayment(recorded(over), { invoiceId: INVOICE, attempt }), "mismatch");
  });
}

test("A-T16/A-T17 (look-up found): returns evidence to compare, never a confirmed payment by itself", async () => {
  reset();
  state.paymentLookup = { data: { id: "p9", invoice_id: INVOICE, idempotency_key: KEY, amount: 20, payment_provider: "cash", payment_reference: null, status: "successful" }, error: null };
  const r = await actions.checkManualPaymentAttemptAction(INVOICE, KEY);
  assert.deepEqual(state.calls.slice(0, 1), ["requireModuleCapability:invoices:edit"], "same guards as recording");
  assert.deepEqual(state.lookupFilters, [["invoice_id", INVOICE], ["idempotency_key", KEY]], "scoped to this invoice and key");
  assert.equal(r.lookup, "found");
  assert.equal(r.payment, undefined, "no payment field: the look-up alone never settles");
  assert.equal(lib.resolveUnresolvedAttempt(r), "unresolved");
  assert.deepEqual(r.recordedPayment, { invoiceId: INVOICE, idempotencyKey: KEY, provider: "cash", amount: 20, reference: null, status: "successful" });
  assert.equal(r.recordedResult?.outcome, "duplicate_ignored");
  assert.equal(r.recordedResult?.balanceDue, 600);
  assert.equal(lib.matchRecordedPayment(r.recordedPayment!, { invoiceId: INVOICE, attempt }), "match");
  assert.equal(lib.matchRecordedPayment(r.recordedPayment!, { invoiceId: INVOICE, attempt: { ...attempt, amount: "25.00" } }), "mismatch");
  assert.deepEqual(state.calls.filter((c) => c.startsWith("rpc:")), [], "read-only: no RPC");
});

test("A-T16/A-T17 (look-up found, bank reference): the recorded reference is returned and compared", async () => {
  reset();
  state.paymentLookup = { data: { id: "p10", invoice_id: INVOICE, idempotency_key: KEY, amount: 400, payment_provider: "bank_transfer", payment_reference: "FT-123 456", status: "successful" }, error: null };
  const r = await actions.checkManualPaymentAttemptAction(INVOICE, KEY);
  assert.equal(r.recordedPayment?.reference, "FT-123 456");
  const bank = { ...attempt, provider: "bank_transfer", amount: "400.00", reference: "ft123456" };
  assert.equal(lib.matchRecordedPayment(r.recordedPayment!, { invoiceId: INVOICE, attempt: bank }), "match");
  assert.equal(lib.matchRecordedPayment(r.recordedPayment!, { invoiceId: INVOICE, attempt: { ...bank, reference: "FT-999" } }), "mismatch");
});

for (const [label, lookup] of [
  ["not found", { data: null, error: null }],
  ["row not successful", { data: { id: "p9", invoice_id: INVOICE, idempotency_key: KEY, amount: 20, payment_provider: "cash", payment_reference: null, status: "pending" }, error: null }],
] as const) {
  test(`A-T2/A-T18 (look-up ${label}): stays unresolved, never proof that nothing was recorded`, async () => {
    reset();
    state.paymentLookup = lookup as Read;
    const r = await actions.checkManualPaymentAttemptAction(INVOICE, KEY);
    assert.equal(r.unconfirmed, true);
    assert.equal(r.lookup, "not_found");
    assert.equal(r.keyStatus, undefined);
    assert.equal(r.payment, undefined);
    assert.equal(lib.resolveUnresolvedAttempt(r), "unresolved");
    assert.match(r.message ?? "", /does not prove it failed/);
  });
}

test("A-T4/A-T18 (look-up error or bad input): stays unresolved and touches nothing", async () => {
  reset();
  state.paymentLookup = { data: null, error: { message: "permission denied" } };
  const failed = await actions.checkManualPaymentAttemptAction(INVOICE, KEY);
  assert.equal(failed.lookup, "failed");
  assert.equal(lib.resolveUnresolvedAttempt(failed), "unresolved");
  reset();
  const bad = await actions.checkManualPaymentAttemptAction(INVOICE, "not-a-uuid");
  assert.equal(bad.lookup, "failed");
  assert.equal(lib.resolveUnresolvedAttempt(bad), "unresolved");
  assert.deepEqual(state.calls.filter((c) => c.startsWith("select:")), [], "no query with malformed input");
});

test("A-T15/B: a key conflict is classified for checking, never as a confirmed payment", async () => {
  reset();
  state.record = { data: null, error: { message: "idempotency_key_conflict" } };
  const r = await pay();
  assert.equal(r.keyStatus, "used");
  assert.equal(r.payment, undefined);
  assert.equal(lib.resolveUnresolvedAttempt(r), "key_used");
  assert.doesNotMatch(r.message ?? "", /recorded with its original details/);
});
