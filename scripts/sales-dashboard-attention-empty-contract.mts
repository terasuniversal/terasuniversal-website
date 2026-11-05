import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// B1 contract: the Sales dashboard shows a compact "all clear" state in Work Requiring Attention only when all
// four attention metrics are numeric zero. A positive count or a failed ("Unavailable") metric keeps all four
// cards and their links. Queries and counting logic are untouched. Static source checks; rendering is covered by QA.

const raw = await readFile("app/admin/(protected)/sales/page.tsx", "utf8");
const src = raw.replace(/\r\n/g, "\n");

// 1. The compact state needs every metric to be exactly zero. countValue() maps an error or null count to
// "Unavailable", so `=== 0` is false for failed metrics and the cards stay visible.
assert.match(src, /const countValue = \(result: \{ count: number \| null; error: unknown \}\) => result\.error \|\| result\.count == null \? "Unavailable" : result\.count;/, "countValue still maps failures to Unavailable");
assert.match(
  src,
  /const attentionAllClear = \[overdueFollowUpsResult, followUpsDueTodayResult, overdueTasksMetric, tasksDueTodayMetric\]\.every\(\(metric\) => countValue\(metric\) === 0\);/,
  "all-clear needs all four attention metrics to be numeric zero",
);
assert.ok(!/attentionAllClear\s*=[^;]*(\|\||some\()/.test(src), "all-clear is not an OR/some of the metrics");

// 2. The message and the links.
assert.match(src, /Nothing overdue or due today\. Follow-ups and tasks are up to date\./, "approved message text");
assert.match(src, /<Link className="ta-btn ta-btn-outline ta-btn-sm" href="\/admin\/sales\/follow-ups">View follow-ups<\/Link>/, "follow-ups queue stays reachable");
assert.match(src, /<Link className="ta-btn ta-btn-outline ta-btn-sm" href="\/admin\/sales\/tasks">View tasks<\/Link>/, "tasks queue stays reachable");

// 3. Otherwise all four cards render exactly as before, with their links.
const afterCond = src.split("{attentionAllClear ? (")[1] ?? "";
const elseBranch = afterCond.split(") : (")[1]?.split("            )}")[0] ?? "";
for (const [label, href] of [
  ["Overdue Follow-ups", "/admin/sales/follow-ups?view=overdue"],
  ["Follow-ups Due Today", "/admin/sales/follow-ups?view=today"],
  ["Overdue Tasks", "/admin/sales/tasks?view=overdue"],
  ["Tasks Due Today", "/admin/sales/tasks?view=today"],
] as const) {
  assert.ok(elseBranch.includes(`label="${label}"`) && elseBranch.includes(`attention href="${href}"`), `${label} card and link are kept when not all clear`);
}
assert.equal((elseBranch.match(/<SalesMetricCard /g) ?? []).length, 4, "exactly four attention cards in the non-empty branch");

// 4. Heading, description and the oldest-overdue section are preserved.
assert.match(src, /<h2 id="sales-attention-heading">Work Requiring Attention<\/h2>/, "heading kept");
assert.match(src, /Overdue and due-today follow-ups and tasks, using the same boundaries as their queues\./, "description kept");
assert.match(src, /Oldest overdue follow-ups/, "oldest overdue section kept");
assert.match(src, /No overdue follow-ups\./, "existing empty line under the table kept");

// 5. No query or business-rule change: the attention queries still use the same boundaries.
assert.match(src, /\.lt\("follow_up_at", nowIso\)/, "overdue follow-up boundary unchanged");
assert.match(src, /\.gte\("follow_up_at", nowIso\)[\s\S]{0,40}\.lt\("follow_up_at", endOfTodayMyt\)/, "due-today follow-up boundary unchanged");
assert.match(src, /\.lt\("due_at", nowIso\)/, "overdue task boundary unchanged");
assert.match(src, /\.gte\("due_at", nowIso\)[\s\S]{0,40}\.lt\("due_at", endOfTodayMyt\)/, "due-today task boundary unchanged");

console.log("Sales dashboard attention empty-state contract passed.");
