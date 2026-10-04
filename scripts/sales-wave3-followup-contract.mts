import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseFollowUpDateTimeLocal } from "../lib/sales/follow-up-date.ts";

const actions = await readFile(new URL("../app/admin/(protected)/sales/leads/actions.ts", import.meta.url), "utf8");
const page = await readFile(new URL("../app/admin/(protected)/sales/follow-ups/page.tsx", import.meta.url), "utf8");
const form = await readFile(new URL("../app/admin/(protected)/sales/follow-ups/FollowUpInlineForm.tsx", import.meta.url), "utf8");

assert.deepEqual(parseFollowUpDateTimeLocal(""), { valid: true, value: null });
assert.deepEqual(parseFollowUpDateTimeLocal("2026-10-03T10:30"), {
  valid: true,
  value: "2026-10-03T02:30:00.000Z",
});
assert.deepEqual(parseFollowUpDateTimeLocal("2026-02-30T10:30"), { valid: false });
assert.deepEqual(parseFollowUpDateTimeLocal("not-a-date"), { valid: false });

assert.match(actions, /parseFollowUpDateTimeLocal/, "follow-up saves validate datetimes before ISO conversion");
assert.match(actions, /requireRole\("admin"\)/, "follow-up authorization remains admin-only");
assert.match(actions, /requireModuleAccess\("sales_leads"\)/, "follow-up module access remains unchanged");
assert.match(page, /from\("v_sales_lead_inbox"\)/, "follow-ups remain sourced from lead-level workflow records");
assert.doesNotMatch(page, /from\("sales_tasks"\)/, "follow-ups are not merged into task rows");
assert.match(page, /query=\{\{ view, owner \}\}/, "follow-up pagination retains view and owner");
assert.match(page, /&page=\$\{page\}/, "follow-up mutations retain the current page");
assert.match(page, /\.eq\("assigned_to", profile\.id\)/, "My Follow-ups retains the existing owner filter");
assert.match(page, /Opportunity \$\{opp\.opportunity_no\}|Source Lead/, "follow-up record links stay Opportunity-first, otherwise source Lead");
assert.doesNotMatch(page, /sales_quotations|Quotation/, "follow-ups do not fabricate a quotation relationship");
assert.match(form, /useActionState/, "inline save and clear use server actions");
assert.match(form, /disabled=\{savePending \|\| clearPending\}/, "save is disabled while either action is pending");
assert.match(form, /disabled=\{clearPending \|\| savePending\}/, "clear is disabled while either action is pending");
assert.match(form, /aria-describedby/, "follow-up field errors are associated with the input");
assert.match(form, /Reschedule/, "existing follow-ups have a clear reschedule action");
assert.match(form, /Set Follow-Up/, "new follow-ups have a clear set action");
assert.match(form, /Clear Follow-Up/, "clear action remains explicit");
assert.match(form, /name="follow_up_at" value=""/, "clear submits the existing empty-date clear action");
assert.match(actions, /Follow-up saved\./, "successful follow-up updates retain the save message");
assert.match(actions, /Follow-up cleared\./, "clear retains its distinct success message");

console.log("Sales Wave 3 follow-up contract: PASS");
