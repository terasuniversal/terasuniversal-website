import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { SCAFFOLDING_CATEGORY, coursesInCategory, scaffoldingPathways } from "../lib/training-categories.ts";
import { scaffoldingContent } from "../content/en/scaffolding.js";

// Phase S4C-1 (owner Option A): /training/scaffolding-competency is a category page for the courses the verified
// catalogue classifies as "Scaffolding Competency". Proves the selection is exactly six catalogue entries (no invented,
// renamed, duplicated or silently excluded course), that their identifiers are intact, that every card links to its
// existing course route, and that the former unverified programme content and any new claim are absent.
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

// The real catalogue, read from source text (plain Node cannot import data/courseCatalog.js).
type Course = { slug: string; title: string; category: string; crmCourseId?: string; duration?: string; summary: boolean };
const catalogue: Course[] = read("data/courseCatalog.js").split(/(?=\bslug: ")/).slice(1).map((chunk) => {
  const field = (key: string) => new RegExp(`\\b${key}: "([^"]+)"`).exec(chunk)?.[1];
  return { slug: field("slug")!, title: field("title") ?? "", category: field("category") ?? "", crmCourseId: field("crmCourseId"), duration: field("duration"), summary: /\bsummary: (?:"|wah\.)/.test(chunk) };
});
const selected = coursesInCategory(catalogue, SCAFFOLDING_CATEGORY);

check("catalogue: 10 entries, unique slugs", () => {
  assert.equal(catalogue.length, 10);
  assert.equal(new Set(catalogue.map((course) => course.slug)).size, 10);
});
check("selection: exactly six courses carry the catalogue category 'Scaffolding Competency'", () => {
  assert.equal(SCAFFOLDING_CATEGORY, "Scaffolding Competency");
  assert.equal(selected.length, 6);
  for (const course of selected) assert.equal(course.category, SCAFFOLDING_CATEGORY, course.slug);
  assert.equal(catalogue.filter((course) => course.category !== SCAFFOLDING_CATEGORY).length, 4);
});
check("selection: the six are, in catalogue order, the entries recorded in the S4C-1 evidence", () => {
  assert.deepEqual(selected.map((course) => course.slug), ["basic-scaffolder-level-1", "intermediate-scaffolder-level-2", "advanced-scaffolder-level-3", "scaffolding-inspector-basic", "scaffolding-inspector-intermediate", "scaffolding-inspector-advanced"]);
});
check("identifiers: slugs unique, titles as catalogued, the CRM identity kept on its course", () => {
  assert.equal(new Set(selected.map((course) => course.slug)).size, 6);
  assert.equal(selected.find((course) => course.slug === "intermediate-scaffolder-level-2")?.crmCourseId, "904293c4-8792-41d7-8744-42143887e577");
  for (const course of selected) assert.ok(read("data/courseCatalog.js").includes(`title: "${course.title}"`), course.title);
});
check("facts: every selected course has a catalogue summary and a duration stated in days", () => {
  for (const course of selected) {
    assert.ok(course.summary, `${course.slug} summary`);
    assert.match(course.duration ?? "", /^\d+ Days?$/, course.slug);
  }
});
check("pathways: three scaffolding and three inspection courses, disjoint, covering all six, in catalogue order", () => {
  const { scaffolding, inspection } = scaffoldingPathways(selected);
  assert.equal(scaffolding.length, 3);
  assert.equal(inspection.length, 3);
  assert.deepEqual([...scaffolding, ...inspection].map((course) => course.slug).sort(), selected.map((course) => course.slug).sort());
  for (const course of inspection) assert.ok(course.title.startsWith("Scaffolding Inspector"), course.title);
  for (const course of scaffolding) assert.ok(!course.title.startsWith("Scaffolding Inspector"), course.title);
});

const page = read("app/training/scaffolding-competency/page.js");
const card = read("components/training/TrainingCourseCard.js");
check("page: courses come from the catalogue through the shared selection, one card each, no duplicates", () => {
  assert.match(page, /const courses = coursesInCategory\(courseCatalog, SCAFFOLDING_CATEGORY\);/);
  assert.match(page, /\{list\.map\(\(course\) => <TrainingCourseCard key=\{course\.slug\} course=\{course\} \/>\)\}/);
  assert.equal((page.match(/<TrainingCourseCard /g) ?? []).length, 1);
  for (const course of catalogue) assert.ok(!page.includes(course.slug) && !page.includes(course.title), course.slug);
});
check("links: each card links to its existing course route, named by the course title", () => {
  assert.match(card, /<h3><a className=\{styles\.cardLink\} href=\{`\/training\/\$\{course\.slug\}`\}>\{course\.title\}<\/a><\/h3>/);
  assert.ok(existsSync(new URL("app/training/[slug]/page.js", root)));
  assert.match(read("app/training/[slug]/page.js"), /generateStaticParams\(\) \{ return courseCatalog\.map/);
});
check("pathways and CTAs: course list, catalogue, calendar and corporate enquiry keep existing destinations", () => {
  assert.equal(scaffoldingContent.hero.toCourses.href, "#scaffolding-courses");
  assert.match(page, /id="scaffolding-courses"/);
  assert.equal(scaffoldingContent.hero.toCatalogue.href, "/training");
  assert.equal(scaffoldingContent.guidance.calendar.href, "/calendar");
  assert.equal(scaffoldingContent.corporate.primary.href, "/request-proposal");
  assert.equal(scaffoldingContent.corporate.corporate.href, "/corporate-training");
  assert.equal(scaffoldingContent.corporate.whatsapp.href, "https://wa.me/60195193834");
});
check("registration: the category page offers no registration link and no payment logic of its own", () => {
  assert.doesNotMatch(page, /\/registration\/|describeSession|sessionKind|payment|toyyibpay/i);
});
check("route: unchanged, and still linked from the homepage card, the menu, the sitemap and site search", () => {
  assert.match(read("content/en/home.js"), /href: "\/training\/scaffolding-competency"/);
  for (const path of ["components/MegaNav.js", "app/sitemap.js", "components/SiteSearch.js"]) assert.ok(read(path).includes("/training/scaffolding-competency"), path);
});
check("content: the former unverified programme content is gone", () => {
  const sources = page + JSON.stringify(scaffoldingContent, (key, value) => (typeof value === "function" ? String(value) : value));
  for (const legacy of ["Participants should be able to", "Introduction to Scaffolding", "Need Analysis", "Training Methodology", "Is this programme suitable for beginners", "training@terasuniversal.com.my", "A structured training pathway", "Competency-Based Learning", "Certification Note"]) {
    assert.ok(!sources.includes(legacy), legacy);
  }
});
check("claims: no regulatory, accreditation, certification, level or progression claim in the category copy", () => {
  const copy = JSON.stringify(scaffoldingContent, (key, value) => (typeof value === "function" ? String(value) : value));
  assert.doesNotMatch(copy, /DOSH|JKKP|CIDB|NIOSH|HRD ?Corp|accredit|certif|recogni[sz]ed|approved by|qualif|prerequisite|progress to|leads to|level \d/i);
  assert.equal(scaffoldingContent.hero.title, "Scaffolding Training");
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
