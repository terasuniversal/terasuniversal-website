// AUTH-1 staff email-link flow: invitation, recovery, password setup and resend.
// Run: node --experimental-strip-types --experimental-test-module-mocks --no-warnings scripts/staff-auth-confirm-flow.test.mts
// Synthetic data only: mocked Supabase/Next modules, fake tokens, no network.
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

const link = await import("../lib/auth/email-link.ts");
const invite = await import("../lib/auth/staff-invite.ts");
const TOKEN = "a".repeat(56); // synthetic token_hash

// ---------------------------------------------------------------- pure helpers
test("token_hash and type validation", () => {
  assert.deepEqual(link.parseEmailLinkParams(TOKEN, "invite"), { ok: true, tokenHash: TOKEN, type: "invite" });
  assert.equal(link.parseEmailLinkParams(`pkce_${TOKEN}`, "recovery").ok, true);
  for (const type of ["signup", "magiclink", "email_change", "email", "", "INVITE", null]) {
    assert.equal(link.parseEmailLinkParams(TOKEN, type).ok, false, `type ${String(type)} refused`);
  }
  for (const hash of ["", "short", "a".repeat(300), `${TOKEN}&next=https://evil.example`, `${TOKEN}<script>`, undefined, 42]) {
    assert.equal(link.parseEmailLinkParams(hash, "invite").ok, false, `hash ${String(hash).slice(0, 20)} refused`);
  }
});

test("verifyOtp errors map to safe codes (expired, already used, rate limited, outage)", () => {
  assert.equal(link.mapVerifyOtpError({ status: 403, code: "otp_expired", message: "Email link is invalid or has expired" }), "link_expired");
  assert.equal(link.mapVerifyOtpError({ status: 403, message: "One-time token not found" }), "link_expired"); // already used
  assert.equal(link.mapVerifyOtpError({ status: 429, code: "over_request_rate_limit", message: "x" }), "rate_limited");
  assert.equal(link.mapVerifyOtpError({ status: 400, code: "validation_failed", message: "bad" }), "link_invalid");
  assert.equal(link.mapVerifyOtpError({ status: 500, message: "upstream" }), "unavailable");
  assert.equal(link.mapVerifyOtpError(null), "unavailable");
  for (const code of link.CONFIRM_ERROR_CODES) assert.ok(link.CONFIRM_ERROR_MESSAGES[code].length > 20);
  assert.equal(link.confirmErrorCode("link_expired"), "link_expired");
  assert.equal(link.confirmErrorCode("<b>x</b>"), null);
});

test("set-password is allowed only for a recent email-link session", () => {
  const now = 1_800_000_000;
  assert.equal(link.hasRecentEmailLinkAuth([{ method: "password", timestamp: now - 10 }], now), false, "password login refused");
  assert.equal(link.hasRecentEmailLinkAuth([{ method: "invite", timestamp: now - 60 }], now), true);
  assert.equal(link.hasRecentEmailLinkAuth([{ method: "otp", timestamp: now - 60 }], now), true);
  assert.equal(link.hasRecentEmailLinkAuth([{ method: "recovery", timestamp: now - 7200 }], now), false, "older than 1h refused");
  assert.equal(link.hasRecentEmailLinkAuth([{ method: "recovery", timestamp: now + 3600 }], now), false, "future timestamp refused");
  assert.equal(link.hasRecentEmailLinkAuth(["otp"], now), false, "string AMR without time refused");
  assert.equal(link.hasRecentEmailLinkAuth(undefined, now), false);
  assert.equal(link.hasRecentEmailLinkAuth([{ method: "password", timestamp: now - 5 }, { method: "recovery", timestamp: now - 30 }], now), true);
});

