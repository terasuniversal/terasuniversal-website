/**
 * PR-2a checks: the shared rate limiter calls its RPC with the server-side
 * (service-role) client under the Preview isolation guards, and the rate-limit
 * keys hold a keyed digest of the client identity instead of a raw IP address.
 *
 * Safety: `fetch` is replaced by a recording stub, so nothing leaves the process.
 * All credentials are synthetic. Supabase, ToyyibPay and every other provider are
 * never contacted.
 *
 * Run: node --experimental-transform-types scripts/rate-limit-service-client.test.mts
 */

import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export default {}", shortCircuit: true };
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

interface Recorded { url: string; headers: Record<string, string>; body: string }
const calls: Recorded[] = [];
let rpcAnswer: () => Response = () => new Response("true", { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (input: unknown, init?: { headers?: unknown; body?: unknown }) => {
  const request = input as { url?: string; headers?: Headers };
  const headers: Record<string, string> = {};
  const source = new Headers((init?.headers as HeadersInit | undefined) ?? request?.headers ?? {});
  source.forEach((value, name) => { headers[name.toLowerCase()] = value; });
  calls.push({ url: String(request?.url ?? input), headers, body: typeof init?.body === "string" ? init.body : "" });
  return rpcAnswer();
}) as typeof fetch;

const APPROVED = "abcdefghijklmnopqrst";
const PRODUCTION_REF = "iagzkrzeuawaxvacqprk";
const b64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload: Record<string, unknown>) => `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.c2lnbmF0dXJl`;
const productionEnv = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production", NODE_ENV: "production" };
const previewEnv = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview", NODE_ENV: "production" };
const stagingEnv = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "staging", NODE_ENV: "production" };
const PUBLISHABLE = "synthetic-publishable-key-not-for-the-limiter";
const PROD_SERVICE = jwt({ role: "service_role", ref: PRODUCTION_REF, marker: "synthetic-production-service" });
const STAGING_SERVICE = jwt({ role: "service_role", ref: APPROVED, marker: "synthetic-staging-service" });

const MANAGED = [
  "VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "NODE_ENV",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY",
  "TERAS_APPROVED_SUPABASE_PROJECT_REF", "TERAS_SERVICE_KEY_PROJECT_REF", "RATE_LIMIT_HMAC_SECRET",
];
function setEnv(values: Record<string, string>) {
  for (const key of MANAGED) delete process.env[key];
  Object.assign(process.env, { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, NEXT_PUBLIC_SUPABASE_ANON_KEY: PUBLISHABLE, ...values });
  calls.length = 0;
  rpcAnswer = () => new Response("true", { status: 200, headers: { "content-type": "application/json" } });
}
const productionConfig = { ...productionEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: PROD_SERVICE };
const stagingConfig = { ...stagingEnv, TERAS_APPROVED_SUPABASE_PROJECT_REF: APPROVED, NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: STAGING_SERVICE };

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
const logged: string[] = [];
const quiet = <T,>(fn: () => Promise<T>) => async () => {
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};
const rpcCalls = () => calls.filter((c) => c.url.includes("/rest/v1/rpc/check_public_rate_limit"));

const { checkSharedRateLimit, hashedClientId } = await import("../lib/rate-limit.js");

