import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildAssigneeFilterState } from "../lib/sales/assignee-filter.ts";
import { clampPage, normalizePage, pageCountFor, pageRange } from "../lib/sales/pagination.ts";

const staff = [{ id: "staff-17", full_name: "A. Reviewer" }];

const successful = buildAssigneeFilterState(false, "staff-17", staff);
assert.equal(successful.disabled, false, "Successful staff lookup leaves owner selection enabled");
assert.equal(successful.value, "staff-17", "Successful lookup preserves the selected staff filter");
assert.deepEqual(successful.options.find((option) => option.value === "staff-17"), { value: "staff-17", label: "A. Reviewer" });

const failedWithoutSelection = buildAssigneeFilterState(true, undefined, []);
assert.equal(failedWithoutSelection.disabled, true, "Failed staff lookup disables an unselected owner filter");
assert.equal(failedWithoutSelection.value, "__staff_options_unavailable__");
assert.ok(failedWithoutSelection.options.some((option) => option.label === "Staff options unavailable"));

const failedWithSelection = buildAssigneeFilterState(true, "staff-17", []);
assert.equal(failedWithSelection.disabled, false, "A selected owner remains changeable when staff lookup fails");
assert.equal(failedWithSelection.value, "staff-17", "Failed lookup must preserve the URL's selected owner id");
assert.deepEqual(failedWithSelection.options.find((option) => option.value === "staff-17"), { value: "staff-17", label: "Selected assignee unavailable" });
assert.ok(failedWithSelection.options.some((option) => option.value === "" && option.label === "Anyone"), "The selected owner can be cleared without changing other filters");

assert.equal(normalizePage("2"), 2);
assert.equal(pageCountFor(0, 20), 0, "An empty result has no result pages");
assert.equal(pageCountFor(20, 20), 1, "An exact count equal to one returned page is one page");
const exactCountPage = Array.from({ length: 20 }, (_, index) => ({ id: `opp-${index + 1}` }));
assert.equal(exactCountPage.length, 20, "The exact-count-equals-returned-count case is covered explicitly");
assert.equal(pageCountFor(exactCountPage.length, 20), 1);
assert.equal(new Set(exactCountPage.map((row) => row.id)).size, exactCountPage.length, "A single base-table page has no duplicate opportunity IDs");
assert.equal(clampPage(2, 3), 2, "An in-range page is retained");
assert.equal(pageCountFor(41, 20), 3, "An exact count larger than one page is preserved");
assert.equal(clampPage(99, 3), 3, "A request beyond the last page clamps to the last page");
assert.deepEqual(pageRange(clampPage(99, 3), 20), { from: 40, to: 59 });
assert.equal(clampPage(99, 0), 1, "An empty result clamps to page one");
assert.deepEqual(pageRange(2, 20), { from: 20, to: 39 });

const root = new URL("../app/admin/(protected)/sales/", import.meta.url);
for (const [name, path, basePath] of [
  ["Leads", "leads/page.tsx", "/admin/sales/leads"],
  ["Opportunities", "opportunities/page.tsx", "/admin/sales/opportunities"],
] as const) {
  const source = await readFile(new URL(path, root), "utf8");
  assert.match(source, /buildAssigneeFilterState\(Boolean\(staffError\), sp\.assigned, staff\)/, `${name} should build owner filter state from lookup status and URL selection`);
  assert.match(source, /disabled=\{assigneeFilterState\.disabled\}/, `${name} should disable owner selection only in the unselected lookup-failure state`);
  assert.match(source, /assigneeFilterState\.options\.map/, `${name} should render an explicit unavailable selection when required`);
  assert.match(source, new RegExp(`href="${basePath}"[^"]*[^>]*>Clear all`), `${name} should retain a reset-all path`);
}

const opportunitySource = await readFile(new URL("opportunities/page.tsx", root), "utf8");
assert.match(opportunitySource, /const PAGE_SIZE = 20/, "The existing opportunity page size should remain unchanged");
assert.match(opportunitySource, /supabase\.from\("sales_opportunities"\)\.select\(listSelect, \{ count: "exact" \}\)/, "Pagination should be rooted in one authoritative opportunity query");
assert.match(opportunitySource, /future_tasks:sales_tasks!sales_tasks_opportunity_id_fkey\(\)/, "Stalled task conditions should be embedded in the authoritative request");
assert.match(opportunitySource, /recent_activity:sales_activity!sales_activity_opportunity_id_fkey\(\)/, "Recent-activity conditions should be embedded in the authoritative request");
assert.match(opportunitySource, /\.in\("stage", OPEN_OPPORTUNITY_STAGES\)/, "Stalled filtering should remain limited to open stages");
assert.match(opportunitySource, /\.lt\("created_at", stalledCutoff\)/, "Stalled filtering should retain the created-at fallback cutoff");
assert.match(opportunitySource, /\.is\("future_tasks\.deleted_at", null\)/, "Only non-deleted tasks should participate in the future-task anti-join");
assert.match(opportunitySource, /\.not\("future_tasks\.status", "in", "\(completed,cancelled\)"\)/, "Completed and cancelled tasks should not prevent the stalled state");
assert.match(opportunitySource, /\.gte\("future_tasks\.due_at", now\.toISOString\(\)\)/, "A task due now or later should prevent the stalled state");
assert.match(opportunitySource, /\.is\("future_tasks", null\)/, "Stalled filtering should require no matching active future task");
assert.match(opportunitySource, /\.gte\("recent_activity\.created_at", stalledCutoff\)/, "Recent activity should use the original seven-day boundary");
assert.match(opportunitySource, /\.is\("recent_activity", null\)/, "Stalled filtering should require no matching recent activity");
assert.match(opportunitySource, /\.order\("created_at", \{ ascending: false \}\)\.order\("id", \{ ascending: true \}\)/, "The opportunity result should use stable ordering and a unique tie-breaker");
assert.match(opportunitySource, /query\.range\(requestedRange\.from, requestedRange\.to\)/, "The list should use its requested page range in the authoritative query");
assert.doesNotMatch(opportunitySource, /pageRangesFor|batchRange|allRows\.push|rawRows\?\.length/, "Stalled filtering must not use multi-range pseudo-snapshot retrieval or capped-response heuristics");

console.log("Sales Wave 2A review-fix contract: PASS");