test("legacy hash links: only invite/recovery tokens are taken, errors are recognised", () => {
  const ok = link.parseLegacyHashTokens("#access_token=fake.jwt.token&refresh_token=fakeRefresh&type=invite&expires_in=3600");
  assert.deepEqual(ok, { accessToken: "fake.jwt.token", refreshToken: "fakeRefresh", type: "invite" });
  assert.equal(link.parseLegacyHashTokens("#access_token=a&refresh_token=b&type=signup"), null);
  assert.equal(link.parseLegacyHashTokens("#access_token=a&type=recovery"), null);
  assert.equal(link.parseLegacyHashTokens(""), null);
  assert.equal(link.legacyHashErrorCode("#error=access_denied&error_code=otp_expired&error_description=x"), "link_expired");
  assert.equal(link.legacyHashErrorCode("#error=server_error"), "link_invalid");
  assert.equal(link.legacyHashErrorCode("#access_token=a"), null);
});

test("email-link redirect stays on the configured site origin", () => {
  // Stays on the already-allowlisted path, which forwards to /admin/auth/confirm.
  assert.equal(link.emailLinkRedirectUrl("https://www.terasuniversal.com.my"), "https://www.terasuniversal.com.my/admin/reset-password");
  assert.equal(link.emailLinkRedirectUrl("https://www.terasuniversal.com.my/"), "https://www.terasuniversal.com.my/admin/reset-password");
  for (const bad of [undefined, "", "javascript:alert(1)", "https://evil.example/x?y", "www.terasuniversal.com.my"]) {
    assert.equal(link.emailLinkRedirectUrl(bad), null, `refuses ${String(bad)}`);
  }
  assert.equal(link.SET_PASSWORD_PATH, "/admin/auth/set-password");
});

test("resend decision: inactive refused, pending invited, confirmed gets recovery", () => {
  assert.equal(invite.resendDecision({ isActive: false, emailConfirmedAt: null }), "refuse_inactive");
  assert.equal(invite.resendDecision({ isActive: false, emailConfirmedAt: "2026-11-22T07:37:00Z" }), "refuse_inactive");
  assert.equal(invite.resendDecision({ isActive: true, emailConfirmedAt: null }), "invite");
  assert.equal(invite.resendDecision({ isActive: true, emailConfirmedAt: "2026-11-22T07:37:00Z" }), "recovery");
  assert.ok(invite.staffInviteMessage("error", "staff-inactive"));
  assert.equal(invite.staffInviteMessage("error", "made-up"), null);
});

// ------------------------------------------- confirmEmailLink with mocked services
class Redirect extends Error { to: string; constructor(to: string) { super(`redirect:${to}`); this.to = to; } }
type Calls = { verifyOtp: unknown[]; signOut: number; rateKeys: string[]; setSession: unknown[]; profileWrites: number };
const NOW = Math.floor(Date.now() / 1000);
const state = {
  verifyResult: { data: { user: { id: "00000000-0000-0000-0000-0000000000a1" } }, error: null } as any,
  profile: { data: { is_active: true }, error: null } as any,
  rateAllowed: true,
  setSessionResult: { data: { user: { id: "00000000-0000-0000-0000-0000000000a1" } }, error: null } as any,
  setSessionThrows: null as null | Error,
  claimsThrows: null as null | Error,
  claims: { data: { claims: { amr: [{ method: "otp", timestamp: NOW - 30 }] } }, error: null } as any,
  calls: { verifyOtp: [], signOut: 0, rateKeys: [], setSession: [], profileWrites: 0 } as Calls,
};
mock.module("next/navigation.js", { namedExports: { redirect: (to: string) => { throw new Redirect(to); } } });
mock.module("next/headers.js", { namedExports: { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }) } });
mock.module(url("lib/rate-limit.js"), {
  namedExports: {
    hashedClientId: (ip: string) => `h(${ip})`,
    checkSharedRateLimit: async ({ key }: { key: string }) => { state.calls.rateKeys.push(key); return state.rateAllowed; },
  },
});
mock.module(url("lib/supabase/server.ts"), {
  namedExports: {
    createSupabaseServerClient: async () => ({
      auth: {
        verifyOtp: async (params: unknown) => { state.calls.verifyOtp.push(params); return state.verifyResult; },
        signOut: async () => { state.calls.signOut += 1; return { error: null }; },
        setSession: async (params: unknown) => { state.calls.setSession.push(params); if (state.setSessionThrows) throw state.setSessionThrows; return state.setSessionResult; },
        getClaims: async () => { if (state.claimsThrows) throw state.claimsThrows; return state.claims; },
      },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => state.profile }) }),
        update: () => { state.calls.profileWrites += 1; return { eq: async () => ({ error: null }) }; },
        upsert: () => { state.calls.profileWrites += 1; return { error: null }; },
      }),
    }),
  },
});
const { confirmEmailLink, establishLegacySession } = await import("../app/admin/auth/confirm/actions.ts");

