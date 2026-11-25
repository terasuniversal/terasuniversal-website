// ToyyibPay Inactive Bill: strict, fail-closed response classification.
// Run: node --experimental-transform-types --experimental-test-module-mocks --no-warnings scripts/toyyibpay-inactive-bill-classifier.test.mts
// No network: globalThis.fetch is replaced before anything runs; synthetic credentials and bill codes only.
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
const read = (rel: string) => readFile(path.join(root, rel), "utf8");

// Synthetic sandbox configuration; fetch below never reaches a network.
process.env.TOYYIBPAY_ENV = "sandbox";
process.env.TOYYIBPAY_USER_SECRET_KEY = "synthetic-secret";
process.env.TOYYIBPAY_CATEGORY_CODE = "synthcat";
delete process.env.VERCEL_ENV;
delete process.env.VERCEL_TARGET_ENV;

type FetchPlan = { status?: number; body?: string; throws?: Error };
const net = { plan: { status: 200, body: "{}" } as FetchPlan, requests: [] as { url: string; init: RequestInit }[] };
globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
  net.requests.push({ url: String(input), init });
  if (net.plan.throws) throw net.plan.throws;
  return new Response(net.plan.body ?? "", { status: net.plan.status ?? 200 });
}) as typeof fetch;

const SUCCESS = JSON.stringify({ status: "success", result: "Bill status changed to inactive" });
const PENDING = JSON.stringify({ status: "failed", result: "Bill has pending transaction process" });
const INACTIVE = JSON.stringify({ status: "failed", result: "Bill is inactive" });

const lib = await import("../lib/payments/toyyibpay.ts");

// ------------------------------------------------------------------ classifier
test("documented bodies map to their outcomes; only the success body is inactivated", () => {
  assert.equal(lib.classifyInactiveBillResponse(JSON.parse(SUCCESS)), "inactivated");
  assert.equal(lib.classifyInactiveBillResponse(JSON.parse(PENDING)), "pending_transaction");
  assert.equal(lib.classifyInactiveBillResponse(JSON.parse(INACTIVE)), "already_inactive");
  assert.equal(lib.classifyInactiveBillResponse([JSON.parse(SUCCESS)]), "inactivated", "single-element array accepted");
  assert.equal(lib.classifyInactiveBillResponse([JSON.parse(PENDING)]), "pending_transaction");
});

test("every other shape is failed or unknown, never inactivated", () => {
  const cases: [unknown, string][] = [
    [{ status: "failed", result: "Something else" }, "failed"],
    [{ status: "failed" }, "failed"],
    [{ status: "error", msg: "x" }, "failed"],
    [{ status: "0" }, "failed"],
    [{ status: "Success", result: "Bill status changed to inactive" }, "unknown"],
    [{ status: "SUCCESS", result: "Bill status changed to inactive" }, "unknown"],
    [{ status: " success", result: "Bill status changed to inactive" }, "unknown"],
    [{ status: "success" }, "unknown"],
    [{ status: "success", result: "" }, "unknown"],
    [{ status: "success", result: "Bill paid" }, "unknown"],
    [{ status: "success", result: 1 }, "unknown"],
    [{ status: 1, result: "Bill status changed to inactive" }, "unknown"],
    [{ status: true }, "unknown"],
    [{ status: "pending" }, "unknown"],
    [{ status: "ok" }, "unknown"],
    [{ status: "1" }, "unknown"],
    [{}, "unknown"],
    [[], "unknown"],
    [[JSON.parse(SUCCESS), JSON.parse(SUCCESS)], "unknown"],
    [[[JSON.parse(SUCCESS)]], "unknown"],
    [null, "unknown"],
    [undefined, "unknown"],
    ["success", "unknown"],
    [42, "unknown"],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(lib.classifyInactiveBillResponse(raw), expected, JSON.stringify(raw));
  }
});

// ------------------------------------------------------------------ inactivateBill transport
test("request: POST to the sandbox inactiveBill endpoint with secretKey + billCode only", async () => {
  net.requests = []; net.plan = { status: 200, body: SUCCESS };
  const r = await lib.inactivateBill("synthbill01");
  assert.deepEqual([r.success, r.outcome], [true, "inactivated"]);
  assert.equal(net.requests.length, 1);
  assert.equal(net.requests[0].url, "https://dev.toyyibpay.com/index.php/api/inactiveBill");
  assert.equal(net.requests[0].init.method, "POST");
  const sent = new URLSearchParams(String(net.requests[0].init.body));
  assert.deepEqual([...sent.keys()].sort(), ["billCode", "secretKey"]);
  assert.equal(sent.get("billCode"), "synthbill01");
});

for (const [label, body, outcome] of [["pending transaction", PENDING, "pending_transaction"], ["already inactive", INACTIVE, "already_inactive"], ["unknown body", JSON.stringify({ status: "weird" }), "unknown"]] as const) {
  test(`inactivateBill: ${label} -> success false (${outcome})`, async () => {
    net.plan = { status: 200, body };
    const r = await lib.inactivateBill("synthbill01");
    assert.deepEqual([r.success, r.outcome], [false, outcome]);
  });
}

