/**
 * Runtime checks for the Preview isolation guards: these import and EXECUTE the
 * real route handlers, middleware and client factories (not source-text
 * contracts) under different deployment targets.
 *
 * Safety: `fetch` is replaced by a recording stub, so no request ever leaves the
 * process (the stub answers every call with an empty JSON body). All credentials
 * are synthetic. ToyyibPay, Resend, Google Sheets and Supabase are never contacted.
 *
 * Run: node --experimental-transform-types scripts/preview-isolation-runtime.test.mts
 * (needs Node 22.15+ for module.registerHooks; also wired as `npm run test:preview-isolation-runtime`)
 */

import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// Minimal resolver so repo source (extensionless relative imports, `server-only`)
// loads under plain Node without a bundler. Only affects files inside the repo.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export default {}", shortCircuit: true };
    // Next's own subpath entry points ("next/server", "next/headers") are extensionless CJS files.
    if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
    const parent = context.parentURL;
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && parent?.startsWith("file:") && !/\.(m?[jt]sx?|cjs|json)$/.test(specifier)) {
      const parentPath = fileURLToPath(parent);
      if (parentPath.startsWith(root) && !parentPath.includes(`${path.sep}node_modules${path.sep}`)) {
        const base = path.resolve(path.dirname(parentPath), specifier);
        for (const suffix of [".ts", ".tsx", ".js", ".mjs", `${path.sep}index.ts`, `${path.sep}index.js`]) {
          const candidate = base + suffix;
          if (existsSync(candidate) && statSync(candidate).isFile()) return { url: pathToFileURL(candidate).href, shortCircuit: true };
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const fetchCalls: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  fetchCalls.push(String((input as { url?: string })?.url ?? input));
  return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

const APPROVED = "abcdefghijklmnopqrst";
const PRODUCTION_REF = "iagzkrzeuawaxvacqprk";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.c2lnbmF0dXJl`;
const productionEnv = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" };
const previewEnv = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" };
const stagingEnv = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "staging" };
const unknownEnv = { VERCEL: "1" };

const MANAGED = [
  "VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "NODE_ENV",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "TERAS_APPROVED_SUPABASE_PROJECT_REF", "TERAS_SERVICE_KEY_PROJECT_REF",
  "TOYYIBPAY_ENV", "TOYYIBPAY_USER_SECRET_KEY", "TOYYIBPAY_CATEGORY_CODE",
  "RESEND_API_KEY", "RESEND_FROM_EMAIL", "RESEND_AUDIENCE_ID", "GOOGLE_SHEETS_WEB_APP_URL",
];
function setEnv(values: Record<string, string>) {
  for (const key of MANAGED) delete process.env[key];
  Object.assign(process.env, {
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-publishable-key",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon-key",
    TOYYIBPAY_USER_SECRET_KEY: "synthetic-secret",
    TOYYIBPAY_CATEGORY_CODE: "synthetic-category",
    ...values,
  });
  fetchCalls.length = 0;
}
/** A fully valid approved non-production configuration (synthetic). */
const approvedConfig = {
  TERAS_APPROVED_SUPABASE_PROJECT_REF: APPROVED,
  NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: APPROVED }),
};
const productionProjectConfig = {
  NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
  SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: PRODUCTION_REF }),
};

let passed = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ok - ${name}`);
  } catch (error) {
    console.error(`  FAIL - ${name}`);
    console.error(`         ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const quiet = <T,>(fn: () => Promise<T>) => async () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

let ipCounter = 0;
const callbackBody = () => new URLSearchParams({ refno: "R1", status: "1", billcode: "B1", order_id: "O1", hash: "bad-hash" }).toString();
function callbackRequest(url: string) {
  return new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: callbackBody() });
}
const jsonRequest = (url: string, body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.0.0.${++ipCounter}` }, body: JSON.stringify(body) });

const callbackRoute = await import("../app/api/payments/toyyibpay/callback/route.ts");
const registrationCallbackRoute = await import("../app/api/payments/toyyibpay/registration-callback/route.ts");

