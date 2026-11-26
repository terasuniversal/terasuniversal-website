import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { revertPublicFirst, PF_CHANGED, PF_ADDED, PF_WITHHELD } from "./public-first-approved.mts";
import { revertW2Privacy } from "./w2-privacy-approved.mts";
import { CONTRACT_BASE, changedSinceBase } from "./contract-base.mts";
import { revertW4a } from "./w4a-approved.mts";
import { approvedRootLoading } from "./w10ux-approved.mts"; // W10-UX-01: root loading boundary moved to /calendar

// S5B-1B Round 4 (owner-approved, local only): Premium V2 hero and button treatment for the legacy informational
// heroes and the inline required-field marker on /contact, all through the scoped bridge module. No JSX, form,
// payload or global stylesheet change; this contract fails if one appears.
const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
// Public-First fixes (newsletter gate, F-5 canonical origin) are reverted before hashing pinned files.
// W2 Phase 1 (owner-approved): the gated Privacy Notice link edits are undone first (scripts/w2-privacy-approved.mts).
const sha = (path: string) => createHash("sha256").update(revertPublicFirst(path, revertW2Privacy(path, read(path)))).digest("hex");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

const css = read("components/premium/legacy-bridge.module.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = css.split("}").map((r) => r.trim()).filter(Boolean);
const HEROES = [".about-hero", ".services-hero", ".scaffolding-hero", ".contact-page-hero", ".proposal-hero", ".gallery-page-hero", ".industries-hub-hero", ".industry-hero", ".resources-hero"];
const HERO_LIST = `:is(${HEROES.join(", ")})`;

