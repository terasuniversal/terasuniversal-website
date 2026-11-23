// AUTH-1 C6 + Option B: Staging-only staff invitation allowlist (synthetic tests 1-15).
// Run: node --experimental-transform-types --experimental-test-module-mocks --no-warnings scripts/staff-invite-staging-allowlist.test.mts
// Synthetic data only: mocked Supabase/Next modules, fake keys and addresses, no network, no email.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import { mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import path from "node:path";

const loader = `export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/navigation" || specifier === "next/headers") return nextResolve(specifier + ".js", context);
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

const STAGING_REF = "eokiaehnvzbggmacifcf";
const OTHER_REF = "pzgtyskhyhuxhzvyzzhe";
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const serviceKey = (ref: string) => `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ ref, role: "service_role" })}.c3ludGhldGlj`; // synthetic, unsigned
const ALLOWED = "uat.invite+auth1@example.test";
const OTHER = "someone.else@example.test";

function stagingEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    VERCEL: "1",
    VERCEL_ENV: "preview", // Vercel reports custom environments as "preview" here
    VERCEL_TARGET_ENV: "staging",
    TERAS_APPROVED_SUPABASE_PROJECT_REF: STAGING_REF,
    NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey(STAGING_REF),
    TERAS_STAGING_INVITE_ALLOWLIST: ALLOWED,
    ...overrides,
  };
}

const iso = await import("../lib/preview-isolation.ts");

// ------------------------------------------------------- decision (pure, 1-6)
test("1. allowlisted recipient on CRM Staging is allowed (exact match, case/space-insensitive)", () => {
  assert.deepEqual(iso.staffInviteDecision(ALLOWED, stagingEnv()), { allowed: true, scope: "staging_allowlist" });
  assert.equal(iso.staffInviteDecision(`  ${ALLOWED.toUpperCase()} `, stagingEnv()).allowed, true);
  assert.equal(iso.staffInviteDecision(ALLOWED, stagingEnv({ TERAS_STAGING_INVITE_ALLOWLIST: ` ${OTHER} , ${ALLOWED} ` })).allowed, true);
});

test("2. non-allowlisted recipient is denied, including near-misses (no partial or suffix match)", () => {
  for (const r of [OTHER, "uat.invite@example.test", `x${ALLOWED}`, `${ALLOWED}.evil`, "uat.invite+auth1@example.tes", `${ALLOWED},${OTHER}`, "", null, 42]) {
    const d = iso.staffInviteDecision(r, stagingEnv());
    assert.equal(d.allowed, false, String(r));
  }
  const d = iso.staffInviteDecision(OTHER, stagingEnv());
  assert.ok(!d.allowed && d.reason === "recipient_not_allowlisted" && d.status === 503 && d.code === "outbound_disabled_non_production");
});

test("3. missing, empty or malformed allowlist fails closed; wildcards are never patterns", () => {
  const cases: Array<[string | undefined, string]> = [
    [undefined, "allowlist_missing"], ["", "allowlist_missing"], ["   ", "allowlist_missing"],
    ["*", "allowlist_malformed"], ["*@example.test", "allowlist_malformed"], ["%@example.test", "allowlist_malformed"],
    [`${ALLOWED},`, "allowlist_malformed"], [`${ALLOWED};${OTHER}`, "allowlist_malformed"], [`${ALLOWED} ${OTHER}`, "allowlist_malformed"],
    ["@example.test", "allowlist_malformed"], ["example.test", "allowlist_malformed"], [Array(11).fill(ALLOWED).join(","), "allowlist_malformed"],
  ];
  for (const [raw, reason] of cases) {
    const d = iso.staffInviteDecision(ALLOWED, stagingEnv({ TERAS_STAGING_INVITE_ALLOWLIST: raw }));
    assert.ok(!d.allowed && d.reason === reason, `${String(raw)} -> ${d.allowed ? "allowed" : d.reason}`);
  }
  // A literal "*" recipient cannot match anything either.
  assert.equal(iso.staffInviteDecision("*", stagingEnv({ TERAS_STAGING_INVITE_ALLOWLIST: ALLOWED })).allowed, false);
});

test("4. wrong Supabase project (approved ref, URL, or service key) is denied", () => {
  const cases = [
    stagingEnv({ TERAS_APPROVED_SUPABASE_PROJECT_REF: OTHER_REF, NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: serviceKey(OTHER_REF) }),
    stagingEnv({ NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co` }),
    stagingEnv({ TERAS_APPROVED_SUPABASE_PROJECT_REF: undefined }),
    stagingEnv({ NEXT_PUBLIC_SUPABASE_URL: "http://eokiaehnvzbggmacifcf.supabase.co" }),
    stagingEnv({ SUPABASE_SERVICE_ROLE_KEY: serviceKey(OTHER_REF) }),
    stagingEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined }),
    stagingEnv({ TERAS_APPROVED_SUPABASE_PROJECT_REF: iso.PRODUCTION_SUPABASE_PROJECT_REF, NEXT_PUBLIC_SUPABASE_URL: `https://${iso.PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: serviceKey(iso.PRODUCTION_SUPABASE_PROJECT_REF) }),
  ];
  for (const [i, env] of cases.entries()) {
    const d = iso.staffInviteDecision(ALLOWED, env);
    assert.ok(!d.allowed && (d.reason === "project_ref_mismatch" || d.reason === "privileged_config_invalid"), `case ${i}: ${d.allowed ? "allowed" : d.reason}`);
  }
});

test("5. Production behavior is unchanged: allowed for any recipient, allowlist never read", () => {
  const prod = { VERCEL: "1", VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" };
  assert.deepEqual(iso.staffInviteDecision(OTHER, prod), { allowed: true, scope: "production" });
  assert.deepEqual(iso.staffInviteDecision(OTHER, { ...prod, TERAS_STAGING_INVITE_ALLOWLIST: ALLOWED }), { allowed: true, scope: "production" });
  // Production returns before any allowlist/target read.
  const fn = iso.staffInviteDecision.toString();
  assert.ok(fn.indexOf("if (base.allowed)") < fn.indexOf("STAGING_INVITE_ALLOWLIST_ENV"));
  // Conflicting production signals are never treated as production or staging.
  assert.equal(iso.staffInviteDecision(ALLOWED, stagingEnv({ VERCEL_ENV: "production" })).allowed, false);
});

test("6. generic Preview, Development, local, unknown and other custom environments are denied even with a full Staging config", () => {
  for (const target of ["preview", "development", "staging-2", "staging2", "uat", "Staging", "STAGING", "prod", ""]) {
    const env = stagingEnv({ VERCEL_TARGET_ENV: target });
    const d = iso.staffInviteDecision(ALLOWED, env);
    assert.ok(!d.allowed && (d.reason === "not_staging_target"), `${JSON.stringify(target)}: ${d.allowed ? "allowed" : d.reason}`);
  }
  assert.equal(iso.staffInviteDecision(ALLOWED, { ...stagingEnv(), VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_TARGET_ENV: undefined }).allowed, false, "local");
  // outboundDecision itself stays Production-only for every channel (no new override).
  for (const channel of ["email", "google_sheets", "staff_invite"] as const) assert.equal(iso.outboundDecision(channel, stagingEnv()).allowed, false);
});

// --------------------------------------------- server actions, mocked services (7-12)
class Redirect extends Error { to: string; constructor(to: string) { super(`redirect:${to}`); this.to = to; } }
class NoAccess extends Error {}
type Call = [string, ...unknown[]];
const state = {
  authorized: true,
  calls: [] as Call[],
  existing: null as null | { id: string },
  profile: { id: "00000000-0000-0000-0000-0000000000b1", email: ALLOWED, is_active: true } as any,
  authUser: { email_confirmed_at: null as string | null },
  inviteError: null as null | { status: number; code: string; message: string },
  rpcError: {} as Record<string, { message: string } | null>,
  rateAllowed: true,
};
const record = (...c: Call) => { state.calls.push(c); };
mock.module("next/navigation.js", { namedExports: { redirect: (to: string) => { throw new Redirect(to); } } });
mock.module(url("lib/auth/session.ts"), {
  namedExports: { requireModuleAccess: async (mod: string, level: string) => { record("requireModuleAccess", mod, level); if (!state.authorized) throw new NoAccess("no access"); return { id: "admin" }; } },
});
mock.module(url("lib/rate-limit.js"), { namedExports: { checkSharedRateLimit: async ({ key }: { key: string }) => { record("rateLimit", key); return state.rateAllowed; } } });
mock.module(url("lib/supabase/env.ts"), { namedExports: { getSupabaseUrl: () => `https://${STAGING_REF}.supabase.co`, getSupabasePublishableKey: () => "sb_publishable_synthetic" } });
mock.module("@supabase/supabase-js", {
  namedExports: { createClient: () => ({ auth: { resetPasswordForEmail: async (email: string, opts: unknown) => { record("resetPasswordForEmail", email, opts); return { error: null }; } } }) },
});
mock.module(url("lib/supabase/server.ts"), {
  namedExports: {
    createSupabaseServerClient: async () => ({
      from: (table: string) => ({
        select: (cols: string) => ({ eq: (col: string) => ({ maybeSingle: async () => {
          record("select", table, cols, col);
          return col === "email" ? { data: state.existing, error: null } : { data: state.profile, error: null };
        } }) }),
      }),
      rpc: async (fn: string, args: unknown) => { record("rpc", fn, args); return { error: state.rpcError[fn] ?? null }; },
    }),
    createSupabaseServiceClient: () => {
      record("serviceClient");
      return { auth: { admin: {
        inviteUserByEmail: async (email: string, opts: unknown) => { record("inviteUserByEmail", email, opts); return state.inviteError ? { data: { user: null }, error: state.inviteError } : { data: { user: { id: "00000000-0000-0000-0000-0000000000c1" } }, error: null }; },
        getUserById: async (id: string) => { record("getUserById", id); return { data: { user: { id, email_confirmed_at: state.authUser.email_confirmed_at } }, error: null }; },
        deleteUser: async (id: string) => { record("deleteUser", id); return { error: null }; },
      } } };
    },
  },
});
const actions = await import("../app/admin/(protected)/users/actions.ts");

const SITE = "https://terasuniversal-website-env-staging-terasuniversal-my.vercel.app";
function useEnv(env: Record<string, string | undefined>) {
  for (const k of ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "TERAS_APPROVED_SUPABASE_PROJECT_REF", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TERAS_STAGING_INVITE_ALLOWLIST", "TERAS_SERVICE_KEY_PROJECT_REF", "NEXT_PUBLIC_SITE_URL"]) delete process.env[k];
  for (const [k, v] of Object.entries({ NEXT_PUBLIC_SITE_URL: SITE, ...env })) if (v !== undefined) process.env[k] = v;
}
function reset(env = stagingEnv()) {
  useEnv(env);
  state.authorized = true; state.calls = []; state.existing = null; state.inviteError = null; state.rpcError = {}; state.rateAllowed = true;
  state.profile = { id: "00000000-0000-0000-0000-0000000000b1", email: ALLOWED, is_active: true };
  state.authUser = { email_confirmed_at: null };
}
function inviteForm(email: string, extra: Record<string, string> = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ full_name: "UAT Invite Synthetic", email, department: "sales", role: "editor", status: "active", access_mode: "role_default", ...extra })) f.set(k, v);
  return f;
}
async function invite(email: string, extra?: Record<string, string>) {
  try { return { result: await actions.inviteStaffAction({}, inviteForm(email, extra)) }; } catch (e) { if (e instanceof Redirect) return { redirect: e.to }; throw e; }
}
async function resend(id = state.profile.id) {
  const f = new FormData(); f.set("user_id", id);
  try { await actions.resendStaffInviteAction(f); } catch (e) { if (e instanceof Redirect) return e.to; throw e; }
  throw new Error("expected redirect");
}
const names = () => state.calls.map((c) => c[0]);
const sent = () => state.calls.filter((c) => c[0] === "inviteUserByEmail" || c[0] === "resetPasswordForEmail");

