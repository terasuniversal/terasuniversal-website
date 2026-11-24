/**
 * W9-G1 eBook lead form tests (owner-approved, local only): Malaysian phone normalisation, the ebookLeadSchema and the
 * request logic in lib/ebook-request.js with fake dependencies. No network, no database, no Next.js runtime.
 *
 * Run: node --experimental-transform-types scripts/w9g1-ebook-lead.test.mts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMalaysianPhone } from "../lib/my-phone.js";
import { ebookLeadSchema } from "../lib/validation/schemas.ts";
import { processEbookRequest } from "../lib/ebook-request.js";
import { ebookPublicEnabled, EBOOK_MARKETING_TEXT_VERSION, EBOOK_PRIVACY_ACK_VERSION } from "../lib/ebook-lead.js";

// Cases follow MCMC NEAP 2023: §9.2.3 (01Y, 7-digit Z = 2–9 or 8-digit Z = 1–9), §9.2.4 (015Z + 7 digits, A = 1–9),
// §6.3–6.4 (geographic NDC and subscriber lengths, X1 = 2–9, never "99"). Valid format ≠ assigned or reachable.
test("phone: Malaysian mobile, 015 and fixed-line formats normalise to E.164 (NEAP 2023)", () => {
  const cases: [string, string, string, string][] = [
    ["012-345 6789", "+60123456789", "mobile", "+60 12-345 6789"],
    ["0123456789", "+60123456789", "mobile", "+60 12-345 6789"],
    ["+60 12-345 6789", "+60123456789", "mobile", "+60 12-345 6789"],
    ["+60123456789", "+60123456789", "mobile", "+60 12-345 6789"],
    ["60123456789", "+60123456789", "mobile", "+60 12-345 6789"],
    ["0060 12 345 6789", "+60123456789", "mobile", "+60 12-345 6789"],
    ["(012) 345.6789", "+60123456789", "mobile", "+60 12-345 6789"],
    ["019-519 3834", "+60195193834", "mobile", "+60 19-519 3834"],
    ["010-234 5678", "+60102345678", "mobile", "+60 10-234 5678"],
    ["014-234 5678", "+60142345678", "mobile", "+60 14-234 5678"],
    ["011-2345 6789", "+601123456789", "mobile", "+60 11-2345 6789"],
    ["+60 11 1234 5678", "+601112345678", "mobile", "+60 11-1234 5678"],
    ["011-234 5678", "+60112345678", "mobile", "+60 11-234 5678"],
    ["012-1234 5678", "+601212345678", "mobile", "+60 12-1234 5678"],
    ["015-4800 1234", "+601548001234", "mobile-other", "+60 15-4800 1234"],
    ["+60 15-0123 4567", "+601501234567", "mobile-other", "+60 15-0123 4567"],
    ["0159 9999 999", "+601599999999", "mobile-other", "+60 15-9999 9999"],
    ["03-2345 6789", "+60323456789", "fixed", "+60 3-2345 6789"],
    ["03-234 5678", "+6032345678", "fixed", "+60 3-234 5678"],
    ["04-917 1234", "+6049171234", "fixed", "+60 4-917 1234"],
    ["09-234 5678", "+6092345678", "fixed", "+60 9-234 5678"],
    ["082-234 567", "+6082234567", "fixed", "+60 82-234 567"],
    ["088 234567", "+6088234567", "fixed", "+60 88-234 567"],
  ];
  for (const [input, e164, type, display] of cases) {
    const result = normalizeMalaysianPhone(input);
    assert.ok(result.ok, input);
    if (result.ok) {
      assert.equal(result.e164, e164, input);
      assert.equal(result.type, type, input);
      assert.equal(result.display, display, input);
      const again = normalizeMalaysianPhone(result.e164);
      assert.ok(again.ok && again.e164 === e164, `idempotent ${input}`);
    }
  }
});

test("phone: invalid, foreign and malformed numbers are rejected (including 015 edge cases)", () => {
  for (const input of [
    "", "   ", "12345", "0123", "012-345 678", "012-345 67890 1", "012-123 4567", "011-123 4567", "012-0234 5678",
    "015-412 3456", "015-4000 1234", "015-48001 2345", "0151234567", "+60 15 4800 123",
    "+65 9123 4567", "+65 12 345 6789", "+1 415 555 0100", "+44 20 7946 0958", "6512345678",
    "02-1234 5678", "03-1234 5678", "03-123 4567", "03-9912 3456", "081-234 567", "082-123 456", "04-12 3456",
    "0123456789x", "+60+123456789", "01+23456789", "abc", "0".repeat(40), null, undefined,
  ]) {
    assert.equal(normalizeMalaysianPhone(input as string).ok, false, String(input));
  }
});

const valid = { fullName: "  Aminah Binti Ali ", phone: "012-345 6789", email: " Aminah@Example.COM ", privacyAck: true };

test("schema: required fields, normalisation, consent defaults", () => {
  const ok = ebookLeadSchema.safeParse(valid);
  assert.ok(ok.success);
  if (ok.success) assert.deepEqual(ok.data, { fullName: "Aminah Binti Ali", phone: "+60123456789", email: "aminah@example.com", privacyAck: true, marketingEmailOptIn: false });
  for (const [field, value] of [["fullName", ""], ["fullName", "A"], ["phone", ""], ["phone", "+65 9123 4567"], ["email", ""], ["email", "not-an-email"], ["privacyAck", false], ["privacyAck", "true"]] as const) {
    const r = ebookLeadSchema.safeParse({ ...valid, [field]: value });
    assert.equal(r.success, false, `${field}=${String(value)}`);
  }
  for (const field of ["fullName", "phone", "email", "privacyAck"] as const) {
    const { [field]: _omit, ...rest } = valid;
    assert.equal(ebookLeadSchema.safeParse(rest).success, false, `missing ${field}`);
  }
  const marketing = ebookLeadSchema.safeParse({ ...valid, marketingEmailOptIn: true });
  assert.ok(marketing.success && marketing.data.marketingEmailOptIn === true);
  assert.equal(ebookLeadSchema.safeParse({ ...valid, marketingEmailOptIn: "yes" }).success, false);
});

test("switch: only the exact value \"on\" enables the public API", () => {
  assert.equal(ebookPublicEnabled({}), false);
  for (const value of ["", "true", "ON", "On", " on", "1", "yes", "off"]) assert.equal(ebookPublicEnabled({ TERAS_EBOOK_PUBLIC: value }), false, value);
  assert.equal(ebookPublicEnabled({ TERAS_EBOOK_PUBLIC: "on" }), true);
});

function deps(overrides: Partial<{ allow: boolean; result: { data: unknown; error: unknown } }> = {}) {
  const calls: { rateLimit: number; submit: Record<string, unknown>[]; logs: unknown[][] } = { rateLimit: 0, submit: [], logs: [] };
  return {
    calls,
    deps: {
      rateLimit: async () => { calls.rateLimit += 1; return overrides.allow ?? true; },
      submit: async (args: Record<string, unknown>) => { calls.submit.push(args); return overrides.result ?? { data: [{ token: "tok_abc", expires_at: "2026-11-23T10:15:00Z" }], error: null }; },
      log: (...args: unknown[]) => { calls.logs.push(args); },
    },
  };
}
const request = (payload: unknown, origin: string | null = "https://www.terasuniversal.com.my") =>
  ({ payload, origin, siteOrigin: "https://www.terasuniversal.com.my", now: 1_000_000 });

test("request: valid submission calls the RPC once with the canonical, versioned contract", async () => {
  const { calls, deps: d } = deps();
  const res = await processEbookRequest(request({ ...valid, formStartedAt: 1 }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, delivery: { token: "tok_abc", expiresAt: "2026-11-23T10:15:00Z" } });
  assert.equal(calls.rateLimit, 1);
  assert.deepEqual(calls.submit, [{
    p_full_name: "Aminah Binti Ali", p_phone_e164: "+60123456789", p_email: "aminah@example.com", p_privacy_ack: true,
    p_privacy_ack_version: EBOOK_PRIVACY_ACK_VERSION, p_marketing_email_opt_in: false, p_marketing_text_version: EBOOK_MARKETING_TEXT_VERSION,
  }]);
});

test("request: marketing is only true when explicitly ticked; phone never implies consent", async () => {
  const a = deps();
  await processEbookRequest(request({ ...valid, marketingEmailOptIn: true }), a.deps);
  assert.equal(a.calls.submit[0].p_marketing_email_opt_in, true);
  const b = deps();
  await processEbookRequest(request({ ...valid }), b.deps);
  assert.equal(b.calls.submit[0].p_marketing_email_opt_in, false);
  assert.deepEqual(Object.keys(b.calls.submit[0]).filter((k) => /whatsapp|call|sms|phone_consent/i.test(k)), []);
});

test("request: rejected before the RPC (origin, body, honeypot, fill time, validation, privacy, rate limit)", async () => {
  const cases: [ReturnType<typeof request>, number, boolean][] = [
    [request(valid, "https://evil.example"), 403, false],
    [request(null), 400, false],
    [request([valid]), 400, false],
    [request({ ...valid, website: "bot" }), 200, false],
    [request({ ...valid, formStartedAt: 999_000 }), 400, false],
    [request({ ...valid, phone: "+65 9123 4567" }), 400, false],
    [request({ ...valid, privacyAck: false }), 400, false],
    [request({ ...valid, email: "x" }), 400, false],
  ];
  for (const [req, status] of cases) {
    const { calls, deps: d } = deps();
    const res = await processEbookRequest(req, d);
    assert.equal(res.status, status, JSON.stringify(req.payload));
    assert.equal(calls.submit.length, 0);
    assert.equal("delivery" in (res.body as object), false);
  }
  const limited = deps({ allow: false });
  const res = await processEbookRequest(request(valid), limited.deps);
  assert.equal(res.status, 429);
  assert.equal(limited.calls.submit.length, 0);
});

test("request: field errors name the phone field with a friendly message", async () => {
  const { deps: d } = deps();
  const res = await processEbookRequest(request({ ...valid, phone: "12345" }), d);
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /"phone":"Please enter a valid Malaysian WhatsApp or phone number"/);
});

test("request: database failures are generic, logged without PII, and never return a token", async () => {
  for (const result of [
    { data: null, error: { code: "42883", message: "function submit_ebook_request does not exist on marketing_contacts" } },
    { data: [], error: null },
    { data: [{ token: "" }], error: null },
  ]) {
    const { calls, deps: d } = deps({ result });
    const res = await processEbookRequest(request(valid), d);
    assert.equal(res.status, 502);
    assert.equal(JSON.stringify(res.body).includes("marketing_contacts"), false);
    assert.equal(JSON.stringify(calls.logs).match(/aminah|\+6012|0123|Aminah/i), null);
  }
  const rl = deps({ result: { data: null, error: { message: "rate_limited" } } });
  assert.equal((await processEbookRequest(request(valid), rl.deps)).status, 429);
});
