/**
 * W9-G3 eBook flow tests (owner-approved, local only; W9-EBOOK-RPC-CONTRACT v1.0). Contract parsers, the server-only
 * privileged module (allowlists, Preview isolation guard, browser refusal), email DNS rules, and the request /
 * verification / download logic against an in-memory CRM mock and a mock mailer. No network, no database, no email.
 *
 * Run: node --experimental-transform-types scripts/w9g3-ebook-flow.test.mts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { EBOOK_CONTRACT_VERSION, EBOOK_PUBLICATION, EBOOK_RPC, parseRedeemResult, parseSubmitResult, parseVerifyResult } from "../lib/ebook-contract.js";
import { EbookPrivilegedUnavailable, makeEbookBackend } from "../lib/ebook-privileged.server.js";
import { checkEmailDomain } from "../lib/email-dns.js";
import { makeMockMailer, makeResendMailer, buildVerificationEmail } from "../lib/ebook-mailer.js";
import { processEbookDownload, processEbookRequest, processEbookVerify } from "../lib/ebook-request.js";
import { makeEbookCrmMock } from "./fixtures/w9g3-ebook-crm-mock.mjs";
import { ebookVerifyUrl, parseVerifyLink } from "../lib/ebook-verify-link.js";

const T43 = "A".repeat(43);
const SITE = "https://www.terasuniversal.com.my";

// ---------- contract ----------
test("contract: version, outcome and token shape are enforced (fail closed)", () => {
  assert.equal(EBOOK_CONTRACT_VERSION, "v1.0");
  assert.deepEqual(parseSubmitResult({ contract: "v1.0", outcome: "accepted", verification_token: T43 }).outcome, "accepted");
  assert.equal(parseSubmitResult({ contract: "v2", outcome: "accepted", verification_token: T43 }).outcome, "contract_error");
  assert.equal(parseSubmitResult({ outcome: "accepted", verification_token: T43 }).outcome, "contract_error");
  assert.equal(parseSubmitResult({ contract: "v1.0", outcome: "created" }).outcome, "contract_error");
  assert.equal(parseSubmitResult({ contract: "v1.0", outcome: "accepted", verification_token: "short" }).outcome, "contract_error");
  assert.equal(parseSubmitResult(null).outcome, "contract_error");
  assert.equal(parseSubmitResult([]).outcome, "contract_error");
  for (const o of ["rate_limited", "quota_exhausted"]) assert.equal(parseSubmitResult({ contract: "v1.0", outcome: o }).outcome, o);
  assert.equal(parseVerifyResult({ contract: "v1.0", outcome: "verified", download_token: "x" }).outcome, "contract_error");
  for (const o of ["invalid", "expired", "already_used"]) assert.equal(parseVerifyResult({ contract: "v1.0", outcome: o }).outcome, o);
});

test("contract: only the exact allowlisted publication is accepted", () => {
  const ok = { contract: "v1.0", outcome: "ok", bucket: "ebook-private", object_path: "v1.5.1/teras-ebook-v1.5.1.pdf" };
  assert.equal(parseRedeemResult(ok).outcome, "ok");
  for (const bad of [{ bucket: "teras-photos" }, { object_path: "../secrets.pdf" }, { object_path: "v1.5.1/other.pdf" }, { bucket: "ebook-private ", object_path: "v1.5.1/teras-ebook-v1.5.1.pdf" }]) {
    assert.equal(parseRedeemResult({ ...ok, ...bad }).outcome, "contract_error", JSON.stringify(bad));
  }
  assert.deepEqual(EBOOK_PUBLICATION, { bucket: "ebook-private", objectPath: "v1.5.1/teras-ebook-v1.5.1.pdf" });
});

// ---------- privileged module ----------
function fakeClient(calls: string[]) {
  return {
    rpc: async (name: string) => { calls.push(`rpc:${name}`); return { data: { contract: "v1.0", outcome: "rate_limited" }, error: null }; },
    storage: { from: (b: string) => ({ createSignedUrl: async (p: string, s: number) => { calls.push(`sign:${b}/${p}:${s}`); return { data: { signedUrl: "https://storage.invalid/x" }, error: null }; } }) },
  };
}

test("privileged: guard must pass before any client is created; failures are typed and fail closed", async () => {
  const calls: string[] = [];
  let created = 0;
  const blocked = makeEbookBackend({ validate: () => ({ ok: false, code: "approved_ref_missing" }), createClient: () => { created += 1; return fakeClient(calls); } });
  await assert.rejects(blocked.callEbookRpc(EBOOK_RPC.submit, {}), (e: unknown) => e instanceof EbookPrivilegedUnavailable && (e as EbookPrivilegedUnavailable).code === "approved_ref_missing");
  await assert.rejects(blocked.signEbookDownload({ bucket: "ebook-private", objectPath: "v1.5.1/teras-ebook-v1.5.1.pdf" }));
  assert.equal(created, 0);
  const broken = makeEbookBackend({ validate: () => (undefined as unknown as { ok: boolean }), createClient: () => fakeClient(calls) });
  await assert.rejects(broken.callEbookRpc(EBOOK_RPC.submit, {}));
});

test("privileged: explicit RPC allowlist and exact signing path; 60-second URLs", async () => {
  const calls: string[] = [];
  const backend = makeEbookBackend({ validate: () => ({ ok: true }), createClient: () => fakeClient(calls) });
  for (const name of ["check_public_rate_limit", "promote_marketing_contact_to_sales", "reserve_email_quota", "submit_ebook_request; drop table x"]) {
    await assert.rejects(backend.callEbookRpc(name, {}), (e: unknown) => (e as EbookPrivilegedUnavailable).code === "rpc_not_allowlisted", name);
  }
  await backend.callEbookRpc(EBOOK_RPC.submit, {});
  await backend.callEbookRpc(EBOOK_RPC.verify, {});
  await backend.callEbookRpc(EBOOK_RPC.redeem, {});
  for (const pub of [{ bucket: "teras-photos", objectPath: "v1.5.1/teras-ebook-v1.5.1.pdf" }, { bucket: "ebook-private", objectPath: "v1.5.1/../x.pdf" }]) {
    await assert.rejects(backend.signEbookDownload(pub), (e: unknown) => (e as EbookPrivilegedUnavailable).code === "path_not_allowlisted");
  }
  const signed = await backend.signEbookDownload({ ...EBOOK_PUBLICATION });
  assert.equal(signed.url, "https://storage.invalid/x");
  assert.deepEqual(calls, ["rpc:submit_ebook_request", "rpc:verify_ebook_email", "rpc:redeem_ebook_token", "sign:ebook-private/v1.5.1/teras-ebook-v1.5.1.pdf:60"]);
});

test("privileged: refuses to run in a browser context", () => {
  const g = globalThis as unknown as { window?: unknown };
  g.window = {};
  try {
    assert.throws(() => makeEbookBackend({ validate: () => ({ ok: true }), createClient: () => ({}) }), (e: unknown) => (e as EbookPrivilegedUnavailable).code === "browser");
  } finally {
    delete g.window;
  }
});

// ---------- email DNS ----------
const dnsErr = (code: string) => Object.assign(new Error(code), { code });
function resolver(map: Record<string, Record<string, unknown>>) {
  const call = (kind: string) => async (d: string) => {
    const v = map[d]?.[kind];
    if (v instanceof Error) throw v;
    if (v === undefined) throw dnsErr("ENODATA");
    return v;
  };
  return { resolveMx: call("mx"), resolve4: call("a"), resolve6: call("aaaa") };
}

test("dns: MX, implicit MX, null MX, NXDOMAIN, no mail host, transient and timeouts", async () => {
  const r = resolver({
    "mx.test": { mx: [{ priority: 10, exchange: "mail.mx.test" }] },
    "implicit.test": { a: ["192.0.2.1"] },
    "null.test": { mx: [{ priority: 0, exchange: "" }] },
    "nulldot.test": { mx: [{ priority: 0, exchange: "." }] },
    "gone.test": { mx: dnsErr("ENOTFOUND"), a: dnsErr("ENOTFOUND"), aaaa: dnsErr("ENOTFOUND") },
    "nomail.test": {},
    "flaky.test": { mx: dnsErr("ESERVFAIL") },
    "flakya.test": { a: dnsErr("ETIMEOUT") },
  });
  const slow = { resolveMx: () => new Promise(() => {}), resolve4: async () => [], resolve6: async () => [] };
  const cases: [string, unknown, boolean, string][] = [
    ["a@mx.test", r, true, "mx"], ["a@implicit.test", r, true, "implicit_mx"], ["a@null.test", r, false, "null_mx"],
    ["a@nulldot.test", r, false, "null_mx"], ["a@gone.test", r, false, "nxdomain"], ["a@nomail.test", r, false, "no_mail_host"],
    ["a@flaky.test", r, true, "transient"], ["a@flakya.test", r, true, "transient"], ["a@slow.test", slow, true, "transient"],
    ["no-at-sign", r, false, "invalid_domain"], ["a@-bad-.test", r, false, "invalid_domain"],
  ];
  for (const [email, res, ok, kind] of cases) {
    const result = await checkEmailDomain(email, { resolver: res as never, timeoutMs: 50 });
    assert.deepEqual(result, { ok, kind }, email);
  }
});

test("dns: definite answers are cached; transient answers are not", async () => {
  let n = 0;
  const cache = new Map();
  const r = { resolveMx: async () => { n += 1; return [{ priority: 5, exchange: "mx.example" }]; }, resolve4: async () => [], resolve6: async () => [] };
  await checkEmailDomain("a@cached.test", { resolver: r, cache });
  await checkEmailDomain("b@cached.test", { resolver: r, cache });
  assert.equal(n, 1);
  const flaky = { resolveMx: async () => { throw dnsErr("ESERVFAIL"); }, resolve4: async () => [], resolve6: async () => [] };
  await checkEmailDomain("a@flaky2.test", { resolver: flaky, cache });
  assert.equal(cache.has("flaky2.test"), false);
});

// ---------- flow ----------
const okDns = async () => ({ ok: true, kind: "mx" });
function harness(opts: { quota?: number; clock?: { t: number }; mailerFails?: boolean; dns?: () => Promise<{ ok: boolean; kind: string }> } = {}) {
  const clock = opts.clock ?? { t: Date.parse("2026-11-24T03:00:00Z") };
  const crm = makeEbookCrmMock({ now: () => clock.t, ebookDailyQuota: opts.quota ?? 25 });
  const logs: unknown[][] = [];
  const outbox: { to: string; verifyUrl: string }[] = [];
  const mailer = opts.mailerFails ? { sendVerification: async () => ({ sent: false, code: "provider_error" }) } : makeMockMailer(outbox);
  const backend = makeEbookBackend({
    validate: () => ({ ok: true }),
    createClient: () => ({ rpc: async (n: string, a: Record<string, unknown>) => crm.rpc(n, a), storage: { from: (b: string) => ({ createSignedUrl: async (p: string, s: number) => crm.sign(b, p, s) }) } }),
  });
  const deps = { backend, mailer, checkDomain: opts.dns ?? okDns, verifyUrlFor: (t: string) => ebookVerifyUrl(SITE, t), log: (...a: unknown[]) => logs.push(a) };
  return { crm, deps, outbox, logs, clock };
}
const lead = { fullName: "Synthetic Tester", phone: "015-4800 1234", email: "Synthetic.Tester@Example.Test", privacyAck: true };
const submit = (h: ReturnType<typeof harness>, payload: object = lead, extra: object = {}) =>
  processEbookRequest({ payload, origin: SITE, siteOrigin: SITE, clientKey: "c".repeat(32), now: Date.parse("2026-11-24T03:00:10Z"), ...extra }, h.deps);
const tokenFrom = (url: string) => { const u = new URL(url); return parseVerifyLink({ hash: u.hash, search: u.search }).token!; };
const PII = /synthetic|tester|example\.test|4800|\+60|[A-Za-z0-9_-]{43}|storage\.invalid/i;

test("request: accepted sends one verification email with the exact contract arguments", async () => {
  const h = harness();
  const res = await submit(h);
  assert.deepEqual(res, { status: 202, body: { ok: true, status: "check_email" } });
  assert.equal(h.outbox.length, 1);
  assert.equal(h.outbox[0].to, "synthetic.tester@example.test");
  assert.match(h.outbox[0].verifyUrl, /^https:\/\/www\.terasuniversal\.com\.my\/ebook\/verify#t=[A-Za-z0-9_-]{43}$/);
  assert.equal(new URL(h.outbox[0].verifyUrl).search, "", "no query string: nothing token-bearing reaches a server request");
  const c = h.crm.state.contacts[0];
  assert.equal(c.email_verification_status, "unverified");
  assert.equal(c.phone_ownership_status, "unverified");
  assert.equal(c.consent_status, "not_set");
});

test("request: uniform responses (rate limited = accepted) and no mail when limited or quota is exhausted", async () => {
  const h = harness({ quota: 1 });
  const first = await submit(h);
  const second = await submit(h, { ...lead, email: "other@example.test", phone: "012-345 6789" });
  assert.deepEqual(second, { status: 202, body: { ok: false, status: "try_later" } });
  assert.equal(h.outbox.length, 1);
  const h2 = harness();
  for (let i = 0; i < 3; i += 1) await submit(h2);
  const limited = await submit(h2);
  assert.deepEqual(limited, first);
  assert.equal(h2.outbox.length, 3);
});

test("request: honeypot, origin, fill time, validation, DNS and privacy rejections never reach the RPC", async () => {
  const h = harness();
  assert.deepEqual(await submit(h, { ...lead, website: "bot" }), { status: 202, body: { ok: true, status: "check_email" } });
  assert.equal((await processEbookRequest({ payload: lead, origin: "https://evil.example", siteOrigin: SITE, clientKey: "k" }, h.deps)).status, 403);
  assert.equal((await submit(h, { ...lead, formStartedAt: Date.parse("2026-11-24T03:00:09Z") })).status, 400);
  for (const bad of [{ phone: "+65 9123 4567" }, { phone: "015-4000 1234" }, { email: "x" }, { privacyAck: false }, { fullName: "A" }]) {
    assert.equal((await submit(h, { ...lead, ...bad })).status, 400, JSON.stringify(bad));
  }
  const hDns = harness({ dns: async () => ({ ok: false, kind: "null_mx" }) });
  const dnsRes = await submit(hDns);
  assert.equal(dnsRes.status, 400);
  assert.match(JSON.stringify(dnsRes.body), /"email":"Please check your email address/);
  assert.equal(h.crm.state.requests.length + hDns.crm.state.requests.length, 0);
});

test("request: marketing is opt-in only, the phone carries no consent, versions are exact", async () => {
  const seen: Record<string, unknown>[] = [];
  const h = harness();
  const orig = h.deps.backend.callEbookRpc;
  h.deps.backend.callEbookRpc = async (n: string, a: Record<string, unknown>) => { seen.push(a); return orig(n, a); };
  await submit(h);
  await submit(h, { ...lead, email: "two@example.test", phone: "012-345 6789", marketingEmailOptIn: true });
  assert.equal(seen[0].p_marketing_email_opt_in, false);
  assert.equal(seen[1].p_marketing_email_opt_in, true);
  assert.equal(seen[0].p_privacy_ack_version, "ebook-privacy-ack-v2");
  assert.equal(seen[0].p_marketing_text_version, "ebook-marketing-email-v1");
  assert.equal(seen[0].p_phone_e164, "+601548001234");
  assert.equal(seen[0].p_client_key, "c".repeat(32));
  assert.deepEqual(Object.keys(seen[0]).filter((k) => /whatsapp|call|sms|phone_consent|ownership/i.test(k)), []);
});

test("request: failures are generic 503/400 and logs never contain PII, tokens or URLs", async () => {
  const cases: [Record<string, unknown>, number][] = [
    [{ data: null, error: { code: "PGRST301", message: "JWT expired for marketing_contacts" } }, 503],
    [{ data: { contract: "v9", outcome: "accepted", verification_token: T43 }, error: null }, 503],
    [{ data: null, error: { code: "P0001", message: "invalid_input" } }, 400],
  ];
  for (const [rpcResult, status] of cases) {
    const logs: unknown[][] = [];
    const backend = { callEbookRpc: async () => rpcResult, signEbookDownload: async () => ({ url: null }) };
    const res = await processEbookRequest({ payload: lead, origin: SITE, siteOrigin: SITE, clientKey: "k" }, { backend, mailer: makeMockMailer(), checkDomain: okDns, verifyUrlFor: (t: string) => t, log: (...a: unknown[]) => logs.push(a) });
    assert.equal(res.status, status);
    assert.equal(JSON.stringify(res.body).includes("marketing_contacts"), false);
    assert.equal(PII.test(JSON.stringify(logs)), false);
  }
  const thrower = { callEbookRpc: async () => { throw new EbookPrivilegedUnavailable("approved_ref_missing"); }, signEbookDownload: async () => ({ url: null }) };
  assert.equal((await processEbookRequest({ payload: lead, origin: SITE, siteOrigin: SITE, clientKey: "k" }, { backend: thrower, mailer: makeMockMailer(), checkDomain: okDns, verifyUrlFor: (t: string) => t, log: () => {} })).status, 503);
  const hFail = harness({ mailerFails: true });
  assert.deepEqual(await submit(hFail), { status: 202, body: { ok: false, status: "try_later" } });
  assert.equal(PII.test(JSON.stringify(hFail.logs)), false);
});

test("verify: single use, scanner-safe shape check, generic for invalid/expired/replaced/used", async () => {
  const h = harness();
  await submit(h);
  const t = tokenFrom(h.outbox[0].verifyUrl);
  const ok = await processEbookVerify({ token: t }, h.deps);
  assert.equal(ok.body.status, "verified");
  assert.match(String((ok.body as { downloadToken: string }).downloadToken), /^[A-Za-z0-9_-]{43}$/);
  const replay = await processEbookVerify({ token: t }, h.deps);
  assert.deepEqual(replay, { status: 200, body: { status: "link_unusable" } });
  for (const bad of [undefined, "", "short", "A".repeat(44), "A".repeat(42) + "!"]) {
    const before = h.crm.state.events.length;
    assert.deepEqual(await processEbookVerify({ token: bad as string }, h.deps), { status: 200, body: { status: "link_unusable" } });
    assert.equal(h.crm.state.events.length, before);
  }
  assert.deepEqual(await processEbookVerify({ token: T43 }, h.deps), { status: 200, body: { status: "link_unusable" } });
  assert.equal(h.crm.state.contacts[0].email_verification_status, "verified");
  assert.equal(h.crm.state.contacts[0].phone_ownership_status, "unverified");
});

test("verify: a new request (resend) invalidates the previous link; expiry after 60 minutes", async () => {
  const h = harness();
  await submit(h);
  await submit(h);
  const [oldLink, newLink] = h.outbox.map((m) => tokenFrom(m.verifyUrl));
  assert.deepEqual(await processEbookVerify({ token: oldLink }, h.deps), { status: 200, body: { status: "link_unusable" } });
  assert.equal((await processEbookVerify({ token: newLink }, h.deps)).body.status, "verified");
  const h2 = harness();
  await submit(h2);
  h2.clock.t += 61 * 60 * 1000;
  assert.deepEqual(await processEbookVerify({ token: tokenFrom(h2.outbox[0].verifyUrl) }, h2.deps), { status: 200, body: { status: "link_unusable" } });
});

test("crm mock semantics the Website relies on: dedup, no overwrite before verification, opt-out preserved, conflict", async () => {
  const h = harness();
  h.crm.state.contacts.push({ id: "c-existing", email: "kept@example.test", full_name: "Original Name", phone_e164: "+60123456789", consent_status: "opted_out", email_verification_status: "not_applicable", phone_ownership_status: "unverified", possible_duplicate_of: null });
  await submit(h, { fullName: "Attacker Name", phone: "019-519 3834", email: "KEPT@example.test", privacyAck: true, marketingEmailOptIn: true });
  const kept = h.crm.state.contacts.find((c) => c.id === "c-existing")!;
  assert.equal(kept.full_name, "Original Name");
  assert.equal(kept.phone_e164, "+60123456789");
  assert.equal(h.crm.state.contacts.length, 1);
  await processEbookVerify({ token: tokenFrom(h.outbox[0].verifyUrl) }, h.deps);
  assert.equal(kept.consent_status, "opted_out");
  assert.equal(kept.full_name, "Original Name");
  assert.ok(h.crm.state.events.some((e) => e.type === "ebook_opted_out_requested"));
  await submit(h, { fullName: "Phone Match", phone: "012-345 6789", email: "new@example.test", privacyAck: true });
  const dup = h.crm.state.contacts.find((c) => c.email === "new@example.test")!;
  assert.equal(dup.possible_duplicate_of, "c-existing");
});

test("download: single-use 15-minute token, exact path signed, signed URL never logged", async () => {
  const h = harness();
  await submit(h);
  const v = await processEbookVerify({ token: tokenFrom(h.outbox[0].verifyUrl) }, h.deps);
  const dl = (v.body as { downloadToken: string }).downloadToken;
  const first = await processEbookDownload({ token: dl }, h.deps);
  assert.equal(first.kind, "redirect");
  assert.match((first as { url: string }).url, /ebook-private\/v1\.5\.1\/teras-ebook-v1\.5\.1\.pdf\?.*expires=60$/);
  assert.deepEqual(await processEbookDownload({ token: dl }, h.deps), { kind: "unusable" });
  assert.deepEqual(await processEbookDownload({ token: "nope" }, h.deps), { kind: "unusable" });
  assert.equal(PII.test(JSON.stringify(h.logs)), false);
  const h2 = harness();
  await submit(h2);
  const v2 = await processEbookVerify({ token: tokenFrom(h2.outbox[0].verifyUrl) }, h2.deps);
  h2.clock.t += 16 * 60 * 1000;
  assert.deepEqual(await processEbookDownload({ token: (v2.body as { downloadToken: string }).downloadToken }, h2.deps), { kind: "unusable" });
});

test("download: a wrong path from the RPC is a contract error and nothing is signed", async () => {
  let signed = 0;
  const backend = {
    callEbookRpc: async () => ({ data: { contract: "v1.0", outcome: "ok", bucket: "ebook-private", object_path: "other.pdf" }, error: null }),
    signEbookDownload: async () => { signed += 1; return { url: "x" }; },
  };
  assert.deepEqual(await processEbookDownload({ token: T43 }, { backend, log: () => {} }), { kind: "unavailable" });
  assert.equal(signed, 0);
});

test("mailer: Resend adapter is inert without configuration; the message carries only the link", async () => {
  let constructed = 0;
  class FakeResend { constructor() { constructed += 1; } emails = { send: async () => ({ error: { name: "daily_quota_exceeded" } }) }; }
  assert.deepEqual(await makeResendMailer({ apiKey: "", from: "a@b", ResendCtor: FakeResend }).sendVerification({ to: "x@y.test", verifyUrl: "u" }), { sent: false, code: "not_configured" });
  assert.equal(constructed, 0);
  assert.deepEqual(await makeResendMailer({ apiKey: "k", from: "a@b", ResendCtor: FakeResend }).sendVerification({ to: "x@y.test", verifyUrl: "u" }), { sent: false, code: "provider_quota" });
  const msg = buildVerificationEmail(ebookVerifyUrl(SITE, T43));
  assert.match(msg.text, /expires in 60 minutes/);
  assert.doesNotMatch(msg.text + msg.html, /whatsapp|phone|\+60/i);
  assert.match(msg.html, /href="https:\/\/www\.terasuniversal\.com\.my\/ebook\/verify#t=A{43}"/);
  assert.match(msg.text, /https:\/\/www\.terasuniversal\.com\.my\/ebook\/verify#t=A{43}/);
  assert.doesNotMatch(msg.text + msg.html, /verify\?t=/);
});

// ---------- W9-G3.1 token transport (erratum v1.0.2) ----------
test("transport: links carry the token only in the fragment; malformed tokens are never linked", () => {
  const url = ebookVerifyUrl(SITE, T43);
  assert.equal(url, `${SITE}/ebook/verify#t=${T43}`);
  const u = new URL(url);
  assert.equal(u.pathname + u.search, "/ebook/verify", "the HTTP request target (what servers and logs see) has no token");
  for (const bad of ["", "short", "A".repeat(44), "A".repeat(42) + "=", null, undefined]) assert.throws(() => ebookVerifyUrl(SITE, bad as string));
});

test("transport: fragment parsing — valid, missing, invalid, legacy query, both, return states", () => {
  assert.deepEqual(parseVerifyLink({ hash: `#t=${T43}`, search: "" }), { token: T43, state: null, legacy: false });
  assert.equal(parseVerifyLink({ hash: "", search: "" }).token, null, "missing");
  assert.equal(parseVerifyLink({ hash: "#", search: "" }).token, null, "empty fragment");
  for (const bad of ["#t=short", `#t=${T43}x`, `#t=${"A".repeat(42)}%`, "#x=1", `#T=${T43}`]) assert.equal(parseVerifyLink({ hash: bad, search: "" }).token, null, bad);
  const legacy = parseVerifyLink({ hash: "", search: `?t=${T43}` });
  assert.deepEqual(legacy, { token: null, state: null, legacy: true }, "legacy query token refused");
  assert.equal(parseVerifyLink({ hash: `#t=${T43}`, search: `?t=${T43}` }).token, null, "query token present: refuse even with a fragment");
  assert.equal(parseVerifyLink({ hash: "", search: "?state=download_unusable" }).state, "download_unusable");
  assert.equal(parseVerifyLink({ hash: "", search: "?state=verified" }).state, null, "unknown state ignored");
});

test("transport: a legacy ?t= link never reaches verification (0 RPC calls); a replayed fragment token is generic", async () => {
  const h = harness();
  await submit(h);
  const good = tokenFrom(h.outbox[0].verifyUrl);
  const legacyUrl = new URL(`${SITE}/ebook/verify?t=${good}`);
  const parsed = parseVerifyLink({ hash: legacyUrl.hash, search: legacyUrl.search });
  assert.equal(parsed.token, null);
  let rpcCalls = 0;
  const counting = { ...h.deps, backend: { ...h.deps.backend, callEbookRpc: async (...a: unknown[]) => { rpcCalls += 1; return (h.deps.backend.callEbookRpc as (...x: unknown[]) => unknown)(...a); } } };
  // The page only POSTs when parsing yields a token; with none, it must not call verification at all.
  if (parsed.token) await processEbookVerify({ token: parsed.token }, counting);
  assert.equal(rpcCalls, 0, "legacy query token never forwarded to the verification RPC");
  assert.equal(h.crm.state.contacts[0].email_verification_status, "unverified", "legacy link did not verify anything");
  const first = await processEbookVerify({ token: good }, counting);
  assert.equal((first.body as { status: string }).status, "verified");
  const replay = await processEbookVerify({ token: good }, counting);
  assert.deepEqual(replay.body, { status: "link_unusable" });
  assert.equal(rpcCalls, 2);
});

test("transport: logs from the whole flow never contain a token, a verify link or a signed URL", async () => {
  const h = harness();
  await submit(h);
  const token = tokenFrom(h.outbox[0].verifyUrl);
  const v = await processEbookVerify({ token }, h.deps);
  await processEbookDownload({ token: (v.body as { downloadToken: string }).downloadToken }, h.deps);
  await processEbookVerify({ token: "B".repeat(43) }, h.deps);
  const all = JSON.stringify(h.logs);
  assert.doesNotMatch(all, /[A-Za-z0-9_-]{43}|#t=|\?t=|verify#|signed|https?:\/\//);
});
