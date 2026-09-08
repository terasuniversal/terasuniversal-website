import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const homepage = await readFile("app/page.js", "utf8");
const catalogue = await readFile("data/courseCatalog.js", "utf8");

assert.match(homepage, /const publicScheduleSlug = \(session\) =>/);
assert.match(homepage, /course\.crmCourseId && course\.crmCourseId === session\.course_id/);
assert.match(homepage, /course\.slug === session\.slug/);
assert.match(homepage, /href=\{scheduleSlug \?/);
assert.doesNotMatch(homepage, /href=\{session\.slug \?/);
assert.match(catalogue, /slug: "intermediate-scaffolder-level-2"[\s\S]*?crmCourseId: "904293c4-8792-41d7-8744-42143887e577"/);

console.log("Phase 3 homepage course-route checker: PASS");
