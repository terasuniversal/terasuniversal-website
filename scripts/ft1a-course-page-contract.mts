/**
 * FT-1A-2 course-page enhancement (owner-approved, 21 Nov 2026): guard contract. Reads repository files only.
 *  - photographs: only the three R2 S2-2 frozen assets (SHA-256 pinned), only for the seven courses they depict;
 *  - FAQs: exactly the six published answers, selected from data/faq.js by exact question (no new answer text);
 *  - enquiry routes: individuals -> /contact, companies -> /request-proposal, registration only through the page's own
 *    Public-First decision; no form, fetch, API, RPC or database access in the new components;
 *  - wording: no regulatory, accreditation, certification-approval or safety-assurance claims in the new copy;
 *  - the page itself: the five named edits are present exactly once (scripts/public-first-approved.mts undoes them).
 *
 * Run: node --experimental-transform-types scripts/ft1a-course-page-contract.mts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { courseContent } from "../content/en/course.js";
import { faqItems } from "../data/faq.js";
import { COURSE_PHOTOS, coursePhoto } from "../lib/course-photos.js";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

// data/courseCatalog.js imports a TypeScript module without an extension, so the slugs are read as text (as in
// scripts/home-content-contract.mts).
const catalogueSlugs = [...read("data/courseCatalog.js").matchAll(/slug: "([^"]+)"/g)].map(([, slug]) => slug);
const FROZEN: Record<string, string> = {
  "/images/v2/course-card-scaffolding-T095.webp": "25b1e307671c6e065914311fea0995eecf8c23b9338037e26f561cc191f5ff6c",
  "/images/v2/course-card-inspector-T234.webp": "3bff167b86c239f043ebcd54c3abd7be1c42b0a20ebb6d47dd053138f5f2a9e1",
  "/images/v2/course-card-wah-T495.webp": "dd474005b059401c0bc18d0f48cf7c6de90554d624f3180865ceeae29c25e3ac",
};
const MAPPING: Record<string, string> = {
  "basic-scaffolder-level-1": "/images/v2/course-card-scaffolding-T095.webp",
  "intermediate-scaffolder-level-2": "/images/v2/course-card-scaffolding-T095.webp",
  "advanced-scaffolder-level-3": "/images/v2/course-card-scaffolding-T095.webp",
  "scaffolding-inspector-basic": "/images/v2/course-card-inspector-T234.webp",
  "scaffolding-inspector-intermediate": "/images/v2/course-card-inspector-T234.webp",
  "scaffolding-inspector-advanced": "/images/v2/course-card-inspector-T234.webp",
  "working-at-height": "/images/v2/course-card-wah-T495.webp",
};
const APPROVED_FAQ = [
  "Do participants receive a certificate?",
  "Are programmes suitable for beginners?",
  "Do you provide practical training?",
  "Can training dates be arranged according to our schedule?",
  "Can training be conducted at our company site?",
  "How can we request a quotation?",
];
const NEW_COMPONENTS = ["components/course/CourseFaq.js", "components/course/CourseEnquiryPaths.js", "lib/course-photos.js"];
const CLAIMS = /\b(DOSH|JKKP|CIDB|NIOSH|MOF)\b|HRD ?Corp|accredit|approved by|certified|secured|anchored|guarantee/i;

// ---- photographs -------------------------------------------------------------------------------------------------
check("photos: exactly the seven approved courses, each mapped to its approved photograph", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(COURSE_PHOTOS).map(([slug, photo]) => [slug, (photo as { src: string }).src])), MAPPING);
  for (const slug of Object.keys(MAPPING)) assert.ok(catalogueSlugs.includes(slug), `catalogue slug ${slug}`);
  for (const slug of catalogueSlugs.filter((slug) => !(slug in MAPPING))) assert.equal(coursePhoto(slug), null, slug);
});
check("photos: served files are the frozen R2 S2-2 assets (SHA-256)", () => {
  for (const [src, sha] of Object.entries(FROZEN)) {
    const path = new URL(`public${src}`, root);
    assert.ok(existsSync(path), src);
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), sha, src);
  }
});
check("photos: alt text is descriptive, brand-free and makes no safety or certification claim", () => {
  for (const photo of Object.values(COURSE_PHOTOS) as { alt: string }[]) {
    assert.ok(photo.alt.length > 20, photo.alt);
    assert.doesNotMatch(photo.alt, CLAIMS);
    assert.doesNotMatch(photo.alt, /AI-generated|MSA|STANLEY|\bCE\b/);
  }
  assert.equal(courseContent.photoCredit, "Photograph: TERAS UNIVERSAL training, Kedah, Malaysia.");
});

// ---- published FAQs -----------------------------------------------------------------------------------------------
check("faq: exactly the six approved questions, each present word for word in data/faq.js", () => {
  assert.deepEqual(courseContent.faq.questions, APPROVED_FAQ);
  for (const question of APPROVED_FAQ) assert.equal(faqItems.filter(([, published]) => published === question).length, 1, question);
});
check("faq: the component reads data/faq.js and writes no answer of its own", () => {
  const source = read("components/course/CourseFaq.js");
  assert.match(source, /import \{ faqItems \} from "\.\.\/\.\.\/data\/faq";/);
  assert.match(source, /faqItems\.find\(\(\[, published\]\) => published === question\)/);
});

// ---- enquiry routes -----------------------------------------------------------------------------------------------
check("routes: individuals go to /contact, companies to /request-proposal, registration only via the page's decision", () => {
  assert.equal(courseContent.paths.individual.href, "/contact");
  const source = read("components/course/CourseEnquiryPaths.js");
  assert.match(source, /href=\{text\.individual\.href\}/);
  assert.match(source, /href=\{enquiryHref\(\{ course: course\.slug, source: "course-enquire" \}\)\}/);
  assert.match(source, /href=\{registerHref\}/);
  assert.match(source, /const registration = hasRegistration \? text\.registration\.open : text\.registration\.closed;/);
  assert.doesNotMatch(source, /\/registration\//);
  assert.match(courseContent.paths.individual.note, /email address is required/i);
});
check("routes: no form, fetch, API, RPC or database access in the new code", () => {
  for (const path of NEW_COMPONENTS) {
    const source = read(path);
    assert.doesNotMatch(source, /<form|fetch\(|\/api\/|\.rpc\(|supabase|createClient|action=/i, path);
  }
});
check("styling: the new components do not import the Premium kit (public-design-foundation importer list)", () => {
  for (const path of NEW_COMPONENTS) assert.doesNotMatch(read(path), /premium\.module\.css|header\.module\.css/, path);
});

// ---- wording ------------------------------------------------------------------------------------------------------
check("wording: the new copy makes no regulatory, accreditation, certification-approval or safety-assurance claim", () => {
  const { faq, paths, photoCredit, actions } = courseContent;
  const copy = JSON.stringify({ faq: { eyebrow: faq.eyebrow, title: faq.title, all: faq.all }, paths, photoCredit, enquire: actions.enquire });
  assert.doesNotMatch(copy, CLAIMS);
  assert.equal(actions.enquire, "Enquire Now");
});

// ---- the page --------------------------------------------------------------------------------------------------------
check("page: the five FT-1A-2 named edits are each present exactly once", () => {
  const page = read("app/training/[slug]/page.js");
  for (const needle of [
    'import { coursePhoto } from "../../../lib/course-photos";',
    'import CourseFaq from "../../../components/course/CourseFaq";',
    'import CourseEnquiryPaths from "../../../components/course/CourseEnquiryPaths";',
    "${styles.photoMobile}",
    "${styles.photoDesktop}",
    'href="#enquire">{text.actions.enquire}</a>',
    "<CourseFaq ",
    "<CourseEnquiryPaths ",
  ]) assert.equal(page.split(needle).length - 1, 1, needle);
  assert.match(read("scripts/public-first-approved.mts"), /const text = revertW2aAddress\(path, revertFt1a\(path, input\)\);/);
});
check("page: unmapped courses keep the existing abstract panel exactly as before", () => {
  assert.match(read("app/training/[slug]/page.js"), /<Image src=\{course\.image\} alt="" unoptimized width=\{1200\} height=\{800\} priority sizes="\(max-width: 960px\) 100vw, 40vw" \/>/);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
if (failures) process.exitCode = 1;
