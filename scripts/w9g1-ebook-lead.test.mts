/**
 * W9-G1 eBook lead form tests (owner-approved, local only): Malaysian phone normalisation, the ebookLeadSchema and the
 * launch switch. No network, no database, no Next.js runtime. (Flow tests: scripts/w9g3-ebook-flow.test.mts.)
 *
 * Run: node --experimental-transform-types scripts/w9g1-ebook-lead.test.mts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMalaysianPhone } from "../lib/my-phone.js";
import { ebookLeadSchema } from "../lib/validation/schemas.ts";
import { ebookPublicEnabled } from "../lib/ebook-lead.js";

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

// W9-G3: the request/verify/download flow tests moved to scripts/w9g3-ebook-flow.test.mts (W9-EBOOK-RPC-CONTRACT v1.0).
