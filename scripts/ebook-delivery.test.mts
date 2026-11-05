import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { EBOOK_CATALOG } from "../lib/marketing/ebookCapture.ts";
import { isEbookCaptureEnabled } from "../lib/marketing/ebookFlag.ts";
import {
  DOWNLOAD_TOKEN_TTL_SECONDS,
  EBOOK_PDF_OBJECTS,
  EbookDeliveryError,
  MAX_PDF_BYTES,
  readCappedBytes,
  getEbookDeliveryConfig,
  issueDownloadToken,
  loadVerifiedEbookPdf,
  verifyDownloadToken,
} from "../lib/marketing/ebookDelivery.ts";

// Fixture-only checks of the private eBook delivery rules. No database, no network, no real PDF, no real secret.

const SECRET = "fixture-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const OTHER = "another-fixture-secret-0123456789-abcdefghijklmnop";
const REQ = "0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8";
const ID = "dari-zero-ke-dunia-industri" as const;
const NOW = 1_800_000_000_000;
const mint = (o: Partial<{ now: number; secret: string }> = {}) => issueDownloadToken({ ebookId: ID, requestId: REQ, now: o.now ?? NOW, secret: o.secret ?? SECRET }).token;
const check = (t: unknown, o: Partial<{ now: number; secret: string }> = {}) => verifyDownloadToken(t, { now: o.now ?? NOW, secret: o.secret ?? SECRET });
const reason = (t: unknown, o: Partial<{ now: number; secret: string }> = {}) => { const r = check(t, o); return r.ok ? "ok" : r.reason; };
const forge = (payload: Record<string, unknown>, secret = SECRET) => {
  const part = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`ebook-download.v1.${part}`).digest("base64url");
  return `v1.${part}.${sig}`;
};
const ON = { EBOOK_LEAD_CAPTURE_ENABLED: "true", EBOOK_DELIVERY_ENABLED: "true", EBOOK_DELIVERY_TOKEN_SECRET: SECRET };

// 1. Delivery is OFF by default and needs all three conditions, each exact.
assert.equal(getEbookDeliveryConfig({}), null, "off by default");
assert.notEqual(getEbookDeliveryConfig(ON), null, "on with all three");
assert.equal(getEbookDeliveryConfig({ ...ON, EBOOK_DELIVERY_ENABLED: undefined }), null, "needs the delivery flag");
assert.equal(getEbookDeliveryConfig({ ...ON, EBOOK_LEAD_CAPTURE_ENABLED: undefined }), null, "needs the capture flag too");
assert.equal(getEbookDeliveryConfig({ ...ON, EBOOK_DELIVERY_TOKEN_SECRET: undefined }), null, "no secret means off (fails closed)");
assert.equal(getEbookDeliveryConfig({ ...ON, EBOOK_DELIVERY_TOKEN_SECRET: "short" }), null, "a short secret means off");
for (const v of ["", "false", "TRUE", "True", "1", "yes", " true", "true "]) assert.equal(getEbookDeliveryConfig({ ...ON, EBOOK_DELIVERY_ENABLED: v }), null, `"${v}" does not enable delivery`);

// 2. A fresh token verifies, names only the ebook, and carries no personal data.
const token = mint();
assert.deepEqual(check(token), { ok: true, ebookId: ID });
assert.ok(token.length < 512, "token fits the length cap");
const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
assert.deepEqual(Object.keys(payload).sort(), ["e", "i", "r", "x"], "claims are ebook id, request id, issued and expiry only");
assert.equal(payload.x - payload.i, DOWNLOAD_TOKEN_TTL_SECONDS);
assert.ok(!/@|example\.com/.test(token) && !/@/.test(Buffer.from(token.split(".")[1], "base64url").toString()), "no email in the token");

// 3. Expiry: valid inside the window, rejected at and after the expiry instant.
assert.equal(reason(token, { now: NOW + (DOWNLOAD_TOKEN_TTL_SECONDS - 1) * 1000 }), "ok");
assert.equal(reason(token, { now: NOW + DOWNLOAD_TOKEN_TTL_SECONDS * 1000 }), "expired");
assert.equal(reason(token, { now: NOW + 24 * 3600 * 1000 }), "expired");

