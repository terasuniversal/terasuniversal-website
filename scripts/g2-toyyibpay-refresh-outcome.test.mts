// G2: "Refresh / Re-check Status" must report every RPC outcome and only show success for a finalized payment.
// Run: node --experimental-transform-types --experimental-test-module-mocks --no-warnings scripts/g2-toyyibpay-refresh-outcome.test.mts
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
type Tx = { providerStatus: string; providerTransactionId: string | null; amount: string | null; billCode: string | null; transactionTime: string | null; raw: unknown };
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const INVOICE = "11111111-1111-4111-8111-111111111111";
const BILL = "synthbill01";

const state = {
  calls: [] as string[],
  rpcArgs: {} as Record<string, unknown[]>,
  attempt: { data: { id: ATTEMPT, invoice_id: INVOICE, status: "pending", provider_bill_code: BILL }, error: null } as Rpc,
  transactions: async (): Promise<Tx[]> => [],
  finalize: { data: { outcome: "finalized" }, error: null } as Rpc,
  markFailed: { data: { outcome: "marked_failed" }, error: null } as Rpc,
  revalidated: [] as string[],
};

const tx = (over: Partial<Tx> = {}): Tx => ({
  providerStatus: "successful", providerTransactionId: "TP-REF-1", amount: "1800.00", billCode: BILL, transactionTime: null, raw: { billcode: BILL }, ...over,
});

function reset() {
  state.calls = [];
  state.rpcArgs = {};
  state.attempt = { data: { id: ATTEMPT, invoice_id: INVOICE, status: "pending", provider_bill_code: BILL }, error: null };
  state.transactions = async () => [];
  state.finalize = { data: { outcome: "finalized" }, error: null };
  state.markFailed = { data: { outcome: "marked_failed" }, error: null };
  state.revalidated = [];
}

mock.module("next/cache.js", { namedExports: { revalidatePath: (p: string) => { state.revalidated.push(p); } } });
mock.module("next/navigation.js", { namedExports: { redirect: (to: string) => { throw new Error(`redirect:${to}`); } } });
mock.module(url("lib/auth/session.ts"), {
  namedExports: {
    requireRole: async (min: string) => { state.calls.push(`requireRole:${min}`); return { id: "admin" }; },
    requireModuleCapability: async (k: string, l: string) => { state.calls.push(`requireModuleCapability:${k}:${l}`); return { id: "admin", role: "admin", is_active: true, access_control_enabled: true }; },
    requireModuleAccess: async (key: string, level: string) => { state.calls.push(`requireModuleAccess:${key}:${level}`); },
  },
});
mock.module(url("lib/payments/toyyibpay.ts"), {
  namedExports: {
    createBill: async () => { throw new Error("createBill must not be called"); },
    inactivateBill: async () => { throw new Error("inactivateBill must not be called"); },
    ringgitStringToSen: () => 0,
    getBillTransactions: async (billcode: string) => { state.calls.push(`getBillTransactions:${billcode}`); return state.transactions(); },
    parseToyyibpayTransactionDate: () => null,
  },
});
mock.module(url("lib/site-origin.ts"), { namedExports: { canonicalSiteOrigin: () => "https://example.test" } });
const rpc = async (name: string, args: unknown) => {
  state.calls.push(`rpc:${name}`);
  (state.rpcArgs[name] ??= []).push(args);
  if (name === "finalize_toyyibpay_payment_from_callback") return state.finalize;
  if (name === "mark_toyyibpay_attempt_failed_from_callback") return state.markFailed;
  throw new Error(`unexpected rpc ${name}`);
};
mock.module(url("lib/supabase/server.ts"), {
  namedExports: {
    createSupabaseServerClient: async () => ({
      from: (table: string) => ({
        select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => { state.calls.push(`select:${table}`); return state.attempt; } }) }) }),
      }),
      rpc: async (name: string) => { throw new Error(`RLS client must not call rpc ${name}`); },
    }),
    createSupabaseServiceClient: () => ({ rpc }),
  },
});

const actions = await import("../app/admin/(protected)/invoices/toyyibpayActions.ts");
const refresh = () => actions.refreshToyyibpayStatusAction(ATTEMPT, {}, new FormData());
const rpcCalls = () => state.calls.filter((c) => c.startsWith("rpc:"));

function assertNotSuccess(r: { tone?: string; message?: string }) {
  assert.notEqual(r.tone, "success");
  assert.ok(r.message && r.message.length > 0, "every non-finalized branch must tell staff what happened");
  assert.doesNotMatch(r.message!, /Payment confirmed by ToyyibPay and recorded/);
}

test("guards run first: admin, then invoices:edit", async () => {
  reset();
  await refresh();
  assert.deepEqual(state.calls.slice(0, 1), ["requireModuleCapability:invoices:edit"]);
});