console.log("A. Service-role client and environment isolation");
await check("Production: the RPC is called with the service-role key, never the publishable key", quiet(async () => {
  setEnv(productionConfig);
  assert.equal(await checkSharedRateLimit({ key: "registration:create:abc", windowSeconds: 60, maxAttempts: 5, failClosed: true }), true);
  const [call] = rpcCalls();
  assert.ok(call, "RPC must be called");
  assert.ok(call.url.startsWith(`https://${PRODUCTION_REF}.supabase.co/`));
  assert.equal(call.headers.apikey, PROD_SERVICE);
  assert.ok(!Object.values(call.headers).some((v) => v.includes(PUBLISHABLE)), "publishable key must not be sent");
  assert.deepEqual(JSON.parse(call.body), { p_key: "registration:create:abc", p_window_seconds: 60, p_max_attempts: 5 });
}));
await check("RPC answer false is reported as not allowed (HTTP 429 upstream)", quiet(async () => {
  setEnv(productionConfig);
  rpcAnswer = () => new Response("false", { status: 200, headers: { "content-type": "application/json" } });
  assert.equal(await checkSharedRateLimit({ key: "k", windowSeconds: 60, maxAttempts: 1, failClosed: true }), false);
}));
await check("Preview cannot reach the Production project: no request, protected request rejected", quiet(async () => {
  setEnv({ ...previewEnv, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: PROD_SERVICE, TERAS_APPROVED_SUPABASE_PROJECT_REF: APPROVED });
  assert.equal(await checkSharedRateLimit({ key: "k", windowSeconds: 60, maxAttempts: 3, failClosed: true }), false);
  assert.equal(calls.length, 0);
}));
await check("Custom Staging with an approved non-Production project uses that project and its own key", quiet(async () => {
  setEnv(stagingConfig);
  assert.equal(await checkSharedRateLimit({ key: "k", windowSeconds: 60, maxAttempts: 3, failClosed: true }), true);
  const [call] = rpcCalls();
  assert.ok(call.url.startsWith(`https://${APPROVED}.supabase.co/`));
  assert.equal(call.headers.apikey, STAGING_SERVICE);
}));
await check("Staging with a service key for another project is refused (fail closed)", quiet(async () => {
  setEnv({ ...stagingConfig, SUPABASE_SERVICE_ROLE_KEY: PROD_SERVICE });
  assert.equal(await checkSharedRateLimit({ key: "k", windowSeconds: 60, maxAttempts: 3, failClosed: true }), false);
  assert.equal(calls.length, 0);
}));
await check("Unknown deployment target is refused (fail closed)", quiet(async () => {
  setEnv({ VERCEL: "1", NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: `https://${APPROVED}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: STAGING_SERVICE, TERAS_APPROVED_SUPABASE_PROJECT_REF: APPROVED });
  assert.equal(await checkSharedRateLimit({ key: "k", windowSeconds: 60, maxAttempts: 3, failClosed: true }), false);
  assert.equal(calls.length, 0);
}));
await check("Production with the service key missing: protected request rejected, no request", quiet(async () => {
  setEnv({ ...productionConfig, SUPABASE_SERVICE_ROLE_KEY: "" });
  assert.equal(await checkSharedRateLimit({ key: "k", windowSeconds: 60, maxAttempts: 3, failClosed: true }), false);
  assert.equal(calls.length, 0);
}));
await check("Production with the Supabase URL missing: protected request rejected, no request", quiet(async () => {
  setEnv({ ...productionConfig, NEXT_PUBLIC_SUPABASE_URL: "" });
  assert.equal(await checkSharedRateLimit({ key: "k", windowSeconds: 60, maxAttempts: 3, failClosed: true }), false);
  assert.equal(calls.length, 0);
}));
await check("a server error from the RPC rejects a protected request, and falls back locally otherwise", quiet(async () => {
  setEnv(productionConfig);
  rpcAnswer = () => new Response(JSON.stringify({ message: "boom" }), { status: 500, headers: { "content-type": "application/json" } });
  assert.equal(await checkSharedRateLimit({ key: "err-closed", windowSeconds: 60, maxAttempts: 2, failClosed: true }), false);
  assert.equal(await checkSharedRateLimit({ key: "err-open", windowSeconds: 60, maxAttempts: 2 }), true);
}));
await check("local development with a loopback stack keeps working", quiet(async () => {
  setEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", iss: "supabase-demo" }) });
  assert.equal(await checkSharedRateLimit({ key: "k", windowSeconds: 60, maxAttempts: 3 }), true);
  assert.ok(rpcCalls().length === 1 && rpcCalls()[0].url.startsWith("http://127.0.0.1:54321/"));
}));
await check("local development with no configuration uses the bounded in-memory fallback and honours the limit", quiet(async () => {
  setEnv({});
  const key = `fallback-${Math.random()}`;
  assert.equal(await checkSharedRateLimit({ key, windowSeconds: 60, maxAttempts: 2 }), true);
  assert.equal(await checkSharedRateLimit({ key, windowSeconds: 60, maxAttempts: 2 }), true);
  assert.equal(await checkSharedRateLimit({ key, windowSeconds: 60, maxAttempts: 2 }), false);
  assert.equal(calls.length, 0);
}));

console.log("B. Client identity minimisation");
await check("the digest is stable for one client and differs between clients", quiet(async () => {
  setEnv(productionConfig);
  assert.equal(hashedClientId("203.0.113.7"), hashedClientId("203.0.113.7"));
  assert.notEqual(hashedClientId("203.0.113.7"), hashedClientId("203.0.113.8"));
  assert.match(hashedClientId("203.0.113.7"), /^[a-f0-9]{32}$/);
}));
await check("the digest contains no raw IP, is not a plain SHA-256 of it, and does not expose the key", quiet(async () => {
  setEnv(productionConfig);
  const ip = "203.0.113.7";
  const digest = hashedClientId(ip);
  assert.ok(!digest.includes(ip));
  assert.notEqual(digest, createHash("sha256").update(ip).digest("hex").slice(0, 32));
  assert.ok(!digest.includes(PROD_SERVICE));
}));
await check("the digest is the HMAC of the documented context, so every instance computes the same value", quiet(async () => {
  setEnv(productionConfig);
  const derived = createHmac("sha256", PROD_SERVICE).update("teras:rate-limit:client-identity:v1").digest();
  assert.equal(hashedClientId("198.51.100.4"), createHmac("sha256", derived).update("198.51.100.4").digest("hex").slice(0, 32));
}));
await check("a dedicated RATE_LIMIT_HMAC_SECRET takes precedence; a short one is ignored", quiet(async () => {
  setEnv(productionConfig);
  const base = hashedClientId("198.51.100.4");
  setEnv({ ...productionConfig, RATE_LIMIT_HMAC_SECRET: "x".repeat(40) });
  const dedicated = hashedClientId("198.51.100.4");
  assert.notEqual(dedicated, base);
  setEnv({ ...productionConfig, RATE_LIMIT_HMAC_SECRET: "short" });
  assert.equal(hashedClientId("198.51.100.4"), base);
}));
await check("different environments (different keys) produce different digests", quiet(async () => {
  setEnv(productionConfig);
  const production = hashedClientId("198.51.100.4");
  setEnv(stagingConfig);
  assert.notEqual(hashedClientId("198.51.100.4"), production);
}));
await check("with no secret at all the digest still works, in-process only, and is not guessable from the IP", quiet(async () => {
  setEnv({});
  const digest = hashedClientId("198.51.100.4");
  assert.match(digest, /^[a-f0-9]{32}$/);
  assert.equal(digest, hashedClientId("198.51.100.4"));
  assert.notEqual(digest, createHash("sha256").update("198.51.100.4").digest("hex").slice(0, 32));
}));
await check("a missing or oversized address cannot break the key or exceed the length limit", quiet(async () => {
  setEnv(productionConfig);
  assert.match(hashedClientId(undefined), /^[a-f0-9]{32}$/);
  assert.equal(hashedClientId("1".repeat(5000)), hashedClientId("1".repeat(100)));
}));

console.log("C. Public registration routes");
const createRoute = await import("../app/api/registration/route.ts");
const paymentRoute = await import("../app/api/registration/payment/route.ts");
const statusRoute = await import("../app/api/registration/status/route.ts");
const post = (url: string, ip: string, raw = "not json") => new Request(url, { method: "POST", headers: { "x-forwarded-for": ip, "content-type": "application/json" }, body: raw });
const routes: Array<[string, (r: Request) => Promise<Response>, string, string]> = [
  ["create", createRoute.POST as never, "http://localhost/api/registration", "registration:create:"],
  ["payment", paymentRoute.POST as never, "http://localhost/api/registration/payment", "registration:payment:"],
  ["status", statusRoute.POST as never, "http://localhost/api/registration/status", "registration:status:"],
];
for (const [name, handler, url, prefix] of routes) {
  await check(`${name}: bucket uses the digest (not the raw IP), is the same on repeat and differs per client`, quiet(async () => {
    setEnv(productionConfig);
    await handler(post(url, "203.0.113.7"));
    await handler(post(url, "203.0.113.7"));
    await handler(post(url, "203.0.113.8"));
    const keys = rpcCalls().map((c) => JSON.parse(c.body).p_key as string);
    assert.equal(keys.length, 3);
    assert.ok(keys.every((k) => k.startsWith(prefix) && /^[a-z:]+[a-f0-9]{32}$/.test(k)), keys.join(","));
    assert.ok(keys.every((k) => !k.includes("203.0.113")), "no raw IP in key");
    assert.equal(keys[0], keys[1]);
    assert.notEqual(keys[0], keys[2]);
    assert.equal(keys[0], `${prefix}${hashedClientId("203.0.113.7")}`);
  }));
  await check(`${name}: limiter denial returns HTTP 429; limiter pass reaches the normal request handling (400 on a bad body; payment: 503 while ToyyibPay is unconfigured)`, quiet(async () => {
    setEnv(productionConfig);
    rpcAnswer = () => new Response("false", { status: 200, headers: { "content-type": "application/json" } });
    assert.equal((await handler(post(url, "203.0.113.7"))).status, 429);
    rpcAnswer = () => new Response("true", { status: 200, headers: { "content-type": "application/json" } });
    // Payment answers 503 when ToyyibPay is not configured (this test sets no ToyyibPay variables), which is also past the limiter.
    assert.equal((await handler(post(url, "203.0.113.7"))).status, name === "payment" ? 503 : 400);
  }));
  await check(`${name}: with the limiter configuration unavailable in Production the protected request is rejected with 429`, quiet(async () => {
    setEnv({ ...productionConfig, SUPABASE_SERVICE_ROLE_KEY: "" });
    assert.equal((await handler(post(url, "203.0.113.7"))).status, 429);
    assert.equal(calls.length, 0);
  }));
}

console.log("D. Logs and static contracts");
await check("no log line produced above contains a raw IP, a service key or the RPC key payload", () => {
  for (const line of logged) {
    assert.ok(!line.includes("203.0.113"), line);
    assert.ok(!line.includes(PROD_SERVICE) && !line.includes(STAGING_SERVICE), "service key in log");
  }
});
const read = (p: string) => readFileSync(path.join(root, p), "utf8");
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.(js|jsx|ts|tsx|mjs)$/.test(entry.name)) out.push(rel);
  }
  return out;
}
await check("the limiter no longer constructs an anonymous client or reads the publishable key", () => {
  const source = read("lib/rate-limit.js");
  assert.ok(!/createClient\(/.test(source) && !/PUBLISHABLE|ANON_KEY/.test(source));
  assert.match(source, /validatePrivilegedSupabaseConfig\(\)\.ok/);
  assert.match(source, /createSupabaseServiceClient\(\)/);
});
await check("no client-side module imports the limiter, and the service client module stays server-only", () => {
  for (const file of [...walk("app"), ...walk("components"), ...walk("lib")]) {
    const text = read(file);
    if (/^\s*["']use client["']/m.test(text.slice(0, 200))) {
      assert.ok(!/rate-limit/.test(text), `${file} is a client module and imports the rate limiter`);
    }
  }
  assert.match(read("lib/supabase/server.ts"), /^import "server-only";/m);
});
await check("every limiter caller keys on the digest and logs the digest only", () => {
  for (const file of ["app/api/registration/route.ts", "app/api/registration/payment/route.ts", "app/api/registration/status/route.ts"]) {
    const text = read(file);
    assert.match(text, /key: `registration:[a-z]+:\$\{hashedClientId\(clientIp\(request\)\)\}`/, file);
    assert.ok(!/ip: clientIp\(request\)/.test(text), `${file} still logs a raw IP`);
  }
});
await check("the ToyyibPay registration callback limiter call is untouched (order-based key, no IP)", () => {
  assert.match(read("app/api/payments/toyyibpay/registration-callback/route.ts"), /checkSharedRateLimit\(\{ key: `toyyibpay:registration-callback:\$\{value\.orderId\}`, windowSeconds: 60, maxAttempts: 10 \}\)/);
});
await check("the legacy admin login endpoint is still absent", () => {
  assert.ok(!existsSync(path.join(root, ["app", "api", "admin", "login"].join("/"))));
});

console.log(`\n${passed} rate-limit service-client check(s) passed${process.exitCode ? " (with failures)" : ""}.`);