// 4. Forged, tampered and malformed credentials are all rejected.
assert.equal(reason(mint({ secret: OTHER })), "signature", "signed with another secret");
const [v, p, s] = token.split(".");
assert.equal(reason(`${v}.${p}.${s.slice(0, -2)}AA`), "signature", "altered signature");
const tamperedClaims = Buffer.from(JSON.stringify({ ...payload, x: payload.x + 86400 })).toString("base64url");
assert.equal(reason(`${v}.${tamperedClaims}.${s}`), "signature", "extended expiry without re-signing");
const tamperedId = Buffer.from(JSON.stringify({ ...payload, e: "../../etc/passwd" })).toString("base64url");
assert.equal(reason(`${v}.${tamperedId}.${s}`), "signature", "swapped ebook id without re-signing");
for (const bad of [undefined, null, 0, {}, [], "", "x", "v1", "v1.a", "v1.a.b.c", `v2.${p}.${s}`, `${v}.${p}`, `${v}.${p}.${s}.extra`, `${v}.${p}!.${s}`, `${v}..${s}`, "a".repeat(513)]) {
  assert.equal(check(bad).ok, false, `rejects ${JSON.stringify(bad)?.slice(0, 40)}`);
}
// A correctly SIGNED token with bad claims is still rejected (defence in depth).
const nowS = Math.floor(NOW / 1000);
assert.equal(reason(forge({ e: ID, r: REQ, i: nowS, x: nowS + 100_000 })), "claims", "lifetime longer than the issued TTL");
assert.equal(reason(forge({ e: ID, r: REQ, i: nowS + 3600, x: nowS + 3600 + 60 })), "claims", "issued in the future");
assert.equal(reason(forge({ e: "../../secret.pdf", r: REQ, i: nowS, x: nowS + 60 })), "claims", "unknown ebook id (path traversal attempt)");
assert.equal(reason(forge({ e: "constructor", r: REQ, i: nowS, x: nowS + 60 })), "claims", "prototype key is not an ebook id");
assert.equal(reason(forge({ e: ID, r: "not-a-uuid", i: nowS, x: nowS + 60 })), "claims", "request id must be a uuid");
assert.equal(reason(forge({ e: ID, r: REQ, i: "1", x: "2" })), "claims", "non-integer times");
assert.equal(reason(forge({ e: ID, r: REQ })), "claims", "missing times");
assert.equal(reason(`v1.${Buffer.from("not json").toString("base64url")}.${createHmac("sha256", SECRET).update(`ebook-download.v1.${Buffer.from("not json").toString("base64url")}`).digest("base64url")}`), "claims", "signed non-JSON");
assert.equal(reason(forge({ e: ID, r: REQ, i: nowS, x: nowS + 60 })), "ok", "the forge helper itself produces a valid token (control)");
// The same token is not valid under a different purpose label.
const wrongPurpose = (() => { const part = Buffer.from(JSON.stringify({ e: ID, r: REQ, i: nowS, x: nowS + 60 })).toString("base64url"); return `v1.${part}.${createHmac("sha256", SECRET).update(`other.v1.${part}`).digest("base64url")}`; })();
assert.equal(reason(wrongPurpose), "signature", "signature from another purpose label");

// 5. Object keys come from a fixed allowlist, never from a request value.
assert.deepEqual(Object.keys(EBOOK_PDF_OBJECTS), EBOOK_CATALOG.map((e) => e.id));
for (const entry of Object.values(EBOOK_PDF_OBJECTS)) assert.match(entry.objectPath, /^ebooks\/[a-z0-9-]+-v\d+\.pdf$/, "fixed, versioned, no traversal characters");
for (const e of EBOOK_CATALOG) {
  assert.equal(EBOOK_PDF_OBJECTS[e.id].sha256, e.pdfSha256, "delivery fingerprint equals the catalog fingerprint");
  assert.equal(EBOOK_PDF_OBJECTS[e.id].fileName, e.pdfFileName, "delivery file name equals the catalog file name");
}
for (const v of [undefined, "", "true", "false", "TRUE", " true", "1"]) assert.equal(getEbookDeliveryConfig({ ...ON, EBOOK_LEAD_CAPTURE_ENABLED: v }) !== null, isEbookCaptureEnabled({ EBOOK_LEAD_CAPTURE_ENABLED: v }), "capture-flag rule agrees with isEbookCaptureEnabled");