function form(fields: Record<string, string>) { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; }
async function run(fields: Record<string, string>): Promise<string> {
  try { await confirmEmailLink(form(fields)); } catch (e) { if (e instanceof Redirect) return e.to; throw e; }
  throw new Error("expected a redirect");
}
function reset() {
  state.verifyResult = { data: { user: { id: "00000000-0000-0000-0000-0000000000a1" } }, error: null };
  state.profile = { data: { is_active: true }, error: null };
  state.rateAllowed = true;
  state.setSessionResult = { data: { user: { id: "00000000-0000-0000-0000-0000000000a1" } }, error: null };
  state.setSessionThrows = null;
  state.claimsThrows = null;
  state.claims = { data: { claims: { amr: [{ method: "otp", timestamp: NOW - 30 }] } }, error: null };
  state.calls = { verifyOtp: [], signOut: 0, rateKeys: [], setSession: [], profileWrites: 0 };
}

test("new invitation: POST verifies once and goes only to set-password", async () => {
  reset();
  assert.equal(await run({ token_hash: TOKEN, type: "invite", next: "https://evil.example" }), "/admin/auth/set-password");
  assert.deepEqual(state.calls.verifyOtp, [{ type: "invite", token_hash: TOKEN }]);
  assert.equal(state.calls.rateKeys[0], "auth-confirm:h(203.0.113.9)");
});

test("password reset (recovery) link", async () => {
  reset();
  assert.equal(await run({ token_hash: TOKEN, type: "recovery" }), "/admin/auth/set-password");
  assert.deepEqual(state.calls.verifyOtp, [{ type: "recovery", token_hash: TOKEN }]);
});

test("expired or already-used token: clear error, token never echoed", async () => {
  reset();
  state.verifyResult = { data: { user: null }, error: { status: 403, code: "otp_expired", message: "Email link is invalid or has expired" } };
  const to = await run({ token_hash: TOKEN, type: "invite" });
  assert.equal(to, "/admin/auth/confirm?error=link_expired");
  assert.ok(!to.includes(TOKEN));
});

test("malformed or wrong-type link is refused before any Auth call", async () => {
  reset();
  assert.equal(await run({ token_hash: TOKEN, type: "signup" }), "/admin/auth/confirm?error=link_invalid");
  assert.equal(await run({ token_hash: "x", type: "invite" }), "/admin/auth/confirm?error=link_invalid");
  assert.equal(state.calls.verifyOtp.length, 0);
});

test("rate limited: no verifyOtp call", async () => {
  reset();
  state.rateAllowed = false;
  assert.equal(await run({ token_hash: TOKEN, type: "invite" }), "/admin/auth/confirm?error=rate_limited");
  assert.equal(state.calls.verifyOtp.length, 0);
});

test("disabled account: session discarded, stays inactive", async () => {
  reset();
  state.profile = { data: { is_active: false }, error: null };
  assert.equal(await run({ token_hash: TOKEN, type: "recovery" }), "/admin/auth/confirm?error=account_inactive");
  assert.equal(state.calls.signOut, 1);
});

