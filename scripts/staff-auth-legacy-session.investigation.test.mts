// AUTH-1 Gate B investigation (LOCAL ONLY, not committed). Synthetic tokens, mocked fetch, real @supabase/auth-js.
// Run: node --experimental-strip-types --no-warnings scripts/staff-auth-legacy-session.investigation.test.mts
import assert from "node:assert/strict";
import { test } from "node:test";
import { GoTrueClient } from "@supabase/auth-js";
import { readFile } from "node:fs/promises";

const link = await import("../lib/auth/email-link.ts");

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
function jwt(exp: number) {
  return `${b64u({ alg: "HS256", typ: "JWT" })}.${b64u({ sub: "00000000-0000-0000-0000-0000000000a5", exp, amr: [{ method: "otp", timestamp: now }], session_id: "s" })}.${Buffer.from("sig").toString("base64url")}`;
}
// GoTrue implicit redirect fragment shape (synthetic values only).
const goodHash = (exp = now + 3600) => `#access_token=${jwt(exp)}&expires_at=${exp}&expires_in=3600&refresh_token=synthRefresh12&token_type=bearer&type=recovery`;
const usedHash = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";

type Call = { method: string; url: string };
const lastStore = { current: new Map<string, string>() };
function client(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, calls: Call[]) {
  const store = new Map<string, string>();
  lastStore.current = store;
  return new GoTrueClient({
    url: "https://synthetic.supabase.co/auth/v1",
    headers: { apikey: "synthetic-anon" },
    flowType: "pkce", // same as @supabase/ssr browser client
    detectSessionInUrl: false,
    persistSession: true,
    autoRefreshToken: false,
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
    fetch: (async (url: string, init: RequestInit) => { calls.push({ method: String(init?.method ?? "GET"), url: String(url) }); return fetchImpl(url, init); }) as typeof fetch,
  });
}
const userOk = async () => new Response(JSON.stringify({ id: "00000000-0000-0000-0000-0000000000a5", aud: "authenticated", email: "qa@example.invalid" }), { status: 200, headers: { "content-type": "application/json" } });

// The exact mapping LegacyHashConfirm uses today: any setSession error -> "link_expired".
async function currentContinue(c: GoTrueClient, hash: string) {
  const tokens = link.parseLegacyHashTokens(hash);
  if (!tokens) return { shown: link.legacyHashErrorCode(hash) ?? "link_invalid", stage: "before-button" };
  const { error } = await c.setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
  return error ? { shown: "link_expired", stage: "after-button", errorName: error.name, status: (error as { status?: number }).status } : { shown: "set-password", stage: "after-button" };
}

test("1. first successful implicit recovery redirect: tokens parsed, setSession calls GET /user once, session saved", async () => {
  const calls: Call[] = [];
  const r = await currentContinue(client(userOk, calls), goodHash());
  assert.equal(r.shown, "set-password");
  assert.deepEqual(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), ["GET /auth/v1/user"]);
  // Session persistence: setSession writes the session to the client's storage (cookies, in the SSR server client).
  assert.ok([...lastStore.current.values()].some((v) => v.includes("synthRefresh12")), "session persisted to storage");
});

test("2. already-used link: GoTrue returns an error fragment, page shows link_expired BEFORE the button, no network", async () => {
  const calls: Call[] = [];
  const r = await currentContinue(client(userOk, calls), usedHash);
  assert.deepEqual(r, { shown: "link_expired", stage: "before-button" });
  assert.equal(calls.length, 0);
});

test("3. browser-side fetch failure (blocked/offline/extension): AuthRetryableFetchError, NO server request, shown as link_expired", async () => {
  const calls: Call[] = [];
  const r = await currentContinue(client(async () => { throw new TypeError("Failed to fetch"); }, calls), goodHash());
  assert.equal(r.shown, "link_expired");
  assert.equal(r.errorName, "AuthRetryableFetchError");
  assert.equal(calls.length, 1, "the request was attempted by the client but never reached Supabase");
});

