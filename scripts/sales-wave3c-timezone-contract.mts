import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { salesDateTimeLocal, taskDueDateTimeLocal } from "../lib/sales/task-queue.ts";
import { parseFollowUpDateTimeLocal } from "../lib/sales/follow-up-date.ts";
import { parseTaskDueDateTimeLocal } from "../lib/sales/task-queue.ts";
const taskForm = await readFile(new URL("../app/admin/(protected)/sales/tasks/TaskForm.tsx", import.meta.url), "utf8");
const followUpForm = await readFile(new URL("../app/admin/(protected)/sales/follow-ups/FollowUpInlineForm.tsx", import.meta.url), "utf8");
const rescheduleForm = await readFile(new URL("../app/admin/(protected)/sales/tasks/TaskQueueActions.tsx", import.meta.url), "utf8");
const taskQueue = await readFile(new URL("../lib/sales/task-queue.ts", import.meta.url), "utf8");

const utcForMalaysiaTen = "2026-10-05T02:00:00.000Z";
const expected = "2026-10-05T10:00";
assert.equal(salesDateTimeLocal(utcForMalaysiaTen), expected, "UTC instant renders as Malaysia wall-clock time");
assert.equal(taskDueDateTimeLocal(utcForMalaysiaTen), expected, "Task queue and quick-reschedule use the shared formatter");
assert.equal(salesDateTimeLocal("2026-10-04T16:30:00.000Z"), "2026-10-05T00:30", "Malaysia midnight crossing uses the next local calendar day");
assert.equal(salesDateTimeLocal(null), "");
assert.equal(salesDateTimeLocal("invalid"), "");

const previousTimezone = process.env.TZ;
process.env.TZ = "Asia/Kuala_Lumpur";
try {
  const taskStored = parseTaskDueDateTimeLocal(expected);
  const followUpStored = parseFollowUpDateTimeLocal(expected);
  assert.equal(taskStored, utcForMalaysiaTen, "Task input uses the existing local-to-UTC submission conversion");
  assert.deepEqual(followUpStored, { valid: true, value: utcForMalaysiaTen }, "Follow-up input uses its existing local-to-UTC conversion");
  assert.equal(salesDateTimeLocal(taskStored), expected, "Task input/storage/display round trip preserves MYT wall time");
  assert.equal(salesDateTimeLocal(followUpStored.value), expected, "Follow-up input/storage/display round trip preserves MYT wall time");
} finally {
  if (previousTimezone === undefined) delete process.env.TZ;
  else process.env.TZ = previousTimezone;
}

assert.match(taskForm, /salesDateTimeLocal\(d\.due_at\)/, "Task detail/edit prefill uses the shared Malaysia formatter");
assert.match(followUpForm, /salesDateTimeLocal\(followUpAt\)/, "Follow-up editor prefill uses the shared Malaysia formatter");
assert.match(rescheduleForm, /taskDueDateTimeLocal\(task\.due_at\)/, "Task quick-reschedule continues using the Malaysia formatter");
assert.match(followUpForm, /setLeadFollowUp/, "Follow-up submission keeps its existing action contract");
assert.match(taskQueue, /export function salesDateTimeLocal/, "CRM datetime-local formatting is centralized in one helper");

console.log("Sales Wave 3C Malaysia datetime-local contract: PASS");
