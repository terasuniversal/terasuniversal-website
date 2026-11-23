import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogueCourseForSession, catalogueDurationText, sessionsForCourse } from "../lib/course-session-map.ts";

// Phase S4B: proves the shared course-to-session mapping returns exactly what the three pre-S4B inline implementations
// returned, and that the pages now use it. Synthetic sessions only; no database or network.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

// The real catalogue (slug, title, crmCourseId, duration), read from source text because plain Node cannot import
// data/courseCatalog.js (it imports a TypeScript module without an extension).
type Course = { slug: string; title: string; crmCourseId?: string; duration?: string };
const catalogueText = read("data/courseCatalog.js");
const chunks = catalogueText.split(/(?=\bslug: ")/).slice(1);
const catalogue: Course[] = chunks.map((chunk) => {
  const slug = /slug: "([^"]+)"/.exec(chunk)![1];
  const title = /title: "([^"]+)"/.exec(chunk)?.[1] ?? "";
  const crmCourseId = /crmCourseId: "([^"]+)"/.exec(chunk)?.[1];
  const duration = /duration: "([^"]+)"/.exec(chunk)?.[1];
  return { slug, title, ...(crmCourseId ? { crmCourseId } : {}), ...(duration ? { duration } : {}) };
});
check("catalogue: all 10 courses read, including the one CRM identity", () => {
  assert.equal(catalogue.length, 10);
  assert.equal(catalogue.filter((course) => course.crmCourseId).length, 1);
  assert.equal(catalogue.find((course) => course.slug === "working-at-height")?.duration, "2 Days");
});

// ---- pre-S4B implementations, copied from the S4A files (docs/S4B/baseline-s4a/); only courseCatalog is renamed catalogue --
// app/page.js
const legacyHomepageSlug = (session: any) => {
  const byCrmId = catalogue.find((course) => course.crmCourseId && course.crmCourseId === session.course_id);
  if (byCrmId) return byCrmId.slug;
  return catalogue.find((course) => course.slug === session.slug)?.slug ?? null;
};
const legacyHomepageDuration = (course: any) => (course && /^\d+\s+Days?$/i.test(course.duration) ? course.duration : null);
// app/calendar/page.js (findCourse(slug) is catalogue.find((course) => course.slug === slug))
const legacyCalendarCourse = (session: any) =>
  catalogue.find((course) => course.crmCourseId && course.crmCourseId === session.course_id) ?? catalogue.find((course) => course.slug === session.slug) ?? null;
const legacyCalendarDuration = (course: any) => (course && /^\d+\s+Days?$/i.test(course.duration) ? course.duration : null);
// app/training/[slug]/page.js (without its date filter, which stays in the page)
const legacyCourseSessions = (course: any, canonicalCourse: any, publicSchedules: any[]) => publicSchedules.filter((session) => (
  course.crmCourseId || canonicalCourse
    ? session.course_id === (course.crmCourseId || canonicalCourse.id)
    : session.slug === course.slug || session.title === course.title
));

// ---- synthetic sessions: every catalogue route plus the edge cases ---------------------------------------------------
const crm = "904293c4-8792-41d7-8744-42143887e577";
const sessions = [
  ...catalogue.map((course, index) => ({ id: `slug-${index}`, course_id: `unknown-${index}`, slug: course.slug, title: course.title })),
  { id: "crm-other-slug", course_id: crm, slug: "intermediate-scaffolder", title: "Intermediate Scaffolder (Level 2)" },
  { id: "crm-null-slug", course_id: crm, slug: null, title: "Anything" },
  { id: "crm-wins-over-slug", course_id: crm, slug: "working-at-height", title: "Working at Height" },
  { id: "title-only", course_id: "unknown-t", slug: null, title: "Safety Passport" },
  { id: "unmapped", course_id: "unknown-u", slug: "not-a-course", title: "QA Fixture Unmapped Course" },
  { id: "null-everything", course_id: "", slug: null, title: "" },
  { id: "wah-by-id", course_id: "qa-course-wah", slug: "working-at-height", title: "Working at Height" },
];