test("4. revoked/expired session server-side: GET /user 403 -> AuthApiError, shown as link_expired (would appear in Supabase logs)", async () => {
  const calls: Call[] = [];
  const r = await currentContinue(client(async () => new Response(JSON.stringify({ code: "session_not_found", msg: "Session not found" }), { status: 403, headers: { "content-type": "application/json" } }), calls), goodHash());
  assert.equal(r.shown, "link_expired");
  assert.equal(r.status, 403);
});

test("5. access token past exp (button pressed > 1h later): refresh path POST /token", async () => {
  const calls: Call[] = [];
  await currentContinue(client(async () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Invalid Refresh Token" }), { status: 400, headers: { "content-type": "application/json" } }), calls), goodHash(now - 10));
  assert.deepEqual(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`), ["POST /auth/v1/token"]);
});

test("6. malformed access token in fragment: AuthInvalidJwtError, NO network, shown as link_expired", async () => {
  const calls: Call[] = [];
  const r = await currentContinue(client(userOk, calls), "#access_token=not-a-jwt&refresh_token=synthRefresh12&type=recovery");
  assert.equal(r.shown, "link_expired");
  assert.equal(r.errorName, "AuthInvalidJwtError");
  assert.equal(calls.length, 0);
});

test("7. duplicate open of the same link in another tab: second tab gets the error fragment (test 2); first tab unaffected (test 1)", async () => {
  const a: Call[] = [], b: Call[] = [];
  assert.equal((await currentContinue(client(userOk, a), goodHash())).shown, "set-password");
  assert.equal((await currentContinue(client(userOk, b), usedHash)).stage, "before-button");
});

test("8. reset-password forwarder keeps the fragment; confirm strips it before rendering the button", async () => {
  const fwd = await readFile("app/admin/reset-password/page.tsx", "utf8");
  assert.match(fwd, /window\.location\.replace\(`\$\{CONFIRM_PATH\}\$\{search\}\$\{hash\}`\)/);
  const lhc = await readFile("app/admin/auth/confirm/LegacyHashConfirm.tsx", "utf8");
  const effect = lhc.slice(lhc.indexOf("useEffect("), lhc.indexOf("async function continueWithLink"));
  assert.ok(effect.indexOf("const hash = window.location.hash") < effect.indexOf("replaceState"), "hash captured before it is removed");
  assert.ok(effect.indexOf("replaceState") < effect.indexOf("parseLegacyHashTokens(hash)"), "tokens parsed from the captured copy");
});

test("9. REMEDIATION: real auth-js failures now classify to distinct codes (were all link_expired)", async () => {
  const outcomes: Record<string, string> = {};
  const run = async (label: string, fetchImpl: (u: string, i: RequestInit) => Promise<Response>, hash: string) => {
    const tokens = link.parseLegacyHashTokens(hash)!;
    const { error } = await client(fetchImpl, []).setSession({ access_token: tokens.accessToken, refresh_token: tokens.refreshToken });
    outcomes[label] = link.classifySessionError(error);
  };
  await run("network", async () => { throw new TypeError("Failed to fetch"); }, goodHash());
  await run("revoked", async () => new Response(JSON.stringify({ code: "session_not_found", msg: "x" }), { status: 403, headers: { "content-type": "application/json" } }), goodHash());
  await run("malformed", userOk, "#access_token=not-a-jwt&refresh_token=synthRefresh12&type=recovery");
  await run("rate", async () => new Response(JSON.stringify({ code: "over_request_rate_limit", msg: "x" }), { status: 429, headers: { "content-type": "application/json" } }), goodHash());
  assert.deepEqual(outcomes, { network: "network_failed", revoked: "session_failed", malformed: "malformed_link", rate: "rate_limited" });
  const lhc = await readFile("app/admin/auth/confirm/LegacyHashConfirm.tsx", "utf8");
  assert.doesNotMatch(lhc, /setError\("link_expired"\)/, "session failures are no longer reported as 'expired or used'");
  assert.match(lhc, /try \{/);
});