test("attempt load error -> error tone, no ToyyibPay call", async () => {
  reset();
  state.attempt = { data: null, error: { message: "boom" } };
  const r = await refresh();
  assert.equal(r.tone, "error");
  assertNotSuccess(r);
  assert.ok(!state.calls.some((c) => c.startsWith("getBillTransactions")));
});

test("attempt not found -> error tone", async () => {
  reset();
  state.attempt = { data: null, error: null };
  const r = await refresh();
  assert.equal(r.tone, "error");
  assertNotSuccess(r);
});

for (const status of ["successful", "failed", "superseded", "cancelled"]) {
  test(`attempt already ${status} -> info, no provider or RPC call`, async () => {
    reset();
    state.attempt = { data: { id: ATTEMPT, invoice_id: INVOICE, status, provider_bill_code: BILL }, error: null };
    const r = await refresh();
    assert.equal(r.tone, "info");
    assertNotSuccess(r);
    assert.ok(!state.calls.some((c) => c.startsWith("getBillTransactions")));
    assert.deepEqual(rpcCalls(), []);
  });
}

test("pending attempt without billcode -> warning, no provider call", async () => {
  reset();
  state.attempt = { data: { id: ATTEMPT, invoice_id: INVOICE, status: "pending", provider_bill_code: null }, error: null };
  const r = await refresh();
  assert.equal(r.tone, "warning");
  assertNotSuccess(r);
  assert.ok(!state.calls.some((c) => c.startsWith("getBillTransactions")));
});

test("network failure reaching ToyyibPay -> error, retryable, no RPC", async () => {
  reset();
  state.transactions = async () => { throw new Error("ETIMEDOUT"); };
  const r = await refresh();
  assert.equal(r.tone, "error");
  assert.match(r.message!, /try again/);
  assertNotSuccess(r);
  assert.deepEqual(rpcCalls(), []);
});

test("no transactions returned -> pending info, no RPC", async () => {
  reset();
  const r = await refresh();
  assert.equal(r.tone, "info");
  assert.match(r.message!, /still pending/);
  assert.deepEqual(rpcCalls(), []);
});

test("provider still pending -> pending info, no RPC", async () => {
  reset();
  state.transactions = async () => [tx({ providerStatus: "pending" })];
  const r = await refresh();
  assert.equal(r.tone, "info");
  assert.match(r.message!, /still pending/);
  assertNotSuccess(r);
  assert.deepEqual(rpcCalls(), []);
});

test("unrecognised provider status -> warning, never paid, no RPC", async () => {
  reset();
  state.transactions = async () => [tx({ providerStatus: "unknown" })];
  const r = await refresh();
  assert.equal(r.tone, "warning");
  assertNotSuccess(r);
  assert.deepEqual(rpcCalls(), []);
});

test("successful without transaction reference -> warning, no RPC", async () => {
  reset();
  state.transactions = async () => [tx({ providerTransactionId: null })];
  const r = await refresh();
  assert.equal(r.tone, "warning");
  assertNotSuccess(r);
  assert.deepEqual(rpcCalls(), []);
});

test("finalized -> the only success; RPC arguments unchanged", async () => {
  reset();
  state.transactions = async () => [tx()];
  const r = await refresh();
  assert.equal(r.tone, "success");
  assert.match(r.message!, /Payment confirmed by ToyyibPay/);
  assert.deepEqual(rpcCalls(), ["rpc:finalize_toyyibpay_payment_from_callback"]);
  const args = state.rpcArgs.finalize_toyyibpay_payment_from_callback[0] as Record<string, unknown>;
  assert.deepEqual(Object.keys(args).sort(), ["p_attempt_id", "p_billcode", "p_callback_received_at", "p_provider_transaction_id", "p_provider_transaction_time", "p_raw_response", "p_verified_amount"]);
  assert.equal(args.p_attempt_id, ATTEMPT);
  assert.equal(args.p_billcode, BILL);
  assert.equal(args.p_verified_amount, "1800.00");
  assert.equal(args.p_provider_transaction_id, "TP-REF-1");
  assert.equal(args.p_callback_received_at, null);
  assert.equal(args.p_provider_transaction_time, null);
  assert.deepEqual(state.revalidated, [`/admin/invoices/${INVOICE}`]);
});

test("finalize duplicate_ignored -> info, not success", async () => {
  reset();
  state.transactions = async () => [tx()];
  state.finalize = { data: { outcome: "duplicate_ignored", attempt_id: ATTEMPT }, error: null };
  const r = await refresh();
  assert.equal(r.tone, "info");
  assert.match(r.message!, /already recorded/);
  assertNotSuccess(r);
});