test("7. a user without Users admin access is stopped before any decision, lookup or email", async () => {
  reset();
  state.authorized = false;
  await assert.rejects(() => actions.inviteStaffAction({}, inviteForm(ALLOWED)), NoAccess);
  const f = new FormData(); f.set("user_id", state.profile.id);
  await assert.rejects(() => actions.resendStaffInviteAction(f), NoAccess);
  assert.deepEqual(names(), ["requireModuleAccess", "requireModuleAccess"]);
  assert.ok(state.calls.every((c) => c[1] === "users" && c[2] === "admin"));
});

test("8. new invite: allowlisted address on Staging sends exactly one invitation; other addresses send none", async () => {
  reset();
  const ok = await invite(ALLOWED.toUpperCase());
  assert.deepEqual(ok, { redirect: "/admin/users?invited=1" });
  assert.equal(sent().length, 1);
  assert.equal(sent()[0][1], ALLOWED, "normalized address is both the checked and the sent recipient");
  assert.deepEqual((sent()[0][2] as any).redirectTo, `${SITE}/admin/reset-password`);
  reset();
  const denied = await invite(OTHER);
  assert.deepEqual(denied, { result: { error: "Staff invitations are disabled in this environment." } });
  assert.equal(sent().length, 0);
  assert.ok(!names().includes("serviceClient") && !names().includes("select"), "no service client or lookup for a denied recipient");
  for (const env of [stagingEnv({ VERCEL_TARGET_ENV: "preview" }), stagingEnv({ TERAS_STAGING_INVITE_ALLOWLIST: undefined }), stagingEnv({ NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co` })]) {
    reset(env);
    assert.equal(typeof (await invite(ALLOWED)).result?.error, "string");
    assert.equal(sent().length, 0);
  }
});

test("9. resend to a confirmed allowlisted user sends a recovery email (not a second invite)", async () => {
  reset();
  state.authUser.email_confirmed_at = "2026-11-22T08:00:00Z";
  assert.equal(await resend(), `/admin/users/${state.profile.id}?resent=recovery`);
  assert.deepEqual(sent().map((c) => [c[0], c[1]]), [["resetPasswordForEmail", ALLOWED]]);
  assert.ok(names().indexOf("serviceClient") > names().indexOf("select"), "decision uses the stored profile email first");
  reset();
  state.profile = { ...state.profile, email: OTHER };
  assert.equal(await resend(), `/admin/users/${state.profile.id}?error=invite-disabled-non-production`);
  assert.equal(sent().length, 0);
  assert.ok(!names().includes("serviceClient") && !names().includes("rateLimit"));
});

test("10. resend to an inactive allowlisted user is refused with no email", async () => {
  reset();
  state.profile = { ...state.profile, is_active: false };
  state.authUser.email_confirmed_at = "2026-11-22T08:00:00Z";
  assert.equal(await resend(), `/admin/users/${state.profile.id}?error=staff-inactive`);
  assert.equal(sent().length, 0);
  assert.ok(!names().includes("rateLimit"));
});

test("11. Auth failure: invite error sends nothing further; profile failure rolls the invited user back", async () => {
  reset();
  state.inviteError = { status: 500, code: "unexpected_failure", message: "synthetic" };
  assert.deepEqual(await invite(ALLOWED), { result: { error: "The invitation could not be sent." } });
  assert.ok(!names().includes("rpc") && !names().includes("deleteUser"));
  reset();
  state.rpcError = { update_staff_profile: { message: "synthetic" } };
  const r = await invite(ALLOWED);
  assert.match(String(r.result?.error), /rolled back/);
  assert.deepEqual(state.calls.filter((c) => c[0] === "deleteUser"), [["deleteUser", "00000000-0000-0000-0000-0000000000c1"]]);
});

test("12. roles and grants: invite writes only the submitted role/grants; resend writes none", async () => {
  reset();
  await invite(ALLOWED, { access_mode: "custom", module_key: "sales", module_access: JSON.stringify([{ module_key: "sales", access_level: "view" }]) });
  const rpcs = state.calls.filter((c) => c[0] === "rpc");
  assert.deepEqual(rpcs.map((c) => c[1]), ["set_staff_module_access", "update_staff_profile"]);
  assert.deepEqual((rpcs[0][2] as any).p_modules, [{ module_key: "sales", access_level: "view" }]);
  assert.equal((rpcs[1][2] as any).p_role, "editor");
  assert.equal((rpcs[1][2] as any).p_access_control_enabled, true);
  // super_admin/admin escalation is impossible from the invite form (schema enum unchanged).
  reset();
  assert.equal(typeof (await invite(ALLOWED, { role: "super_admin" })).result?.error, "string");
  assert.equal(sent().length, 0);
  reset();
  state.authUser.email_confirmed_at = "2026-11-22T08:00:00Z";
  await resend();
  assert.ok(!names().includes("rpc"), "resend never touches roles, grants or is_active");
});

// ----------------------------------------------------------- C6 + leakage (13-15)
test("13. C6: the GET page never spends the token; templates point at the confirm page with token_hash", async () => {
  const page = await read("app/admin/auth/confirm/page.tsx");
  assert.doesNotMatch(page, /verifyOtp|setSession|exchangeCodeForSession/);
  assert.match(page, /<form action=\{confirmEmailLink\}/);
  const doc = await read("docs/release/AUTH1_SUPABASE_CONFIG.md");
  for (const type of ["recovery", "invite"]) {
    assert.ok(doc.includes(`{{ .SiteURL }}/admin/auth/confirm?token_hash={{ .TokenHash }}&type=${type}`), `${type} template link`);
  }
  const c6 = doc.slice(doc.indexOf("## C6"), doc.indexOf("## C6 rollback"));
  const bodies = [...c6.matchAll(/```html\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.equal(bodies.length, 2, "exactly the Reset and Invite bodies");
  for (const body of bodies) {
    assert.doesNotMatch(body, /\{\{ \.Token \}\}|\{\{ \.ConfirmationURL \}\}|redirect_to|https?:\/\//, "C6 bodies: no OTP code, no ConfirmationURL, no hard-coded origin");
    assert.equal(body.match(/href=/g)?.length, 1, "one link per email");
  }
});

test("14. C6: the POST accepts only invite/recovery token_hash links", async () => {
  const link = await import("../lib/auth/email-link.ts");
  assert.deepEqual([...link.EMAIL_LINK_TYPES], ["invite", "recovery"]);
  for (const type of ["signup", "magiclink", "email_change", "email", "reauthentication", "INVITE", "recovery "]) {
    assert.equal(link.parseEmailLinkParams("a".repeat(56), type).ok, false, type);
  }
  const src = await read("app/admin/auth/confirm/actions.ts");
  const body = src.slice(src.indexOf("export async function confirmEmailLink"));
  assert.ok(body.indexOf("parseEmailLinkParams") < body.indexOf("verifyOtp"), "type checked before verifyOtp");
  assert.ok(body.indexOf("verifyOtp") < body.indexOf("hasRecentEmailLinkAuth") && body.indexOf("hasRecentEmailLinkAuth") < body.indexOf("is_active"));
});

test("15. no token, key or recipient address leaks into logs, errors or redirects", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")); };
  const results: string[] = [];
  try {
    reset();
    state.inviteError = { status: 500, code: "unexpected_failure", message: "synthetic" };
    results.push(JSON.stringify(await invite(ALLOWED)));
    reset();
    results.push(JSON.stringify(await invite(OTHER)));
    reset(stagingEnv({ TERAS_STAGING_INVITE_ALLOWLIST: "*" }));
    results.push(JSON.stringify(await invite(ALLOWED)));
    reset();
    state.profile = { ...state.profile, email: OTHER };
    results.push(await resend());
    results.push(JSON.stringify(iso.staffInviteDecision(OTHER, stagingEnv())));
  } finally {
    console.error = original;
  }
  const haystack = [...logged, ...results].join("\n");
  for (const secret of [serviceKey(STAGING_REF), ALLOWED, OTHER, "sb_publishable_synthetic"]) assert.ok(!haystack.includes(secret), `leaked ${secret.slice(0, 12)}`);
  const srcs = await Promise.all(["lib/preview-isolation.ts", "app/admin/(protected)/users/actions.ts", "app/admin/auth/confirm/actions.ts"].map(read));
  for (const src of srcs) {
    for (const line of src.split("\n").filter((l) => /console\.(error|warn|log)/.test(l))) {
      assert.doesNotMatch(line, /token_hash|tokenHash|access_token|refresh_token|password\b|ALLOWLIST|recipient|email:/, line.trim());
    }
  }
  assert.doesNotMatch(srcs[0], /NEXT_PUBLIC_TERAS_STAGING|NEXT_PUBLIC_.*ALLOWLIST/, "allowlist is server-only");
});
