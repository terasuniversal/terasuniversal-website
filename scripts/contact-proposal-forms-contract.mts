import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  CONTACT_ENQUIRY_TYPES,
  CONTACT_INTERESTS,
  PROPOSAL_CATEGORIES,
  PROPOSAL_INDUSTRIES,
  buildContactPayload,
  buildProposalPayload,
  describeSubmitFailure,
  validateContact,
  validateProposal,
} from "../lib/public-form-helpers.js";

// Contract for the public Contact and Request Proposal forms (Template 3, S3B-1).
// The forms are a presentation layer over two endpoints that this slice does not change, so the main job here is to
// prove the forms still speak the endpoints' contract: same field names, enums, required fields and payload keys.
// Synthetic inputs only; no browser, network, database or form submission.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const list = (source: string, pattern: RegExp): string[] => {
  const body = pattern.exec(source)?.[1];
  assert.ok(body, `pattern not found: ${pattern}`);
  return [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]);
};

const proposalRoute = read("app/api/request-proposal/route.js");
const contactRoute = read("app/api/contact/route.js");
const schemas = read("lib/validation/schemas.ts");

// ---- Request Proposal: the form against the route ----------------------------------------------------------------
const maxLengths = /const MAX_LENGTHS = \{([^}]+)\}/.exec(proposalRoute)?.[1] ?? "";
const routeKeys = [...maxLengths.matchAll(/(\w+):\s*\d/g)].map((match) => match[1]);
const full = {
  companyName: "Acme", contactPerson: "Aina", jobTitle: "HSE", email: "aina@example.com", phone: "0123456789", industry: "Construction", category: "Industrial Safety",
  programme: "Working at Height", participants: "20", location: "Johor", month: "2026-12", budget: "5000", objectives: "Safer work", notes: "None", consent: true, website: "",
};
const proposalPayload = buildProposalPayload(full, 1234);
check("proposal: payload carries every key the route reads", () => assert.deepEqual([...routeKeys].sort(), Object.keys(proposalPayload).filter((key) => !["consent", "website", "formStartedAt"].includes(key)).sort()));
check("proposal: payload carries consent, honeypot and form start time", () => { assert.equal(proposalPayload.consent, true); assert.equal(proposalPayload.website, ""); assert.equal(proposalPayload.formStartedAt, 1234); });
check("proposal: industries match the route list", () => assert.deepEqual(PROPOSAL_INDUSTRIES, list(proposalRoute, /const ALLOWED_INDUSTRIES = \[([^\]]+)\]/)));
check("proposal: categories match the route list", () => assert.deepEqual(PROPOSAL_CATEGORIES, list(proposalRoute, /const ALLOWED_CATEGORIES = \[([^\]]+)\]/)));
const routeRequired = list(proposalRoute, /const required = \[([^\]]+)\]/);
check("proposal: empty form reports exactly the route's required fields plus consent", () => assert.deepEqual(Object.keys(validateProposal({ consent: false })).sort(), [...routeRequired, "consent"].sort()));
check("proposal: training objectives stay required (J2)", () => assert.ok("objectives" in validateProposal({ ...full, objectives: "  " })));
check("proposal: a complete form has no errors", () => assert.deepEqual(validateProposal(full), {}));
check("proposal: optional fields may be empty", () => assert.deepEqual(validateProposal({ ...full, jobTitle: "", programme: "", participants: "", location: "", month: "", budget: "", notes: "" }), {}));
check("proposal: unknown industry and category are rejected", () => { const errors = validateProposal({ ...full, industry: "Mining", category: "Sales" }); assert.ok(errors.industry && errors.category); });
check("proposal: bad email is rejected", () => assert.ok(validateProposal({ ...full, email: "not-an-email" }).email));
check("proposal: participants must be a whole number from 1 to 1,000,000", () => {
  for (const bad of ["0", "-3", "1.5", "abc", "1000001"]) assert.ok(validateProposal({ ...full, participants: bad }).participants, bad);
  for (const good of ["1", "20", "1000000"]) assert.equal(validateProposal({ ...full, participants: good }).participants, undefined, good);
});
check("proposal: month must be year-month when given", () => { assert.ok(validateProposal({ ...full, month: "Dec 2026" }).month); assert.equal(validateProposal({ ...full, month: "2026-12" }).month, undefined); });
check("proposal: over-long text is flagged", () => assert.ok(validateProposal({ ...full, objectives: "x".repeat(3001) }).objectives));
check("proposal: consent must be exactly true", () => { assert.ok(validateProposal({ ...full, consent: "on" }).consent); assert.ok(validateProposal({ ...full, consent: false }).consent); });
check("proposal: payload trims text and keeps participants as a string", () => { const payload = buildProposalPayload({ ...full, companyName: "  Acme  ", participants: " 20 " }, 1); assert.equal(payload.companyName, "Acme"); assert.equal(payload.participants, "20"); });

