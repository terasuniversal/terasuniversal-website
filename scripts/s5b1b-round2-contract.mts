import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { privacyNoticeEn } from "../content/en/privacy.js";
import { privacyNoticeMs } from "../content/ms/privacy.js";
import { termsPartAEn } from "../content/en/terms.js";
import { isUntrackedPath, sanitizeAnalyticsUrl, sanitizeReferrer } from "../lib/analytics-privacy.js";
import { CONTRACT_BASE, changedSinceBase } from "./contract-base.mts";
import { revertW2Privacy } from "./w2-privacy-approved.mts";
import { createHash } from "node:crypto";

// FT-1B (owner-approved): LF-normalised SHA-256 of the approved three-step components/ProposalWizard.js.
const FT1B_PROPOSAL_WIZARD_SHA256 = "f0f7242bbc7e202796d739d445000db5392eb0f8306d54869cbff3ed6f72878b";

// S5B-1B Round 2 (owner-approved, local only): draft legal pages (gated, noindex, not linked, BM/EN parity), form
// privacy notes without payload changes, the proposal-success wording, the 404 header, the Insights hard 404 and
// analytics URL privacy.
const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const atHead = (path: string) => execFileSync("git", ["show", `${CONTRACT_BASE}:${path}`], { cwd: rootPath, encoding: "utf8" }).replace(/\r\n/g, "\n");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const DRAFT_PAGES = ["app/privacy/[[...lang]]/page.js", "app/terms/[[...part]]/page.js"];

