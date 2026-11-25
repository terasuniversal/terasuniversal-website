// F-PAY-1 (P1): cancelling an invoice must first inactivate any pending ToyyibPay bill.
// Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings scripts/fpay1-cancel-invoice-toyyibpay.test.mts
// Mocks only: no network, no ToyyibPay call, no database.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const BILL = "synthbill01";

const state = {
  calls: [] as string[],
  rpcArgs: {} as Record<string, unknown[]>,
  active: { data: { has_active_attempt: false }, error: null } as Rpc,
  inactivate: async (): Promise<{ success: unknown; raw: unknown }> => ({ success: true, raw: [{ status: "1" }] }),
  supersede: { data: { status: "superseded" }, error: null } as Rpc,
  cancel: { data: null, error: null } as Rpc,
  revalidated: [] as string[],
  guardFails: false,
};

function reset() {
  state.calls = [];
  state.rpcArgs = {};
  state.active = { data: { has_active_attempt: false }, error: null };
  state.inactivate = async () => ({ success: true, raw: [{ status: "1" }] });
  state.supersede = { data: { status: "superseded" }, error: null };
  state.cancel = { data: null, error: null };
  state.revalidated = [];
  state.guardFails = false;
}

class Redirect extends Error { to: string; constructor(to: string) { super(`redirect:${to}`); this.to = to; } }

mock.module("next/cache.js", { namedExports: { revalidatePath: (p: string) => { state.revalidated.push(p); } } });
mock.module("next/navigation.js", { namedExports: { redirect: (to: string) => { throw new Redirect(to); } } });
mock.module(url("lib/auth/session.ts"), {
  namedExports: {
    requireRole: async (min: string) => { state.calls.push(`requireRole:${min}`); if (state.guardFails) throw new Redirect("/admin/no-access"); return { id: "admin" }; },
    requireModuleCapability: async (k: string, l: string) => { state.calls.push(`requireModuleCapability:${k}:${l}`); if (state.guardFails) throw new Redirect("/admin/no-access"); return { id: "admin", role: "admin", is_active: true, access_control_enabled: true }; },
    requireModuleAccess: async (key: string, level: string) => { state.calls.push(`requireModuleAccess:${key}:${level}`); },
  },
});
mock.module(url("lib/payments/toyyibpay.ts"), {
  namedExports: {
    inactivateBill: async (billcode: string) => { state.calls.push(`inactivateBill:${billcode}`); return state.inactivate(); },
  },
});
mock.module(url("lib/supabase/server.ts"), {
  namedExports: {
    createSupabaseServerClient: async () => ({
      from: (table: string) => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => { state.calls.push(`select:${table}`); return { data: { opportunity_id: "opp-1", quotation_id: "qt-1" }, error: null }; } }) }),
      }),
      rpc: async (name: string, args: unknown) => {
        state.calls.push(`rpc:${name}`);
        (state.rpcArgs[name] ??= []).push(args);
        if (name === "get_active_toyyibpay_attempt") return state.active;
        if (name === "mark_toyyibpay_attempt_superseded") return state.supersede;
        if (name === "cancel_invoice") return state.cancel;
        if (name === "log_toyyibpay_conflict") return { data: { logged: true }, error: null };
        throw new Error(`unexpected rpc ${name}`);
      },
    }),
  },
});

const actions = await import("../app/admin/(protected)/invoices/actions.ts");
const form = (reason = "Customer withdrew") => { const f = new FormData(); f.set("reason", reason); return f; };
const cancel = (f = form()) => actions.cancelInvoiceAction(INVOICE, {}, f);
const activeAttempt = () => { state.active = { data: { has_active_attempt: true, attempt_id: ATTEMPT, billcode: BILL }, error: null }; };
const rpcNames = () => state.calls.filter((c) => c.startsWith("rpc:") || c.startsWith("inactivateBill:"));

test("guards run first: invoices capability (RBAC), before any read or RPC", async () => {
  reset();
  await cancel();
  assert.deepEqual(state.calls.slice(0, 1), ["requireModuleCapability:invoices:edit"]);
  reset(); state.guardFails = true;
  await assert.rejects(cancel(), Redirect);
  assert.deepEqual(state.calls, ["requireModuleCapability:invoices:edit"], "nothing after a failed guard");
});

test("no pending ToyyibPay attempt: cancels exactly as before, no provider call", async () => {
  reset();
  assert.deepEqual(await cancel(), {});
  assert.deepEqual(rpcNames(), ["rpc:get_active_toyyibpay_attempt", "rpc:cancel_invoice"]);
  assert.deepEqual(state.rpcArgs.cancel_invoice, [{ p_invoice_id: INVOICE, p_reason: "Customer withdrew" }]);
  assert.ok(state.revalidated.includes(`/admin/invoices/${INVOICE}`));
});

test("pending attempt + confirmed inactivation: inactivate, supersede, then cancel - in that order", async () => {
  reset(); activeAttempt();
  assert.deepEqual(await cancel(), {});
  assert.deepEqual(rpcNames(), ["rpc:get_active_toyyibpay_attempt", `inactivateBill:${BILL}`, "rpc:mark_toyyibpay_attempt_superseded", "rpc:cancel_invoice"]);
  assert.deepEqual(state.rpcArgs.mark_toyyibpay_attempt_superseded, [{ p_attempt_id: ATTEMPT }]);
});

