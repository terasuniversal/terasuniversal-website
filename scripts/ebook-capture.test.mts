import assert from "node:assert/strict";
import {
  CONSENT_TEXT_VERSION,
  EBOOK_CATALOG,
  EBOOK_IDS,
  MIN_FILL_TIME_MS,
  PRIVACY_NOTICE_VERSION,
  CONFIRMED_CAPTURE_OUTCOMES,
  captureErrorMessage,
  confirmedCaptureOutcome,
  ebookLeadSchema,
  emailRateKeyPart,
  fillTimeStatus,
  sanitizeUtm,
  utmFromSearchParams,
} from "../lib/marketing/ebookCapture.ts";
import { isEbookCaptureEnabled } from "../lib/marketing/ebookFlag.ts";

// Fixture-only checks of the /ebook capture rules. No database, no network, no real contacts.

const REQ = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
const valid = (o: Record<string, unknown> = {}) => ({
  email: "ana@example.com",
  full_name: "Ana Binti Ali",
  phone: "012-345 6789",
  ebook_id: "dari-zero-ke-dunia-industri",
  privacy_acknowledged: true,
  marketing_opt_in: false,
  request_id: REQ,
  utm: {},
  website: "",
  formStartedAt: 1_000,
  ...o,
});
const issues = (o: Record<string, unknown>) => {
  const r = ebookLeadSchema.safeParse(o);
  return r.success ? [] : r.error.issues.map((i) => `${String(i.path[0])}:${i.message}`);
};

// 1. The capture is OFF unless the flag is exactly "true".
assert.equal(isEbookCaptureEnabled({}), false, "off by default");
for (const v of ["", "false", "TRUE", "True", "1", "yes", " true", "true "]) assert.equal(isEbookCaptureEnabled({ EBOOK_LEAD_CAPTURE_ENABLED: v }), false, `"${v}" does not enable it`);
assert.equal(isEbookCaptureEnabled({ EBOOK_LEAD_CAPTURE_ENABLED: "true" }), true);

// 2. The catalogue describes the Owner-approved PDF but does not activate any download.
assert.equal(EBOOK_CATALOG.length, 1);
assert.equal(EBOOK_CATALOG[0].pdfSha256, "9595cc470063bcd5fd35404b771b09f580c3562e5b7ea38aa6aef49e37ab520c", "approved Balanced PDF fingerprint");
assert.equal(EBOOK_CATALOG[0].pdfFileName, "TERAS_eBook_DariZeroKeDuniaIndustri.pdf");
assert.equal(EBOOK_CATALOG[0].delivery, "not_active", "no download until storage is approved");
assert.ok(!("url" in EBOOK_CATALOG[0]) && !("href" in EBOOK_CATALOG[0]), "no download URL in the catalogue");
assert.deepEqual([...EBOOK_IDS], ["dari-zero-ke-dunia-industri"]);
assert.ok(/unreviewed/.test(PRIVACY_NOTICE_VERSION) && /unreviewed/.test(CONSENT_TEXT_VERSION), "draft versions are marked unreviewed");

// 3. Required and optional fields.
assert.deepEqual(issues(valid()), [], "a minimal valid submission");
assert.deepEqual(issues(valid({ full_name: "", phone: "" })), [], "name and phone are optional");
assert.deepEqual(issues(valid({ full_name: undefined, phone: undefined })), [], "name and phone may be absent");
assert.ok(issues(valid({ email: "" })).some((i) => i.startsWith("email")), "email is required");
assert.ok(issues({ ...valid(), email: undefined }).some((i) => i.startsWith("email")), "email may not be absent");