console.log("A. ToyyibPay callbacks: blocked non-Production requests are explicit failures");
const blockedTargets: Array<[string, Record<string, string>]> = [
  ["preview", previewEnv], ["custom staging", stagingEnv], ["unknown target", unknownEnv], ["local", {}],
];
for (const [label, env] of blockedTargets) {
  await check(`${label}: /callback returns 503, not OK, with no outbound call (privileged config not approved)`, quiet(async () => {
    setEnv({ ...env, ...productionProjectConfig, TOYYIBPAY_ENV: "sandbox" });
    const res = await callbackRoute.POST(callbackRequest("http://localhost/api/payments/toyyibpay/callback") as never);
    assert.equal(res.status, 503);
    const text = await res.text();
    assert.notEqual(text.trim(), "OK");
    assert.equal(JSON.parse(text).code, "callback_disabled_non_production");
    assert.equal(fetchCalls.length, 0);
  }));
  await check(`${label}: /registration-callback returns 503, not OK, with no outbound call`, quiet(async () => {
    setEnv({ ...env, ...productionProjectConfig, TOYYIBPAY_ENV: "sandbox" });
    const res = await registrationCallbackRoute.POST(callbackRequest("http://localhost/api/payments/toyyibpay/registration-callback") as never);
    assert.equal(res.status, 503);
    assert.notEqual((await res.text()).trim(), "OK");
    assert.equal(fetchCalls.length, 0);
  }));
}
await check("preview with an approved project but live ToyyibPay mode: callback is 503 before any outbound call", quiet(async () => {
  setEnv({ ...previewEnv, ...approvedConfig, TOYYIBPAY_ENV: "production" });
  for (const [route, url] of [[callbackRoute, "http://localhost/api/payments/toyyibpay/callback"], [registrationCallbackRoute, "http://localhost/api/payments/toyyibpay/registration-callback"]] as const) {
    const res = await route.POST(callbackRequest(url) as never);
    assert.equal(res.status, 503);
    assert.notEqual((await res.text()).trim(), "OK");
  }
  assert.equal(fetchCalls.length, 0);
}));
await check("preview with an approved project and sandbox mode: callback is still acknowledged (provider contract preserved)", quiet(async () => {
  setEnv({ ...previewEnv, ...approvedConfig, TOYYIBPAY_ENV: "sandbox" });
  const res = await callbackRoute.POST(callbackRequest("http://localhost/api/payments/toyyibpay/callback") as never);
  assert.equal(res.status, 200);
  assert.equal((await res.text()).trim(), "OK");
  assert.ok(fetchCalls.length >= 1, "invalid-hash event should be logged through the (stubbed) Supabase client");
  assert.ok(fetchCalls.every((url) => url.startsWith(`https://${APPROVED}.supabase.co/`)), "only the approved project host is addressed");
}));
for (const [route, url, label] of [
  [callbackRoute, "http://localhost/api/payments/toyyibpay/callback", "/callback"],
  [registrationCallbackRoute, "http://localhost/api/payments/toyyibpay/registration-callback", "/registration-callback"],
] as const) {
  await check(`production ${label}: unchanged generic OK acknowledgement (invalid hash)`, quiet(async () => {
    setEnv({ ...productionEnv, ...productionProjectConfig, TOYYIBPAY_ENV: "production" });
    const res = await route.POST(callbackRequest(url) as never);
    assert.equal(res.status, 200);
    assert.equal((await res.text()).trim(), "OK");
    assert.ok(fetchCalls.length >= 1 && fetchCalls.every((u) => u.startsWith(`https://${PRODUCTION_REF}.supabase.co/`)));
  }));
  await check(`production ${label}: malformed body still gets the generic OK`, quiet(async () => {
    setEnv({ ...productionEnv, ...productionProjectConfig, TOYYIBPAY_ENV: "production" });
    const res = await route.POST(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }) as never);
    assert.equal(res.status, 200);
    assert.equal((await res.text()).trim(), "OK");
  }));
}

