/**
 * Public-First F-1 offline test: the server-side public registration kill switch (lib/public-registration-gate.ts).
 *
 * Runs the REAL POST /api/registration, POST /api/registration/payment and lib/public-content.ts against recording
 * fakes (scripts/fixtures/public-registration-gate-fakes.mjs) for Supabase, rate limiting and next/cache. Global fetch
 * throws on ANY request, so a ToyyibPay or network call fails the run. All request bodies are synthetic.
 *
 * Run: node --experimental-transform-types scripts/public-registration-kill-switch.test.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CONTRACT_BASE } from "./contract-base.mts";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const FAKES = pathToFileURL(path.join(root, "scripts", "fixtures", "public-registration-gate-fakes.mjs")).href;
const FAKED = [/[\\/]lib[\\/]supabase\.js$/, /[\\/]lib[\\/]supabase[\\/]server\.ts$/, /[\\/]lib[\\/]rate-limit\.js$/];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: "data:text/javascript,export default {}", shortCircuit: true };
    if (specifier === "next/cache") return { url: FAKES, shortCircuit: true };
    if (/^next\/[a-z-]+$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
    const parent = context.parentURL;
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && parent?.startsWith("file:") && !/\.(m?[jt]sx?|cjs|json)$/.test(specifier)) {
      const parentPath = fileURLToPath(parent);
      if (parentPath.startsWith(root) && !parentPath.includes(`${path.sep}node_modules${path.sep}`)) {
        const base = path.resolve(path.dirname(parentPath), specifier);
        for (const suffix of [".ts", ".tsx", ".js", ".mjs", `${path.sep}index.ts`, `${path.sep}index.js`]) {
          const candidate = base + suffix;
          if (existsSync(candidate) && statSync(candidate).isFile()) {
            if (FAKED.some((pattern) => pattern.test(candidate))) return { url: FAKES, shortCircuit: true };
            return { url: pathToFileURL(candidate).href, shortCircuit: true };
          }
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

const outbound: string[] = [];
globalThis.fetch = (async (input: unknown) => {
  outbound.push(String((input as { url?: string })?.url ?? input));
  throw new Error("unexpected outbound request in offline test");
}) as typeof fetch;

interface Gate { rpcs: { name: string; args: Record<string, unknown>; kind: string }[]; reads: string[]; rateLimits: string[]; rpcAnswer?: (name: string, args: unknown) => { data: unknown; error: unknown } }
const gate = () => (globalThis as { __gate: Gate }).__gate;
function reset(flag: string | undefined, rpcAnswer?: Gate["rpcAnswer"]) {
  if (flag === undefined) delete process.env.TERAS_PUBLIC_REGISTRATION; else process.env.TERAS_PUBLIC_REGISTRATION = flag;
  delete process.env.TOYYIBPAY_ENV;
  (globalThis as { __gate?: Gate }).__gate = { rpcs: [], reads: [], rateLimits: [], rpcAnswer };
  outbound.length = 0;
}

const SCHEDULE = "11111111-1111-4111-8111-111111111111";
const SECRET = "a".repeat(64);
const createBody = { schedule_id: SCHEDULE, idempotency_key: "synthetic-idempotency-key-0001", registration_secret: SECRET, attendees: [{ full_name: "Synthetic Attendee", email: "synthetic@example.invalid", phone: "0100000000" }] };
const paymentBody = { registration_reference: "TRX-SYNTH-0001", registration_secret: SECRET, provider: "toyyibpay" };
const post = (url: string, body: unknown) => new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });

const createRoute = (await import("../app/api/registration/route.ts")).POST;
const paymentRoute = (await import("../app/api/registration/payment/route.ts")).POST;
const { getPublicRegistrationSchedule, getUpcomingSchedules } = await import("../lib/public-content.ts");
const { sessionKind } = await import("../lib/session-display.ts");
const { publicRegistrationEnabled, REGISTRATION_DISABLED_MESSAGE } = await import("../lib/public-registration-gate.ts");

const scheduleRow = { schedule_id: SCHEDULE, course_id: "c", course_title: "Synthetic Course", course_slug: "working-at-height", start_date: "2026-12-10", end_date: "2026-12-11", status: "open", capacity: 10, available_seats: 5, fee: 650, registration_available: true };
const scheduleAnswer = (name: string) => name === "get_public_registration_schedule" ? { data: [scheduleRow], error: null }
  : name === "get_public_upcoming_schedules" ? { data: [scheduleRow], error: null }
  : name === "create_public_registration" ? { data: { registration_reference: "TRX-SYNTH-0001", registration_status: "pending_payment", payment_status: "pending", amount: 650, currency: "MYR" }, error: null }
  : { data: null, error: { message: "synthetic" } };

const results: { id: string; name: string; ok: boolean; note?: string }[] = [];
async function scenario(id: string, name: string, fn: () => Promise<void> | void) {
  const original = console.error; console.error = () => {};
  try { await fn(); results.push({ id, name, ok: true }); }
  catch (error) { results.push({ id, name, ok: false, note: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; }
  finally { console.error = original; }
}

await scenario("K1", "Flag unset: direct POST /api/registration -> 503, no database call, no rate-limit write, no network", async () => {
  reset(undefined, scheduleAnswer);
  const res = await createRoute(post("/api/registration", createBody));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, REGISTRATION_DISABLED_MESSAGE);
  assert.equal(gate().rpcs.length + gate().reads.length + gate().rateLimits.length + outbound.length, 0);
});
await scenario("K2", "Fail closed: every value other than exactly 'enabled' keeps registration off", async () => {
  for (const value of ["", "true", "1", "ENABLED", " enabled", "enabled ", "yes", "on", "disabled"]) {
    reset(value, scheduleAnswer);
    assert.equal(publicRegistrationEnabled(), false, JSON.stringify(value));
    assert.equal((await createRoute(post("/api/registration", createBody))).status, 503, JSON.stringify(value));
    assert.equal(gate().rpcs.length, 0);
  }
});
await scenario("K3", "Flag off: direct POST /api/registration/payment -> 503 before any payment attempt or ToyyibPay bill", async () => {
  for (const value of [undefined, "", "true"]) {
    reset(value, scheduleAnswer);
    const res = await paymentRoute(post("/api/registration/payment", paymentBody));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(body.error, REGISTRATION_DISABLED_MESSAGE);
    assert.doesNotMatch(JSON.stringify(body), /bank|transfer/i, "no unapproved bank-transfer offer");
    assert.equal(gate().rpcs.length + gate().reads.length + outbound.length, 0, "no begin_public_registration_payment, no createBill");
  }
});
await scenario("K4", "Malformed or hostile bodies while off are still answered 503 without parsing into the database", async () => {
  reset(undefined, scheduleAnswer);
  for (const body of [{}, { schedule_id: "not-a-uuid" }, "x".repeat(5000), null]) {
    assert.equal((await createRoute(post("/api/registration", body))).status, 503);
    assert.equal((await paymentRoute(post("/api/registration/payment", body))).status, 503);
  }
  assert.equal(gate().rpcs.length, 0);
});
await scenario("K5", "Flag 'enabled': the existing path is unchanged (create RPC reached; payment still needs TOYYIBPAY_ENV)", async () => {
  reset("enabled", scheduleAnswer);
  const res = await createRoute(post("/api/registration", createBody));
  assert.equal(res.status, 201, "the existing route answers 201 Created");
  assert.deepEqual(gate().rpcs.map((c) => c.name), ["create_public_registration"]);
  reset("enabled", scheduleAnswer);
  const pay = await paymentRoute(post("/api/registration/payment", paymentBody));
  assert.equal(pay.status, 503, "existing TOYYIBPAY_ENV capability gate still applies after the kill switch");
  assert.equal(gate().rpcs.length + outbound.length, 0);
});
await scenario("K6", "Public schedule data: registration_available is forced false while off, passed through when enabled", async () => {
  reset(undefined, scheduleAnswer);
  assert.equal((await getPublicRegistrationSchedule(SCHEDULE))?.registration_available, false);
  const upcoming = await getUpcomingSchedules();
  assert.ok(upcoming.length === 1 && upcoming.every((s: { registration_available: boolean }) => s.registration_available === false));
  assert.equal(sessionKind(upcoming[0]), "enquiry", "calendar, course and homepage show Enquire, not Register");
  reset("enabled", scheduleAnswer);
  assert.equal((await getPublicRegistrationSchedule(SCHEDULE))?.registration_available, true);
  assert.equal(sessionKind((await getUpcomingSchedules())[0]), "open");
});
await scenario("K7", "Static: registration page 404s before the schedule lookup; read-only status routes and callbacks are not gated", () => {
  const page = readFileSync(path.join(root, "app/registration/[scheduleId]/page.tsx"), "utf8");
  assert.ok(page.indexOf("if (!publicRegistrationEnabled()) notFound();") > -1 && page.indexOf("if (!publicRegistrationEnabled()) notFound();") < page.indexOf("getPublicRegistrationSchedule(scheduleId)"));
  for (const file of ["app/api/registration/status/route.ts", "app/registration/status/page.tsx", "app/api/payments/toyyibpay/callback/route.ts", "app/api/payments/toyyibpay/registration-callback/route.ts"]) {
    assert.doesNotMatch(readFileSync(path.join(root, file), "utf8"), /public-registration-gate/, file);
  }
  for (const file of ["app/api/registration/route.ts", "app/api/registration/payment/route.ts"]) {
    const src = readFileSync(path.join(root, file), "utf8");
    const body = src.slice(src.indexOf("export async function POST"));
    assert.match(body.split("\n").slice(1, 4).join("\n"), /if \(!publicRegistrationEnabled\(\)\) return NextResponse\.json\(\{ error: REGISTRATION_DISABLED_MESSAGE \}, \{ status: 503 \}\);/, `${file}: gate is the first statement`);
  }
});
await scenario("K8", "Existing obligations: ToyyibPay callbacks, the status route and the payment library are unchanged from the release base", () => {
  // Public-First release (K-4): the kill switch must not touch the routes that settle payments started earlier. They are
  // compared with the contract base (scripts/contract-base.mts) -- the release base -- with line endings normalised.
  const atBase = (file: string) => execFileSync("git", ["show", `${CONTRACT_BASE}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 }).replace(/\r\n/g, "\n");
  for (const file of ["app/api/payments/toyyibpay/callback/route.ts", "app/api/payments/toyyibpay/registration-callback/route.ts", "app/api/registration/status/route.ts", "lib/payments/toyyibpay.ts"]) {
    assert.equal(readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n"), atBase(file), file);
  }
  assert.equal(existsSync(path.join(root, "lib/payments/toyyibpay-decision.ts")), false, "the R2 decision module is not part of this release");
  assert.equal(outbound.length, 0);
});

for (const r of results) console.log(`${r.ok ? "LULUS" : "GAGAL"} ${r.id} ${r.name}${r.note ? ` -> ${r.note}` : ""}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} lulus${passed === results.length ? "" : ` (${results.length - passed} gagal)`}`);