test("C6 token_hash: a session without a recent email-link AMR is discarded (fail closed)", async () => {
  reset();
  state.claims = { data: { claims: { amr: [{ method: "password", timestamp: NOW - 5 }] } }, error: null };
  assert.equal(await run({ token_hash: TOKEN, type: "invite" }), "/admin/auth/confirm?error=session_failed");
  assert.equal(state.calls.signOut, 1);
  reset();
  state.claims = { data: null, error: { name: "AuthInvalidJwtError", status: 401 } };
  assert.equal(await run({ token_hash: TOKEN, type: "recovery" }), "/admin/auth/confirm?error=session_failed");
  assert.equal(state.calls.signOut, 1);
});

test("C6 token_hash: unexpected Auth/network failures fail closed with a redirect, never a throw", async () => {
  reset();
  state.verifyResult = { data: null, error: null };
  assert.equal(await run({ token_hash: TOKEN, type: "invite" }), "/admin/auth/confirm?error=unavailable");
  reset();
  state.profile = { data: null, error: { code: "PGRST000" } };
  assert.equal(await run({ token_hash: TOKEN, type: "invite" }), "/admin/auth/confirm?error=unavailable");
  assert.equal(state.calls.signOut, 1);
  reset();
  state.claimsThrows = Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError" });
  assert.equal(await run({ token_hash: TOKEN, type: "recovery" }), "/admin/auth/confirm?error=network_failed");
  reset();
  state.claimsThrows = new Error("boom");
  assert.equal(await run({ token_hash: TOKEN, type: "recovery" }), "/admin/auth/confirm?error=unavailable");
  const src = await read("app/admin/auth/confirm/actions.ts");
  const confirmBody = src.slice(src.indexOf("export async function confirmEmailLink"), src.indexOf("async function verifyEmailLink"));
  assert.doesNotMatch(confirmBody, /try \{/, "redirect() is never inside a try block");
});

// ---------------------------------------------------------- source contracts
test("GET never spends the token; page is not indexable and sends no referrer", async () => {
  const page = await read("app/admin/auth/confirm/page.tsx");
  assert.doesNotMatch(page, /verifyOtp|setSession|exchangeCodeForSession/);
  assert.match(page, /<form action=\{confirmEmailLink\}/);
  assert.match(page, /referrer: "no-referrer"/);
  assert.match(page, /index: false/);
  const legacy = await read("app/admin/auth/confirm/LegacyHashConfirm.tsx");
  assert.match(legacy, /history\.replaceState/, "hash tokens removed from the address bar");
  // Gate B remediation: the session is set on the server, only when the button is pressed.
  assert.doesNotMatch(legacy, /createSupabaseBrowserClient|auth\.setSession\(/, "no browser-side setSession");
  assert.equal(legacy.split("establishLegacySession(").length, 2, "exactly one call to the server action");
  assert.ok(legacy.indexOf("establishLegacySession(form)") > legacy.indexOf("async function continueWithLink"), "posted only on button press");
});

// ------------------------------------- establishLegacySession (Gate B remediation)
const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ACCESS = `${b64u({ alg: "HS256" })}.${b64u({ sub: "a1", exp: NOW + 3600 })}.c2ln`; // synthetic, unsigned
const REFRESH = "synthRefresh12";
const legacyForm = (access = ACCESS, refresh = REFRESH) => form({ access_token: access, refresh_token: refresh });

test("R1 valid first-use legacy recovery: server setSession once, then only the internal set-password path", async () => {
  reset();
  assert.deepEqual(await establishLegacySession(legacyForm()), { ok: true, next: "/admin/auth/set-password" });
  assert.deepEqual(state.calls.setSession, [{ access_token: ACCESS, refresh_token: REFRESH }]);
  assert.equal(state.calls.rateKeys[0], "auth-legacy-session:h(203.0.113.9)");
});

test("R2 malformed tokens are refused before any Auth call", async () => {
  reset();
  for (const [a, r] of [["not-a-jwt", REFRESH], [ACCESS, "x"], [ACCESS, "bad token!"], ["", ""], ["a.b.c" + "x".repeat(5000), REFRESH]]) {
    assert.deepEqual(await establishLegacySession(legacyForm(a, r)), { ok: false, error: "malformed_link" });
  }
  assert.equal(state.calls.setSession.length, 0);
});

test("R3 failures are classified instead of all becoming link_expired", async () => {
  const cases: [any, string][] = [
    [{ name: "AuthRetryableFetchError", status: 0 }, "network_failed"],
    [{ name: "AuthInvalidJwtError" }, "malformed_link"],
    [{ name: "AuthApiError", status: 403, code: "session_not_found" }, "session_failed"],
    [{ name: "AuthApiError", status: 400, code: "refresh_token_not_found" }, "session_failed"],
    [{ name: "AuthApiError", status: 429, code: "over_request_rate_limit" }, "rate_limited"],
    [{ name: "AuthApiError", status: 503 }, "unavailable"],
  ];
  for (const [error, expected] of cases) {
    reset();
    state.setSessionResult = { data: { user: null, session: null }, error };
    assert.deepEqual(await establishLegacySession(legacyForm()), { ok: false, error: expected }, expected);
  }
});

test("R4 server-side network exception is caught (no unhandled throw)", async () => {
  reset();
  state.setSessionThrows = Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError" });
  assert.deepEqual(await establishLegacySession(legacyForm()), { ok: false, error: "network_failed" });
  reset();
  state.setSessionThrows = new TypeError("boom");
  assert.deepEqual(await establishLegacySession(legacyForm()), { ok: false, error: "unavailable" });
});

test("R5 inactive account: session discarded, stays inactive, no profile write", async () => {
  reset();
  state.profile = { data: { is_active: false }, error: null };
  assert.deepEqual(await establishLegacySession(legacyForm()), { ok: false, error: "account_inactive" });
  assert.equal(state.calls.signOut, 1);
  assert.equal(state.calls.profileWrites, 0);
});

test("R6 a normal password session cannot use this path to reach set-password", async () => {
  reset();
  state.claims = { data: { claims: { amr: [{ method: "password", timestamp: NOW - 10 }] } }, error: null };
  assert.deepEqual(await establishLegacySession(legacyForm()), { ok: false, error: "session_failed" });
  assert.equal(state.calls.signOut, 1);
});

test("R7 rate limited: no Auth call", async () => {
  reset();
  state.rateAllowed = false;
  assert.deepEqual(await establishLegacySession(legacyForm()), { ok: false, error: "rate_limited" });
  assert.equal(state.calls.setSession.length, 0);
});

test("R8 repeated Continue: each press is one server call; a second press after success is harmless", async () => {
  reset();
  await establishLegacySession(legacyForm());
  await establishLegacySession(legacyForm());
  assert.equal(state.calls.setSession.length, 2, "no hidden retries");
  const legacy = await read("app/admin/auth/confirm/LegacyHashConfirm.tsx");
  assert.match(legacy, /if \(!tokens \|\| inFlight\.current\) return;/, "client ignores clicks while a request is in flight");
  assert.match(legacy, /disabled=\{pending\}/);
  assert.match(legacy, /\} catch \(thrown\) \{[\s\S]*?setError\("network_failed"\)/, "a failed request ends the loading state with a network error");
  assert.match(legacy, /inFlight\.current = false;\s*setPending\(false\);/, "loading always ends on failure");
});

test("R9 no token appears in any log line of the new action", async () => {
  reset();
  const seen: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { seen.push(JSON.stringify(args)); };
  try {
    state.setSessionResult = { data: { user: null }, error: { name: "AuthApiError", status: 403, code: "session_not_found", message: `echo ${ACCESS} ${REFRESH}` } };
    await establishLegacySession(legacyForm());
    state.setSessionThrows = Object.assign(new Error(`echo ${ACCESS}`), { name: "AuthRetryableFetchError" });
    await establishLegacySession(legacyForm());
  } finally { console.error = orig; }
  assert.ok(seen.length >= 2);
  for (const line of seen) { assert.ok(!line.includes(ACCESS) && !line.includes(REFRESH), line); }
});

test("R10 error messages are distinct and in Bahasa Melayu", () => {
  const messages = link.CONFIRM_ERROR_CODES.map((c) => link.CONFIRM_ERROR_MESSAGES[c]);
  assert.equal(new Set(messages).size, messages.length, "every code has its own message");
  assert.match(link.CONFIRM_ERROR_MESSAGES.network_failed, /Cuba lagi/);
  assert.deepEqual([...link.RETRYABLE_CONFIRM_ERRORS].sort(), ["network_failed", "rate_limited", "unavailable"]);
});

test("set-password: active staff, recent email-link session, no privileged client", async () => {
  const actions = await read("app/admin/auth/set-password/actions.ts");
  const body = actions.slice(actions.indexOf("export async function setPasswordFromEmailLink"));
  assert.ok(body.indexOf("requireStaff()") < body.indexOf("emailLinkSessionIsRecent()"));
  assert.ok(body.indexOf("emailLinkSessionIsRecent()") < body.indexOf("updateUser("));
  assert.ok(body.indexOf("setPasswordSchema.safeParse") < body.indexOf("updateUser("));
  assert.doesNotMatch(actions, /createSupabaseServiceClient|is_active|update_staff_profile|set_staff_module_access/);
  const session = await read("lib/auth/email-link-session.ts");
  assert.match(session, /import "server-only"/);
  assert.match(session, /auth\.getClaims\(\)/);
  const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(exported, ["setPasswordFromEmailLink"], "no unguarded helper exported from a use-server file");
});

test("middleware: only the confirm page is public, set-password still needs a session", async () => {
  const mw = await read("lib/supabase/middleware.ts");
  assert.match(mw, /pathname === "\/admin\/reset-password" \|\| pathname === "\/admin\/auth\/confirm"/);
  assert.doesNotMatch(mw, /auth\/set-password/);
});

test("old reset page only forwards; it no longer calls Auth", async () => {
  const resetPage = await read("app/admin/reset-password/page.tsx");
  assert.doesNotMatch(resetPage, /updateUser|createSupabaseBrowserClient/);
  assert.match(resetPage, /window\.location\.replace\(`\$\{CONFIRM_PATH\}\$\{search\}\$\{hash\}`\)/);
});

test("Resend Invite keeps the guards, refuses inactive, rate-limits, never touches roles or grants", async () => {
  const actions = await read("app/admin/(protected)/users/actions.ts");
  const body = actions.slice(actions.indexOf("export async function resendStaffInviteAction"));
  const order = ["requireModuleAccess(\"users\", \"admin\")", "staffInviteDecision(profile.email)", "serviceClientOrError()", "refuse_inactive", "checkSharedRateLimit", "inviteUserByEmail", "resetPasswordForEmail"].map((s) => body.indexOf(s));
  assert.ok(order.every((i) => i > 0) && order.every((i, n) => n === 0 || i > order[n - 1]), `resend steps in order: ${order}`);
  assert.doesNotMatch(body, /update_staff_profile|set_staff_module_access|is_active:\s*true|\.update\(/);
  assert.match(actions, /function invitationRedirectUrl\(\) \{\n  return emailLinkRedirectUrl\(process\.env\.NEXT_PUBLIC_SITE_URL\);/);
  const route = await read("app/api/admin/reset-password/route.js");
  assert.match(route, /redirectTo: `\$\{new URL\(request\.url\)\.origin\}\/admin\/reset-password`/);
});

test("no token or password is written to logs", async () => {
  for (const file of ["app/admin/auth/confirm/actions.ts", "app/admin/auth/set-password/actions.ts", "app/admin/(protected)/users/actions.ts"]) {
    const src = await read(file);
    for (const line of src.split("\n").filter((l) => /console\.(error|warn|log)/.test(l))) {
      assert.doesNotMatch(line, /token_hash|tokenHash|access_token|refresh_token|password\b|new_password|email:/, `${file}: ${line.trim()}`);
    }
  }
});