test("transport failures throw (callers treat a throw as not inactivated)", async () => {
  net.plan = { status: 500, body: "boom" };
  await assert.rejects(lib.inactivateBill("synthbill01"), /HTTP 500/);
  net.plan = { status: 200, body: "secretKey parameter is empty!" };
  await assert.rejects(lib.inactivateBill("synthbill01"), lib.ToyyibPayNonJsonResponseError);
  net.plan = { throws: Object.assign(new Error("aborted"), { name: "AbortError" }) };
  await assert.rejects(lib.inactivateBill("synthbill01"), /timed out/);
  net.plan = { throws: new TypeError("fetch failed") };
  await assert.rejects(lib.inactivateBill("synthbill01"), /network error/);
  net.requests = []; net.plan = { status: 200, body: SUCCESS };
  await assert.rejects(lib.inactivateBill("  "), /billCode is required/);
  assert.equal(net.requests.length, 0, "no request without a bill code");
});

// ------------------------------------------------------------------ manual payment flow, real lib + stubbed fetch
const INVOICE = "11111111-1111-4111-8111-111111111111";
const ATTEMPT = "22222222-2222-4222-8222-222222222222";
const flow = { calls: [] as string[], rpcArgs: {} as Record<string, unknown[]> };
class Redirect extends Error { to: string; constructor(to: string) { super(`redirect:${to}`); this.to = to; } }
mock.module("next/cache.js", { namedExports: { revalidatePath: () => {} } });
mock.module("next/navigation.js", { namedExports: { redirect: (to: string) => { throw new Redirect(to); } } });
mock.module(url("lib/auth/session.ts"), { namedExports: { requireRole: async () => ({ id: "admin" }), requireModuleAccess: async () => {}, requireModuleCapability: async () => ({ id: "admin" }) } });
mock.module(url("lib/supabase/server.ts"), {
  namedExports: {
    createSupabaseServerClient: async () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { opportunity_id: null, quotation_id: null }, error: null }) }) }) }),
      rpc: async (name: string, args: unknown) => {
        flow.calls.push(name);
        (flow.rpcArgs[name] ??= []).push(args);
        if (name === "get_active_toyyibpay_attempt") return { data: { has_active_attempt: true, attempt_id: ATTEMPT, billcode: "synthbill01" }, error: null };
        // G3: the real RPC always reports an outcome; a payload without one is now treated as unconfirmed.
        if (name === "record_manual_payment") return { data: { outcome: "recorded", payment_id: "p1", amount_paid: 100, status: "partially_paid" }, error: null };
        return { data: {}, error: null };
      },
    }),
  },
});
const invoiceActions = await import("../app/admin/(protected)/invoices/actions.ts");
const paymentForm = () => {
  const f = new FormData();
  f.set("payment_provider", "bank_transfer"); f.set("amount", "100"); f.set("payment_date", "2026-11-23");
  // G1: bank transfers need a reference and every submission carries the form's idempotency key.
  f.set("payment_reference", "FT-TEST-0001"); f.set("idempotency_key", "33333333-3333-4333-8333-333333333333");
  return f;
};

for (const [label, plan] of [
  ["pending transaction (documented failed body)", { status: 200, body: PENDING }],
  ["already inactive (documented failed body)", { status: 200, body: INACTIVE }],
  ["unknown body", { status: 200, body: JSON.stringify({ status: "Success", result: "Bill status changed to inactive" }) }],
  ["HTTP 503", { status: 503, body: "" }],
  ["timeout", { throws: Object.assign(new Error("aborted"), { name: "AbortError" }) }],
  ["non-JSON", { status: 200, body: "<html>" }],
] as const) {
  test(`manual payment does NOT proceed when inactivation is ${label}`, async () => {
    flow.calls = []; flow.rpcArgs = {}; net.plan = plan as FetchPlan;
    const result = await invoiceActions.recordManualPaymentAction(INVOICE, {}, paymentForm());
    assert.match(result.message ?? "", /NOT recorded/);
    assert.deepEqual(flow.calls, ["get_active_toyyibpay_attempt", "log_toyyibpay_conflict"]);
    assert.deepEqual(flow.rpcArgs.log_toyyibpay_conflict, [{ p_invoice_id: INVOICE, p_attempt_id: ATTEMPT, p_conflict_type: "in_progress" }]);
  });
}

test("manual payment proceeds only after the documented success body", async () => {
  flow.calls = []; flow.rpcArgs = {}; net.plan = { status: 200, body: SUCCESS };
  const result = await invoiceActions.recordManualPaymentAction(INVOICE, {}, paymentForm());
  assert.equal(result.message, undefined);
  assert.equal(result.payment?.outcome, "recorded");
  assert.deepEqual(flow.calls, ["get_active_toyyibpay_attempt", "mark_toyyibpay_attempt_superseded", "record_manual_payment"]);
});

// ------------------------------------------------------------------ other callers (static)
test("orphan compensation logs 'deactivated' only from result.success; public registration still ignores the result", async () => {
  const link = await read("app/admin/(protected)/invoices/toyyibpayActions.ts");
  assert.match(link, /compensationSucceeded = result\.success;/);
  assert.match(link, /p_compensation_status: compensationSucceeded \? "deactivated" : "deactivation_failed"/);
  const registration = await read("app/api/registration/payment/route.ts");
  assert.match(registration, /await inactivateBill\(bill\.billCode\)\.catch\(/);
  const at = registration.indexOf("await inactivateBill(");
  const compensation = registration.slice(at, registration.indexOf("return NextResponse.json", at));
  assert.doesNotMatch(compensation, /\.success|\.outcome|=\s*await inactivateBill/, "registration compensation does not branch on the result");
  const manual = await read("app/admin/(protected)/invoices/actions.ts");
  assert.match(manual, /inactivateSucceeded = result\.success;/);
});