test("finalize reconciliation_required -> warning with amount and admin escalation", async () => {
  reset();
  state.transactions = async () => [tx()];
  state.finalize = { data: { outcome: "reconciliation_required", attempt_id: ATTEMPT }, error: null };
  const r = await refresh();
  assert.equal(r.tone, "warning");
  assert.match(r.message!, /RM 1,800\.00/);
  assert.match(r.message!, /Reconciliation is required/);
  assert.match(r.message!, /Nothing was changed/);
  assertNotSuccess(r);
});

test("finalize amount_exceeds_balance -> warning, left pending", async () => {
  reset();
  state.transactions = async () => [tx({ amount: "2000.00" })];
  state.finalize = { data: { outcome: "amount_exceeds_balance", attempt_id: ATTEMPT }, error: null };
  const r = await refresh();
  assert.equal(r.tone, "warning");
  assert.match(r.message!, /RM 2,000\.00/);
  assert.match(r.message!, /left pending/);
  assertNotSuccess(r);
});

for (const [label, data] of [["unknown outcome", { outcome: "something_new" }], ["null data", null], ["non-object data", "ok"], ["outcome not a string", { outcome: 1 }]] as const) {
  test(`finalize ${label} -> warning, fail closed`, async () => {
    reset();
    state.transactions = async () => [tx()];
    state.finalize = { data, error: null };
    const r = await refresh();
    assert.equal(r.tone, "warning");
    assert.match(r.message!, /could not confirm the result/);
    assertNotSuccess(r);
  });
}

test("finalize billcode_mismatch exception -> error with admin escalation", async () => {
  reset();
  state.transactions = async () => [tx()];
  state.finalize = { data: null, error: { message: "billcode_mismatch" } };
  const r = await refresh();
  assert.equal(r.tone, "error");
  assert.match(r.message!, /different bill/);
  assertNotSuccess(r);
});

test("finalize other exception -> generic error, reload advice, no internals leaked", async () => {
  reset();
  state.transactions = async () => [tx()];
  state.finalize = { data: null, error: { message: "invoice_not_found: relation public.invoices" } };
  const r = await refresh();
  assert.equal(r.tone, "error");
  assert.match(r.message!, /Reload the page/);
  assert.doesNotMatch(r.message!, /relation|public\.|invoice_not_found/);
  assertNotSuccess(r);
});

test("provider unsuccessful + marked_failed -> warning, link closed", async () => {
  reset();
  state.transactions = async () => [tx({ providerStatus: "unsuccessful" })];
  const r = await refresh();
  assert.equal(r.tone, "warning");
  assert.match(r.message!, /unsuccessful/);
  assertNotSuccess(r);
  assert.deepEqual(rpcCalls(), ["rpc:mark_toyyibpay_attempt_failed_from_callback"]);
  const args = state.rpcArgs.mark_toyyibpay_attempt_failed_from_callback[0] as Record<string, unknown>;
  assert.deepEqual(args, { p_attempt_id: ATTEMPT, p_billcode: BILL, p_callback_received_at: null, p_reason: "confirmed unsuccessful via admin-triggered status refresh" });
});

test("mark_failed duplicate_ignored -> info", async () => {
  reset();
  state.transactions = async () => [tx({ providerStatus: "unsuccessful" })];
  state.markFailed = { data: { outcome: "duplicate_ignored" }, error: null };
  const r = await refresh();
  assert.equal(r.tone, "info");
  assertNotSuccess(r);
});

test("mark_failed unknown outcome -> warning, fail closed", async () => {
  reset();
  state.transactions = async () => [tx({ providerStatus: "unsuccessful" })];
  state.markFailed = { data: {}, error: null };
  const r = await refresh();
  assert.equal(r.tone, "warning");
  assertNotSuccess(r);
});

test("mark_failed exception -> error", async () => {
  reset();
  state.transactions = async () => [tx({ providerStatus: "unsuccessful" })];
  state.markFailed = { data: null, error: { message: "attempt_not_found" } };
  const r = await refresh();
  assert.equal(r.tone, "error");
  assertNotSuccess(r);
});

test("retry after an error is safe: second refresh re-reads state and repeats the same RPC call", async () => {
  reset();
  state.transactions = async () => [tx()];
  state.finalize = { data: null, error: { message: "timeout" } };
  const first = await refresh();
  assert.equal(first.tone, "error");
  state.finalize = { data: { outcome: "duplicate_ignored" }, error: null };
  const second = await refresh();
  assert.equal(second.tone, "info");
  assert.equal(state.calls.filter((c) => c === "select:invoice_payments").length, 2);
  assert.equal(state.rpcArgs.finalize_toyyibpay_payment_from_callback.length, 2);
  assert.deepEqual(state.rpcArgs.finalize_toyyibpay_payment_from_callback[0], state.rpcArgs.finalize_toyyibpay_payment_from_callback[1]);
});