// 4. The privacy acknowledgement is REQUIRED and is NOT marketing consent.
assert.ok(issues(valid({ privacy_acknowledged: false })).some((i) => i.includes("privacy_acknowledgement_required")), "false is rejected");
assert.ok(issues({ ...valid(), privacy_acknowledged: undefined }).some((i) => i.startsWith("privacy_acknowledged")), "missing is rejected");
assert.ok(issues(valid({ privacy_acknowledged: "true" })).some((i) => i.startsWith("privacy_acknowledged")), "a string is not an acknowledgement");
assert.ok(issues(valid({ privacy_acknowledged: false, marketing_opt_in: true })).length > 0, "marketing consent cannot stand in for the acknowledgement");
assert.deepEqual(issues(valid({ marketing_opt_in: true })), [], "opt-in path is valid");
assert.deepEqual(issues(valid({ marketing_opt_in: false })), [], "no-opt-in path is valid: the eBook never depends on marketing consent");
assert.ok(issues({ ...valid(), marketing_opt_in: undefined }).some((i) => i.startsWith("marketing_opt_in")), "the choice must be explicit, never inferred");
assert.ok(issues(valid({ marketing_opt_in: "true" })).some((i) => i.startsWith("marketing_opt_in")), "a string is not an opt-in");
assert.ok(issues(valid({ marketing_opt_in: 1 })).some((i) => i.startsWith("marketing_opt_in")), "a number is not an opt-in");

// 5. Input limits and validation.
for (const email of ["not-an-email", "a@b", "a b@example.com", "@example.com", "a@@example.com", `${"a".repeat(250)}@x.com`]) {
  assert.ok(issues(valid({ email })).some((i) => i.startsWith("email")), `email "${email.slice(0, 20)}" rejected`);
}
assert.ok(issues(valid({ phone: "<script>" })).some((i) => i.startsWith("phone")), "phone with letters rejected");
assert.ok(issues(valid({ phone: "1".repeat(41) })).some((i) => i.startsWith("phone")), "phone over 40 rejected");
assert.ok(issues(valid({ phone: "12" })).some((i) => i.startsWith("phone")), "phone under 3 rejected");
assert.deepEqual(issues(valid({ phone: "+60 (12) 345-6789" })), [], "common phone punctuation allowed");
assert.ok(issues(valid({ full_name: "n".repeat(201) })).some((i) => i.startsWith("full_name")), "name over 200 rejected");
assert.ok(issues(valid({ ebook_id: "something-else" })).some((i) => i.startsWith("ebook_id")), "unknown eBook id rejected");
assert.ok(issues(valid({ ebook_id: "../../etc/passwd" })).some((i) => i.startsWith("ebook_id")), "path-like eBook id rejected");
assert.ok(issues(valid({ request_id: "not-a-uuid" })).some((i) => i.startsWith("request_id")), "request id must be a UUID");
assert.ok(issues({ ...valid(), formStartedAt: "1000" }).some((i) => i.startsWith("formStartedAt")), "form start time must be a number");
assert.ok(issues(valid({ website: "x".repeat(501) })).some((i) => i.startsWith("website")), "honeypot value is bounded");
const trimmed = ebookLeadSchema.parse(valid({ email: "  Ana@Example.com  " }));
assert.equal(trimmed.email, "Ana@Example.com", "email is trimmed (the database lower-cases and matches)");
assert.equal("password" in ebookLeadSchema.parse({ ...valid(), password: "x", role: "admin" }), false, "unknown fields are stripped, never passed on");

// 6. UTM handling: five keys only, strings only, control characters removed, 200 chars max.
assert.deepEqual(sanitizeUtm({ utm_source: "facebook", utm_medium: "social", utm_campaign: "ebook-dari-zero", utm_content: "post1", utm_term: "scaffold", evil: "x" }), {
  utm_source: "facebook", utm_medium: "social", utm_campaign: "ebook-dari-zero", utm_content: "post1", utm_term: "scaffold",
});
assert.deepEqual(sanitizeUtm({ utm_source: 123, utm_medium: { a: 1 }, utm_campaign: null, utm_content: ["x"] }), {}, "non-strings ignored");
assert.deepEqual(sanitizeUtm({ utm_source: "  a\u0007b\n " }), { utm_source: "ab" }, "control characters removed and trimmed");
assert.equal(sanitizeUtm({ utm_source: "x".repeat(300) }).utm_source?.length, 200, "capped at 200");
assert.deepEqual(sanitizeUtm({ utm_source: "   " }), {}, "blank values dropped");
for (const bad of [null, undefined, "str", 5, []]) assert.deepEqual(sanitizeUtm(bad), {}, "non-object input is empty");
assert.deepEqual(utmFromSearchParams(new URLSearchParams("utm_source=fb&utm_campaign=ebook-dari-zero&email=a@b.com&x=1")), { utm_source: "fb", utm_campaign: "ebook-dari-zero" }, "only UTM keys are read from the URL (nothing else, no personal data)");