// ---- draft legal pages ---------------------------------------------------------------------------------------
check("drafts: every draft page 404s unless TERAS_LEGAL_DRAFTS=preview, is noindex/nofollow and says it is a draft", () => {
  assert.match(read("lib/legal-drafts.js"), /export const legalDraftsEnabled = process\.env\.TERAS_LEGAL_DRAFTS === "preview";/);
  for (const path of DRAFT_PAGES) {
    const page = read(path);
    // A real 404 when the flag is off: no static params and no on-demand params (router-level, not a soft 404).
    assert.match(page, /^export const dynamicParams = false;$/m, path);
    // Public-First F-6: the Privacy Notice has its own fail-closed switch (lib/privacy-publication.js, null in the release
    // candidate); TERAS_LEGAL_DRAFTS still only previews it. Terms keeps the original draft-only gate.
    assert.match(page, path.startsWith("app/privacy/") ? /return privacyPublished \|\| legalDraftsEnabled \? \[.+\] : \[\];/ : /return legalDraftsEnabled \? \[.+\] : \[\];/, path);
    assert.match(page, /robots: \{ index: false, follow: false \}/, path);
    assert.match(page, /\(Internal Draft\)/, path);
  }
  assert.match(read("app/privacy/[[...lang]]/page.js"), /\{ lang: \[\] \}, \{ lang: \["ms"\] \}/);
  assert.match(read("app/privacy/[[...lang]]/page.js"), /Notis Privasi \(Draf Dalaman\)/);
  assert.match(read("lib/legal-drafts.js"), /INTERNAL DRAFT — NOT APPROVED FOR PUBLICATION — LEGAL REVIEW PENDING/);
  assert.match(read("lib/legal-drafts.js"), /DRAF DALAMAN — TIDAK DILULUSKAN UNTUK PENERBITAN/);
});
check("drafts: not in the sitemap and not linked from the footer, header, forms or any public page", () => {
  // F-6: /privacy may enter the sitemap only behind the Privacy publication switch; /terms never does.
  const sitemap = read("app/sitemap.js").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(sitemap, /terms/i);
  assert.deepEqual(sitemap.split("\n").filter((line) => /privacy/i.test(line) && !/^\s*\/\//.test(line) && !/^import \{ privacyPublished \}/.test(line)).map((line) => /privacyPublished \?/.test(line)), [true]);
  let out: string[] = [];
  try {
    out = execFileSync("git", ["grep", "-l", "--untracked", "-E", "href=[\"'{`]*/(privacy|terms)", "--", "app", "components", "content"], { cwd: rootPath, encoding: "utf8" }).trim().split("\n").filter(Boolean);
  } catch (error) {
    if ((error as { status?: number }).status !== 1) throw error; // git grep exits 1 when nothing matches
  }
  // Only the two Privacy pages link to each other (language switch, in their content modules). W2 Phase 1: the one
  // shared form link renders only behind the Privacy publication switch (proved in scripts/privacy-publication-contract.mts).
  assert.deepEqual(out, ["components/legal/PrivacyNoticeLink.js"], out.join(", "));
  assert.match(read("components/legal/PrivacyNoticeLink.js"), /if \(!privacyPublished\) return null;/);
  const switches = [privacyNoticeEn.switchLink.href, privacyNoticeMs.switchLink.href].sort();
  assert.deepEqual(switches, ["/privacy", "/privacy/ms"]);
});
// Public-First F-6: the v0.2 draft checks (16 sections, open decision markers) are superseded by the owner-approved
// v0.4 text. scripts/privacy-publication-contract.mts now proves its structure and BM/EN equivalence, the absence of
// open markers, retention durations, compliance and DPO claims and a precedence clause, and allows exactly one storage
// location: Singapore, the verified Supabase region. The no-invented-claims rule below is kept here as well.
check("privacy: no invented retention periods, unverified hosting locations, DPO name or compliance claim", () => {
  const text = JSON.stringify([privacyNoticeEn, privacyNoticeMs]);
  assert.doesNotMatch(text, /\b\d+\s*(years?|months?|days?|tahun|bulan|hari)\b/i);
  assert.doesNotMatch(text, /\b(United States|USA|Europe|Ireland|Amerika|Eropah)\b/i);
  assert.doesNotMatch(text, /\b(compliant|complies with|fully comply|mematuhi sepenuhnya|patuh PDPA)\b/i);
  assert.doesNotMatch(text, /Data Protection Officer|Pegawai Perlindungan Data/);
});
check("terms: Part A only, with refund, cancellation and certificate terms left as pending decisions", () => {
  const text = JSON.stringify(termsPartAEn);
  for (const id of ["D-10", "D-11", "D-12", "D-02", "L-14"]) assert.match(text, new RegExp(`\\[\\[${id}`), id);
  assert.doesNotMatch(text, /\b\d+\s*%|\bRM\s*\d|\b\d+\s*(days?|hours?)\b/i);
});

// ---- forms -------------------------------------------------------------------------------------------------
const NOTE_CONTACT = "Privacy: we use these details to respond to your enquiry and keep a record of it. Sending this form does not subscribe you to marketing emails.";
check("forms: privacy notes are present and contain no link to the unpublished draft", () => {
  assert.ok(read("components/ContactEnquiryForm.js").includes(NOTE_CONTACT));
  assert.ok(read("components/ContactForm.js").includes(NOTE_CONTACT));
  assert.ok(revertW2Privacy("components/ProposalWizard.js", read("components/ProposalWizard.js")).includes('<p className="wizard-note">Privacy: we use these details to prepare and follow up on your proposal and keep a record of the request. Submitting this form does not subscribe you to marketing emails.</p>'));
  assert.ok(read("components/NewsletterSignup.js").includes("Privacy: your email address is used only to send these updates and is held by our email delivery provider. You can unsubscribe at any time."));
});
check("forms: apart from the approved notes (and Round 1 edits) every form component is identical to HEAD — payloads, endpoints, required fields and consent unchanged", () => {
  const strip = (source: string) => source
    .replace(`      <p className="contact-form-note">\n        ${NOTE_CONTACT}\n      </p>\n`, "")
    .replace(`      <p className="form-note">\n        ${NOTE_CONTACT}\n      </p>\n`, "")
    .replace('<p className="wizard-note">Privacy: we use these details to prepare and follow up on your proposal and keep a record of the request. Submitting this form does not subscribe you to marketing emails.</p>', "")
    .replace('import styles from "./NewsletterSignup.module.css";\n', "")
    .replace('      <p className={`newsletter-privacy-note ${styles.privacyNote}`}>Privacy: your email address is used only to send these updates and is held by our email delivery provider. You can unsubscribe at any time.</p>\n', "")
    // Round 1 (owner-approved): admin@ display address and the honest newsletter message.
    .replaceAll("admin@terasuniversal.com.my", "training@terasuniversal.com.my")
    .replace("your subscription request has been received.", "please check your inbox to confirm your subscription.")
    .replace(' * configured. If that env var is missing, submission shows a neutral\n * "temporarily unavailable" error instead of silently failing.', " * configured. If that env var is missing, submission shows a clear error\n * instead of silently failing.");
  // FT-1B (owner-approved, 21 Nov 2026): ProposalWizard.js was rewritten as the three-step wizard, so it is pinned below to
  // the exact approved FT-1B bytes instead of the pre-Round-2 file; scripts/ft1b-proposal-wizard-contract.mts proves the
  // payload keys, endpoint, required fields, allowed lists, consent and privacy wording are unchanged.
  for (const path of ["components/ContactEnquiryForm.js", "components/ContactForm.js", "components/NewsletterSignup.js"]) {
    // W2 Phase 1 (owner-approved): the gated Privacy Notice link edits are undone first (scripts/w2-privacy-approved.mts).
    assert.equal(strip(revertW2Privacy(path, read(path))), atHead(path), path);
  }
  assert.equal(createHash("sha256").update(read("components/ProposalWizard.js")).digest("hex"), FT1B_PROPOSAL_WIZARD_SHA256, "components/ProposalWizard.js (FT-1B approved bytes)");
});
check("proposal success: no unverified confirmation-email promise", () => {
  const page = read("app/request-proposal/success/page.js");
  assert.match(page, /Your proposal request has been received by our team\. We will review your requirements and follow up shortly\./);
  assert.doesNotMatch(page, /confirmation email|email is on its way/i);
});

// ---- landmarks and 404 -------------------------------------------------------------------------------------
check("404: the shared Premium header sits before <main>; no legacy header, logo or menus remain", () => {
  const page = read("app/not-found.js");
  assert.match(page, /<PremiumHeader \/>\s*<main>/);
  assert.doesNotMatch(page, /site-header|teras-universal-logo\.png|MegaNav|MobileNav|components\/Footer"/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
});
check("insights: unknown article slugs are rejected by the router (dynamicParams = false), valid slugs still prebuilt", () => {
  const page = read("app/insights/[slug]/page.js");
  assert.match(page, /^export function generateStaticParams\(\) \{ return insights\.map\(\(\{ slug \}\) => \(\{ slug \}\)\); \}$/m);
  assert.match(page, /^export const dynamicParams = false;$/m);
  assert.equal(read("app/loading.js"), atHead("app/loading.js"), "root loading.js unchanged");
});

// ---- analytics URL privacy -----------------------------------------------------------------------------------
check("analytics: untracked routes are admin, payments, registration, verification and feedback (and only those)", () => {
  for (const path of ["/admin", "/admin/dashboard", "/payments/toyyibpay/return", "/registration/abc", "/registration/status", "/verify", "/verify/ABC123", "/feedback/t", "/feedback/s/x"]) assert.ok(isUntrackedPath(path), path);
  for (const path of ["/", "/training", "/insights/x", "/search", "/contact", "/verifyx", "/administrator-guide"]) assert.ok(!isUntrackedPath(path), path);
});
check("analytics: sanitised URLs keep origin + path + utm_* only; sensitive routes collapse to their prefix", () => {
  const base = "https://www.terasuniversal.com.my";
  assert.equal(sanitizeAnalyticsUrl(`${base}/payments/toyyibpay/return?attempt=0f1e2d3c-1111-2222-3333-444455556666`), `${base}/payments`);
  assert.equal(sanitizeAnalyticsUrl(`${base}/payments/toyyibpay/registration-return?reference=TR-2026-0001`), `${base}/payments`);
  assert.equal(sanitizeAnalyticsUrl(`${base}/verify?q=TU-CERT-0001`), `${base}/verify`);
  assert.equal(sanitizeAnalyticsUrl(`${base}/verify/SECRET-TOKEN`), `${base}/verify`);
  assert.equal(sanitizeAnalyticsUrl(`${base}/feedback/s/PUBLIC-TOKEN?x=1`), `${base}/feedback`);
  assert.equal(sanitizeAnalyticsUrl(`${base}/registration/status?reference=R1&secret=abc`), `${base}/registration`);
  assert.equal(sanitizeAnalyticsUrl(`${base}/search?q=john%40example.com`), `${base}/search`);
  assert.equal(sanitizeAnalyticsUrl(`${base}/training?utm_source=fb&utm_campaign=wah&email=a%40b.c&gclid=x#top`), `${base}/training?utm_source=fb&utm_campaign=wah`);
  assert.equal(sanitizeAnalyticsUrl("javascript:alert(1)"), "");
  assert.equal(sanitizeReferrer("https://www.google.com/search?q=teras+ic+900101", base), "https://www.google.com");
  assert.equal(sanitizeReferrer(`${base}/verify?q=TU-CERT-0001`, base), `${base}/verify`);
});
check("analytics: the component never sends the raw URL, disables GA4 and loads nothing on untracked routes", () => {
  const source = read("components/Analytics.js");
  assert.doesNotMatch(source, /page_location: window\.location\.href|location\.search/);
  // W5-a (owner-approved D-07, W5-a-G1): opt-in replaces the former opt-out flag; GA4 is also switched off without
  // consent, Google Signals and ad personalisation are off, and Google Tag Manager support is removed.
  assert.match(source, /window\[`ga-disable-\$\{measurementId\}`\] = isUntrackedPath\(pathname\) \|\| consent !== CONSENT_GRANTED;/);
  assert.match(source, /window\.gtag\("config", measurementId, \{ send_page_view: false, page_location: pageLocation, page_referrer: pageReferrer, allow_google_signals: false, allow_ad_personalization_signals: false \}\);/);
  assert.match(source, /if \(untracked \|\| !analyticsEnabled\) return null;/);
  assert.match(source, /cta_destination: target\.href \? sanitizeAnalyticsUrl\(target\.href\) : "button"/);
  assert.match(source, /window\.__TERAS_ANALYTICS_CONSENT__ === true/, "opt-in consent flag");
  assert.doesNotMatch(source, /window\.__TERAS_ANALYTICS_CONSENT__ !== false/, "the former opt-out default is gone");
  assert.match(source, /\{consent === CONSENT_GRANTED && <Script src=\{`https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=\$\{measurementId\}`\}/, "gtag.js only after consent");
  assert.doesNotMatch(source, /gtm\.js|NEXT_PUBLIC_GTM_ID|tagManager/, "no Google Tag Manager");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
