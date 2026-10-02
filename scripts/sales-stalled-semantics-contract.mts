import assert from "node:assert/strict";
import { register } from "node:module";
import type { SalesTaskRow } from "../lib/sales/crm.ts";

const loader = `export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\\.(?:c|m)?[jt]s$/.test(specifier)) {
      return nextResolve(specifier + ".ts", context);
    }
    throw error;
  }
}`;
register(`data:text/javascript,${encodeURIComponent(loader)}`, import.meta.url);

const { isStalledOpportunity } = await import("../lib/sales/opportunity-pipeline.ts");

const NOW = new Date("2026-10-02T04:00:00.000Z");
const EIGHT_DAYS_BEFORE_NOW = "2026-09-24T04:00:00.000Z";
const OLD_OPEN_OPPORTUNITY = { stage: "qualified" as const, created_at: EIGHT_DAYS_BEFORE_NOW };
const recentActivity = (created_at: string) => [{ opportunity_id: "opp-1", created_at }];

function makeTask(overrides: Partial<SalesTaskRow> = {}): SalesTaskRow {
  return {
    id: "task-1",
    title: "Follow up",
    description: null,
    status: "open",
    priority: "medium",
    due_at: null,
    assigned_to: null,
    lead_metadata_id: null,
    opportunity_id: "opp-1",
    quotation_id: null,
    created_by: null,
    completed_at: null,
    created_at: "2026-09-23T12:00:00.000Z",
    updated_at: "2026-09-23T12:00:00.000Z",
    deleted_at: null,
    ...overrides,
  };
}

const taskCases: Array<{ name: string; tasks: SalesTaskRow[]; expectedStalled: boolean }> = [
  { name: "no task leaves an old open opportunity stalled", tasks: [], expectedStalled: true },
  { name: "future active task prevents stalled status", tasks: [makeTask({ due_at: "2026-10-03T04:00:00.000Z" })], expectedStalled: false },
  { name: "due-today active task later today prevents stalled status", tasks: [makeTask({ due_at: "2026-10-02T10:00:00.000Z" })], expectedStalled: false },
  { name: "active task due exactly at NOW prevents stalled status", tasks: [makeTask({ due_at: NOW.toISOString() })], expectedStalled: false },
  { name: "overdue active task does not prevent stalled status", tasks: [makeTask({ due_at: "2026-10-01T15:59:59.000Z" })], expectedStalled: true },
  { name: "active task with null due date does not prevent stalled status", tasks: [makeTask({ due_at: null })], expectedStalled: true },
  { name: "completed future-dated task does not prevent stalled status", tasks: [makeTask({ status: "completed", due_at: "2026-10-03T04:00:00.000Z" })], expectedStalled: true },
  { name: "cancelled future-dated task does not prevent stalled status", tasks: [makeTask({ status: "cancelled", due_at: "2026-10-03T04:00:00.000Z" })], expectedStalled: true },
  { name: "deleted future-dated task does not prevent stalled status", tasks: [makeTask({ due_at: "2026-10-03T04:00:00.000Z", deleted_at: "2026-09-24T05:00:00.000Z" })], expectedStalled: true },
];

for (const { name, tasks, expectedStalled } of taskCases) {
  assert.equal(isStalledOpportunity(OLD_OPEN_OPPORTUNITY, tasks, [], NOW), expectedStalled, name);
}

const ageCases: Array<{ name: string; latestActivityAt: string; expectedStalled: boolean }> = [
  { name: "activity 6 days 23:59:59 ago is not stalled by age", latestActivityAt: "2026-09-25T04:00:01.000Z", expectedStalled: false },
  { name: "activity exactly 7 days ago is not stalled by age", latestActivityAt: "2026-09-25T04:00:00.000Z", expectedStalled: false },
  { name: "activity 7 days and 1 second ago is stalled by age", latestActivityAt: "2026-09-25T03:59:59.000Z", expectedStalled: true },
  { name: "activity exactly 8 days ago is stalled by age", latestActivityAt: "2026-09-24T04:00:00.000Z", expectedStalled: true },
];

for (const { name, latestActivityAt, expectedStalled } of ageCases) {
  assert.equal(isStalledOpportunity(OLD_OPEN_OPPORTUNITY, [], recentActivity(latestActivityAt), NOW), expectedStalled, name);
}

console.log("Sales stalled-opportunity semantics contract: PASS (9 task cases; 4 age boundaries).");
