import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { estimateAssessmentRowHeightMm, paginateAssessmentRows } from "../lib/documents/assessmentPagination.ts";

const root = process.cwd();
const route = fs.readFileSync(path.join(root, "app/admin/(protected)/assessment/[scheduleId]/export/route.ts"), "utf8");

const short = { name: "Short Name", remarks: "OK", competency: "COMPETENT" };
const medium = { name: "Medium Participant Name", remarks: "Review practical handling and confirm the next observation.", competency: "COMPETENT" };
const multiline = { name: "Participant With A Longer Name", remarks: "Line one\nLine two\nLine three", competency: "NOT YET COMPETENT" };
const veryLong = { name: "Participant With An Extremely Long Synthetic Participant Name That Must Wrap Safely", remarks: "Long synthetic remarks that represent a detailed assessment observation and must wrap within the formal report without being truncated or pushed outside the page boundary. ".repeat(5), competency: "NOT YET COMPETENT" };
const unbroken = { name: "AssessmentParticipantNameWithAnExtremelyLongUnbrokenSyntheticToken", remarks: "AssessmentRemarksWithAnExtremelyLongUnbrokenSyntheticToken".repeat(4), competency: "COMPETENT" };

const heights = [short, medium, multiline, veryLong, unbroken].map((row) => estimateAssessmentRowHeightMm(row));
assert.ok(heights[0] >= 8);
assert.ok(heights[1] >= heights[0]);
assert.ok(heights[2] > heights[0]);
assert.ok(heights[3] > heights[2]);
assert.ok(heights[4] > heights[0]);

const makeRows = (row: typeof short, count: number) => Array.from({ length: count }, (_, i) => ({
  value: { ...row, name: `${row.name} ${i + 1}`, heightMm: estimateAssessmentRowHeightMm(row) },
  heightMm: estimateAssessmentRowHeightMm(row),
}));
const options = { firstPageHeightMm: 144, continuationPageHeightMm: 171, finalPageReserveMm: 23, firstPageSafetyMm: 48 };

const shortPages = paginateAssessmentRows(makeRows(short, 36), options);
const mixedPages = paginateAssessmentRows([
  ...makeRows(short, 12),
  ...makeRows(medium, 6),
  ...makeRows(multiline, 6),
  ...makeRows(veryLong, 6),
  ...makeRows(unbroken, 6),
], options);
const oversizedPages = paginateAssessmentRows([{ value: veryLong, heightMm: 260 }, ...makeRows(short, 2)], options);

assert.equal(shortPages.length, 3, "normal 36-row baseline remains a 3-page report");
assert.ok(mixedPages.length > shortPages.length, "mixed content consumes additional page budget");
assert.ok(oversizedPages.every((page) => page.length > 0), "oversized row pagination has no empty pages");
assert.equal(oversizedPages.flat().length, 3, "oversized row pagination preserves every row exactly once");
assert.ok(mixedPages.every((page) => page.length > 0), "mixed pagination has no empty pages");
assert.equal(mixedPages.flat().length, 36, "mixed pagination preserves every row exactly once");
for (let count = 1; count <= 150; count += 1) {
  const pages = paginateAssessmentRows(makeRows(short, count), options);
  const last = pages.at(-1) ?? [];
  const lastHeight = last.reduce((sum, row) => sum + row.heightMm, 0);
  if (pages.length > 1) assert.ok(lastHeight + options.finalPageReserveMm <= options.continuationPageHeightMm, `final reserve respected at ${count} rows`);
  assert.ok(pages.every((page) => page.length > 0), `no empty page at ${count} rows`);
  assert.equal(pages.flat().length, count, `all rows preserved at ${count} rows`);
}
assert.deepEqual(
  paginateAssessmentRows(makeRows(multiline, 20), options),
  paginateAssessmentRows(makeRows(multiline, 20), options),
  "pagination is deterministic",
);

assert.match(route, /estimateAssessmentRowHeightMm/);
assert.match(route, /paginateAssessmentRows/);
assert.match(route, /td\.asm-name, td\.asm-group, td\.asm-remarks/);
assert.match(route, /Page \$\{pageIndex \+ 1\} of \$\{printPages\.length\}/);
assert.match(route, /ASSESSMENT RESULT/);
assert.match(route, /Assessment Record/);
assert.match(route, /Theory Score/);
assert.match(route, /Theory Result/);
assert.match(route, /Practical Score/);
assert.match(route, /Practical Result/);
assert.match(route, /Overall Result/);
assert.match(route, /Competency Status/);
assert.match(route, /maskIdentification/);
assert.doesNotMatch(route, /ROW_HEIGHT_MM/);
assert.doesNotMatch(route, /participant_skill_results/);

console.log("Assessment Functional Fix 3C-A pagination contract checks passed");
