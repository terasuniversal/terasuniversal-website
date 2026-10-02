import assert from "node:assert/strict";
import { normalizeTaskQueueContext, parseTaskDueDateTimeLocal, resolveTaskRelatedRecord, taskActionReturnHref, taskQueueFeedbackMessage, taskQueueReturnHref, taskDueDateTimeLocal, taskStatusTransition } from "../lib/sales/task-queue.ts";
import { clampPage, pageCountFor, pageRange } from "../lib/sales/pagination.ts";
import { readFile } from "node:fs/promises";

const taskActions = await readFile(new URL("../app/admin/(protected)/sales/tasks/actions.ts", import.meta.url), "utf8");
const taskPage = await readFile(new URL("../app/admin/(protected)/sales/tasks/page.tsx", import.meta.url), "utf8");
const taskForm = await readFile(new URL("../app/admin/(protected)/sales/tasks/TaskForm.tsx", import.meta.url), "utf8");
const taskQueueActions = await readFile(new URL("../app/admin/(protected)/sales/tasks/TaskQueueActions.tsx", import.meta.url), "utf8");
const taskDetail = await readFile(new URL("../app/admin/(protected)/sales/tasks/[id]/page.tsx", import.meta.url), "utf8");
const adminCss = await readFile(new URL("../app/admin/admin.css", import.meta.url), "utf8");

const staffId = "123e4567-e89b-42d3-a456-426614174000";
const context = normalizeTaskQueueContext({ view: "upcoming", owner: staffId, q: "  audit, follow-up  ", page: "3" });
assert.deepEqual(context, { view: "upcoming", owner: staffId, q: "audit, follow-up", page: 3 });

const returnHref = taskQueueReturnHref(context, "completed");
const returned = new URL(returnHref, "https://internal.invalid");
assert.equal(returned.pathname, "/admin/sales/tasks");
assert.equal(returned.searchParams.get("view"), "upcoming");
assert.equal(returned.searchParams.get("owner"), staffId);
assert.equal(returned.searchParams.get("q"), "audit, follow-up");
assert.equal(returned.searchParams.get("page"), "3");
assert.equal(returned.searchParams.get("feedback"), "completed");

const queueActionForm = new FormData();
queueActionForm.set("return_mode", "queue");
queueActionForm.set("return_view", "upcoming");
queueActionForm.set("return_owner", staffId);
queueActionForm.set("return_q", "audit & follow-up");
queueActionForm.set("return_page", "3");
queueActionForm.set("return_to", "https://external.invalid/redirect");
const actionReturn = new URL(taskActionReturnHref(queueActionForm, staffId, "updated"), "https://internal.invalid");
assert.equal(actionReturn.origin, "https://internal.invalid", "action return path cannot be redirected externally");
assert.equal(actionReturn.pathname, "/admin/sales/tasks");
assert.equal(actionReturn.searchParams.get("q"), "audit & follow-up");
assert.equal(actionReturn.searchParams.get("page"), "3");

const detailActionForm = new FormData();
detailActionForm.set("return_mode", "detail");
detailActionForm.set("return_view", "today");
detailActionForm.set("return_owner", staffId);
detailActionForm.set("return_q", "customer follow-up");
detailActionForm.set("return_page", "3");
const detailReturn = new URL(taskActionReturnHref(detailActionForm, staffId, "completed"), "https://internal.invalid");
assert.equal(detailReturn.pathname, `/admin/sales/tasks/${staffId}`);
assert.equal(detailReturn.searchParams.get("feedback"), "completed");
assert.equal(detailReturn.searchParams.get("view"), "today");
assert.equal(detailReturn.searchParams.get("owner"), staffId);
assert.equal(detailReturn.searchParams.get("q"), "customer follow-up");
assert.equal(detailReturn.searchParams.get("page"), "3");
assert.equal(taskQueueFeedbackMessage("toString"), null, "unknown feedback keys must not read object prototypes");
assert.equal(taskQueueFeedbackMessage("not-a-task-feedback"), null);

