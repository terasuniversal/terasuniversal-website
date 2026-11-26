/**
 * W9-LAUNCH-PREP Lane L-B tests (local only, synthetic values, no network, database or email):
 *   B1 canonical-origin injection matrix for eBook verification links (lib/ebook-link-origin.js) and the runtime wiring
 *   B2 exact analytics exclusion of /ebook/verify (lib/analytics-privacy.js)
 *   A-1 analytics boundaries (consent gate, sensitive paths, query/fragment scrubbing)
 *   (B3 shared email quota is HOLD and is not part of this lane; its tests live with that HOLD work.)
 *
 * Run: node --experimental-transform-types --no-warnings --test scripts/w9lp-lb.test.mts
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveEbookLinkOrigin } from "../lib/ebook-link-origin.js";
import { ebookVerifyUrl } from "../lib/ebook-verify-link.js";
import { isUntrackedPath, sanitizeAnalyticsUrl, sanitizeReferrer, UNTRACKED_PREFIXES } from "../lib/analytics-privacy.js";

const WWW = "https://www.terasuniversal.com.my";
const APEX = "https://terasuniversal.com.my";
const PREVIEW = "https://terasuniversal-website-git-feat-w9-ebo-58baf3-terasuniversal-my.vercel.app";
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

// ---------- B1 ----------
test("B1: production accepts exactly the two approved origins", () => {
  assert.deepEqual(resolveEbookLinkOrigin({ target: "production", value: WWW }), { ok: true, origin: WWW });
  assert.deepEqual(resolveEbookLinkOrigin({ target: "production", value: APEX }), { ok: true, origin: APEX });
});

test("B1: injection and lookalike origins are rejected in production", () => {
  const bad = [
    undefined, "", " ", "null", "www.terasuniversal.com.my", "http://www.terasuniversal.com.my", `${WWW}/`, `${WWW}/ebook`,
    `${WWW}?x=1`, `${WWW}#t=x`, `${WWW}:443`, `${WWW}:8443`, "https://user@www.terasuniversal.com.my", "https://user:pw@www.terasuniversal.com.my",
    "https://www.terasuniversal.com.my.evil.example", "https://evil.example", "https://evil.example#https://www.terasuniversal.com.my",
    "https://WWW.TERASUNIVERSAL.COM.MY", " https://www.terasuniversal.com.my", "https://www.terasuniversal.com.my ", "javascript:alert(1)",
    "https://xn--terasuniversal-xyz.com.my", PREVIEW, "http://localhost:3000",
  ];
  for (const value of bad) assert.equal(resolveEbookLinkOrigin({ target: "production", value }).ok, false, String(value));
});

test("B1: preview / custom accept only this project's own https Vercel hosts", () => {
  assert.equal(resolveEbookLinkOrigin({ target: "preview", value: PREVIEW }).ok, true);
  assert.equal(resolveEbookLinkOrigin({ target: "custom", value: "https://terasuniversal-website-env-staging-terasuniversal-my.vercel.app" }).ok, true);
  for (const value of [
    "http://terasuniversal-website-git-x-terasuniversal-my.vercel.app", "https://terasuniversal-website-git-x-terasuniversal-my.vercel.app.evil.example",
    "https://evil-terasuniversal-my.vercel.app", "https://terasuniversal-website-terasuniversal-my.vercel.app.evil.example",
    "https://other-website-git-x-terasuniversal-my.vercel.app", `${PREVIEW}:8443`, `${PREVIEW}/`, WWW, "http://localhost:3000",
  ]) assert.equal(resolveEbookLinkOrigin({ target: "preview", value }).ok, false, value);
});

test("B1: local accepts only loopback http; unknown or development targets fail closed", () => {
  assert.equal(resolveEbookLinkOrigin({ target: "local", value: "http://localhost:3580" }).ok, true);
  assert.equal(resolveEbookLinkOrigin({ target: "local", value: "http://127.0.0.1:3580" }).ok, true);
  for (const value of ["http://localhost.evil.example:3580", "https://localhost:3580", "http://0.0.0.0:3580", "http://[::1]:3580", WWW]) {
    assert.equal(resolveEbookLinkOrigin({ target: "local", value }).ok, false, value);
  }
  for (const target of ["unknown", "development", undefined, "PRODUCTION"]) assert.equal(resolveEbookLinkOrigin({ target, value: WWW }).ok, false, String(target));
});

test("B1: the verification link is built on the resolved origin with the token in the fragment only", () => {
  const { origin } = resolveEbookLinkOrigin({ target: "production", value: WWW }) as { ok: true; origin: string };
  const link = ebookVerifyUrl(origin, "A".repeat(43));
  assert.equal(link, `${WWW}/ebook/verify#t=${"A".repeat(43)}`);
  assert.equal(new URL(link).search, "");
});

test("B1: runtime takes the origin from TERAS_CANONICAL_ORIGIN only, never from request.url or forwarding headers", () => {
  const runtime = read("lib/ebook-runtime.server.js");
  assert.match(runtime, /resolveEbookLinkOrigin\(\{ target, value: process\.env\.TERAS_CANONICAL_ORIGIN \}\)/);
  assert.match(runtime, /const siteOrigin = linkOrigin\.ok \? linkOrigin\.origin : null;/);
  assert.match(runtime, /verifyUrlFor: \(token\) => ebookVerifyUrl\(siteOrigin, token\)/);
  assert.doesNotMatch(runtime, /new URL\(request\.url\)/);
  assert.doesNotMatch(runtime, /x-forwarded-host|request\.headers\.get\("host"\)|\.nextUrl/);
  const route = read("app/api/ebook/route.js");
  const post = route.slice(route.indexOf("export async function POST"));
  assert.ok(post.indexOf("ebookPublicEnabled()") < post.indexOf("if (!siteOrigin)"), "switch first");
  assert.ok(post.indexOf("if (!siteOrigin)") < post.indexOf("processEbookRequest("), "fail closed before DNS / RPC / email");
  assert.match(post, /if \(!siteOrigin\) return NextResponse\.json\(\{ error: "temporarily_unavailable" \}, \{ status: 503, headers: NO_STORE \}\);/);
});

// ---------- B2 ----------
test("B2: /ebook/verify is excluded exactly; the other untracked prefixes are unchanged", () => {
  assert.deepEqual(UNTRACKED_PREFIXES, ["/admin", "/payments", "/registration", "/verify", "/feedback", "/ebook/verify", "/api"]);
  for (const p of ["/ebook/verify", "/ebook/verify/", "/ebook/verify/anything"]) assert.equal(isUntrackedPath(p), true, p);
  for (const p of ["/ebook", "/ebook/verifyx", "/ebooks/verify", "/ebook-verify", "/training"]) assert.equal(isUntrackedPath(p), false, p);
});

test("B2: a verification URL never reaches analytics with its token, query or fragment", () => {
  const token = "B".repeat(43);
  for (const href of [`${WWW}/ebook/verify#t=${token}`, `${WWW}/ebook/verify?t=${token}`, `${WWW}/ebook/verify?utm_source=x#t=${token}`]) {
    const s = sanitizeAnalyticsUrl(href);
    assert.equal(s, `${WWW}/ebook/verify`, href);
    assert.ok(!s.includes(token));
  }
  assert.equal(sanitizeReferrer(`${WWW}/ebook/verify#t=${token}`, WWW), `${WWW}/ebook/verify`);
});

test("B2: analytics stays off: no measurement id or GTM id is configured in code, and the component still honours untracked paths", () => {
  const component = read("components/Analytics.js");
  assert.match(component, /const analyticsEnabled = process\.env\.NODE_ENV === "production" && Boolean\(measurementId\);/);
  assert.match(component, /window\[`ga-disable-\$\{measurementId\}`\] = isUntrackedPath\(pathname\);/);
  assert.doesNotMatch(component + read("app/layout.js"), /G-[A-Z0-9]{6,}|GTM-[A-Z0-9]{4,}/);
});

// ---------- A-1 analytics boundaries ----------
test("A-1: /ebook stays eligible (consent-gated); /ebook/verify, its descendants and every /api route are excluded", () => {
  for (const p of ["/ebook", "/ebook/"]) assert.equal(isUntrackedPath(p), false, p);
  for (const p of ["/ebook/verify", "/ebook/verify/x", "/api", "/api/ebook", "/api/ebook/verify", "/api/ebook/download", "/api/contact"]) assert.equal(isUntrackedPath(p), true, p);
  for (const p of ["/apiary", "/apis", "/ebookverify"]) assert.equal(isUntrackedPath(p), false, p);
  assert.equal(sanitizeAnalyticsUrl(WWW + "/api/ebook/download?t=" + "C".repeat(43)), WWW + "/api");
});

test("A-1: query strings and fragments never leak tokens, names, phones, e-mail addresses or signed URLs", () => {
  const token = "D".repeat(43);
  const cases: [string, string][] = [
    [WWW + "/ebook?t=" + token + "#t=" + token, WWW + "/ebook"],
    [WWW + "/ebook?name=Ali+Bin+Abu&phone=%2B60123456789&email=ali%40example.test", WWW + "/ebook"],
    [WWW + "/ebook?utm_source=fb&utm_campaign=ebook-launch#section", WWW + "/ebook?utm_source=fb&utm_campaign=ebook-launch"],
    [WWW + "/ebook?utm_term=ali%40example.test&utm_source=fb", WWW + "/ebook?utm_source=fb"],
    [WWW + "/ebook?utm_content=%2B60%2012-345%206789&utm_medium=social", WWW + "/ebook?utm_medium=social"],
    [WWW + "/ebook?utm_content=" + token + "&utm_medium=email", WWW + "/ebook?utm_medium=email"],
    [WWW + "/ebook?utm_content=" + encodeURIComponent("https://synth.supabase.co/storage/v1/object/sign/ebook-private/v1.5.1/x.pdf?token=abc"), WWW + "/ebook"],
  ];
  for (const [href, want] of cases) assert.equal(sanitizeAnalyticsUrl(href), want, href);
  assert.equal(sanitizeReferrer("https://synth.supabase.co/storage/v1/object/sign/ebook-private/x.pdf?token=abc", WWW), "https://synth.supabase.co");
  assert.equal(sanitizeAnalyticsUrl("https://synth.supabase.co/storage/v1/object/sign/ebook-private/x.pdf?token=abc"), "https://synth.supabase.co/storage/v1/object/sign/ebook-private/x.pdf");
});

test("A-1: refused or revoked consent disables GA4; the existing untracked-path line is unchanged; still no IDs in code", () => {
  const component = read("components/Analytics.js");
  assert.match(component, /window\[\x60ga-disable-\$\{measurementId\}\x60\] = isUntrackedPath\(pathname\);\n.*\n    if \(window\.__TERAS_ANALYTICS_CONSENT__ === false\) window\[\x60ga-disable-\$\{measurementId\}\x60\] = true;/);
  assert.match(component, /window\.__TERAS_ANALYTICS_CONSENT__ !== false/);
  // Tag scripts are rendered only after mount and never when consent is refused (nothing is requested at all).
  assert.match(component, /const \[consentChecked, setConsentChecked\] = useState\(false\);/);
  assert.match(component, /setConsentRefused\(window\.__TERAS_ANALYTICS_CONSENT__ === false\); setConsentChecked\(true\);/);
  const gate = component.indexOf("  if (!consentChecked || consentRefused) return null;\n");
  assert.ok(gate > 0 && gate < component.indexOf("googletagmanager.com/gtag/js"), "consent gate precedes the tag scripts");
  assert.doesNotMatch(component + read("app/layout.js"), /G-[A-Z0-9]{6,}|GTM-[A-Z0-9]{4,}/);
});
