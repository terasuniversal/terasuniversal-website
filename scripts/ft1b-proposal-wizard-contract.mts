/**
 * FT-1B three-step Request a Proposal wizard (owner-approved, 21 Nov 2026): semantic guard contract. Reads repository
 * files only. Complements the byte pins in s5b1b-round2 / s5b1b-round4 (re-pinned to the approved wizard) by proving:
 *  (a) the request body keys are the API's own keys (route MAX_LENGTHS) plus consent, website and formStartedAt;
 *  (b) the industry / category lists equal the route's ALLOWED_* lists; the field limits equal the route's limits;
 *  (c) formStartedAt is the real time the form was opened (useRef(Date.now())), never a faked "now minus N";
 *  (d) the existing `website` honeypot is rendered off-screen (not display:none), tabIndex -1, autocomplete off, and sent;
 *  (e) no marketing / newsletter consent or other new field is collected or sent;
 *  (f) ?course= is used only after it matches a real catalogue slug;
 *  (g) the endpoint and success redirect are unchanged; consent sentence and privacy note are word for word;
 *  (h) no response-time promise, certification claim or raw HTML injection in the new copy;
 *  (i) the API route and the /request-proposal pages are unchanged (LF-normalised SHA-256);
 *  (j) the wizard stylesheet stays local (no :global, no !important).
 *
 * Run: node --experimental-transform-types scripts/ft1b-proposal-wizard-contract.mts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { proposalContent } from "../content/en/proposal.js";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
const sha = (path: string) => createHash("sha256").update(read(path)).digest("hex");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

const wizard = read("components/ProposalWizard.js");
const route = read("app/api/request-proposal/route.js");
const css = read("components/proposal/wizard.module.css");
const listOf = (source: string, name: string) => JSON.parse(source.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`))?.[1] ?? "null");
const objectKeys = (literal: string) => [...literal.matchAll(/(\w+):/g)].map(([, key]) => key);
const routeMax = route.match(/const MAX_LENGTHS = \{([^}]*)\};/)?.[1] ?? "";
const routeMaxKeys = objectKeys(routeMax);
const payloadBlock = wizard.match(/const payload = \{([\s\S]*?)\n {4}\};/)?.[1] ?? "";
const payloadKeys = objectKeys(payloadBlock.replace(/\([^)]*\)/g, ""));

check("(a) request body keys are exactly the API keys plus consent, website and formStartedAt", () => {
  assert.ok(routeMaxKeys.length === 14, "route MAX_LENGTHS parsed");
  assert.deepEqual([...payloadKeys].sort(), [...routeMaxKeys, "consent", "website", "formStartedAt"].sort());
  for (const key of ["companyName", "contactPerson", "email", "phone", "industry", "category", "objectives"]) assert.match(route, new RegExp(`"${key}"`), key);
  assert.match(route, /const required = \["companyName", "contactPerson", "email", "phone", "industry", "category", "objectives"\];/);
});
check("(b) industry and category lists equal the route's ALLOWED_* lists; field limits equal the route's", () => {
  assert.deepEqual(listOf(wizard, "industries"), listOf(route, "ALLOWED_INDUSTRIES"));
  assert.deepEqual(listOf(wizard, "categories"), listOf(route, "ALLOWED_CATEGORIES"));
  const limits = (literal: string) => Object.fromEntries([...literal.matchAll(/(\w+): (\d+)/g)].map(([, key, value]) => [key, Number(value)]));
  const wizardMax = limits(wizard.match(/const MAX = \{([^}]*)\};/)?.[1] ?? "");
  for (const [key, value] of Object.entries(wizardMax)) assert.equal(value, limits(routeMax)[key], key);
});
check("(c) formStartedAt is the real time the form was opened, never faked", () => {
  assert.match(wizard, /const formStartedAt = useRef\(Date\.now\(\)\);/);
  assert.match(payloadBlock, /formStartedAt: formStartedAt\.current/);
  assert.doesNotMatch(wizard, /Date\.now\(\)\s*-/);
  assert.equal((wizard.match(/formStartedAt\.current\s*=/g) ?? []).length, 0, "never reset");
});
check("(d) the existing `website` honeypot is rendered off-screen, unfocusable, without autofill, and sent", () => {
  assert.match(wizard, /<div aria-hidden="true" className=\{styles\.trap\}>/);
  assert.match(wizard, /<input id="pw-website" name="website" type="text" tabIndex=\{-1\} autoComplete="off" value=\{values\.website\} onChange=\{update\} \/>/);
  assert.match(payloadBlock, /website: values\.website/);
  assert.match(css, /^\.trap \{ position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; \}$/m);
  assert.doesNotMatch(css.match(/^\.trap \{[^}]*\}/m)?.[0] ?? "", /display:\s*none|visibility/);
  assert.match(route, /if \(clean\(payload\.website, 200\)\) return NextResponse\.json\(\{ ok: true \}\);/);
});
check("(e) no marketing or newsletter consent, and no other new field, is collected or sent", () => {
  assert.doesNotMatch(wizard, /marketing[A-Z]\w*|newsletter|subscribe\w*:/i);
  assert.equal((wizard.match(/type="checkbox"/g) ?? []).length, 1, "one checkbox: the existing consent");
});
check("(f) ?course= preselects only a real catalogue slug", () => {
  assert.match(wizard, /const findCourse = \(slug\) => courseCatalog\.find\(\(course\) => course\.slug === slug\);/);
  assert.match(wizard, /const course = slug \? findCourse\(slug\) : null;\n\s+if \(!course\) return;/);
  assert.match(wizard, /categories\.includes\(course\.category\) \? course\.category : ""/);
  assert.doesNotMatch(wizard, /dangerouslySetInnerHTML|innerHTML/);
});
check("(g) endpoint, success redirect, consent sentence and privacy note are unchanged", () => {
  assert.match(wizard, /fetch\("\/api\/request-proposal", \{ method: "POST", headers: \{ "Content-Type": "application\/json" \}, body: JSON\.stringify\(payload\) \}\)/);
  assert.match(wizard, /router\.push\("\/request-proposal\/success"\)/);
  assert.match(wizard, /<span>I confirm that the information provided is accurate and may be used by TERAS UNIVERSAL to respond to this enquiry\.<\/span>/);
  assert.match(wizard, /<p className="wizard-note">Privacy: we use these details to prepare and follow up on your proposal and keep a record of the request\. Submitting this form does not subscribe you to marketing emails\.<PrivacyNoticeLink newTab \/><\/p>/);
  assert.match(wizard, /if \(target === 2 && !values\.consent\) next\.consent/);
  assert.match(payloadBlock, /consent: values\.consent/);
});
check("(h) no response-time promise, certification claim or regulator name in the new copy", () => {
  const copy = JSON.stringify(proposalContent, (key, value) => (typeof value === "function" ? String(value) : value));
  assert.doesNotMatch(copy, /within|hours?\b|working day|24\/7|guarantee|certif|accredit|approved by|\b(CIDB|MOF|JKKP|DOSH|NIOSH)\b|HRD ?Corp/i);
  assert.doesNotMatch(read("content/en/proposal.js"), /training@terasuniversal/);
});
check("(i) the API route and the /request-proposal pages are unchanged", () => {
  assert.equal(sha("app/api/request-proposal/route.js"), "444572e3082786527bb3a00236ebc4d1dbee158b6ae85df9e309c3106d669ecb");
  assert.equal(sha("app/request-proposal/page.js"), "6a42b1bb39abfed358e3e0fe5bf8a18e253220bd7984676b937084ef0084b3a9");
  assert.equal(sha("app/request-proposal/success/page.js"), "70c6dcb025669dd2d567d152d63829df8885d7cefcc063de4f4873ca370f224d");
  assert.equal(sha("app/request-proposal/layout.js"), "c4b794b07eabc3934ffd7bd84a9cbd6247e92f6fb3255f7991cf62d438df2e57");
});
check("(j) the wizard stylesheet is local: every selector starts with a local class, no :global, no !important", () => {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /:global|!important|@import/);
  const selectors = [...code.matchAll(/(^|})\s*([^{}@]+)\{/g)].map(([, , selector]) => selector.trim()).filter((selector) => selector && !/^\d|^from$|^to$/.test(selector));
  for (const selector of selectors) for (const part of selector.split(",")) assert.match(part.trim(), /^\.[A-Za-z]/, part.trim());
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
if (failures) process.exitCode = 1;