const invalidContext = normalizeTaskQueueContext({ view: "//evil.invalid", owner: "all/../admin", q: "  ", page: "0" });
assert.deepEqual(invalidContext, { view: "all", owner: "mine", q: undefined, page: 1 });
const longSearch = "q".repeat(250);
assert.equal(normalizeTaskQueueContext({ q: longSearch }).q, longSearch, "return context preserves existing search text");

assert.equal(parseTaskDueDateTimeLocal("2026-10-03T10:30"), new Date("2026-10-03T10:30").toISOString());
assert.equal(taskDueDateTimeLocal("2026-10-03T02:30:00.000Z"), "2026-10-03T10:30", "UTC timestamps render as Malaysia local time in the queue editor");
assert.equal(parseTaskDueDateTimeLocal("2026-02-30T10:30"), null);
assert.equal(parseTaskDueDateTimeLocal("not-a-date"), null);
assert.equal(parseTaskDueDateTimeLocal(""), null);

assert.deepEqual(resolveTaskRelatedRecord({ lead_metadata_id: "lead-1", opportunity_id: null, quotation_id: null }), {
  kind: "lead", id: "lead-1", href: "/admin/sales/leads/lead-1",
});
assert.deepEqual(resolveTaskRelatedRecord({ lead_metadata_id: null, opportunity_id: "opp-1", quotation_id: null }), {
  kind: "opportunity", id: "opp-1", href: "/admin/sales/opportunities/opp-1",
});
assert.deepEqual(resolveTaskRelatedRecord({ lead_metadata_id: null, opportunity_id: null, quotation_id: "quote-1" }), {
  kind: "quotation", id: "quote-1", href: "/admin/sales/quotations/quote-1",
});
assert.equal(resolveTaskRelatedRecord({ lead_metadata_id: null, opportunity_id: null, quotation_id: null }), null);

assert.equal(taskStatusTransition("open", "completed"), "apply");
assert.equal(taskStatusTransition("in_progress", "completed"), "apply");
assert.equal(taskStatusTransition("completed", "completed"), "already_completed");
assert.equal(taskStatusTransition("cancelled", "completed"), "invalid");
assert.equal(taskStatusTransition("open", "in_progress"), "apply");
assert.equal(taskStatusTransition("completed", "open"), "apply");
assert.equal(taskStatusTransition("cancelled", "open"), "apply");

assert.equal(pageCountFor(101), 3);
assert.deepEqual(pageRange(3), { from: 100, to: 149 });
assert.equal(clampPage(2, pageCountFor(101)), 2, "quick actions on a normal page preserve the current page");
const lastPageCompleteHref = new URL(taskActionReturnHref(queueActionForm, staffId, "completed"), "https://internal.invalid");
const queueAfterLastVisibleCompletion = normalizeTaskQueueContext(Object.fromEntries(lastPageCompleteHref.searchParams));
assert.equal(queueAfterLastVisibleCompletion.page, 3, "completion redirect preserves the page before the queue reload");
assert.equal(pageCountFor(100), 2, "completing the last visible task reduces total results and page count");
assert.equal(clampPage(queueAfterLastVisibleCompletion.page, pageCountFor(100)), 2, "reloaded queue clamps the preserved page after completion reduces the count");

