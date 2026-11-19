import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { trainingContent } from "../content/en/training.js";

// Phase S4C contract for the training catalogue (/training): every card comes from data/courseCatalog.js and links to a
// real course route, the filter categories come from the catalogue, the page keeps its enquiry pathways and wording, and
// no training, fee, schedule, recognition or regulatory claim is added. Static checks of repository files only.
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

const catalogueText = read("data/courseCatalog.js");
const slugs = [...catalogueText.matchAll(/\bslug: "([^"]+)"/g)].map((match) => match[1]);
const categories = [...new Set([...catalogueText.matchAll(/\bcategory: "([^"]+)"/g)].map((match) => match[1]))];
const page = read("app/training/page.js");
// Since S4C-1 the card markup is components/training/TrainingCourseCard.js (shared with the scaffolding category page).
const catalogue = read("components/training/CourseCatalogue.js");
const card = read("components/training/TrainingCourseCard.js");

check("routes: every catalogue slug is served by app/training/[slug] (generateStaticParams from the catalogue)", () => {
  assert.equal(slugs.length, 10);
  assert.ok(existsSync(new URL("app/training/[slug]/page.js", root)));
  assert.match(read("app/training/[slug]/page.js"), /generateStaticParams\(\) \{ return courseCatalog\.map\(\(\{ slug \}\) => \(\{ slug \}\)\); \}/);
});
check("cards: the page passes the whole catalogue, nothing hard-coded", () => {
  assert.match(page, /<CourseCatalogue courses=\{courseCatalog\} \/>/);
  assert.doesNotMatch(page, /slug: "/);
  for (const slug of slugs) assert.ok(!page.includes(slug) && !catalogue.includes(slug) && !card.includes(slug), slug);
});
check("cards: each card title links to its own detail route and is the card's accessible name", () => {
  assert.match(catalogue, /\{visibleCourses\.map\(\(course\) => <TrainingCourseCard key=\{course\.slug\} course=\{course\} \/>\)\}/);
  assert.match(card, /<h3><a className=\{styles\.cardLink\} href=\{`\/training\/\$\{course\.slug\}`\}>\{course\.title\}<\/a><\/h3>/);
});
check("filter: categories come from the catalogue, in catalogue order, after 'All Programmes'", () => {
  assert.match(catalogue, /\[text\.allCategories, \.\.\.new Set\(courses\.map\(\(course\) => course\.category\)\)\]/);
  assert.deepEqual(categories, ["Industrial Safety", "Scaffolding Competency"]);
  assert.equal(trainingContent.catalogue.allCategories, "All Programmes");
});
check("duration: only the catalogue's own 'N Days' value (shared rule)", () => assert.match(card, /catalogueDurationText\(course\)/));
check("pathways: corporate enquiry, custom-training card and WhatsApp keep their destinations", () => {
  assert.equal(trainingContent.hero.secondary.href, "/request-proposal?source=training-hero");
  assert.equal(trainingContent.corporate.primary.href, "/request-proposal?source=training-corporate");
  assert.equal(trainingContent.catalogue.custom.source, "training-catalogue");
  assert.match(catalogue, /enquiryHref\(\{ source: text\.custom\.source \}\)/);
  assert.match(trainingContent.corporate.whatsapp.href, /^https:\/\/wa\.me\/60195193834\?text=/);
});
check("wording: the pre-S4C headings are kept", () => {
  assert.equal(trainingContent.hero.title, "Practical Training for Safer and More Competent Workforces");
  assert.equal(trainingContent.catalogue.title, "Find a verified public course page.");
  assert.equal(trainingContent.delivery.title, "A flexible arrangement for every organisation.");
  assert.equal(trainingContent.corporate.title, "Need a Programme Built Around Your Workforce?");
  assert.equal(trainingContent.catalogue.count(1), "1 public course available");
  assert.equal(trainingContent.catalogue.count(6), "6 public courses available");
});
check("brand: the slogan is the official tagline", () => {
  assert.match(read("data/companyProfile.js"), new RegExp(`tagline: "${trainingContent.slogan.replace(/\./g, "\\.")}"`));
});
check("imagery: the existing hero illustration is captioned as AI-generated and no new image is used", () => {
  assert.equal(trainingContent.hero.image.caption, "AI-generated illustration");
  assert.equal(trainingContent.hero.image.src, "/images/v2/delivery-instructor-led-male-branded.webp");
});
check("claims: no regulatory, accreditation or certification claim in the catalogue page copy", () => {
  const copy = JSON.stringify(trainingContent, (key, value) => (typeof value === "function" ? String(value) : value));
  assert.doesNotMatch(copy, /DOSH|JKKP|CIDB|NIOSH|HRD ?Corp|accredit|certif|recogni[sz]ed|approved by/i);
});
check("cleanup: removed components have no remaining import", () => {
  for (const file of ["CourseCard.js", "CourseFactList.js", "RelatedIndustries.js", "CourseScheduleOptions.tsx", "public-phase-one.module.css"]) {
    assert.ok(!existsSync(new URL(`components/public/${file}`, root)), file);
  }
  for (const source of [page, catalogue, read("app/training/[slug]/page.js"), read("components/course/CourseSessions.tsx")]) {
    assert.doesNotMatch(source, /^import .*(CourseCard|CourseFactList|RelatedIndustries|CourseScheduleOptions)/m);
    assert.doesNotMatch(source, /^import PrimaryCtaGroup/m);
  }
  assert.doesNotMatch(read("components/public/PrimaryCtaGroup.js"), /export default/);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