// 6. The loader returns only the exact approved bytes.
const pdfBytes = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from("fixture body, not the real eBook")]);
const catalogHash = EBOOK_CATALOG[0].pdfSha256;
const asked: string[] = [];
const loaderFor = (bytes: Uint8Array | Error) => ({ async download(path: string) { asked.push(path); if (bytes instanceof Error) throw bytes; return bytes; } });
await assert.rejects(() => loadVerifiedEbookPdf(ID, loaderFor(pdfBytes)), (e: unknown) => e instanceof EbookDeliveryError && e.code === "integrity", "a file whose SHA-256 is not the approved one is refused");
assert.deepEqual(asked, [EBOOK_PDF_OBJECTS[ID].objectPath], "only the allowlisted key was requested");
assert.notEqual(createHash("sha256").update(pdfBytes).digest("hex"), catalogHash);
await assert.rejects(() => loadVerifiedEbookPdf(ID, loaderFor(new Error("Storage said: bucket ebook-private object ebooks/x.pdf secret"))), (e: unknown) => e instanceof EbookDeliveryError && e.code === "unavailable" && !/bucket|ebooks\/|secret/.test(e.message), "a storage failure is generic and leaks no path");
await assert.rejects(() => loadVerifiedEbookPdf(ID, loaderFor(new Uint8Array(0))), (e: unknown) => e instanceof EbookDeliveryError && e.code === "integrity", "empty file");
await assert.rejects(() => loadVerifiedEbookPdf(ID, loaderFor(new Uint8Array(MAX_PDF_BYTES + 1))), (e: unknown) => e instanceof EbookDeliveryError && e.code === "integrity", "oversized file");
await assert.rejects(() => loadVerifiedEbookPdf("../../etc/passwd" as never, loaderFor(pdfBytes)), (e: unknown) => e instanceof EbookDeliveryError && e.code === "unavailable", "an id outside the allowlist never reaches storage");
assert.equal(asked.includes("../../etc/passwd"), false);
// Positive control: bytes that hash to the pinned fingerprint come back unchanged (fingerprint swapped for the check only).
const entry = EBOOK_PDF_OBJECTS[ID] as { sha256: string };
const saved = entry.sha256;
try {
  entry.sha256 = createHash("sha256").update(pdfBytes).digest("hex");
  const out = await loadVerifiedEbookPdf(ID, loaderFor(pdfBytes));
  assert.equal(Buffer.compare(Buffer.from(out), pdfBytes), 0, "the exact verified bytes come back");
  const badHeader = Buffer.concat([Buffer.from("%PDX-"), pdfBytes.subarray(5)]);
  entry.sha256 = createHash("sha256").update(badHeader).digest("hex");
  await assert.rejects(() => loadVerifiedEbookPdf(ID, loaderFor(badHeader)), (e: unknown) => e instanceof EbookDeliveryError, "a file without the %PDF- header is refused even if its hash matches");
} finally {
  entry.sha256 = saved;
}

