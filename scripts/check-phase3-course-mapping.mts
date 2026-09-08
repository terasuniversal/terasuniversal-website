import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const catalog = await readFile(new URL("../data/courseCatalog.js", import.meta.url), "utf8");
const coursePage = await readFile(new URL("../app/training/[slug]/page.js", import.meta.url), "utf8");

assert.match(catalog, /slug: "intermediate-scaffolder-level-2"[\s\S]*crmCourseId: "904293c4-8792-41d7-8744-42143887e577"/);
assert.match(coursePage, /course\.crmCourseId[\s\S]*session\.course_id === \(course\.crmCourseId \|\| canonicalCourse\.id\)/);
assert.doesNotMatch(coursePage, /includes\(|startsWith\(|\.title\.toLowerCase\(\)/);

console.log("Phase 3 course mapping checks passed: explicit CRM course ID is primary and legacy matching is exact-only.");
