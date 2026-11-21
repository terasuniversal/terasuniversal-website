/**
 * PKG-1b-A contract: public registration and ToyyibPay server-side hardening (owner-approved, 21 Nov 2026).
 *
 * Runs the REAL POST /api/registration, POST /api/registration/payment and POST
 * /api/payments/toyyibpay/registration-callback with the REAL lib/payments/toyyibpay.ts, against recording fakes for
 * Supabase and the shared rate limiter (defined in this file) and a stubbed next/headers. Global fetch is replaced: it
 * answers only synthetic https://dev.toyyibpay.com calls and fails the run on anything else, so nothing leaves the
 * process. No database, no ToyyibPay sandbox or live call, no environment outside this process. All data is synthetic.
 *
 * Run: node --experimental-transform-types scripts/pkg1b-registration-hardening-contract.mts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONTRACT_BASE } from "./contract-base.mts";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n");

// ---- fakes -----------------------------------------------------------------------------------------------------------
const FAKE_DB = `data:text/javascript,${encodeURIComponent(`
import { createHash } from "node:crypto";
const st = () => globalThis.__pkg1b;
function client(kind) {
  st().clients.push(kind);
  return {
    kind,
    async rpc(name, args) {
      st().rpcs.push({ name, args, kind });
      const answer = st().rpc[name];
      return typeof answer === "function" ? answer(args) : (answer ?? { data: null, error: { message: "synthetic: no answer" } });
    },
    from(table) {
      const q = { table, filters: [] };
      const b = {
        select: () => b, in: () => b, order: () => b, limit: () => b, is: () => b,
        eq: (column, value) => { q.filters.push([column, value]); return b; },
        maybeSingle: async () => {
          st().reads.push({ table, kind, filters: q.filters });
          const answer = st().tables[table];
          return typeof answer === "function" ? answer(q) : (answer ?? { data: null, error: null });
        },
      };
      return b;
    },
  };
}
export async function createSupabaseServerClient() { return client("server"); }
export function createSupabaseServiceClient() { if (st().serviceThrows) throw new Error("synthetic isolation refusal"); return client("service"); }
export function getSupabaseClient() { return client("anon"); }
export async function checkSharedRateLimit(options) { st().limits.push(options); return !(st().deny && st().deny(options.key)); }
export function hashedClientId(value) { return createHash("sha256").update(String(value)).digest("hex").slice(0, 32); }
`)}`;
const FAKE_HEADERS = `data:text/javascript,${encodeURIComponent(`export async function headers() { return new Headers(globalThis.__pkg1b.headers); }`)}`;
const FAKED = [/[\\/]lib[\\/]supabase[\\/]server\.ts$/, /[\\/]lib[\\/]rate-limit\.js$/];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export default {}", shortCircuit: true };
    if (specifier === "next/headers") return { url: FAKE_HEADERS, shortCircuit: true };
    if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
    const parent = context.parentURL;
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && parent?.startsWith("file:")) {
      const parentPath = fileURLToPath(parent);
      if (parentPath.startsWith(root) && !parentPath.includes(`${path.sep}node_modules${path.sep}`)) {
        const base = path.resolve(path.dirname(parentPath), specifier);
        for (const suffix of ["", ".ts", ".tsx", ".js", ".mjs", `${path.sep}index.ts`, `${path.sep}index.js`]) {
          const candidate = base + suffix;
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            if (FAKED.some((pattern) => pattern.test(candidate))) return { url: FAKE_DB, shortCircuit: true };
            return { url: pathToFileURL(candidate).href, shortCircuit: true };
          }
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

interface Fetched { url: string; params: URLSearchParams }
interface State {
  clients: string[]; rpcs: { name: string; args: Record<string, unknown>; kind: string }[];
  reads: { table: string; kind: string; filters: [string, unknown][] }[]; limits: { key: string; maxAttempts: number; windowSeconds: number; failClosed?: boolean }[];
  rpc: Record<string, unknown>; tables: Record<string, unknown>; deny?: (key: string) => boolean; serviceThrows?: boolean;
  headers: Record<string, string>; fetched: Fetched[]; forbidden: string[]; provider: Record<string, () => unknown>;
}
const st = () => (globalThis as unknown as { __pkg1b: State }).__pkg1b;

globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
  const url = String((input as { url?: string })?.url ?? input);
  if (!url.startsWith("https://dev.toyyibpay.com/")) { st().forbidden.push(url); throw new Error(`blocked outbound request: ${url}`); }
  const params = new URLSearchParams(String(init?.body ?? ""));
  st().fetched.push({ url, params });
  const endpoint = url.replace("https://dev.toyyibpay.com/index.php/api/", "");
  const answer = st().provider[endpoint];
  const body = answer ? answer() : [{ msg: "synthetic: unknown endpoint", status: "error" }];
  return { ok: true, status: 200, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) } as Response;
}) as typeof fetch;

const SITE = "https://www.terasuniversal.com.my";
const SECRET = "a".repeat(64);
const REFERENCE = "TU-REG-PKG1B0001";
const SCHEDULE = "11111111-1111-4111-8111-111111111111";
const TOYYIBPAY_SECRET = "synthetic-toyyibpay-secret";
const createBody = { schedule_id: SCHEDULE, idempotency_key: "synthetic-idempotency-key-pkg1b", registration_secret: SECRET, attendees: [{ full_name: "Synthetic Attendee", email: "synthetic@example.invalid", phone: "0100000000" }] };
const paymentBody = (reference = REFERENCE) => ({ registration_reference: reference, registration_secret: SECRET, provider: "toyyibpay" });

function reset(options: { flag?: string | null } = {}) {
  if (options.flag === null) delete process.env.TERAS_PUBLIC_REGISTRATION; else process.env.TERAS_PUBLIC_REGISTRATION = options.flag ?? "enabled";
  process.env.TOYYIBPAY_ENV = "sandbox";
  process.env.TOYYIBPAY_USER_SECRET_KEY = TOYYIBPAY_SECRET;
  process.env.TOYYIBPAY_CATEGORY_CODE = "synthetic-category";
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  const holdEndsAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  (globalThis as unknown as { __pkg1b: State }).__pkg1b = {
    clients: [], rpcs: [], reads: [], limits: [], fetched: [], forbidden: [],
    headers: { host: "www.terasuniversal.com.my" },
    rpc: {
      create_public_registration: { data: { status: "created", registration_reference: REFERENCE, amount: 650, currency: "MYR" }, error: null },
      begin_public_registration_payment: { data: { registration_reference: REFERENCE, amount: 650, currency: "MYR", status: "pending", payment_url: null, bill_creation_owner: true }, error: null },
      attach_public_registration_toyy_pay_bill: { data: { status: "attached" }, error: null },
      fail_public_registration_payment_setup: { data: { outcome: "failed" }, error: null },
      record_public_registration_payment_orphan: { data: { outcome: "recorded" }, error: null },
      finalize_public_registration_payment_from_callback: { data: { outcome: "confirmed" }, error: null },
      mark_public_registration_payment_failed_from_callback: { data: { outcome: "failed" }, error: null },
      log_public_registration_payment_event: { data: null, error: null },
    },
    tables: {
      public_registrations: { data: { id: "reg-1", hold_expires_at: holdEndsAt }, error: null },
      public_registration_payments: (q: { filters: [string, unknown][] }) => q.filters.some(([c]) => c === "id")
        ? { data: { id: "att-1", provider_bill_code: "PKG1BBILL", status: "processing" }, error: null }
        : { data: { id: "att-1", amount: "650.00", payment_url: null, bill_creation_state: "claimed" }, error: null },
      public_registration_attendees: { data: { full_name: "Synthetic Payer", email: "payer@example.invalid", phone: "0100000000" }, error: null },
    },
    provider: {
      createBill: () => [{ BillCode: "PKG1BBILL" }],
      inactiveBill: () => [{ status: "success" }],
      getBillTransactions: () => [{ billpaymentStatus: "1", billpaymentAmount: "650.00", billpaymentInvoiceNo: "TP-REF-1", billCode: "PKG1BBILL", billPaymentDate: "21-11-2026 12:00:00" }],
    },
  };
  return holdEndsAt;
}

const request = (route: string, body: unknown, origin: string | null = SITE, site = SITE, ip = "203.0.113.7") => new Request(`${site}${route}`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": ip, ...(origin === null ? {} : { origin }) },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

const createRoute = (await import("../app/api/registration/route.ts")).POST;
const paymentRoute = (await import("../app/api/registration/payment/route.ts")).POST;
const callbackRoute = (await import("../app/api/payments/toyyibpay/registration-callback/route.ts")).POST;
const { formatToyyibpayExpiryDate } = await import("../lib/payments/toyyibpay.ts");
const { registrationReferenceBucket } = await import("../lib/public-registration.ts");
const digest = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

let failures = 0;
const results: string[] = [];
const logged: string[] = [];
async function check(id: string, name: string, fn: () => Promise<void> | void) {
  logged.length = 0;
  const original = console.error; console.error = (...args: unknown[]) => { logged.push(JSON.stringify(args)); };
  try { await fn(); results.push(`LULUS ${id} ${name}`); }
  catch (error) { failures += 1; results.push(`GAGAL ${id} ${name} -> ${(error as Error).message.split("\n")[0]}`); }
  finally { console.error = original; }
}
const nothingHappened = () => {
  assert.equal(st().rpcs.length, 0, "no RPC"); assert.equal(st().reads.length, 0, "no table read");
  assert.equal(st().fetched.length + st().forbidden.length, 0, "no outbound request");
};

// ---- N1 F-1 OFF ------------------------------------------------------------------------------------------------------
await check("N1", "F-1 OFF: create and payment answer 503 before Origin, rate limit, parsing, any client, database or ToyyibPay", async () => {
  for (const flag of [null, "", "true", "ENABLED"]) {
    reset({ flag });
    assert.equal((await createRoute(request("/api/registration", createBody))).status, 503);
    assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 503);
    assert.equal((await createRoute(request("/api/registration", createBody, null))).status, 503, "even without Origin");
    nothingHappened(); assert.equal(st().limits.length, 0); assert.equal(st().clients.length, 0);
  }
});

// ---- N2 privileged create --------------------------------------------------------------------------------------------
await check("N2", "create: the write RPC runs through the server-only service client, never the anon/session client", async () => {
  reset();
  const res = await createRoute(request("/api/registration", createBody));
  assert.equal(res.status, 201);
  assert.deepEqual(st().rpcs.map((c) => [c.name, c.kind]), [["create_public_registration", "service"]]);
  assert.deepEqual(st().clients, ["service"], "no anon or session client is even constructed");
  assert.equal(st().reads.length, 0, "no direct table access");
  assert.deepEqual(st().limits.map((l) => l.key), [`registration:create:${digest("203.0.113.7")}`]);
});
await check("N2b", "create: a service client refusal (isolation guard) is a 503 with a generic message, no RPC", async () => {
  reset(); st().serviceThrows = true;
  const res = await createRoute(request("/api/registration", createBody));
  assert.equal(res.status, 503);
  assert.doesNotMatch(JSON.stringify(await res.json()), /isolation|service|synthetic/i);
  assert.equal(st().rpcs.length, 0);
});

// ---- N3 privileged payment + bill expiry ---------------------------------------------------------------------------
await check("N3", "payment: begin via service client; bill amount from the server; billExpiryDate = the hold deadline in Malaysia time", async () => {
  const holdEndsAt = reset();
  const res = await paymentRoute(request("/api/registration/payment", paymentBody()));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).payment_url, "https://dev.toyyibpay.com/PKG1BBILL");
  assert.ok(st().rpcs.every((c) => c.kind === "service"), "every RPC through the service client");
  assert.deepEqual(st().rpcs.map((c) => c.name), ["begin_public_registration_payment", "attach_public_registration_toyy_pay_bill"]);
  assert.deepEqual(st().clients, ["service"]);
  const bills = st().fetched.filter((f) => f.url.endsWith("/createBill"));
  assert.equal(bills.length, 1);
  assert.equal(bills[0].params.get("billAmount"), "65000", "amount comes from the server-side attempt row");
  assert.equal(bills[0].params.get("billPriceSetting"), "1", "fixed price");
  assert.equal(bills[0].params.get("billExternalReferenceNo"), "att-1");
  assert.equal(bills[0].params.get("billExpiryDate"), formatToyyibpayExpiryDate(new Date(holdEndsAt)));
  assert.match(bills[0].params.get("billExpiryDate") ?? "", /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
});
await check("N3b", "payment: the request body cannot set the amount (extra fields are ignored)", async () => {
  reset();
  await paymentRoute(request("/api/registration/payment", { ...paymentBody(), amount: 1, billAmount: "100" }));
  assert.equal(st().fetched.find((f) => f.url.endsWith("/createBill"))?.params.get("billAmount"), "65000");
});

// ---- N4/N5/N6 Origin -------------------------------------------------------------------------------------------------
await check("N4", "Origin missing: create and payment answer 403 before rate limiting or any database call", async () => {
  reset();
  assert.equal((await createRoute(request("/api/registration", createBody, null))).status, 403);
  assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody(), null))).status, 403);
  nothingHappened(); assert.equal(st().limits.length, 0); assert.equal(st().clients.length, 0);
});
await check("N5", "untrusted Origins are refused (any *.vercel.app, null, look-alikes, other schemes, paths, ports)", async () => {
  for (const origin of ["https://evil.vercel.app", "https://terasuniversal-website-git-x-terasuniversal-my.vercel.app", "null", "", "https://www.terasuniversal.com.my.evil.test",
    "https://evil.test", "http://www.terasuniversal.com.my", "https://www.terasuniversal.com.my/", "https://www.terasuniversal.com.my:8443", "https://user@www.terasuniversal.com.my", "not a url"]) {
    reset();
    assert.equal((await createRoute(request("/api/registration", createBody, origin))).status, 403, origin);
    assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody(), origin))).status, 403, origin);
    nothingHappened(); assert.equal(st().limits.length, 0, origin);
  }
});
await check("N6", "trusted Origins are accepted: www, apex, NEXT_PUBLIC_SITE_URL and the deployment's own origin", async () => {
  const cases: [string, string, string | undefined][] = [
    [SITE, SITE, undefined],
    ["https://terasuniversal.com.my", SITE, undefined],
    ["https://staging.teras.example", "https://staging.teras.example", "https://staging.teras.example"],
    ["https://terasuniversal-website-own123-terasuniversal-my.vercel.app", "https://terasuniversal-website-own123-terasuniversal-my.vercel.app", undefined],
  ];
  for (const [origin, site, configured] of cases) {
    reset();
    if (configured) process.env.NEXT_PUBLIC_SITE_URL = configured; else delete process.env.NEXT_PUBLIC_SITE_URL;
    assert.equal((await createRoute(request("/api/registration", createBody, origin, site))).status, 201, origin);
  }
});

// ---- N7 rate limits --------------------------------------------------------------------------------------------------
await check("N7a", "payment limits: per-IP 3/60s (unchanged) then per-reference 3/60s, both shared and fail-closed", async () => {
  reset();
  await paymentRoute(request("/api/registration/payment", paymentBody()));
  const [ip, ref] = st().limits;
  assert.deepEqual([ip.key, ip.maxAttempts, ip.windowSeconds, ip.failClosed], [`registration:payment:${digest("203.0.113.7")}`, 3, 60, true]);
  assert.deepEqual([ref.key, ref.maxAttempts, ref.windowSeconds, ref.failClosed], [`registration:payment-ref:${digest(REFERENCE)}`, 3, 60, true]);
});
await check("N7b", "per-IP exhaustion: 429 before parsing (even an invalid body) and before any database call", async () => {
  reset(); st().deny = (key) => key.startsWith("registration:payment:");
  assert.equal((await paymentRoute(request("/api/registration/payment", "not json"))).status, 429);
  assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 429);
  nothingHappened(); assert.equal(st().clients.length, 0);
});
await check("N7c", "per-reference exhaustion: 429 after validation, before the service client, RPC or ToyyibPay", async () => {
  reset(); st().deny = (key) => key.startsWith("registration:payment-ref:");
  assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 429);
  nothingHappened(); assert.equal(st().clients.length, 0);
  assert.equal(st().limits.length, 2, "the per-IP bucket was still consumed first");
});
await check("N7d", "combined: per-IP denial wins; the per-reference bucket is not touched", async () => {
  reset(); st().deny = () => true;
  assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 429);
  assert.equal(st().limits.length, 1);
});
await check("N7e", "the reference bucket cannot be bypassed by case, spacing or Unicode compatibility forms; other references differ", async () => {
  const keys = new Set<string>();
  for (const reference of [REFERENCE, "tu-reg-pkg1b0001", "  TU-REG-PKG1B0001  ", "Tu-Reg-Pkg1b0001", "ＴＵ-ＲＥＧ-ＰＫＧ１Ｂ０００１"]) {
    reset();
    await paymentRoute(request("/api/registration/payment", paymentBody(reference)));
    keys.add(st().limits[1].key);
  }
  assert.equal(keys.size, 1, [...keys].join(","));
  assert.equal(registrationReferenceBucket("tu reg pkg1b 0001"), "TUREGPKG1B0001");
  reset();
  await paymentRoute(request("/api/registration/payment", paymentBody("TU-REG-OTHER0002")));
  assert.notEqual(st().limits[1].key, [...keys][0]);
});
await check("N7f", "create keeps its per-IP 5/60s shared fail-closed bucket", async () => {
  reset();
  await createRoute(request("/api/registration", createBody));
  assert.deepEqual([st().limits[0].maxAttempts, st().limits[0].windowSeconds, st().limits[0].failClosed], [5, 60, true]);
});

// ---- N8 validation ---------------------------------------------------------------------------------------------------
await check("N8", "invalid bodies are 400 with no RPC (bad UUID, secret, attendee count, reference length)", async () => {
  for (const body of [{ ...createBody, schedule_id: "x" }, { ...createBody, registration_secret: "z".repeat(64) }, { ...createBody, attendees: [] },
    { ...createBody, attendees: Array.from({ length: 101 }, () => createBody.attendees[0]) }, "not json"]) {
    reset();
    assert.equal((await createRoute(request("/api/registration", body))).status, 400);
    assert.equal(st().rpcs.length, 0);
  }
  for (const body of [{ ...paymentBody(), registration_secret: "short" }, { ...paymentBody(), registration_reference: "x" }, { ...paymentBody(), provider: "other" }]) {
    reset();
    assert.equal((await paymentRoute(request("/api/registration/payment", body))).status, 400);
    nothingHappened();
  }
});

// ---- N9 database errors ----------------------------------------------------------------------------------------------
const noBill = () => assert.equal(st().fetched.filter((f) => f.url.endsWith("/createBill")).length, 0, "no bill created");
// Every checked database error is logged with its step, and no log line carries the registration secret.
const loggedStep = (step: string) => {
  assert.ok(logged.some((line) => line.includes(`"step":"${step}"`)), `the ${step} lookup error is logged`);
  assert.ok(logged.every((line) => !line.includes(SECRET)), "no secret in logs");
};
await check("N9a", "registration lookup error: 502, no bill, error not echoed", async () => {
  reset(); st().tables.public_registrations = { data: null, error: { message: "synthetic relation failure secret-detail" } };
  const res = await paymentRoute(request("/api/registration/payment", paymentBody()));
  assert.equal(res.status, 502); noBill(); loggedStep("registration");
  assert.doesNotMatch(JSON.stringify(await res.json()), /secret-detail|relation/);
});
await check("N9b", "payment attempt lookup error: 502, no bill", async () => {
  reset(); st().tables.public_registration_payments = { data: null, error: { message: "synthetic failure" } };
  assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 502); noBill(); loggedStep("attempt");
});
await check("N9c", "payer lookup error: 502, no bill, and the claimed attempt is released so the payer can retry", async () => {
  reset(); st().tables.public_registration_attendees = { data: null, error: { message: "synthetic failure" } };
  assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 502); noBill(); loggedStep("payer");
  assert.deepEqual(st().rpcs.filter((c) => c.name === "fail_public_registration_payment_setup").map((c) => c.args.p_attempt_id), ["att-1"]);
  // Recovery: the next attempt (database healthy again) reaches ToyyibPay normally.
  st().tables.public_registration_attendees = { data: { full_name: "Synthetic Payer", email: null, phone: null }, error: null };
  assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 200);
});
await check("N9d", "unclaimed or missing attempt: 502, no bill", async () => {
  reset(); st().tables.public_registration_payments = { data: { id: "att-1", amount: "650.00", payment_url: null, bill_creation_state: "attached" }, error: null };
  assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 502); noBill();
});
await check("N9e", "begin RPC refusal (wrong secret / expired): 400, database detail not echoed, no lookups, no bill", async () => {
  // supabase-js returns `error` as a plain object (not an Error), so the existing publicErrorMessage() answers with its
  // generic text here -- pre-existing behaviour, recorded in the PKG-1b report, unchanged by this package.
  reset(); st().rpc.begin_public_registration_payment = { data: null, error: { message: "registration_expired", code: "P0001" } };
  const res = await paymentRoute(request("/api/registration/payment", paymentBody()));
  assert.equal(res.status, 400); assert.doesNotMatch(JSON.stringify(await res.json()), /P0001|registration_expired/); noBill(); assert.equal(st().reads.length, 0);
});

// ---- N10 hold deadline and provider failure --------------------------------------------------------------------------
await check("N10a", "hold boundary: under 60 s remaining (or missing/invalid) -> 409, claim released, no bill", async () => {
  for (const hold of [new Date(Date.now() + 59_000).toISOString(), new Date(Date.now() - 1_000).toISOString(), null, "not a date"]) {
    reset(); st().tables.public_registrations = { data: { id: "reg-1", hold_expires_at: hold }, error: null };
    assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 409, String(hold)); noBill();
    assert.equal(st().rpcs.filter((c) => c.name === "fail_public_registration_payment_setup").length, 1, String(hold));
  }
});
await check("N10b", "hold boundary: about 61 s remaining still creates a bill that expires at the hold deadline", async () => {
  reset(); const hold = new Date(Date.now() + 61_500).toISOString();
  st().tables.public_registrations = { data: { id: "reg-1", hold_expires_at: hold }, error: null };
  assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 200);
  assert.equal(st().fetched.find((f) => f.url.endsWith("/createBill"))?.params.get("billExpiryDate"), formatToyyibpayExpiryDate(new Date(hold)));
});
await check("N10c", "ToyyibPay createBill failure: the attempt is failed (released) and the payer gets 502", async () => {
  reset(); st().provider.createBill = () => [{ msg: "synthetic refusal", status: "error" }];
  assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 502);
  assert.equal(st().rpcs.filter((c) => c.name === "fail_public_registration_payment_setup").length, 1);
});

// ---- N11 attach failure ------------------------------------------------------------------------------------------------
await check("N11", "attach failure: the provider bill is inactivated and recorded as an orphan; 502", async () => {
  reset(); st().rpc.attach_public_registration_toyy_pay_bill = { data: null, error: { message: "synthetic failure" } };
  assert.equal((await paymentRoute(request("/api/registration/payment", paymentBody()))).status, 502);
  assert.equal(st().fetched.filter((f) => f.url.endsWith("/inactiveBill")).length, 1);
  assert.equal(st().rpcs.filter((c) => c.name === "record_public_registration_payment_orphan").length, 1);
});

// ---- N12 static ------------------------------------------------------------------------------------------------------
await check("N12", "static: service client for writes, strict Origin, gate first, server-only payment library, no public secrets", () => {
  for (const file of ["app/api/registration/route.ts", "app/api/registration/payment/route.ts"]) {
    const src = read(file);
    assert.doesNotMatch(src, /createSupabaseServerClient/, file);
    assert.match(src, /createSupabaseServiceClient\(\)/, file);
    assert.match(src, /if \(!isTrustedRegistrationOrigin\(request\)\) return NextResponse\.json\(\{ error: "Invalid request origin\." \}, \{ status: 403 \}\);/, file);
    assert.doesNotMatch(src, /isAllowedOrigin/, file);
    const body = src.slice(src.indexOf("export async function POST"));
    const order = ["publicRegistrationEnabled()", "isTrustedRegistrationOrigin(request)", "checkSharedRateLimit(", "safeParse(body)", "createSupabaseServiceClient()", ".rpc("].map((token) => body.indexOf(token));
    assert.ok(order.every((index, i) => index > 0 && (i === 0 || index > order[i - 1])), `${file}: gate -> Origin -> limit -> Zod -> service client -> RPC (${order.join(",")})`);
    assert.doesNotMatch(src, /NEXT_PUBLIC_[A-Z_]*(KEY|SECRET)/, file);
  }
  const lib = read("lib/payments/toyyibpay.ts");
  assert.match(lib, /^import "server-only";$/m);
  assert.ok(lib.indexOf('import "server-only";') < lib.indexOf("import { createHash"), "server-only is the first import");
  assert.match(read("lib/supabase/server.ts"), /^import "server-only";$/m);
  const payment = read("app/api/registration/payment/route.ts");
  assert.match(payment, /const MIN_HOLD_REMAINING_MS = 60_000;/);
  assert.match(payment, /expiresAt: holdEndsAt,/);
  for (const step of ["registration", "attempt", "payer"]) assert.match(payment, new RegExp(`step: "${step}"`), step);
});
await check("N12b", "unchanged: status route, both ToyyibPay callbacks and the client flow equal the contract base", () => {
  const atBase = (file: string) => execFileSync("git", ["show", `${CONTRACT_BASE}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 }).replace(/\r\n/g, "\n");
  for (const file of ["app/api/registration/status/route.ts", "app/api/payments/toyyibpay/callback/route.ts", "app/api/payments/toyyibpay/registration-callback/route.ts", "components/public/PublicRegistrationFlow.tsx"]) {
    assert.equal(read(file), atBase(file), file);
  }
});

// ---- N14 callback / idempotency regression -------------------------------------------------------------------------
const callbackHash = (status: string, orderId: string, refno: string) => createHash("md5").update(TOYYIBPAY_SECRET + status + orderId + refno + "ok").digest("hex");
const callback = (fields: Record<string, string>) => new Request(`${SITE}/api/payments/toyyibpay/registration-callback`, {
  method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString(),
});
const validCallback = (extra: Record<string, string> = {}) => ({ refno: "TP-REF-1", status: "1", reason: "", billcode: "PKG1BBILL", order_id: "att-1", transaction_time: "21-11-2026 12:00:00", hash: callbackHash("1", "att-1", "TP-REF-1"), ...extra });
const finalizeCalls = () => st().rpcs.filter((c) => c.name === "finalize_public_registration_payment_from_callback");
await check("N14a", "callback: a wrong hash never reaches the provider check or any payment transition", async () => {
  reset();
  const res = await callbackRoute(callback(validCallback({ hash: "0".repeat(32) })) as never);
  assert.equal(res.status, 200);
  assert.equal(finalizeCalls().length, 0); assert.equal(st().fetched.length, 0);
});
await check("N14b", "callback: a bill-code mismatch never finalizes", async () => {
  reset();
  await callbackRoute(callback(validCallback({ billcode: "OTHERBILL" })) as never);
  assert.equal(finalizeCalls().length, 0);
});
await check("N14c", "callback: 'success' in the callback is ignored unless ToyyibPay itself reports the bill paid", async () => {
  reset(); st().provider.getBillTransactions = () => [{ billpaymentStatus: "2", billpaymentAmount: "650.00", billpaymentInvoiceNo: "TP-REF-1", billCode: "PKG1BBILL" }];
  await callbackRoute(callback(validCallback()) as never);
  assert.equal(finalizeCalls().length, 0);
  reset(); st().provider.getBillTransactions = () => "No data found!";
  await callbackRoute(callback(validCallback()) as never);
  assert.equal(finalizeCalls().length, 0);
});
await check("N14d", "callback: finalization uses the provider-verified amount and transaction id, never values from the callback", async () => {
  reset();
  await callbackRoute(callback(validCallback({ amount: "1.00", billpaymentAmount: "1.00" })) as never);
  assert.equal(finalizeCalls().length, 1);
  assert.equal(finalizeCalls()[0].args.p_verified_amount, "650.00");
  assert.equal(finalizeCalls()[0].args.p_provider_transaction_id, "TP-REF-1");
  assert.equal(finalizeCalls()[0].kind, "service");
});
await check("N14e", "callback: a repeated callback passes identical arguments (the database answers duplicate_ignored); errors are not leaked", async () => {
  reset();
  await callbackRoute(callback(validCallback()) as never);
  st().rpc.finalize_public_registration_payment_from_callback = { data: { outcome: "duplicate_ignored" }, error: null };
  const res = await callbackRoute(callback(validCallback()) as never);
  assert.equal(res.status, 200); assert.equal(await res.text(), "OK");
  assert.equal(finalizeCalls().length, 2);
  assert.deepEqual({ ...finalizeCalls()[0].args, p_callback_received_at: 0 }, { ...finalizeCalls()[1].args, p_callback_received_at: 0 });
  reset(); st().rpc.finalize_public_registration_payment_from_callback = { data: null, error: { message: "payment_amount_mismatch" } };
  const mismatch = await callbackRoute(callback(validCallback()) as never);
  assert.equal(await mismatch.text(), "OK", "a refused finalization is logged, never echoed");
  assert.ok(st().rpcs.some((c) => c.name === "log_public_registration_payment_event" && c.args.p_event_type === "amount_mismatch"));
});
await check("N14f", "callback: an unsuccessful provider status marks the attempt failed, never paid", async () => {
  reset(); st().provider.getBillTransactions = () => [{ billpaymentStatus: "3", billpaymentAmount: "650.00", billpaymentInvoiceNo: "TP-REF-1", billCode: "PKG1BBILL" }];
  await callbackRoute(callback(validCallback({ status: "3", hash: callbackHash("3", "att-1", "TP-REF-1") })) as never);
  assert.equal(finalizeCalls().length, 0);
  assert.equal(st().rpcs.filter((c) => c.name === "mark_public_registration_payment_failed_from_callback").length, 1);
});

await check("N0", "no request in this run left the process", () => { assert.equal(st().forbidden.length, 0); });

for (const line of results) console.log(line);
console.log(failures ? `\n${failures} semakan GAGAL` : `\nSemua ${results.length} semakan PKG-1b LULUS`);
process.exit(failures ? 1 : 0);
