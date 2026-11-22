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
type Calls = { verifyOtp: unknown[]; signOut: number; rateKeys: string[] };
const state = {
  verifyResult: { data: { user: { id: "00000000-0000-0000-0000-0000000000a1" } }, error: null } as any,
  profile: { data: { is_active: true }, error: null } as any,
  rateAllowed: true,
  calls: { verifyOtp: [], signOut: 0, rateKeys: [] } as Calls,
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
      },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => state.profile }) }) }),
    }),
  },
});
const { confirmEmailLink } = await import("../app/admin/auth/confirm/actions.ts");

function form(fields: Record<string, string>) { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; }
async function run(fields: Record<string, string>): Promise<string> {
  try { await confirmEmailLink(form(fields)); } catch (e) { if (e instanceof Redirect) return e.to; throw e; }
  throw new Error("expected a redirect");
}
function reset() {
  state.verifyResult = { data: { user: { id: "00000000-0000-0000-0000-0000000000a1" } }, error: null };
  state.profile = { data: { is_active: true }, error: null };
  state.rateAllowed = true;
  state.calls = { verifyOtp: [], signOut: 0, rateKeys: [] };
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

// ---------------------------------------------------------- source contracts
test("GET never spends the token; page is not indexable and sends no referrer", async () => {
  const page = await read("app/admin/auth/confirm/page.tsx");
  assert.doesNotMatch(page, /verifyOtp|setSession|exchangeCodeForSession/);
  assert.match(page, /<form action=\{confirmEmailLink\}/);
  assert.match(page, /referrer: "no-referrer"/);
  assert.match(page, /index: false/);
  const legacy = await read("app/admin/auth/confirm/LegacyHashConfirm.tsx");
  assert.match(legacy, /history\.replaceState/, "hash tokens removed from the address bar");
  assert.ok(legacy.indexOf("auth.setSession(") > legacy.indexOf("async function continueWithLink"), "setSession only on button press");
  assert.equal(legacy.split("auth.setSession(").length, 2, "exactly one setSession call");
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
  const order = ["requireModuleAccess(\"users\", \"admin\")", "outboundDecision(\"staff_invite\")", "refuse_inactive", "checkSharedRateLimit", "inviteUserByEmail", "resetPasswordForEmail"].map((s) => body.indexOf(s));
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
