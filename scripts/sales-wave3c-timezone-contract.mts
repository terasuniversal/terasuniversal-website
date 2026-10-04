import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { salesDateTimeLocal, taskDueDateTimeLocal } from "../lib/sales/task-queue.ts";
import { parseFollowUpDateTimeLocal } from "../lib/sales/follow-up-date.ts";
import { parseTaskDueDateTimeLocal } from "../lib/sales/task-queue.ts";
const taskForm = await readFile(new URL("../app/admin/(protected)/sales/tasks/TaskForm.tsx", import.meta.url), "utf8");
const followUpForm = await readFile(new URL("../app/admin/(protected)/sales/follow-ups/FollowUpInlineForm.tsx", import.meta.url), "utf8");
const leadActionsPanel = await readFile(new URL("../app/admin/(protected)/sales/leads/[id]/LeadActionsPanel.tsx", import.meta.url), "utf8");
const rescheduleForm = await readFile(new URL("../app/admin/(protected)/sales/tasks/TaskQueueActions.tsx", import.meta.url), "utf8");
const taskQueue = await readFile(new URL("../lib/sales/task-queue.ts", import.meta.url), "utf8");

const inputs = ["2026-10-05T10:00", "2026-10-05T00:15", "2026-12-31T23:30"];
const expectedUtc = [
  "2026-10-05T02:00:00.000Z",
  "2026-10-04T16:15:00.000Z",
  "2026-12-31T15:30:00.000Z",
];
const serverTimezones = ["UTC", "Asia/Kuala_Lumpur", "America/New_York"];

if (process.argv.includes("--timezone-probe")) {
  console.log(JSON.stringify({
    serverTimezone: process.env.TZ ?? null,
    legacyLocalParse: new Date(inputs[0]).toISOString(),
    parserResults: {
      task: inputs.map(parseTaskDueDateTimeLocal),
      followUp: inputs.map(parseFollowUpDateTimeLocal),
      prefill: salesDateTimeLocal("2026-10-05T02:00:00Z"),
      taskEmpty: parseTaskDueDateTimeLocal(""),
      followUpEmpty: parseFollowUpDateTimeLocal(""),
      taskMalformed: parseTaskDueDateTimeLocal("2026-02-30T10:00"),
      followUpMalformed: parseFollowUpDateTimeLocal("2026-02-30T10:00"),
      taskWithOffset: parseTaskDueDateTimeLocal("2026-10-05T10:00Z"),
      followUpWithOffset: parseFollowUpDateTimeLocal("2026-10-05T10:00Z"),
    },
  }));
} else {
  const timezoneResults = serverTimezones.map((timezone) => {
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), "--timezone-probe"],
      { env: { ...process.env, TZ: timezone }, encoding: "utf8" },
    );
    assert.equal(child.status, 0, `${timezone} parser process exits successfully: ${child.stderr}`);
    return JSON.parse(child.stdout.trim());
  });

  assert.deepEqual(timezoneResults.map(({ serverTimezone }) => serverTimezone), serverTimezones, "each child process receives its requested TZ");
  assert.deepEqual(timezoneResults.map(({ legacyLocalParse }) => legacyLocalParse), [
    "2026-10-05T10:00:00.000Z",
    "2026-10-05T02:00:00.000Z",
    "2026-10-05T14:00:00.000Z",
  ], "child process timezones are observably distinct for server-local datetime parsing");
  assert.deepEqual(timezoneResults[1].parserResults, timezoneResults[0].parserResults, "MYT and UTC server processes return identical parser results");
  assert.deepEqual(timezoneResults[2].parserResults, timezoneResults[0].parserResults, "New York and UTC server processes return identical parser results");
  const { parserResults: result } = timezoneResults[0];

  for (let index = 0; index < inputs.length; index += 1) {
    assert.equal(result.task[index], expectedUtc[index], `Task input ${inputs[index]} stores the MYT instant`);
    assert.deepEqual(result.followUp[index], { valid: true, value: expectedUtc[index] }, `Follow-up input ${inputs[index]} stores the MYT instant`);
    assert.equal(result.task[index], result.followUp[index].value, "Task and Follow-up parsers agree");
  }

  assert.equal(result.prefill, "2026-10-05T10:00", "UTC instant prefills as the Malaysia wall-clock time");
  assert.equal(taskDueDateTimeLocal("2026-10-05T02:00:00Z"), "2026-10-05T10:00", "Task quick-reschedule keeps Malaysia prefill formatting");
  assert.equal(salesDateTimeLocal("2026-10-04T16:30:00.000Z"), "2026-10-05T00:30", "Malaysia midnight crossing uses the next local calendar day");
  assert.equal(salesDateTimeLocal(null), "");
  assert.equal(salesDateTimeLocal("invalid"), "");
  assert.equal(result.taskEmpty, null, "Empty task input retains its existing null behavior");
  assert.deepEqual(result.followUpEmpty, { valid: true, value: null }, "Empty follow-up input retains its existing nullable behavior");
  assert.equal(result.taskMalformed, null, "Malformed task input remains invalid");
  assert.deepEqual(result.followUpMalformed, { valid: false }, "Malformed follow-up input remains invalid");
  assert.equal(result.taskWithOffset, null, "Task parser rejects a value containing a timezone suffix");
  assert.deepEqual(result.followUpWithOffset, { valid: false }, "Follow-up parser rejects a value containing a timezone suffix");
  assert.match(taskForm, /salesDateTimeLocal\(d\.due_at\)/, "Task detail/edit prefill uses the shared Malaysia formatter");
assert.match(followUpForm, /salesDateTimeLocal\(followUpAt\)/, "Follow-up editor prefill uses the shared Malaysia formatter");
assert.match(rescheduleForm, /taskDueDateTimeLocal\(task\.due_at\)/, "Task quick-reschedule continues using the Malaysia formatter");
assert.match(followUpForm, /setLeadFollowUp/, "Follow-up submission keeps its existing action contract");
assert.match(leadActionsPanel, /salesDateTimeLocal\(followUpAt\)/, "Lead detail follow-up prefill uses the shared Malaysia formatter");
assert.match(taskQueue, /export function salesDateTimeLocal/, "CRM datetime-local formatting is centralized in one helper");

console.log("Sales Wave 3C Malaysia datetime-local contract: PASS");
}
