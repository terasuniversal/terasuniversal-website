import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const homepage = await readFile("app/page.js", "utf8");
const catalogue = await readFile("data/courseCatalog.js", "utf8");

// Phase S4B: the CRM-first mapping moved to lib/course-session-map.ts (equivalence proven by
// scripts/course-session-map-contract.mts). Since S2B/S3 the homepage builds its course link as a row field
// (courseHref) instead of an inline href={scheduleSlug ? ...}; the intent is unchanged: links use the mapped public
// slug, never the raw RPC slug.
const mapping = await readFile("lib/course-session-map.ts", "utf8");
assert.match(homepage, /const publicScheduleCourse = \(session\) => catalogueCourseForSession\(session, courseCatalog\)/);
assert.match(mapping, /course\.crmCourseId && course\.crmCourseId === session\.course_id/);
assert.match(mapping, /course\.slug === session\.slug/);
assert.match(homepage, /courseHref: scheduleSlug \? `\/training\/\$\{scheduleSlug\}`/);
assert.doesNotMatch(homepage, /session\.slug \? `\/training/);
assert.match(catalogue, /slug: "intermediate-scaffolder-level-2"[\s\S]*?crmCourseId: "904293c4-8792-41d7-8744-42143887e577"/);

console.log("Phase 3 homepage course-route checker: PASS");