// 7. Size boundary: one limit for app, bucket and the buffered Vercel response; read with a hard cap while streaming IN.
assert.equal(MAX_PDF_BYTES, 4_500_000, "application cap equals the proposed bucket file_size_limit and the 4.5 MB buffered-response limit");
assert.ok(MAX_PDF_BYTES >= 4_353_912, "the approved PDF (4,353,912 bytes) fits under the cap");
const bodyOf = (chunks: Uint8Array[], headers: Record<string, string> = {}) => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(c) { for (const k of chunks) c.enqueue(k); c.close(); },
    cancel() { cancelled = true; },
  });
  const res = new Response(stream, { headers });
  return { res, wasCancelled: () => cancelled };
};
const mk = (n: number, fill = 7) => new Uint8Array(n).fill(fill);
{
  // Known length: the exact bytes come back in ONE buffer of the declared size.
  const data = mk(1000);
  const { res } = bodyOf([data.subarray(0, 400), data.subarray(400)], { "content-length": "1000" });
  const out = await readCappedBytes(res, 5000);
  assert.equal(out.length, 1000); assert.equal(Buffer.compare(Buffer.from(out), Buffer.from(data)), 0, "declared-length read returns the exact bytes");
  // Unknown length (chunked): still exact.
  const r2 = bodyOf([mk(300, 1), mk(300, 2)]).res;
  const out2 = await readCappedBytes(r2, 5000);
  assert.equal(out2.length, 600); assert.equal(out2[0], 1); assert.equal(out2[599], 2);
  assert.equal(out2.byteOffset, 0, "unknown length: a view of the single buffer, no merge copy");
  assert.equal(out2.buffer.byteLength, MAX_PDF_BYTES === 4_500_000 ? 5000 : -1, "unknown length: exactly one allocation of the cap");
  // Declared length above the cap: refused BEFORE reading the body.
  const big = bodyOf([mk(10)], { "content-length": String(MAX_PDF_BYTES + 1) });
  await assert.rejects(() => readCappedBytes(big.res, MAX_PDF_BYTES), (e: unknown) => e instanceof EbookDeliveryError && e.code === "integrity", "declared oversize refused");
  assert.equal(big.wasCancelled(), true, "an over-limit declared length is refused and the body is cancelled without reading it");
  // A lying Content-Length (says small, sends more) is caught by the running count and the stream is cancelled.
  const liar = bodyOf([mk(600), mk(600)], { "content-length": "700" });
  await assert.rejects(() => readCappedBytes(liar.res, 5000), (e: unknown) => e instanceof EbookDeliveryError && e.code === "integrity", "more bytes than declared");
  // No Content-Length and a body past the cap: abandoned at the cap, never fully read.
  let cancelledEndless = false;
  let pulled = 0;
  const endless = { res: new Response(new ReadableStream<Uint8Array>({ pull(c) { pulled += 1; c.enqueue(mk(400)); }, cancel() { cancelledEndless = true; } })), wasCancelled: () => cancelledEndless };
  await assert.rejects(() => readCappedBytes(endless.res, 1000), (e: unknown) => e instanceof EbookDeliveryError && e.code === "integrity", "unknown-length oversize refused at the cap");
  assert.equal(endless.wasCancelled(), true, "the over-cap body is cancelled, not drained");
  assert.ok(pulled <= 5, "an endless body is abandoned after a few chunks, never read to the end");
  // Short body (fewer bytes than declared) is refused.
  await assert.rejects(() => readCappedBytes(bodyOf([mk(10)], { "content-length": "100" }).res, 5000), (e: unknown) => e instanceof EbookDeliveryError && e.code === "integrity", "truncated body refused");
  // A compressed body's Content-Length is not the decoded length: it is ignored, the running cap still applies.
  const gz = await readCappedBytes(bodyOf([mk(50)], { "content-length": "10", "content-encoding": "gzip" }).res, 1000);
  assert.equal(gz.length, 50, "compressed bodies do not trust Content-Length");
  await assert.rejects(() => readCappedBytes(new Response(null), 1000), (e: unknown) => e instanceof EbookDeliveryError && e.code === "unavailable", "no body");
  for (const bad of ["abc", "-5", "1e3", "10.5"]) {
    const r = bodyOf([mk(20)], { "content-length": bad }).res;
    assert.equal((await readCappedBytes(r, 1000)).length, 20, `a malformed Content-Length (${bad}) is ignored, the running cap decides`);
  }
}
// The loader hands the cap to the downloader and still verifies the finished buffer.
{
  let seenMax = -1;
  await assert.rejects(() => loadVerifiedEbookPdf(ID, { async download(_p, max) { seenMax = max; return pdfBytes; } }), EbookDeliveryError);
  assert.equal(seenMax, MAX_PDF_BYTES, "the downloader receives the cap");
}

console.log("ebook-delivery: all checks passed");
