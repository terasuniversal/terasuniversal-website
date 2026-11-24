/**
 * W5-a GA4 consent contract (owner-approved W5-a-G1, D-07, local only). Proves explicit opt-in: no GA4 before
 * "Accept analytics" or after "Reject", consent can be withdrawn on /privacy, sensitive routes stay untracked, URLs
 * are sanitised, Google Tag Manager is gone, the CSP only gains GA4 collection endpoints (script-src unchanged) and
 * reverting the named CSP edit restores next.config.mjs exactly. Synthetic data only; no network.
 * Run: node --experimental-transform-types scripts/w5a-ga4-consent-contract.mts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CONSENT_CHANGE_EVENT, CONSENT_DENIED, CONSENT_GRANTED, CONSENT_STORAGE_KEY, analyticsConfigured, applyConsentChoice,
  gaCookieDeletions, gaCookieNames, isValidMeasurementId, readConsent, writeConsent,
} from "../lib/analytics-consent.js";
import { isUntrackedPath, sanitizeAnalyticsUrl } from "../lib/analytics-privacy.js";
import { revertW5a, W5A_CHANGED } from "./w5a-approved.mts";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

const memoryStorage = () => { const map = new Map<string, string>(); return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, map }; };
const brokenStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

check("configuration: only a production build with a valid G- measurement ID enables analytics", () => {
  for (const good of ["G-ABC123", "G-1A2B3C4D5E"]) assert(isValidMeasurementId(good), good);
  for (const bad of [undefined, null, "", "UA-12345-1", "GTM-ABCD12", "G-", "g-abc123", "G-abc123", "G-ABC 123", "G-ABC123<script>"]) assert(!isValidMeasurementId(bad), String(bad));
  assert(analyticsConfigured("production", "G-ABC123") && !analyticsConfigured("development", "G-ABC123") && !analyticsConfigured("production", undefined), "configured");
});
check("consent storage: only 'granted' or 'denied' are stored; anything else or blocked storage means no choice", () => {
  const s = memoryStorage();
  assert(readConsent(s) === null, "no choice yet");
  assert(writeConsent(s, CONSENT_GRANTED) && readConsent(s) === CONSENT_GRANTED, "granted");
  assert(writeConsent(s, CONSENT_DENIED) && readConsent(s) === CONSENT_DENIED, "denied");
  assert(!writeConsent(s, "yes") && readConsent(s) === CONSENT_DENIED, "invalid value ignored");
  s.map.set(CONSENT_STORAGE_KEY, "true");
  assert(readConsent(s) === null, "tampered value is not consent");
  assert(readConsent(brokenStorage) === null && writeConsent(brokenStorage, CONSENT_GRANTED) === false, "blocked storage");
  assert(readConsent(null) === null, "no storage");
});
check("withdrawal: Reject deletes the GA4 cookies on this host and its parent domains, and notifies the component", () => {
  assert(JSON.stringify(gaCookieNames("_ga=GA1.1.1; theme=x; _ga_ABC123=GS1; _gat=1; x_ga=1")) === JSON.stringify(["_ga", "_ga_ABC123"]), "names");
  const deletions = gaCookieDeletions("_ga=1; _ga_ABC123=2", "www.terasuniversal.com.my");
  for (const d of ["_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/", "_ga=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.terasuniversal.com.my", "_ga_ABC123=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.com.my"]) assert(deletions.includes(d), d);
  const written: string[] = []; const events: string[] = []; const s = memoryStorage();
  const win = { localStorage: s, document: { get cookie() { return "_ga=GA1.1.1; _ga_ABC123=GS1"; }, set cookie(v: string) { written.push(v); } }, location: { hostname: "www.terasuniversal.com.my" }, dispatchEvent: (e: Event) => { events.push(e.type); return true; } } as unknown as Window & Record<string, unknown>;
  applyConsentChoice(win, CONSENT_GRANTED);
  assert(win.__TERAS_ANALYTICS_CONSENT__ === true && readConsent(s) === CONSENT_GRANTED && written.length === 0, "accept stores consent, deletes nothing");
  applyConsentChoice(win, CONSENT_DENIED);
  assert(win.__TERAS_ANALYTICS_CONSENT__ === false && win.__TERAS_ANALYTICS_CHOICE__ === CONSENT_DENIED && readConsent(s) === CONSENT_DENIED, "withdrawal stored");
  assert(written.length >= 2 && written.every((w) => /^_ga(_ABC123)?=; expires=Thu, 01 Jan 1970/.test(w)), "GA cookies expired");
  assert(events.length === 2 && events.every((e) => e === CONSENT_CHANGE_EVENT), "component notified");
  applyConsentChoice(win, "maybe");
  assert(events.length === 2, "invalid choice ignored");
});
check("routes and URLs: the five sensitive prefixes are never tracked and no query value other than utm_* is sent", () => {
  for (const p of ["/admin", "/admin/sales", "/payments/toyyibpay/return", "/registration/status", "/verify", "/verify/TOKEN", "/feedback/s/T"]) assert(isUntrackedPath(p), p);
  for (const p of ["/", "/training/working-at-height", "/privacy", "/contact"]) assert(!isUntrackedPath(p), p);
  assert(sanitizeAnalyticsUrl("https://www.terasuniversal.com.my/training/x?utm_source=facebook&q=john%40mail.com&id=7&phone=0123#top") === "https://www.terasuniversal.com.my/training/x?utm_source=facebook", "sanitised");
  assert(sanitizeAnalyticsUrl("https://www.terasuniversal.com.my/registration/status?reference=R1&secret=s") === "https://www.terasuniversal.com.my/registration", "sensitive path collapsed");
});

const analytics = read("components/Analytics.js");
const banner = read("components/AnalyticsConsentBanner.js");
const settings = read("components/AnalyticsSettings.js");
check("component: opt-in, no GA4 before consent or after rejection, nothing on untracked routes, no GTM", () => {
  assert(/const analyticsEnabled = process\.env\.NODE_ENV === "production" && isValidMeasurementId\(measurementId\);/.test(analytics), "valid-ID gate");
  assert(/window\.__TERAS_ANALYTICS_CONSENT__ === true && !isUntrackedPath\(pathname\)/.test(analytics), "canTrack needs consent");
  assert(/\{consent === CONSENT_GRANTED && <Script src=/.test(analytics), "gtag.js only after consent");
  assert(/if \(untracked \|\| !analyticsEnabled\) return null;/.test(analytics), "nothing on untracked routes or without configuration");
  assert(/consentRead && consent === null && <AnalyticsConsentBanner \/>/.test(analytics), "banner only before a choice");
  assert(/allow_google_signals: false, allow_ad_personalization_signals: false/.test(analytics), "signals and ad personalisation off");
  assert(/ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied"/.test(analytics), "consent mode ads denied");
  assert(!/gtm\.js|NEXT_PUBLIC_GTM_ID|tagManager|location\.search|page_location: window\.location\.href/.test(analytics), "no GTM or raw URL");
});
check("banner and settings: bilingual, explicit Accept and Reject, withdrawal on /privacy, no own link to the notice", () => {
  for (const s of ["Accept analytics · Terima analitik", "Reject · Tolak", 'lang="ms"', "<PrivacyNoticeLink />", 'type="button"']) assert(banner.includes(s), `banner: ${s}`);
  assert(!/href=/.test(banner), "banner uses the shared publication-gated link only");
  for (const s of ["Analytics settings", "Tetapan analitik", "Reject or withdraw consent", "Tolak atau tarik balik persetujuan", 'role="status"']) assert(settings.includes(s), `settings: ${s}`);
  assert(/if \(!configured \|\| choice === undefined\) return null;/.test(settings), "settings hidden while GA4 is not configured");
  assert(/<AnalyticsSettings lang=\{malay \? "ms" : "en"\} \/>/.test(read("app/privacy/[[...lang]]/page.js")), "settings on both privacy pages");
  assert(!/(email|phone|name|reference)\s*:/i.test(analytics.replace(/page_title: document\.title/g, "")), "no personal fields in events");
});
check("CSP: script-src unchanged; only GA4 collection endpoints added; reverting the named edit restores the base", () => {
  assert(JSON.stringify(W5A_CHANGED) === JSON.stringify(["next.config.mjs"]), "scope");
  const now = read("next.config.mjs");
  // Pinned SHA-256 (LF) of next.config.mjs at the approved base d7a93886, so the proof still holds after merge, when
  // the dynamic contract base will already contain W5-a.
  const reverted = revertW5a("next.config.mjs", now);
  assert(createHash("sha256").update(reverted).digest("hex") === "7679080cf0b8cc714d1a29409b4c3c9df778c3423d2abe01a3ddc4de3da80f55", "revert equals the approved base bytes");
  const scriptSrc = (t: string) => /script-src 'self'[^;]*/.exec(t)?.[0];
  assert(scriptSrc(now) === scriptSrc(reverted), "script-src unchanged");
  for (const host of ['"https://*.google-analytics.com"', '"https://*.analytics.google.com"', '"https://www.googletagmanager.com"']) assert(now.includes(host), host);
  assert(/img-src 'self' data: blob: https:\/\/\*\.google-analytics\.com https:\/\/www\.googletagmanager\.com;/.test(now), "img-src");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