assert.match(taskActions, /taskStatusTransition/, "Task status actions must use the existing transition helper");
assert.match(taskActions, /taskActionReturnHref/, "Task status actions must build safe internal return paths");
assert.match(taskActions, /requireRole\("editor"\)/, "Task actions retain the editor role gate");
assert.match(taskActions, /requireModuleAccess\("sales_tasks"\)/, "Task actions retain the sales_tasks module gate");
assert.match(taskActions, /You do not have permission to change this task/, "status action retains owner/creator/Admin authorization");
assert.match(taskActions, /task_completed/, "Completion retains the existing activity event");
assert.match(taskActions, /activity-warning/, "activity-write failures are surfaced after the status update");
assert.match(taskActions, /formData\.get\("intent"\) === "reschedule"/, "rescheduling uses the existing updateTask server action");
assert.match(taskActions, /parseTaskDueDateTimeLocal/, "invalid reschedule datetimes are rejected by the server action");
assert.match(taskActions, /eq\("status", task\.status\)/, "reschedule and status updates reject stale transitions");
assert.match(taskPage, /TaskQueueActions/, "Task rows expose quick actions");
assert.match(taskPage, /const VIEWS: readonly TaskQueueView\[\] = \["today", "overdue", "upcoming", "completed", "all"\]/, "priority task views are surfaced first without removing All Open");
assert.match(taskPage, /clampPage\(requestedPage, pageCount\)/, "Task queue clamps the requested page after mutations");
assert.match(taskPage, /count: "exact"/, "Task queue retains exact-count pagination");
assert.match(taskPage, /mytEndOfTodayUtc/, "Task view boundaries remain based on existing MYT helper");
assert.match(taskPage, /\.order\("id", \{ ascending: true \}\)/, "Task list keeps its deterministic ID tie-breaker");
assert.match(taskPage, /<TaskTitle task=\{t\} \/>/, "task descriptions are exposed as compact secondary context");
assert.match(taskPage, /Source Lead/, "lead-linked tasks remain directly navigable without loading additional lead fields");
assert.doesNotMatch(taskPage, /from\("v_sales_lead_inbox"\)/, "task list does not cross-read lead PII outside the linked task scope");
assert.match(taskPage, /<ReadErrorState/, "failed Task reads remain distinct from empty results");
assert.match(taskQueueActions, /setTaskStatus\.bind\(null, task\.id, "completed"\)/, "quick complete invokes the existing transition action");
assert.match(taskQueueActions, /useActionState/, "quick actions expose server action errors and pending state");
assert.match(taskQueueActions, /disabled=\{busy\}/, "quick actions prevent repeat submissions while pending");
assert.match(taskQueueActions, /aria-label=\{`Complete task:/, "complete button has a task-specific accessible label");
assert.match(taskQueueActions, /aria-describedby/, "reschedule validation error is associated with its input");
assert.match(taskQueueActions, /className="ta-alert ta-alert-error" role="alert"/, "task action failures are announced beside their controls");
assert.match(taskDetail, /normalizeTaskQueueContext/, "task detail validates list return state");
assert.match(taskDetail, /returnContext=\{returnContext\}/, "task edit receives its validated return context");
assert.match(adminCss, /@media \(max-width: 1100px\)/, "task and follow-up cards replace wide tables at tablet widths");
assert.match(adminCss, /ta-task-actions button \{ min-height: 36px/, "task actions have a deliberate desktop hit area");
assert.match(adminCss, /ta-followup-inline button \{ min-height: 36px/, "follow-up actions have a deliberate desktop hit area");
assert.match(adminCss, /@media \(max-width: 620px\)[\s\S]*ta-task-actions button \{ min-height: 44px/, "task actions meet the mobile hit-area treatment");
assert.match(adminCss, /@media \(max-width: 620px\)[\s\S]*ta-followup-inline button \{ min-height: 44px/, "follow-up actions meet the mobile hit-area treatment");
assert.match(taskForm, /return_view/, "Task edit form preserves the queue view");
assert.match(taskForm, /return_owner/, "Task edit form preserves the owner filter");
assert.match(taskForm, /return_q/, "Task edit form preserves search");
assert.match(taskForm, /return_page/, "Task edit form preserves page");
assert.match(taskForm, /never offers a picker/, "generic task creation remains unlinked unless opened from a Sales record");

console.log("Sales Wave 3 task contract: PASS");