// ---- Contact: the form against the schema and route --------------------------------------------------------------
const schemaBody = /export const contactEnquirySchema = z\.object\(\{([\s\S]*?)\n\}\);/.exec(schemas)?.[1] ?? "";
const schemaKeys = [...schemaBody.matchAll(/^\s{2}(\w+):/gm)].map((match) => match[1]);
const contactValues = { name: "Aina Hassan", company: "", email: "aina@example.com", phone: "0123456789", enquiryType: "Corporate", course: "Industrial Safety Training", message: "Hello", website: "" };
const contactPayload = buildContactPayload(contactValues, 99);
check("contact: payload keys are the schema keys plus honeypot and form start time", () => assert.deepEqual(Object.keys(contactPayload).sort(), [...schemaKeys, "website", "formStartedAt"].sort()));
check("contact: the select named course is sent as subject", () => assert.equal(contactPayload.subject, "Industrial Safety Training"));
check("contact: source page is contact_page, which the schema allows", () => { assert.equal(contactPayload.sourcePage, "contact_page"); assert.ok(list(schemaBody, /sourcePage: z\.enum\(\[([^\]]+)\]/).includes("contact_page")); });
check("contact: enquiry types match the schema enum", () => assert.deepEqual(CONTACT_ENQUIRY_TYPES, list(schemaBody, /enquiryType: z\.enum\(\[([^\]]+)\]/)));
check("contact: topics are non-empty and unique", () => { assert.ok(CONTACT_INTERESTS.length > 0); assert.equal(new Set(CONTACT_INTERESTS).size, CONTACT_INTERESTS.length); });
check("contact: empty form reports the required fields", () => assert.deepEqual(Object.keys(validateContact({ enquiryType: "Corporate" })).sort(), ["course", "email", "message", "name", "phone"]));
check("contact: a complete form has no errors", () => assert.deepEqual(validateContact(contactValues), {}));
check("contact: company is optional", () => assert.equal(validateContact({ ...contactValues, company: "" }).company, undefined));
check("contact: name needs 2 characters and phone needs 5 (schema minimums)", () => { assert.ok(validateContact({ ...contactValues, name: "A" }).name); assert.ok(validateContact({ ...contactValues, phone: "1234" }).phone); });
check("contact: whitespace-only values count as empty", () => { const errors = validateContact({ ...contactValues, name: "   ", message: "\n" }); assert.ok(errors.name && errors.message); });
check("contact: unknown enquiry type is rejected", () => assert.ok(validateContact({ ...contactValues, enquiryType: "Other" }).enquiryType));
check("contact: over-long message is flagged", () => assert.ok(validateContact({ ...contactValues, message: "x".repeat(3001) }).message));

// ---- Failure states (what the form shows for each response the route can give) ------------------------------------
check("failure: 429 shows the route's wait message", () => assert.match(describeSubmitFailure(429, { error: "Please wait a minute." }, "contact").message, /wait a minute/));
check("failure: 429 without a body still asks to wait", () => assert.match(describeSubmitFailure(429, {}, "proposal").message, /wait a minute/i));
check("failure: 503 outside Production says nothing was sent", () => { const { message } = describeSubmitFailure(503, { error: "Email sending is disabled in this environment.", code: "outbound_disabled_non_production" }, "contact"); assert.match(message, /not accept live submissions/); assert.match(message, /not sent/); });
check("failure: network error says nothing was sent", () => assert.match(describeSubmitFailure(0, {}, "contact").message, /not sent/));
check("failure: 403 asks for a reload", () => assert.match(describeSubmitFailure(403, { error: "Invalid request origin." }, "proposal").message, /Reload the page/));
check("failure: 400 shows the route's message and maps subject to the course field", () => {
  const failure = describeSubmitFailure(400, { error: "Please check the highlighted fields.", errors: { subject: "Please select what you're enquiring about", email: "Enter a valid email" } }, "contact");
  assert.equal(failure.message, "Please check the highlighted fields.");
  assert.equal(failure.fieldErrors.course, "Please select what you're enquiring about");
  assert.equal(failure.fieldErrors.email, "Enter a valid email");
});
check("failure: 502 uses a generic message with no server detail", () => { const { message } = describeSubmitFailure(502, { error: "relation \"enquiries\" does not exist" }, "contact"); assert.doesNotMatch(message, /relation|enquiries/); assert.match(message, /contact us directly/); });
check("failure: a response is never described as a success", () => { for (const status of [0, 400, 403, 429, 500, 502, 503]) assert.doesNotMatch(describeSubmitFailure(status, {}, "contact").message, /thank you|submitted|received/i); });

