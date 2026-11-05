import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";

// Sales Phase 4B Slice 1: a lead is Won only through accept_quotation(), and
// follow-up forms are offered only to roles that may submit them.

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

const { leadStatusChangeBlock, selectableLeadStatuses, LEAD_WON_VIA_QUOTATION_MESSAGE } = await import("../lib/sales/lead-status.ts");
const { CRM_STATUS_ORDER } = await import("../lib/sales/crm.ts");
const { canAccessModule, isAdmin } = await import("../lib/auth/rbac.ts");

// 1. The rule: only a transition INTO won is refused.
for (const current of ["new", "contacted", "qualified", "proposal_sent", "negotiation", "lost", "archived", null, undefined]) {
  assert.equal(leadStatusChangeBlock(current, "won"), LEAD_WON_VIA_QUOTATION_MESSAGE, `${current} -> won must be refused`);
}
assert.equal(leadStatusChangeBlock("won", "won"), null, "re-submitting won is not a transition");
for (const next of CRM_STATUS_ORDER.filter((s: string) => s !== "won")) {
  for (const current of CRM_STATUS_ORDER) assert.equal(leadStatusChangeBlock(current, next), null, `${current} -> ${next} stays allowed`);
}

// 2. The select: won is offered only while the lead already has it; nothing else is lost.
const others = CRM_STATUS_ORDER.filter((s: string) => s !== "won");
for (const current of others) assert.deepEqual(selectableLeadStatuses(current), others, `${current}: no won option`);
assert.deepEqual(selectableLeadStatuses("won"), CRM_STATUS_ORDER, "a won lead still shows its saved status");
assert.ok(others.includes("lost") && others.includes("archived"), "lost and archived remain selectable");

// 3. Role facts the follow-up gating relies on.
assert.equal(isAdmin("admin"), true);
assert.equal(isAdmin("super_admin"), true);
assert.equal(isAdmin("editor"), false);
assert.equal(canAccessModule("editor", "sales_followups", [], false), true, "editors still see the follow-up queue");

// 4. Wiring.
const read = (file: string) => readFile(file, "utf8");
const [actions, panel, page] = await Promise.all([
  read("app/admin/(protected)/sales/leads/actions.ts"),
  read("app/admin/(protected)/sales/leads/[id]/LeadActionsPanel.tsx"),
  read("app/admin/(protected)/sales/follow-ups/page.tsx"),
]);

const statusAction = actions.slice(actions.indexOf("export async function updateLeadStatus"), actions.indexOf("export async function assignLead"));
assert.match(statusAction, /requireRole\("admin"\)/, "status change still requires admin");
const order = ["requireRole(\"admin\")", "salesLeadStatusSchema.safeParse", "leadStatusChangeBlock(", ".update(patch)"].map((needle) => statusAction.indexOf(needle));
assert.ok(order.every((i) => i >= 0) && order.every((i, n) => n === 0 || i > order[n - 1]), "guard, validate, won check, then write");
assert.match(statusAction, /if \(blocked\) return \{ message: blocked \}/, "won refusal returns a message");
assert.match(statusAction, /currentLead\.status === "won" && status === "won"\) return \{\}/, "re-submitting won keeps the original won_at");
assert.match(statusAction, /status === "lost" \? lost_reason : null/, "mark lost path is unchanged");
assert.match(statusAction, /\.update\(patch\)\.eq\("id", leadMetadataId\)\.eq\("status", currentLead\.status\)\.select\("id"\)/, "the write is conditional on the status that was checked");
assert.match(statusAction, /if \(!updated\) return \{ message: "This lead changed while you were working/, "a lost race is reported, not silently ignored");

assert.ok(!/Mark Won/.test(panel), "no Mark Won button");
assert.ok(!/quickSetStatus|statusFormRef|requestSubmit/.test(panel), "the one-click won submit is gone");
assert.match(panel, /selectableLeadStatuses\(status\)/, "status select hides won");
assert.match(panel, /Mark Lost/, "Mark Lost is kept");
assert.match(panel, /convertLeadToOpportunity/, "convert flow is kept");

assert.match(page, /const canSchedule = isAdmin\(profile\.role\)/, "follow-ups page decides by role");
assert.equal((page.match(/<FollowUpInlineForm/g) ?? []).length, 1, "the form is rendered in exactly one place, behind canSchedule");
assert.match(page, /canSchedule \?[\s\S]*?<FollowUpInlineForm[\s\S]*?\) : \(/, "form only when canSchedule");
assert.equal((page.match(/followUpControl\(l\)/g) ?? []).length, 2, "table and card layouts both use the gated control");
assert.match(page, /requireRole\("editor"\)/, "the page is still open to editors");
const followUpAction = actions.slice(actions.indexOf("export async function setLeadFollowUp"), actions.indexOf("const QUALIFICATION_REASON_SET"));
assert.match(followUpAction, /requireRole\("admin"\)/, "scheduling still requires admin on the server");

console.log("Sales lead-won guard contract passed.");