// 7. Minimum fill time boundaries.
assert.equal(MIN_FILL_TIME_MS, 3000);
assert.equal(fillTimeStatus(10_000, 12_999), "too_fast");
assert.equal(fillTimeStatus(10_000, 13_000), "ok");
assert.equal(fillTimeStatus(10_000, 10_000), "too_fast");
assert.equal(fillTimeStatus(10_000, 9_999), "invalid", "a start time in the future is invalid");
assert.equal(fillTimeStatus(0, 25 * 3600 * 1000), "invalid", "a form older than a day is invalid");
assert.equal(fillTimeStatus(Number.NaN, 1), "invalid");
assert.equal(fillTimeStatus(Number.POSITIVE_INFINITY, 1), "invalid");

// 8. Rate-limit key: stable, case/space-insensitive, 32 hex characters, never contains the address.
{
  const a = await emailRateKeyPart("Ana@Example.com");
  const b = await emailRateKeyPart("  ana@example.COM ");
  const c = await emailRateKeyPart("other@example.com");
  assert.equal(a, b, "normalised");
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.ok(!a.includes("ana") && !a.includes("example"), "no address in the key");
}

// 9. Visitor-safe error mapping: known codes get a message, everything else is a generic 502 that leaks nothing.
assert.deepEqual(captureErrorMessage("invalid_email").status, 400);
assert.equal(captureErrorMessage("privacy_acknowledgement_required").status, 400);
assert.equal(captureErrorMessage("invalid_phone").status, 400);
for (const code of ["invalid_name", "invalid_ebook", "invalid_version", "invalid_request_id"]) assert.equal(captureErrorMessage(code).status, 400);
for (const raw of ["", "connection refused 10.0.0.1:5432", 'duplicate key value violates unique constraint "marketing_contacts_email_idx"', "permission denied for table marketing_contacts"]) {
  const r = captureErrorMessage(raw);
  assert.equal(r.status, 502, `unknown error "${raw.slice(0, 30)}" is a generic server error`);
  assert.ok(!/(10\.0|constraint|permission|table|marketing_contacts|idx)/i.test(r.message), "the visitor message leaks no internals");
}

// 9. A registration counts as persisted ONLY for an explicitly confirmed RPC outcome (the download token depends on it).
assert.deepEqual([...CONFIRMED_CAPTURE_OUTCOMES], ["created", "matched", "duplicate_request"]);
for (const o of CONFIRMED_CAPTURE_OUTCOMES) assert.equal(confirmedCaptureOutcome({ outcome: o }), o, `${o} is confirmed`);
assert.equal(confirmedCaptureOutcome({ outcome: "created", extra: 1 }), "created", "extra fields do not matter");
for (const bad of [null, undefined, 0, 1, "created", true, [], ["created"], [{ outcome: "created" }], {}, { outcome: null }, { outcome: undefined }, { outcome: "" }, { outcome: "CREATED" }, { outcome: " created" }, { outcome: "updated" }, { outcome: "error" }, { outcome: "ok" }, { outcome: ["created"] }, { outcome: { v: "created" } }, { outcome: 1 }, { Outcome: "created" }, { status: "created" }, { result: { outcome: "created" } }]) {
  assert.equal(confirmedCaptureOutcome(bad), null, `not confirmed: ${JSON.stringify(bad)}`);
}

console.log("Ebook capture rule tests passed.");
