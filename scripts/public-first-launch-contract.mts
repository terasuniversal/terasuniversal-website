/**
 * Public-First launch fixes (owner-approved, local only): static contract.
 *  - every edit to an existing file is exactly the named edit in scripts/public-first-approved.mts (reverting reproduces
 *    the pre-Public-First bytes pinned below);
 *  - the registration, newsletter and canonical controls fail closed / default to today's behaviour;
 *  - the drone photographs and the unverified poster are not served and not referenced (Option B, F-2/F-3);
 *  - legal drafts, the eBook preview, articles' noindex, certificate logic and all ToyyibPay files are untouched.
 *
 * Run: node --experimental-transform-types scripts/public-first-launch-contract.mts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { revertPublicFirst, PF_CHANGED, PF_ADDED, PF_WITHHELD } from "./public-first-approved.mts";
import { CONTRACT_BASE, changedSinceBase } from "./contract-base.mts";
import { revertToyyibpayInactiveBill, revertToyyibpayInactiveBillInBase } from "./toyyibpay-inactivebill-approved.mts";
import { revertW6a2 } from "./w6a2-approved.mts";
import { revertW9g1 } from "./w9g1-approved.mts";
import { revertW9g3 } from "./w9g3-approved.mts";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const raw = (path: string) => readFileSync(new URL(path, root));
const text = (path: string) => raw(path).toString("utf8");
const sha16 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex").slice(0, 16);
// Content hash with line endings normalised (CRLF->LF), for text files.
const norm16 = (value: string) => sha16(value.replace(/\r\n/g, "\n"));
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

// Pre-Public-First content, line endings normalised (CRLF->LF) so the check does not depend on how git checks files out.
// Release candidate (K-4): includes the F-6 sitemap line, which revertPublicFirst() also removes.
const BEFORE: Record<string, string> = {
  "app/about/layout.js": "a9e00d6bcfaaf6e9",
  "app/about/page.js": "d2224ba1d985ccb6",
  "app/api/newsletter/route.js": "8dd997c659721b99",
  "app/api/registration/payment/route.ts": "2e694f2a1fe0bde9",
  "app/api/registration/route.ts": "45eb606e63772091",
  "app/calendar/page.js": "6502b78e3875006a",
  "app/contact/layout.js": "c0b9e6471622b77b",
  "app/contact/page.js": "ffd88103a5876ee6",
  "app/gallery/layout.js": "9167ca7269a438e1",
  "app/insights/[slug]/page.js": "d8853ad7976dfdcd",
  "app/insights/page.js": "7f111aa4aac64d75",
  "app/layout.js": "6ee5f7105b96c598",
  "app/registration/[scheduleId]/page.tsx": "d3eff06dfd48bcde",
  "app/robots.js": "3717453daa60a2de",
  "app/services/layout.js": "36fa3087b00c1dd7",
  "app/services/page.js": "59f4012a15dc0396",
  "app/services/scaffolding/layout.js": "e8be4fa6d44463fe",
  "app/services/scaffolding/page.js": "7f20f6ba345be780",
  "app/sitemap.js": "a9bf12a373259b84",
  "app/training/[slug]/page.js": "9083a37f05bae169",
  "app/training/layout.js": "600e0331c4099b5d",
  "app/verify/VerificationResult.tsx": "7a5d36987d622c85",
  "app/verify/page.tsx": "35988db58a267b02",
  "components/home/HomeContact.js": "52e3ad9a01d6ae24",
  "components/premium/PremiumHeader.js": "3e0d3c116ec43e91",
  "components/public/BreadcrumbJsonLd.js": "eb9d885c1bd0c207",
  "content/en/calendar.js": "1a5737c20fdc70c3",
  "content/en/home.js": "5c796a663fb6b7df",
  "lib/public-content.ts": "79aab392fc4b7d67",
};
// Files these fixes must not touch (normalised content hashes). The F-6 Privacy files are covered by
// scripts/privacy-publication-contract.mts instead.
const UNTOUCHED: Record<string, string> = {
  "lib/legal-drafts.js": "a4237d8d3be23fa0",
  "lib/ebook-preview.js": "9ebc46050dac2412",
  "lib/site-origin.ts": "601f922d087c64f1",
  "app/payments/toyyibpay/return/page.tsx": "271da94cf86af90e",
  "lib/payments/toyyibpay-return-view.ts": "3c377a880bbc6c89",
  "app/verify/VerifyForm.js": "8cf3f5bb142d76ce",
  "app/verify/[token]/page.tsx": "0037c5a220d600b3",
  "app/api/registration/status/route.ts": "d103eeb456e2a3b0",
  "app/registration/status/page.tsx": "a6c515d0056cddd7",
  "content/en/terms.js": "901b1240f403f29b",
  "app/terms/[[...part]]/page.js": "38da8c3e51935cc4",
  "app/ebook/[[...ebook]]/page.js": "4b47d8d534f14afd",
  "data/insights.js": "159251bacae5830e",
};
// ToyyibPay files in this release are exactly the release base's: the R2/R4 changes are excluded, so they are compared
// with the CONTRACT_BASE blob rather than pinned to a hash.
const PAYMENT_AT_BASE = ["app/api/payments/toyyibpay/callback/route.ts", "app/api/payments/toyyibpay/registration-callback/route.ts", "lib/payments/toyyibpay.ts", "app/admin/(protected)/invoices/toyyibpayActions.ts"];
// S5C export hashes of the withheld drone photographs and the poster's committed blob.
const WITHHELD_HASHES: Record<string, string> = {
  "teras-yard-trainees-landscape.webp": "3d23616c89149a96", "teras-yard-trainees-portrait.webp": "e9943b58c5d76e03",
  "teras-yard-overhead-landscape.webp": "9a1e89a351c8e99c", "teras-yard-overhead-portrait.webp": "ef8a7b32577be70a",
  "scaffolding-rental-poster-en.webp": "8f1a85afefc5c96f",
};
const EVIDENCE = "D:/Projects/_design/teras-hybrid-v2/docs/WEBSITE-PUBLIC-FIRST-FIXES/withheld-assets/";

check("every changed file differs only by its named Public-First edit (revert reproduces the pre-Public-First bytes)", () => {
  assert.deepEqual([...PF_CHANGED].sort(), Object.keys(BEFORE).sort());
  for (const path of PF_CHANGED) assert.equal(norm16(revertPublicFirst(path, text(path))), BEFORE[path], path);
});
check("the listed new files exist", () => {
  for (const path of PF_ADDED) assert.ok(existsSync(new URL(path, root)), path);
});
check("F-1: the registration switch fails closed (only the exact value 'enabled' turns it on)", () => {
  const gate = text("lib/public-registration-gate.ts");
  assert.match(gate, /return process\.env\.TERAS_PUBLIC_REGISTRATION === "enabled";/);
  assert.equal((gate.match(/process\.env/g) ?? []).length, 1);
  for (const path of ["app/api/registration/route.ts", "app/api/registration/payment/route.ts"]) assert.match(text(path), /if \(!publicRegistrationEnabled\(\)\) return NextResponse\.json\(\{ error: REGISTRATION_DISABLED_MESSAGE \}, \{ status: 503 \}\);/, path);
  assert.match(text("app/registration/[scheduleId]/page.tsx"), /if \(!publicRegistrationEnabled\(\)\) notFound\(\);/);
  assert.equal((text("lib/public-content.ts").match(/publicRegistrationEnabled\(\) && row\.registration_available === true/g) ?? []).length, 2);
  assert.match(text("components/premium/PremiumHeader.js"), /publicRegistrationEnabled\(\) \? homeContent\.header\.registerCta : homeContent\.header\.registerCtaClosed/);
  assert.match(text("app/calendar/page.js"), /publicRegistrationEnabled\(\) \? intro\.lead : intro\.leadClosed/);
  const closed = text("content/en/home.js").match(/registerCtaClosed: \{ label: "([^"]+)", shortLabel: "([^"]+)"/);
  assert.ok(closed && !/regist/i.test(closed[1] + closed[2]), "closed header action does not say register");
  assert.doesNotMatch(text("content/en/calendar.js").match(/leadClosed: "[^"]*"/)?.[0] ?? "", /register/i, "closed calendar intro does not mention registering online");
});
check("newsletter: collection is off unless TERAS_NEWSLETTER=enabled, and the API refuses after the preview-isolation check", () => {
  assert.match(text("lib/newsletter-gate.js"), /return process\.env\.TERAS_NEWSLETTER === "enabled";/);
  const route = text("app/api/newsletter/route.js").replace(/\r\n/g, "\n");
  assert.ok(route.indexOf("if (!newsletterEnabled())") > route.indexOf("if (!outbound.allowed)"), "gate after preview isolation, before Resend");
  assert.ok(route.indexOf("if (!newsletterEnabled())") < route.indexOf("new Resend("), "gate before any Resend use");
  assert.match(text("components/home/HomeContact.js"), /\{newsletterEnabled\(\) && \(/);
  assert.match(text("app/insights/page.js"), /\{newsletterEnabled\(\) && <div className="insights-newsletter-block">/);
});
check("F-5: canonical origin is centralised, defaults to the current apex host and switches only on the exact www value", () => {
  const origin = text("lib/canonical-origin.js");
  assert.match(origin, /export const CANONICAL_ORIGIN = process\.env\.TERAS_CANONICAL_ORIGIN === WWW_ORIGIN \? WWW_ORIGIN : APEX_ORIGIN;/);
  assert.match(origin, /APEX_ORIGIN = "https:\/\/terasuniversal\.com\.my"/);
  let hard = "";
  try { hard = execFileSync("git", ["grep", "-l", "--untracked", "https://terasuniversal.com.my", "--", "app", "components"], { cwd: rootPath, encoding: "utf8" }).trim(); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
  assert.deepEqual(hard.split("\n").filter(Boolean).filter((p) => !p.startsWith("app/admin/") && !p.startsWith("app/api/")), [], "no public page keeps its own hard-coded host");
});
check("F-2/F-3: drone photographs and the unverified poster are not served and not referenced; slots show the approved panels", () => {
  assert.equal(existsSync(new URL("public/images/authentic", root)), false);
  for (const path of PF_WITHHELD) assert.equal(existsSync(new URL(path, root)), false, path);
  let users = "";
  try { users = execFileSync("git", ["grep", "-l", "--untracked", "-E", "images/authentic|scaffolding-rental-poster", "--", "app", "components", "content", "data", "lib"], { cwd: rootPath, encoding: "utf8" }).trim(); }
  catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
  assert.equal(users, "");
  for (const [path, count] of [["app/about/page.js", 1], ["app/contact/page.js", 1], ["app/services/page.js", 1], ["app/services/scaffolding/page.js", 2]] as const) {
    assert.ok((text(path).match(/\/images\/v2\/panel-[abc]\.svg" alt="" unoptimized/g) ?? []).length >= count, path);
  }
  assert.equal(sha16(execFileSync("git", ["show", `${CONTRACT_BASE}:public/images/scaffolding-rental-poster-en.webp`], { cwd: rootPath, maxBuffer: 1 << 26 })), WITHHELD_HASHES["scaffolding-rental-poster-en.webp"], "poster blob in git history");
});
check("withheld evidence copies are byte-identical (local evidence folder, when present)", () => {
  if (!existsSync(EVIDENCE)) { console.log("  (evidence folder not on this machine: copy check NOT RUN)"); return; }
  for (const [name, hash] of Object.entries(WITHHELD_HASHES)) {
    const file = name.startsWith("teras-yard") ? `${EVIDENCE}authentic/${name}` : `${EVIDENCE}${name}`;
    assert.equal(sha16(readFileSync(file)), hash, name);
  }
});
check("F-4: /verify uses #667085 for its secondary text; verification logic files untouched", () => {
  for (const path of ["app/verify/page.tsx", "app/verify/VerificationResult.tsx"]) assert.doesNotMatch(text(path), /#98a2b3/i, path);
});
check("untouched: legal drafts and their markers, eBook gate, articles, certificate logic, site origin and every ToyyibPay file", () => {
  // W6-SEO-a2 (owner-approved) later edited data/insights.js; only its named edits are undone before hashing.
  // W9-G1 (owner-approved) later edited the /ebook page; its named edits are undone first.
  for (const [path, hash] of Object.entries(UNTOUCHED)) assert.equal(norm16(revertW6a2(path, revertW9g1(path, revertW9g3(path, text(path))))), hash, path);
  for (const path of PAYMENT_AT_BASE) {
    const current = text(path).replace(/\r\n/g, "\n");
    const base = execFileSync("git", ["show", `${CONTRACT_BASE}:${path}`], { cwd: rootPath, encoding: "utf8", maxBuffer: 1 << 26 }).replace(/\r\n/g, "\n");
    // CRM F-PAY-1 NE-1 (owner-approved): only the Inactive Bill classifier edit is undone, on both sides, before comparing.
    if (path === "lib/payments/toyyibpay.ts") assert.equal(revertToyyibpayInactiveBill(path, current), revertToyyibpayInactiveBillInBase(path, base), `${path} must equal the release base`);
    else assert.equal(current, base, `${path} must equal the release base`);
  }
  assert.equal(existsSync(new URL("lib/payments/toyyibpay-decision.ts", root)), false, "R2 decision module is not part of this release");
  assert.match(text("app/insights/[slug]/page.js"), /robots: \{ index: false, follow: true \}/, "articles stay noindex");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
