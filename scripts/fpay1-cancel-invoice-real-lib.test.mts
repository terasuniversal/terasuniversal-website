// F-PAY-1 P1: cancelInvoiceAction with the REAL ToyyibPay classifier (lib/payments/toyyibpay.ts) and a stubbed fetch.
// Run: node --experimental-transform-types --experimental-test-module-mocks --no-warnings scripts/fpay1-cancel-invoice-real-lib.test.mts
// No network, no DB: fetch, Supabase, auth and next/* are replaced; synthetic credentials and bill codes only.
// Only the documented inactiveBill success body may let a cancellation proceed; every other response blocks it.
import assert from "node:assert/strict";
import { register } from "node:module";
import { mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const loader = `export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/navigation" || specifier === "next/cache" || specifier === "next/headers") return nextResolve(specifier + ".js", context);
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

process.env.TOYYIBPAY_ENV = "sandbox";
process.env.TOYYIBPAY_USER_SECRET_KEY = "synthetic-secret";
process.env.TOYYIBPAY_CATEGORY_CODE = "synthcat";
for (const k of Object.keys(process.env)) if (/^VERCEL|SUPABASE/.test(k)) delete process.env[k];

type Plan = { status?: number; body?: string; throws?: Error };
const net = { plan: { status: 200, body: "{}" } as Plan, urls: [] as string[] };
globalThis.fetch = (async (input: string | URL) => {
  net.urls.push(String(input));
  if (net.plan.throws) throw net.plan.throws;
  return new Response(net.plan.body ?? "", { status: net.plan.status ?? 200 });
}) as typeof fetch;

const INVOICE = "44444444-4444-4444-8444-444444444444";
const ATTEMPT = "55555555-5555-4555-8555-555555555555";
const flow = { calls: [] as string[], conflict: [] as unknown[], supersedeFails: false };
mock.module(url("node_modules/next/cache.js"), { namedExports: { revalidatePath: () => {} } });
mock.module(url("node_modules/next/navigation.js"), { namedExports: { redirect: () => { throw new Error("unexpected redirect"); } } });
mock.module(url("lib/auth/session.ts"), { namedExports: { requireRole: async () => ({ id: "admin" }), requireModuleAccess: async () => {} } });
const client = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { opportunity_id: null, quotation_id: null }, error: null }) }) }) }),
  rpc: async (name: string, args: unknown) => {
    flow.calls.push(name);
    if (name === "get_active_toyyibpay_attempt") return { data: { has_active_attempt: true, attempt_id: ATTEMPT, billcode: "synthcancel01" }, error: null };
    if (name === "log_toyyibpay_conflict") flow.conflict.push(args);
    if (name === "mark_toyyibpay_attempt_superseded" && flow.supersedeFails) return { data: null, error: { message: "attempt_not_pending" } };
    return { data: {}, error: null };
  },
};
mock.module(url("lib/supabase/server.ts"), { namedExports: { createSupabaseServerClient: async () => client, createSupabaseServiceClient: () => client } });
const actions = await import(url("app/admin/(protected)/invoices/actions.ts"));
const form = () => { const f = new FormData(); f.set("reason", "synthetic cancellation"); return f; };

test("cancel proceeds only after the documented success body (as live S1)", async () => {
  flow.calls = []; flow.conflict = []; flow.supersedeFails = false; net.urls = []; net.plan = { status: 200, body: JSON.stringify({ status: "success", result: "Bill status changed to inactive" }) };
  await actions.cancelInvoiceAction(INVOICE, {}, form()).catch((e: Error) => { if (!/redirect/.test(e.message)) throw e; });
  assert.deepEqual(flow.calls, ["get_active_toyyibpay_attempt", "mark_toyyibpay_attempt_superseded", "cancel_invoice"]);
  assert.deepEqual(net.urls, ["https://dev.toyyibpay.com/index.php/api/inactiveBill"]);
});
for (const [label, plan] of [
  ["already inactive (as live S2)", { status: 200, body: JSON.stringify({ status: "failed", result: "Bill is inactive" }) }],
  ["pending transaction (mock)", { status: 200, body: JSON.stringify({ status: "failed", result: "Bill has pending transaction process" }) }],
  ["unknown body (mock)", { status: 200, body: JSON.stringify({ status: "ok" }) }],
  ["HTTP 500 (mock)", { status: 500, body: "" }],
  ["timeout (mock AbortError)", { throws: Object.assign(new Error("aborted"), { name: "AbortError" }) }],
  ["non-JSON body (mock)", { status: 200, body: "<html>maintenance</html>" }],
  ["network error (mock)", { throws: new TypeError("fetch failed") }],
] as [string, Plan][]) {
  test(`cancel is NOT performed when inactivation is ${label}`, async () => {
    flow.calls = []; flow.conflict = []; flow.supersedeFails = false; net.urls = []; net.plan = plan;
    const r = await actions.cancelInvoiceAction(INVOICE, {}, form());
    assert.match(r.message ?? "", /NOT cancelled/);
    assert.deepEqual(flow.calls, ["get_active_toyyibpay_attempt", "log_toyyibpay_conflict"]);
    assert.equal((flow.conflict[0] as { p_conflict_type: string }).p_conflict_type, "in_progress");
  });
}

const OK = { status: 200, body: JSON.stringify({ status: "success", result: "Bill status changed to inactive" }) };
test("retry: a failed inactivation blocks, the next attempt with the documented success cancels (no stale state)", async () => {
  flow.calls = []; flow.conflict = []; flow.supersedeFails = false; net.plan = { status: 200, body: JSON.stringify({ status: "failed", result: "Bill has pending transaction process" }) };
  assert.match((await actions.cancelInvoiceAction(INVOICE, {}, form())).message ?? "", /NOT cancelled/);
  flow.calls = []; flow.conflict = []; net.plan = OK;
  await actions.cancelInvoiceAction(INVOICE, {}, form()).catch((e: Error) => { if (!/redirect/.test(e.message)) throw e; });
  assert.deepEqual(flow.calls, ["get_active_toyyibpay_attempt", "mark_toyyibpay_attempt_superseded", "cancel_invoice"]);
});
test("callback race: bill inactivated but the attempt was paid meanwhile -> supersede refused, NOT cancelled, reconciliation_required", async () => {
  flow.calls = []; flow.conflict = []; flow.supersedeFails = true; net.plan = OK;
  const r = await actions.cancelInvoiceAction(INVOICE, {}, form());
  assert.match(r.message ?? "", /NOT cancelled/);
  assert.deepEqual(flow.calls, ["get_active_toyyibpay_attempt", "mark_toyyibpay_attempt_superseded", "log_toyyibpay_conflict"]);
  assert.equal((flow.conflict[0] as { p_conflict_type: string }).p_conflict_type, "reconciliation_required");
});