console.log("B. anon / authenticated clients cannot use Production from non-Production");
const resetRoute = await import("../app/api/admin/reset-password/route.js");
for (const [label, env] of [["preview", previewEnv], ["custom staging", stagingEnv], ["local", {}]] as Array<[string, Record<string, string>]>) {
  await check(`${label}: password reset is blocked with 503 when the URL is the Production project`, quiet(async () => {
    setEnv({ ...env, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` });
    const reset = await resetRoute.POST(jsonRequest("http://localhost/api/admin/reset-password", { email: "a@b.co" }));
    assert.equal(reset.status, 503);
    assert.equal((await reset.json()).code, "production_project_in_non_production");
    assert.equal(fetchCalls.length, 0, "no request may be sent to the Production project");
  }));
}
await check("preview with a non-Production project: password reset proceeds (read-only and Auth Preview flows not broken)", quiet(async () => {
  setEnv({ ...previewEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED}.supabase.co` });
  const reset = await resetRoute.POST(jsonRequest("http://localhost/api/admin/reset-password", { email: "a@b.co" }));
  assert.notEqual(reset.status, 503);
  assert.ok(fetchCalls.length >= 1 && fetchCalls.every((u) => u.startsWith(`https://${APPROVED}.supabase.co/`)));
}));
await check("preview with a configured approved project rejects any other project, not just Production", quiet(async () => {
  setEnv({ ...previewEnv, TERAS_APPROVED_SUPABASE_PROJECT_REF: APPROVED, NEXT_PUBLIC_SUPABASE_URL: "https://tsrqponmlkjihgfedcba.supabase.co" });
  const reset = await resetRoute.POST(jsonRequest("http://localhost/api/admin/reset-password", { email: "a@b.co" }));
  assert.equal(reset.status, 503);
  assert.equal((await reset.json()).code, "url_ref_mismatch");
  assert.equal(fetchCalls.length, 0);
}));
await check("production: password reset proceeds against the Production project (unchanged)", quiet(async () => {
  setEnv({ ...productionEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` });
  const reset = await resetRoute.POST(jsonRequest("http://localhost/api/admin/reset-password", { email: "a@b.co" }));
  assert.notEqual(reset.status, 503);
  assert.ok(fetchCalls.length >= 1 && fetchCalls.every((u) => u.startsWith(`https://${PRODUCTION_REF}.supabase.co/`)));
}));
await check("unknown target is not taken down by the anon guard (cannot be told apart from Production)", quiet(async () => {
  setEnv({ ...unknownEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` });
  const reset = await resetRoute.POST(jsonRequest("http://localhost/api/admin/reset-password", { email: "a@b.co" }));
  assert.notEqual(reset.status, 503);
}));

const { createSupabaseServerClient } = await import("../lib/supabase/server.ts");
await check("createSupabaseServerClient (public registration, certificates, staff Auth reads) is blocked before touching cookies", quiet(async () => {
  setEnv({ ...previewEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` });
  await assert.rejects(() => createSupabaseServerClient(), (error: Error) => error.name === "PreviewIsolationError");
}));
await check("createSupabaseServerClient passes the guard with a non-Production project (fails later only for the missing request scope)", quiet(async () => {
  setEnv({ ...previewEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED}.supabase.co` });
  await assert.rejects(() => createSupabaseServerClient(), (error: Error) => error.name !== "PreviewIsolationError");
}));

const { updateSession } = await import("../lib/supabase/middleware.ts");
const { NextRequest } = await import("next/server");
await check("admin middleware returns 503 in Preview when pointed at Production, and proceeds otherwise", quiet(async () => {
  setEnv({ ...previewEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` });
  const blocked = await updateSession(new NextRequest("http://localhost/admin/dashboard"));
  assert.equal(blocked.status, 503);
  setEnv({ ...previewEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED}.supabase.co` });
  assert.notEqual((await updateSession(new NextRequest("http://localhost/admin/dashboard"))).status, 503);
  setEnv({ ...productionEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` });
  assert.notEqual((await updateSession(new NextRequest("http://localhost/admin/dashboard"))).status, 503);
}));

const { checkSharedRateLimit } = await import("../lib/rate-limit.js");
await check("shared rate limiter never calls the Production project from Preview", quiet(async () => {
  setEnv({ ...previewEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` });
  await checkSharedRateLimit({ key: "k", windowSeconds: 60, maxAttempts: 3 });
  assert.equal(fetchCalls.length, 0);
}));

console.log("C. local development");
await check("local + loopback Supabase URL: anon routes proceed (no approved ref needed)", quiet(async () => {
  setEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" });
  const reset = await resetRoute.POST(jsonRequest("http://localhost/api/admin/reset-password", { email: "a@b.co" }));
  assert.notEqual(reset.status, 503);
  assert.ok(fetchCalls.length >= 1 && fetchCalls.every((u) => u.startsWith("http://127.0.0.1:54321/")));
}));
await check("local + loopback URL: privileged callback is processed against the local stack (not blocked)", quiet(async () => {
  setEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", iss: "supabase-demo" }), TOYYIBPAY_ENV: "sandbox" });
  const res = await callbackRoute.POST(callbackRequest("http://localhost/api/payments/toyyibpay/callback") as never);
  assert.equal(res.status, 200);
  assert.ok(fetchCalls.length >= 1 && fetchCalls.every((u) => u.startsWith("http://127.0.0.1:54321/")));
}));
await check("local + Production URL: anon and privileged paths are both blocked", quiet(async () => {
  setEnv({ ...productionProjectConfig });
  const reset = await resetRoute.POST(jsonRequest("http://localhost/api/admin/reset-password", { email: "a@b.co" }));
  assert.equal(reset.status, 503);
  const cb = await callbackRoute.POST(callbackRequest("http://localhost/api/payments/toyyibpay/callback") as never);
  assert.equal(cb.status, 503);
  assert.equal(fetchCalls.length, 0);
}));
for (const [label, env] of [["preview", previewEnv], ["custom staging", stagingEnv], ["unknown target", unknownEnv], ["development", { VERCEL_TARGET_ENV: "development", VERCEL_ENV: "development" }]] as Array<[string, Record<string, string>]>) {
  await check(`${label} + loopback URL: privileged callback is blocked (loopback exception is local-only)`, quiet(async () => {
    setEnv({ ...env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", iss: "supabase-demo" }), TOYYIBPAY_ENV: "sandbox" });
    const res = await callbackRoute.POST(callbackRequest("http://localhost/api/payments/toyyibpay/callback") as never);
    assert.equal(res.status, 503);
    assert.equal(fetchCalls.length, 0);
  }));
}

console.log("D. outbound routes, executed (not just ordered)");
const contactRoute = await import("../app/api/contact/route.js");
const newsletterRoute = await import("../app/api/newsletter/route.js");
const proposalRoute = await import("../app/api/request-proposal/route.js");
for (const [label, env] of blockedTargets) {
  await check(`${label}: contact, newsletter and request-proposal return 503 and make no outbound call`, quiet(async () => {
    setEnv({ ...env, ...approvedConfig, RESEND_API_KEY: "synthetic-resend", RESEND_FROM_EMAIL: "x@example.test", RESEND_AUDIENCE_ID: "aud", GOOGLE_SHEETS_WEB_APP_URL: "https://sheets.invalid/exec" });
    for (const [route, url] of [[contactRoute, "http://localhost/api/contact"], [newsletterRoute, "http://localhost/api/newsletter"], [proposalRoute, "http://localhost/api/request-proposal"]] as const) {
      const res = await route.POST(jsonRequest(url, { email: "a@b.co" }) as never);
      assert.equal(res.status, 503);
      const body = await res.json();
      assert.equal(body.code, "outbound_disabled_non_production");
      assert.equal("ok" in body, false);
    }
    assert.equal(fetchCalls.length, 0);
  }));
}
await check("production: the same routes proceed past the guard to their own validation", quiet(async () => {
  setEnv({ ...productionEnv, ...productionProjectConfig });
  assert.equal((await contactRoute.POST(jsonRequest("http://localhost/api/contact", { name: "x" }) as never)).status, 400);
  assert.equal((await proposalRoute.POST(jsonRequest("http://localhost/api/request-proposal", { companyName: "x" }) as never)).status, 400);
  assert.equal((await newsletterRoute.POST(jsonRequest("http://localhost/api/newsletter", { email: "a@b.co" }) as never)).status, 503);
  assert.equal(fetchCalls.length, 0);
}));

console.log(`\n${passed} runtime check(s) passed.`);
if (process.exitCode) {
  console.error("Some runtime checks FAILED -- see above.");
  process.exit(process.exitCode);
}
