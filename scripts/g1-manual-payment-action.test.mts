// G1: recordManualPaymentAction sends the form's idempotency key, requires a reference for bank transfer / cheque and
// reports a replay as a notice. Database behaviour itself is proven in supabase/tests/crm_g1 (Docker).
// Run: node --experimental-transform-types --experimental-test-module-mocks --no-warnings scripts/g1-manual-payment-action.test.mts
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
const INVOICE = "11111111-1111-4111-8111-111111111111";
const KEY = "33333333-3333-4333-8333-333333333333";

const state = { calls: [] as string[], args: {} as Record<string, unknown[]>, record: { data: { outcome: "recorded" }, error: null } as Rpc };
function reset() { state.calls = []; state.args = {}; state.record = { data: { outcome: "recorded" }, error: null }; }

mock.module("next/cache.js", { namedExports: { revalidatePath: () => {} } });
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
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { opportunity_id: null, quotation_id: null }, error: null }) }) }) }),
      rpc: async (name: string, args: unknown) => {
        state.calls.push(`rpc:${name}`);
        (state.args[name] ??= []).push(args);
        if (name === "get_active_toyyibpay_attempt") return { data: { has_active_attempt: false }, error: null };
        if (name === "record_manual_payment") return state.record;
        throw new Error(`unexpected rpc ${name}`);
      },
    }),
  },
});

const actions = await import("../app/admin/(protected)/invoices/actions.ts");
const form = (over: Record<string, string> = {}) => {
  const f = new FormData();
  const base: Record<string, string> = { payment_provider: "bank_transfer", payment_method: "Maybank", amount: "400", payment_date: "2026-11-23", payment_reference: "FT-123 456", notes: "", idempotency_key: KEY };
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== "__omit__") f.set(k, v);
  return f;
};
const pay = (f = form()) => actions.recordManualPaymentAction(INVOICE, {}, f);

test("guards run first", async () => {
  reset();
  await pay();
  assert.deepEqual(state.calls.slice(0, 2), ["requireRole:admin", "requireModuleAccess:invoices:edit"]);
});

test("sends the form's key as p_idempotency_key with the existing seven arguments", async () => {
  reset();
  const r = await pay();
  assert.equal(r.message, undefined);
  assert.equal(r.payment?.outcome, "recorded"); // G3: a confirmed payment is reported, not an empty state
  assert.deepEqual(state.args.record_manual_payment, [{
    p_invoice_id: INVOICE, p_payment_provider: "bank_transfer", p_payment_method: "Maybank", p_amount: 400, p_payment_date: "2026-11-23",
    p_payment_reference: "FT-123 456", p_notes: null, p_idempotency_key: KEY,
  }]);
});

test("replay (duplicate_ignored) is a notice, not an error, and not a second payment", async () => {
  reset();
  state.record = { data: { outcome: "duplicate_ignored", payment_id: "p1" }, error: null };
  const r = await pay();
  assert.equal(r.message, undefined);
  assert.match(r.notice ?? "", /already recorded/);
});

for (const [label, over, field] of [
  ["missing key", { idempotency_key: "__omit__" }, "idempotency_key"],
  ["malformed key", { idempotency_key: "not-a-uuid" }, "idempotency_key"],
  ["bank transfer without reference", { payment_reference: "" }, "payment_reference"],
  ["bank transfer with punctuation-only reference", { payment_reference: " - / " }, "payment_reference"],
  ["cheque without cheque number", { payment_provider: "cheque", payment_reference: "" }, "payment_reference"],
] as const) {
  test(`${label}: refused before any database or ToyyibPay call`, async () => {
    reset();
    const r = await pay(form(over as Record<string, string>));
    assert.ok(r.errors?.[field], JSON.stringify(r));
    assert.deepEqual(state.calls.filter((c) => c.startsWith("rpc:")), []);
  });
}

test("cash and other need no reference", async () => {
  for (const provider of ["cash", "other"]) {
    reset();
    assert.equal((await pay(form({ payment_provider: provider, payment_reference: "" }))).payment?.outcome, "recorded");
    assert.equal((state.args.record_manual_payment[0] as { p_payment_reference: unknown }).p_payment_reference, null);
  }
});

for (const [code, pattern] of [
  ["duplicate_payment_reference", /already recorded on this invoice/],
  ["idempotency_key_conflict", /Reload the page/],
  ["idempotency_key_required", /expired/],
  ["payment_reference_required", /reference or cheque number is required/],
  ["payment_exceeds_balance", /exceeds the outstanding balance/],
] as const) {
  test(`database code ${code} is shown as a staff message`, async () => {
    reset();
    state.record = { data: null, error: { message: code } };
    const r = await pay();
    assert.match(r.message ?? "", pattern);
    assert.equal(r.notice, undefined);
  });
}