check("equivalence: catalogueCourseForSession = homepage publicScheduleSlug for every session", () => {
  for (const session of sessions) assert.equal(catalogueCourseForSession(session, catalogue)?.slug ?? null, legacyHomepageSlug(session), session.id);
});
check("equivalence: catalogueCourseForSession = calendar catalogueCourse for every session (same object)", () => {
  for (const session of sessions) assert.equal(catalogueCourseForSession(session, catalogue), legacyCalendarCourse(session), session.id);
});
check("equivalence: catalogueDurationText = homepage and calendar duration rules for every course and null", () => {
  for (const course of [...catalogue, null, { slug: "x" }, { slug: "y", duration: "Course duration to be confirmed based on scope" }, { slug: "z", duration: "1 Day" }]) {
    assert.equal(catalogueDurationText(course as any), legacyHomepageDuration(course), JSON.stringify(course));
    assert.equal(catalogueDurationText(course as any), legacyCalendarDuration(course), JSON.stringify(course));
  }
});
check("equivalence: sessionsForCourse = course page filter for every course, with and without a resolved course row", () => {
  for (const course of catalogue) {
    for (const canonical of [null, undefined, { id: crm }, { id: "qa-course-wah" }, { id: "unknown-0" }]) {
      assert.deepEqual(sessionsForCourse(course, canonical, sessions).map((s) => s.id), legacyCourseSessions(course, canonical, sessions).map((s) => s.id), `${course.slug} ${JSON.stringify(canonical)}`);
    }
  }
});
check("behaviour: the CRM identity wins over the session slug, and its public slug is returned", () => {
  assert.equal(catalogueCourseForSession({ course_id: crm, slug: "working-at-height" }, catalogue)?.slug, "intermediate-scaffolder-level-2");
  assert.equal(catalogueCourseForSession({ course_id: "x", slug: "not-a-course" }, catalogue), null);
});

// ---- the pages use the shared module (and no longer carry their own copy) ------------------------------------------
const homepage = read("app/page.js");
const calendarPage = read("app/calendar/page.js");
const coursePage = read("app/training/[slug]/page.js");
check("usage: homepage, calendar and course page import lib/course-session-map", () => {
  for (const [name, source] of [["homepage", homepage], ["calendar", calendarPage], ["course page", coursePage]] as const) assert.match(source, /from "(\.\.\/)+lib\/course-session-map"/, name);
  assert.match(homepage, /catalogueCourseForSession\(session, courseCatalog\)/);
  assert.match(calendarPage, /catalogueCourseForSession\(session, courseCatalog\)/);
  assert.match(coursePage, /sessionsForCourse\(course, canonicalCourse, publicSchedules\)/);
});
check("usage: no page keeps an inline copy of the mapping or the duration rule", () => {
  for (const [name, source] of [["homepage", homepage], ["calendar", calendarPage], ["course page", coursePage]] as const) {
    assert.doesNotMatch(source, /course\.crmCourseId && course\.crmCourseId === session\.course_id/, name);
    assert.doesNotMatch(source, /\/\^\\d\+\\s\+Days\?\$\/i/, name);
  }
});
check("scope: the course page keeps its own upcoming-date filter and data access", () => {
  // W3-a (owner-approved W3-G1): the identity is derived from the sessions already loaded (scripts/w3-approved.mts).
  assert.match(coursePage, /= await getPublishedSchedulesWithState\(\);\r?\n[^\n]*\r?\n\s*const canonicalCourse = courseIdentityFromSchedules\(course\.slug, publicSchedules\);/);
  assert.match(coursePage, /session\.start_date >= new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
});

console.log(failures ? `\n${failures} semakan GAGAL` : "\nSemua semakan LULUS");
process.exit(failures ? 1 : 0);