for (const [label, inactivate] of [
  ["provider reports failure", async () => ({ success: false, raw: [{ status: "error" }] })],
  ["provider times out (AbortError)", async () => { const e = new Error("timeout"); e.name = "AbortError"; throw e; }],
  ["provider throws (network / credentials)", async () => { throw new Error("ToyyibPay unreachable"); }],
  ["ambiguous truthy result is not a confirmed success", async () => ({ success: "yes", raw: null })],
] as const) {
  test(`inactivation not confirmed (${label}): nothing changes, conflict logged, invoice NOT cancelled`, async () => {
    reset(); activeAttempt(); state.inactivate = inactivate as typeof state.inactivate;
    const result = await cancel();
    assert.match(result.message ?? "", /NOT cancelled/);
    assert.deepEqual(rpcNames(), ["rpc:get_active_toyyibpay_attempt", `inactivateBill:${BILL}`, "rpc:log_toyyibpay_conflict"]);
    assert.deepEqual(state.rpcArgs.log_toyyibpay_conflict, [{ p_invoice_id: INVOICE, p_attempt_id: ATTEMPT, p_conflict_type: "in_progress" }]);
    assert.equal(state.rpcArgs.mark_toyyibpay_attempt_superseded, undefined);
    assert.equal(state.rpcArgs.cancel_invoice, undefined);
    assert.deepEqual(state.revalidated, []);
  });
}

test("retry after a failed inactivation succeeds on the next attempt (no stale state)", async () => {
  reset(); activeAttempt(); state.inactivate = async () => ({ success: false, raw: null });
  assert.match((await cancel()).message ?? "", /NOT cancelled/);
  state.calls = []; state.rpcArgs = {}; state.inactivate = async () => ({ success: true, raw: [{ status: "1" }] });
  assert.deepEqual(await cancel(), {});
  assert.deepEqual(rpcNames(), ["rpc:get_active_toyyibpay_attempt", `inactivateBill:${BILL}`, "rpc:mark_toyyibpay_attempt_superseded", "rpc:cancel_invoice"]);
});

test("callback race: payment completed before inactivation -> supersede refused, reconciliation logged, invoice NOT cancelled", async () => {
  reset(); activeAttempt(); state.supersede = { data: null, error: { message: "attempt_not_pending" } };
  const result = await cancel();
  assert.match(result.message ?? "", /NOT cancelled/);
  assert.deepEqual(rpcNames(), ["rpc:get_active_toyyibpay_attempt", `inactivateBill:${BILL}`, "rpc:mark_toyyibpay_attempt_superseded", "rpc:log_toyyibpay_conflict"]);
  assert.deepEqual(state.rpcArgs.log_toyyibpay_conflict, [{ p_invoice_id: INVOICE, p_attempt_id: ATTEMPT, p_conflict_type: "reconciliation_required" }]);
  assert.equal(state.rpcArgs.cancel_invoice, undefined);
});

test("active-attempt check fails: no provider call, no cancel", async () => {
  reset(); state.active = { data: null, error: { message: "not_authorized" } };
  assert.match((await cancel()).message ?? "", /NOT cancelled/);
  assert.deepEqual(rpcNames(), ["rpc:get_active_toyyibpay_attempt"]);
});

test("active attempt without a bill code or attempt id: fail closed, no provider call, no cancel", async () => {
  for (const data of [{ has_active_attempt: true, attempt_id: ATTEMPT }, { has_active_attempt: true, billcode: BILL }]) {
    reset(); state.active = { data, error: null };
    assert.match((await cancel()).message ?? "", /NOT cancelled/);
    assert.deepEqual(rpcNames(), ["rpc:get_active_toyyibpay_attempt"]);
  }
});

test("cancel_invoice refuses after the bill was deactivated: plain message, no throw, page revalidated", async () => {
  reset(); activeAttempt(); state.cancel = { data: null, error: { message: "cannot_cancel_invoice_with_payments" } };
  const result = await cancel();
  assert.match(result.message ?? "", /deactivated, but the invoice could not be cancelled: An invoice that has received a payment cannot be cancelled directly\./);
  assert.ok(state.revalidated.includes(`/admin/invoices/${INVOICE}`));
});

test("cancel_invoice error without an active attempt keeps the existing message mapping", async () => {
  reset(); state.cancel = { data: null, error: { message: "already_cancelled" } };
  assert.deepEqual(await cancel(), { message: "This invoice is already cancelled." });
});

test("invalid reason: validation error, no RPC", async () => {
  reset();
  const result = await cancel(form("x".repeat(501)));
  assert.ok(result.errors?.reason);
  assert.deepEqual(rpcNames(), []);
});

test("static: manual payment orchestration and other invoice actions are unchanged in shape", async () => {
  const src = await readFile(path.join(root, "app/admin/(protected)/invoices/actions.ts"), "utf8");
  const manual = src.slice(src.indexOf("export async function recordManualPaymentAction"), src.indexOf("export async function generateReceiptAction"));
  assert.ok(manual.indexOf("inactivateBill(active.billcode)") < manual.indexOf('rpc("mark_toyyibpay_attempt_superseded"'));
  assert.ok(manual.indexOf('rpc("mark_toyyibpay_attempt_superseded"') < manual.indexOf('rpc("record_manual_payment"'));
  const cancelBody = src.slice(src.indexOf("export async function cancelInvoiceAction"));
  assert.ok(cancelBody.indexOf("inactivateBill(active.billcode)") < cancelBody.indexOf('rpc("mark_toyyibpay_attempt_superseded"'));
  assert.ok(cancelBody.indexOf('rpc("mark_toyyibpay_attempt_superseded"') < cancelBody.indexOf('rpc("cancel_invoice"'));
  assert.match(cancelBody, /result\.success === true/);
  assert.doesNotMatch(src, /createSupabaseServiceClient/, "no service-role client in invoice actions");
});