check("hero: the nine legacy informational heroes get the navy Premium V2 ground with white text", () => {
  const ground = rules.find((r) => r.startsWith(`.page :global(${HERO_LIST})`));
  assert.ok(ground, "hero ground rule");
  assert.match(ground!, /background: radial-gradient\(circle at 86% 14%, rgba\(212, 175, 55, 0\.14\), transparent 30%\), #0b3a63;/);
  assert.match(ground!, /color: #ffffff;/);
  assert.ok(rules.some((r) => r.startsWith(`.page :global(${HERO_LIST} :is(h1, h2))`) && /color: #ffffff;/.test(r)), "headings white");
  assert.ok(rules.some((r) => r.startsWith(`.page :global(${HERO_LIST} h1 span)`) && /color: #d4af37;/.test(r)), "tagline gold");
  assert.ok(rules.some((r) => r.startsWith(`.page :global(${HERO_LIST} :is(p, li, dd, dt))`) && /rgba\(255, 255, 255, 0\.9\)/.test(r)), "body copy");
});
check("hero: the old light-hero navy band behind the gold tagline is neutralised on the navy hero", () => {
  const band = rules.find((r) => r.startsWith(".page:is(:global(#main-content) > main) :global(:is(.about-hero-copy, .services-hero-copy) h1 span)"));
  assert.ok(band, "band override");
  assert.match(band!, /background: transparent;/);
  assert.match(band!, /padding: 0;/);
});
check("hero CTAs: gold primary with navy text, white outline secondary", () => {
  const primary = rules.find((r) => r.startsWith(`.page :global(${HERO_LIST} :is(.btn-primary, .btn-gold))`));
  assert.ok(primary && /background: #d4af37;/.test(primary) && /color: #072a48;/.test(primary), "primary");
  const outline = rules.find((r) => r.startsWith(`.page :global(${HERO_LIST} :is(.btn-outline, .btn-light))`));
  assert.ok(outline && /background: transparent;/.test(outline) && /color: #ffffff;/.test(outline), "outline");
});
check("buttons: Premium kit shape with a 48px minimum target and no hover lift", () => {
  const btn = rules.find((r) => r.startsWith(".page :global(.btn) {"));
  assert.ok(btn && /min-height: 48px;/.test(btn) && /border-radius: 2px;/.test(btn), "button shape");
  assert.ok(rules.some((r) => r.startsWith(".page :global(.btn:hover)") && /transform: none;/.test(r)), "no lift");
});
check("contact form: the required marker sits on the label line; fields still take the full row", () => {
  const label = rules.find((r) => r.startsWith(".page :global(.contact-page-form label) {"));
  assert.ok(label && /display: flex;/.test(label) && /flex-wrap: wrap;/.test(label), "label flex");
  const field = rules.find((r) => r.startsWith(".page :global(.contact-page-form label > :is(input, select, textarea, .form-field-error))"));
  assert.ok(field && /flex: 1 0 100%;/.test(field), "full-width field");
});
check("contact form: field errors keep the site error red; marker and required note take the label colour", () => {
  const errorRule = rules.find((r) => r.startsWith(".page :global(.contact-page-form label > .form-field-error) {"));
  assert.ok(errorRule && /color: #b3261e;/.test(errorRule), "error red");
  assert.equal(rules.filter((r) => /#b3261e/i.test(r)).length, 1, "error red used only for field errors");
  const marker = rules.find((r) => r.startsWith(".page :global(:is(.contact-page-form label > span:not(.form-field-error), .contact-form-required-note span))"));
  assert.ok(marker && /color: inherit;/.test(marker), "marker inherits");
});
check("bridge scope: still .page/.aiNote only, approved palette, no protected selectors, no !important", () => {
  for (const rule of rules) assert.match(rule, /^\.(page|aiNote)\b/, rule.slice(0, 60));
  for (const colour of css.match(/#[0-9a-f]{3,6}\b/gi) ?? []) assert.ok(["#0b3a63", "#072a48", "#d4af37", "#333333", "#4f5b6a", "#ffffff", "#b3261e"].includes(colour.toLowerCase()), colour);
  assert.doesNotMatch(css, /teras-admin|verify|certificate|registration|feedback|payment|@import|@font-face|!important/i);
});

// Form components and their API routes are byte-identical (LF-normalised) to the Round 3 result: field names,
// payloads, validation, consent, anti-spam and destinations cannot have moved in this round.
const FROZEN: Record<string, string> = {
  "components/ContactEnquiryForm.js": "c6094a0182d86889b5ac91e7d530706636d22abeaec878dbef4ed62710b4ec8e",
  "components/ContactForm.js": "b10c146a9dc816edaed988a8d75ca1c98d526df87e8416231fbc44f823773646",
  // FT-1B (owner-approved, 21 Nov 2026): re-pinned to the approved three-step wizard (was d25dd7e1… from Round 3);
  // scripts/ft1b-proposal-wizard-contract.mts proves its payload, endpoint, consent and privacy wording are unchanged.
  "components/ProposalWizard.js": "18e35a80fa3a9dbc1b01219976df893b16256bf38f709d281be08c8129b89833",
  "components/NewsletterSignup.js": "16ab290193adb1688816543d33d13d39ae139112ed27461fd788eb3d4297bb9b",
  "app/api/contact/route.js": "d9de48d49b0d6e4ddb1b004d10f4ddc06a630f2133f8a1eb7e4beb2148bc0914",
  "app/api/request-proposal/route.js": "444572e3082786527bb3a00236ebc4d1dbee158b6ae85df9e309c3106d669ecb",
  "app/api/newsletter/route.js": "8dd997c659721b9987428cefd08f961c7db97493fffc58a779207715afe140b4",
};
check("forms: components and API routes unchanged in this round", () => {
  for (const [path, hash] of Object.entries(FROZEN)) assert.equal(sha(path), hash, path);
});
check("global stylesheet, root layout and loading boundary are untouched", () => {
  for (const path of ["app/globals.css", "app/loading.js"]) {
    // W4-a NE-2/NE-3 (owner-approved): the named globals.css rules are undone first (scripts/w4a-approved.mts).
    assert.equal(revertW4a(path, path === "app/loading.js" ? approvedRootLoading(root) : read(path)), execFileSync("git", ["show", `${CONTRACT_BASE}:${path}`], { cwd: rootPath, encoding: "utf8", maxBuffer: 1 << 26 }).replace(/\r\n/g, "\n"), path);
  }
  // app/layout.js carries the Round 1 JSON-LD email change only; pinned to that result rather than HEAD.
  assert.equal(sha("app/layout.js"), "6ee5f7105b96c5985c5609b9704ef2792cb3fd37b9d514331c87e272cea02337", "app/layout.js");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
