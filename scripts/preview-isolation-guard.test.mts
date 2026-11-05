/**
 * Preview isolation guard checks (lib/preview-isolation.ts and its call sites).
 *
 * Dependency-free, no network, no real credentials, no Supabase/Resend/Sheets/
 * ToyyibPay call (fetch is stubbed and asserted untouched). All keys below are
 * synthetic strings built in this file.
 *
 * Run: node --experimental-transform-types scripts/preview-isolation-guard.test.mts
 * (also wired as `npm run check:preview-isolation`)
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const {
  resolveDeploymentTarget,
  isProductionTarget,
  validatePrivilegedSupabaseConfig,
  assertPrivilegedSupabaseConfig,
  PreviewIsolationError,
  outboundDecision,
  blockedOutboundBody,
  isToyyibpayModeAllowed,
  PRODUCTION_SUPABASE_PROJECT_REF,
} = await import("../lib/preview-isolation.ts");

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

const APPROVED = "abcdefghijklmnopqrst"; // synthetic approved non-production ref
const OTHER = "tsrqponmlkjihgfedcba";
const stagingUrl = `https://${APPROVED}.supabase.co`;

function b64url(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
/** Synthetic JWT-shaped key. The signature segment is a fixed dummy. */
function fakeJwt(payload: Record<string, unknown>) {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.c2lnbmF0dXJl`;
}
const SECRET_KEY = "sb_secret_SYNTHETIC0000000000000000";

function previewEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL: "1",
    VERCEL_ENV: "preview",
    VERCEL_TARGET_ENV: "preview",
    TERAS_APPROVED_SUPABASE_PROJECT_REF: APPROVED,
    NEXT_PUBLIC_SUPABASE_URL: stagingUrl,
    SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: "service_role", ref: APPROVED }),
    ...overrides,
  };
}

console.log("1. deployment target resolution");
await check("production target", () => {
  const r = resolveDeploymentTarget({ VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" });
  assert.equal(r.target, "production");
  assert.equal(isProductionTarget({ VERCEL_TARGET_ENV: "production", VERCEL_ENV: "production" }), true);
});
await check("production target without VERCEL_ENV is still production", () => {
  assert.equal(resolveDeploymentTarget({ VERCEL_TARGET_ENV: "production" }).target, "production");
});
await check("preview and development targets", () => {
  assert.equal(resolveDeploymentTarget({ VERCEL_TARGET_ENV: "preview", VERCEL_ENV: "preview" }).target, "preview");
  assert.equal(resolveDeploymentTarget({ VERCEL_TARGET_ENV: "development", VERCEL_ENV: "development" }).target, "development");
});
await check("custom environment 'staging' (VERCEL_ENV reports preview) is custom, never production", () => {
  const r = resolveDeploymentTarget({ VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "staging" });
  assert.equal(r.target, "custom");
  assert.equal(r.name, "staging");
  assert.equal(isProductionTarget({ VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "staging" }), false);
});
await check("missing VERCEL_TARGET_ENV on Vercel is unknown (fail closed)", () => {
  assert.equal(resolveDeploymentTarget({ VERCEL: "1" }).target, "unknown");
  assert.equal(resolveDeploymentTarget({ VERCEL_ENV: "production" }).target, "unknown");
  assert.equal(resolveDeploymentTarget({ VERCEL_TARGET_ENV: "   ", VERCEL_ENV: "preview" }).target, "unknown");
});
await check("no Vercel variables at all is local, never production", () => {
  const r = resolveDeploymentTarget({});
  assert.equal(r.target, "local");
  assert.equal(isProductionTarget({}), false);
});
await check("unexpected values are unknown, including near-miss spellings of production", () => {
  for (const value of ["Production", "PRODUCTION", "prod", "production ", "pre view", "../x", "a".repeat(80)]) {
    const r = resolveDeploymentTarget({ VERCEL: "1", VERCEL_TARGET_ENV: value });
    // "production " (trailing space) trims to the exact production literal.
    const expectProduction = value.trim() === "production";
    assert.equal(r.target === "production", expectProduction, `value ${JSON.stringify(value)} -> ${r.target}`);
    // Anything that is not the exact lowercase literal is never production; values
    // that are not a valid environment name at all are unknown.
    if (/[A-Z ./]/.test(value.trim()) || value.length > 63) assert.equal(r.target, "unknown", `value ${JSON.stringify(value)}`);
  }
  // "prod" is a syntactically valid custom environment name: restricted, never production.
  assert.equal(resolveDeploymentTarget({ VERCEL: "1", VERCEL_TARGET_ENV: "prod" }).target, "custom");
});
await check("conflicting VERCEL_ENV / VERCEL_TARGET_ENV is unknown", () => {
  assert.equal(resolveDeploymentTarget({ VERCEL_TARGET_ENV: "production", VERCEL_ENV: "preview" }).target, "unknown");
  assert.equal(resolveDeploymentTarget({ VERCEL_TARGET_ENV: "staging", VERCEL_ENV: "production" }).target, "unknown");
});

console.log("2. privileged Supabase configuration");
await check("production is unrestricted and reads no other configuration", () => {
  const r = validatePrivilegedSupabaseConfig({ VERCEL_TARGET_ENV: "production", VERCEL_ENV: "production" });
  assert.equal(r.ok, true);
});
await check("production passes even with a production URL and any key shape (unchanged behavior)", () => {
  const env = {
    VERCEL_TARGET_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY,
  };
  assert.equal(validatePrivilegedSupabaseConfig(env).ok, true);
  assert.doesNotThrow(() => assertPrivilegedSupabaseConfig(env));
});
await check("approved project + matching URL + JWT ref match -> ok (preview)", () => {
  const r = validatePrivilegedSupabaseConfig(previewEnv());
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.keyCheck, "jwt_ref_matched");
});
await check("custom environment 'staging' with matched config -> ok", () => {
  const r = validatePrivilegedSupabaseConfig(previewEnv({ VERCEL_TARGET_ENV: "staging" }));
  assert.equal(r.ok, true);
});
await check("missing approved ref -> blocked", () => {
  const r = validatePrivilegedSupabaseConfig(previewEnv({ TERAS_APPROVED_SUPABASE_PROJECT_REF: undefined }));
  assert.equal(r.ok === false && r.code, "approved_ref_missing");
});
await check("malformed approved ref -> blocked", () => {
  const r = validatePrivilegedSupabaseConfig(previewEnv({ TERAS_APPROVED_SUPABASE_PROJECT_REF: "not-a-ref" }));
  assert.equal(r.ok === false && r.code, "approved_ref_invalid");
});
await check("Production ref can never be approved for a non-production environment", () => {
  const r = validatePrivilegedSupabaseConfig(
    previewEnv({
      TERAS_APPROVED_SUPABASE_PROJECT_REF: PRODUCTION_SUPABASE_PROJECT_REF,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: "service_role", ref: PRODUCTION_SUPABASE_PROJECT_REF }),
    })
  );
  assert.equal(r.ok === false && r.code, "approved_ref_is_production");
});
await check("URL pointing at Production while another project is approved -> blocked", () => {
  const r = validatePrivilegedSupabaseConfig(previewEnv({ NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co` }));
  assert.equal(r.ok === false && r.code, "url_ref_mismatch");
});
await check("URL for a different non-approved project -> blocked", () => {
  const r = validatePrivilegedSupabaseConfig(previewEnv({ NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER}.supabase.co` }));
  assert.equal(r.ok === false && r.code, "url_ref_mismatch");
});
await check("missing / non-Supabase / non-https URL -> blocked", () => {
  assert.equal(validatePrivilegedSupabaseConfig(previewEnv({ NEXT_PUBLIC_SUPABASE_URL: undefined })).ok, false);
  assert.equal((validatePrivilegedSupabaseConfig(previewEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://example.com" })) as any).code, "url_not_supabase_host");
  assert.equal((validatePrivilegedSupabaseConfig(previewEnv({ NEXT_PUBLIC_SUPABASE_URL: `http://${APPROVED}.supabase.co` })) as any).code, "url_not_supabase_host");
});
await check("legacy JWT for another project (mismatched project reference) -> blocked", () => {
  const r = validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: "service_role", ref: PRODUCTION_SUPABASE_PROJECT_REF }) }));
  assert.equal(r.ok === false && r.code, "service_key_ref_mismatch");
});
await check("legacy JWT with a non-service role -> blocked", () => {
  const r = validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ role: "anon", ref: APPROVED }) }));
  assert.equal(r.ok === false && r.code, "service_key_role_invalid");
});
await check("missing / unrecognized service key -> blocked", () => {
  assert.equal((validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined })) as any).code, "service_key_missing");
  assert.equal((validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_SYNTHETIC" })) as any).code, "service_key_unrecognized");
  assert.equal((validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: "plain-text" })) as any).code, "service_key_unrecognized");
});
await check("new sb_secret key without attestation -> blocked (no readable project reference assumed)", () => {
  const r = validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY }));
  assert.equal(r.ok === false && r.code, "service_key_attestation_missing");
});
await check("new sb_secret key with matching per-environment attestation -> ok", () => {
  const r = validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY, TERAS_SERVICE_KEY_PROJECT_REF: APPROVED }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.keyCheck, "attested");
});
await check("sb_secret attestation for another project (or Production) -> blocked", () => {
  for (const ref of [OTHER, PRODUCTION_SUPABASE_PROJECT_REF]) {
    const r = validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY, TERAS_SERVICE_KEY_PROJECT_REF: ref }));
    assert.equal(r.ok === false && r.code, "service_key_attestation_mismatch");
  }
  assert.equal((validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY, TERAS_SERVICE_KEY_PROJECT_REF: "bad" })) as any).code, "service_key_attestation_invalid");
});
await check("attestation never overrides a wrong URL", () => {
  const r = validatePrivilegedSupabaseConfig(
    previewEnv({ SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY, TERAS_SERVICE_KEY_PROJECT_REF: APPROVED, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co` })
  );
  assert.equal(r.ok === false && r.code, "url_ref_mismatch");
});
await check("JWT without a ref claim is treated as not checkable (needs attestation)", () => {
  const key = fakeJwt({ role: "service_role" });
  assert.equal((validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: key })) as any).code, "service_key_attestation_missing");
  assert.equal(validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: key, TERAS_SERVICE_KEY_PROJECT_REF: APPROVED })).ok, true);
});
await check("unknown target and local runs fail closed without approved configuration", () => {
  assert.equal((validatePrivilegedSupabaseConfig({ VERCEL: "1" }) as any).code, "target_unknown");
  assert.equal((validatePrivilegedSupabaseConfig({}) as any).code, "approved_ref_missing");
  assert.equal((validatePrivilegedSupabaseConfig({ VERCEL_TARGET_ENV: "preview", VERCEL_ENV: "production" }) as any).code, "target_unknown");
});
await check("assertPrivilegedSupabaseConfig throws a coded error and never leaks key material", () => {
  const key = fakeJwt({ role: "service_role", ref: OTHER });
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void logged.push(args);
  let caught: unknown;
  try {
    assertPrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: key }));
  } catch (error) {
    caught = error;
  } finally {
    console.error = original;
  }
  assert.ok(caught instanceof PreviewIsolationError);
  assert.equal((caught as InstanceType<typeof PreviewIsolationError>).code, "service_key_ref_mismatch");
  const everything = JSON.stringify([String((caught as Error).message), logged]);
  const payloadSegment = key.split(".")[1];
  const signatureSegment = key.split(".")[2];
  assert.equal(everything.includes(key), false);
  assert.equal(everything.includes(payloadSegment), false);
  assert.equal(everything.includes(signatureSegment), false);
});
await check("a synthetic sb_secret value never appears in results or messages", () => {
  const r = validatePrivilegedSupabaseConfig(previewEnv({ SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY }));
  assert.equal(JSON.stringify(r).includes(SECRET_KEY), false);
});

console.log("3. outbound side effects");
const targets: Array<[string, Record<string, string | undefined>, boolean]> = [
  ["production", { VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" }, true],
  ["preview", { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" }, false],
  ["development", { VERCEL_TARGET_ENV: "development", VERCEL_ENV: "development" }, false],
  ["custom staging", { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "staging" }, false],
  ["unknown (missing target on Vercel)", { VERCEL: "1" }, false],
  ["local", {}, false],
];
for (const [label, env, allowed] of targets) {
  await check(`${label}: email, sheets and staff invitations ${allowed ? "allowed" : "blocked"}`, () => {
    for (const channel of ["email", "google_sheets", "staff_invite"] as const) {
      assert.equal(outboundDecision(channel, env).allowed, allowed, `${label}/${channel}`);
    }
  });
}
await check("blocked decisions are explicit 503 failures with no success shape", () => {
  const decision = outboundDecision("email", { VERCEL_TARGET_ENV: "preview" });
  assert.equal(decision.allowed, false);
  if (!decision.allowed) {
    assert.equal(decision.status, 503);
    const body = blockedOutboundBody(decision);
    assert.equal(body.code, "outbound_disabled_non_production");
    assert.equal("ok" in body, false);
    assert.equal(Object.keys(body).sort().join(","), "channel,code,error");
  }
});
await check("no global override flag can enable any channel outside Production", () => {
  const flags = {
    VERCEL_TARGET_ENV: "preview",
    ALLOW_PREVIEW_OUTBOUND: "1",
    TERAS_ALLOW_OUTBOUND: "true",
    TERAS_OUTBOUND_ENABLED: "1",
    ENABLE_OUTBOUND: "1",
    TERAS_PREVIEW_EMAIL_ENABLED: "preview",
    TERAS_ENV: "production",
    NODE_ENV: "production",
  };
  for (const channel of ["email", "google_sheets", "staff_invite"] as const) {
    assert.equal(outboundDecision(channel, flags).allowed, false, channel);
  }
});

console.log("4. ToyyibPay live-payment gate");
const modes = ["sandbox", "production"] as const;
for (const [label, env, isProd] of targets) {
  for (const mode of modes) {
    const expected = mode === "sandbox" || isProd;
    await check(`${label} + ${mode}: ${expected ? "allowed" : "blocked"} (shared helper)`, () => {
      assert.equal(isToyyibpayModeAllowed(mode, env), expected);
    });
  }
}
{
  // The payment module mirrors the shared helper; prove the two agree on the real module.
  const calls: string[] = [];
  // @ts-expect-error -- test-only stub; must never be reached in blocked cases.
  globalThis.fetch = async (url: string) => {
    calls.push(url);
    return { ok: true, text: async () => JSON.stringify([{ BillCode: "TESTBILL" }]) };
  };
  const { createBill, getToyyibpayCapability } = await import("../lib/payments/toyyibpay.ts");
  const bill = {
    invoiceNo: "INV-TEST", description: "synthetic", amountSen: 100,
    returnUrl: "https://example.test/return", callbackUrl: "https://example.test/callback",
    externalReferenceNo: "00000000-0000-0000-0000-000000000000", billTo: "Synthetic",
  };
  const saved = { ...process.env };
  for (const [label, env, isProd] of targets) {
    for (const mode of modes) {
      await check(`toyyibpay.ts agrees with shared helper: ${label} + ${mode}`, async () => {
        for (const key of ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV"]) delete process.env[key];
        Object.assign(process.env, env);
        process.env.TOYYIBPAY_ENV = mode;
        process.env.TOYYIBPAY_USER_SECRET_KEY = "synthetic-secret";
        process.env.TOYYIBPAY_CATEGORY_CODE = "synthetic-category";
        calls.length = 0;
        const expected = mode === "sandbox" || isProd;
        assert.equal(getToyyibpayCapability().enabled, expected);
        if (expected) {
          await createBill(bill);
          assert.equal(calls.length, 1);
          assert.match(calls[0], mode === "sandbox" ? /^https:\/\/dev\.toyyibpay\.com\// : /^https:\/\/toyyibpay\.com\//);
        } else {
          await assert.rejects(() => createBill(bill), /live "production" mode is blocked/);
          assert.equal(calls.length, 0, "no HTTP call may be made when live mode is blocked");
        }
      });
    }
  }
  for (const key of ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "TOYYIBPAY_ENV", "TOYYIBPAY_USER_SECRET_KEY", "TOYYIBPAY_CATEGORY_CODE"]) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
}

console.log("5. call-site contracts (guard executes before any external call)");
function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
function postBody(code: string) {
  const start = code.indexOf("export async function POST");
  assert.ok(start >= 0, "POST handler not found");
  return code.slice(start);
}
function firstIndexOf(code: string, patterns: RegExp[]) {
  const hits = patterns.map((p) => code.search(p)).filter((i) => i >= 0);
  return hits.length ? Math.min(...hits) : Infinity;
}
const externalPatterns = [/process\.env\.RESEND/, /new Resend\(/, /\bfetch\(/, /createSupabase(Server|Service)Client\(/, /request\.json\(/, /sendNotificationEmails\(/, /syncToGoogleSheets\(/, /notifyInternal\(/];
for (const route of ["app/api/contact/route.js", "app/api/newsletter/route.js", "app/api/request-proposal/route.js"]) {
  await check(`${route}: outboundDecision runs before any external or persistence call`, () => {
    const body = postBody(source(route));
    const guard = body.search(/outboundDecision\(/);
    assert.ok(guard >= 0, "guard missing");
    assert.ok(guard < firstIndexOf(body, externalPatterns), "guard must come first");
    assert.match(body.slice(guard, guard + 400), /status: outbound\.status/);
    assert.doesNotMatch(body.slice(guard, guard + 400), /ok:\s*true/);
  });
}
await check("request-proposal checks both email and google_sheets channels", () => {
  const body = postBody(source("app/api/request-proposal/route.js"));
  assert.match(body, /\["email", "google_sheets"\]/);
});
await check("users/actions.ts: staff invite guards run before the service client or Auth admin call", () => {
  const code = source("app/admin/(protected)/users/actions.ts");
  for (const fn of ["export async function inviteStaffAction", "export async function resendStaffInviteAction"]) {
    const start = code.indexOf(fn);
    assert.ok(start >= 0, fn);
    const body = code.slice(start);
    const guard = body.search(/outboundDecision\("staff_invite"\)/);
    const external = firstIndexOf(body, [/serviceClientOrError\(\)/, /inviteUserByEmail\(/]);
    assert.ok(guard >= 0 && guard < external, `${fn}: guard must precede service client and inviteUserByEmail`);
  }
});
await check("createSupabaseServiceClient calls the privileged guard before constructing the client", () => {
  const code = source("lib/supabase/server.ts");
  const start = code.indexOf("export function createSupabaseServiceClient");
  const body = code.slice(start);
  const guard = body.search(/assertPrivilegedSupabaseConfig\(\)/);
  const create = body.search(/createClient</);
  assert.ok(guard >= 0 && guard < create);
});
await check("production code paths do not read any new guard configuration variable", () => {
  const code = source("lib/preview-isolation.ts");
  // The production branch of validatePrivilegedSupabaseConfig returns before the first env[...] read.
  const fn = code.slice(code.indexOf("export function validatePrivilegedSupabaseConfig"));
  const productionReturn = fn.indexOf('keyCheck: "production_unrestricted"');
  const firstConfigRead = fn.search(/env\[APPROVED_SUPABASE_REF_ENV\]|env\.NEXT_PUBLIC_SUPABASE_URL|env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.ok(productionReturn >= 0 && productionReturn < firstConfigRead);
});

console.log(`\n${passed} check(s) passed.`);
if (process.exitCode) {
  console.error("Some checks FAILED -- see above.");
  process.exit(process.exitCode);
}