// ---- Source checks: wiring, claims and what must not change ------------------------------------------------------
const contactForm = read("components/ContactEnquiryForm.js");
const proposalForm = read("components/ProposalRequestForm.js");
const contactPage = read("app/contact/page.js");
const proposalPage = read("app/request-proposal/page.js");
const successPage = read("app/request-proposal/success/page.js");
const fieldComponent = read("components/premium/FormField.js");
// Comments explain why; the claims checks below are about what visitors read, so they look at code without comments.
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
// Includes follow-up promises ("we will contact you"): the notification email is best effort, so the pages only say what was submitted.
const unverified = /Fast Response|Experienced Trainers|Nationwide|nationwide|Customised Solutions|Industry Experience|Sunday|8:30|Business Hours|within \d+ (hour|day)|24 hours|will (review|contact|follow|get back|respond|reply)|follow up|get back to you|shortly/i;

check("contact form: posts to /api/contact only, through the shared payload builder", () => { assert.match(contactForm, /fetch\("\/api\/contact"/); assert.doesNotMatch(contactForm, /request-proposal/); assert.match(contactForm, /buildContactPayload\(/); });
check("proposal form: posts to /api/request-proposal and then to the existing success URL", () => { assert.match(proposalForm, /fetch\("\/api\/request-proposal"/); assert.match(proposalForm, /router\.push\("\/request-proposal\/success"\)/); assert.match(proposalForm, /buildProposalPayload\(/); });
check("proposal form: is single page (no wizard steps)", () => { assert.doesNotMatch(proposalForm, /setStep|steps\[|Step \d/); assert.equal(existsSync(new URL("../components/ProposalWizard.js", import.meta.url)), false); });
check("proposal form: confirmation statement is unchanged", () => assert.ok(proposalForm.includes("I confirm that the information provided is accurate and may be used by TERAS UNIVERSAL to respond to this enquiry.")));
check("forms: both keep the honeypot the endpoints check", () => { for (const source of [contactForm, proposalForm]) assert.match(source, /name="website"/); });
check("forms: no form-start-time forgery (the wizard sent Date.now() - 5000)", () => { assert.doesNotMatch(proposalForm, /Date\.now\(\)\s*-/); assert.doesNotMatch(contactForm, /Date\.now\(\)\s*-/); });
check("forms: errors are linked to their fields and announced once", () => { assert.match(fieldComponent, /aria-describedby/); assert.match(fieldComponent, /aria-invalid/); assert.doesNotMatch(fieldComponent, /role="alert"/); for (const source of [contactForm, proposalForm]) assert.match(source, /role="alert"/); });
check("forms: submit is disabled while sending and the form is marked busy", () => { for (const source of [contactForm, proposalForm]) { assert.match(source, /disabled=\{submitting\}/); assert.match(source, /aria-busy=\{submitting\}/); } });
check("forms: do not say that consent or any record is stored, or that an email was sent", () => { for (const source of [contactForm, proposalForm, successPage]) assert.doesNotMatch(code(source), /consent (has been|is|was) (stored|saved|recorded)|confirmation email|email is on its way|we have emailed/i); });
check("forms: no dangerouslySetInnerHTML and no new dependency imports", () => { for (const source of [contactForm, proposalForm, fieldComponent, contactPage, proposalPage, successPage]) { assert.doesNotMatch(source, /dangerouslySetInnerHTML/); for (const match of source.matchAll(/from "([^"]+)"/g)) assert.match(match[1], /^(\.|react|next\/)/, `unexpected import ${match[1]}`); } });
check("contact page: no embedded map (J8); the map is a user-initiated link", () => { assert.doesNotMatch(contactPage, /<iframe|maps\/embed/); assert.match(contactPage, /google\.com\/maps\/search/); assert.match(contactPage, /target="_blank" rel="noopener noreferrer"/); });
check("contact page: address, email and phone come from companyProfile (J4)", () => { assert.match(contactPage, /companyProfile\.contact/); assert.doesNotMatch(contactPage, /Jalan Tanah Merah/); assert.doesNotMatch(contactPage, /training@terasuniversal/); });
check("contact and proposal pages: no unverified claims, hours or response-time promises (J3)", () => { for (const source of [contactPage, proposalPage, successPage, contactForm, proposalForm]) assert.doesNotMatch(code(source), unverified); });
check("pages: use the premium header and inner hero", () => { for (const source of [contactPage, proposalPage, successPage]) { assert.match(source, /PremiumHeader/); assert.match(source, /InnerHero/); } });
check("success page: keeps its URL, is not indexed and makes no email claim", () => { assert.match(successPage, /robots: \{ index: false/); assert.doesNotMatch(code(successPage), /email/i); });
check("endpoints: both routes still run the preview-isolation guard before anything else", () => { assert.match(contactRoute, /outboundDecision\("email"\)/); assert.match(proposalRoute, /outboundDecision\(channel\)/); });

if (failures) { console.error(`\n${failures} semakan gagal.`); process.exit(1); }
console.log("\nSemua semakan kontrak borang Contact dan Request Proposal lulus.");
