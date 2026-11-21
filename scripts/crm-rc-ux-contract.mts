import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRM release-candidate UX/permission-messaging contract (UAT U0/U1 findings). Static only: no database.
// Each check pins one finding so a regression reintroducing the old behaviour fails here.
const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n  ${(e as Error).message.split("\n")[0]}`); }
}

const staffForm = read("app/admin/(protected)/users/StaffUserForm.tsx");
const staffActions = read("app/admin/(protected)/users/actions.ts");
const noAccess = read("app/admin/no-access/page.tsx");
const noAccessSignOut = read("app/admin/no-access/NoAccessSignOut.tsx");
const login = read("app/admin/login/actions.ts");
const nav = read("lib/admin-nav.ts");
const quotePanel = read("app/admin/(protected)/sales/quotations/[id]/QuotationActionsPanel.tsx");
const quotePage = read("app/admin/(protected)/sales/quotations/[id]/page.tsx");
const quoteList = read("app/admin/(protected)/sales/quotations/page.tsx");
const taskPage = read("app/admin/(protected)/sales/tasks/[id]/page.tsx");
const taskForm = read("app/admin/(protected)/sales/tasks/TaskForm.tsx");
const taskActions = read("app/admin/(protected)/sales/tasks/actions.ts");
const followUps = read("app/admin/(protected)/sales/follow-ups/page.tsx");
const leadActions = read("app/admin/(protected)/sales/leads/actions.ts");
const leadForm = read("app/admin/(protected)/sales/leads/LeadCreateForm.tsx");
const leadPanel = read("app/admin/(protected)/sales/leads/[id]/LeadActionsPanel.tsx");
const oppPanel = read("app/admin/(protected)/sales/opportunities/[id]/OpportunityActionsPanel.tsx");
const itemsEditor = read("app/admin/(protected)/sales/quotations/QuotationItemsEditor.tsx");

check("Staff Users: per-module None/View/Edit select replaces the checkbox", () => {
  assert.match(staffForm, /<option value="none">None<\/option>/);
  assert.match(staffForm, /<option value="view">/);
  assert.match(staffForm, /<option value="edit" disabled=\{viewOnly\}>/);
  assert.doesNotMatch(staffForm, /type="checkbox" name="module_key"/);
  assert.match(staffForm, /<input type="hidden" name="module_key" value=\{module\.key\} \/>/);
});
check("Staff Users: Admin level is only offered where already saved (no broadening)", () => {
  assert.match(staffForm, /savedAdminKeys\.has\(module\.key\) \|\| current === "admin"/);
});
check("Staff Users: server still forces HRDF to view for non-admin targets and still accepts only view/edit/admin", () => {
  assert.match(staffActions, /module_key === "hrdf_claims" && targetIsNonAdmin\s*\n?\s*\? "view"/);
  assert.match(staffActions, /const moduleAccessLevels = \["view", "edit", "admin"\] as const;/);
});
check("Landing: one helper picks the first module the user can open, in sidebar order", () => {
  assert.match(nav, /export function firstAccessibleHref\(/);
  assert.match(nav, /visibleNavGroups\(role, moduleKeys, accessControlEnabled\)/);
  assert.match(login, /firstAccessibleHref\(profile\.role, allowed, true\) \?\? "\/admin\/no-access"/);
  assert.doesNotMatch(login, /allowed\.includes\("news"\) \? "\/admin\/news"/);
});
check("No Access: offers an authorized destination and a working Sign out", () => {
  assert.match(noAccess, /firstAccessibleHref\(/);
  assert.match(noAccess, /<NoAccessSignOut \/>/);
  assert.doesNotMatch(noAccess, /href="\/admin\/dashboard"/);
  assert.match(noAccessSignOut, /auth\.signOut\(\)/);
  assert.match(noAccessSignOut, /router\.push\("\/admin\/login"\)/);
  assert.match(noAccess, /export const dynamic = "force-dynamic"/);
});
check("Quotation: denial message names the exact missing requirement", () => {
  assert.match(quotePanel, /deniedReason\?: string;/);
  assert.match(quotePage, /Creating an invoice requires Invoices Edit access\./);
  assert.match(quotePage, /You have view-only access to Quotations\. Status changes require Edit access\./);
  assert.doesNotMatch(quotePanel, /Status changes require Admin access with edit permission for this module\./);
});
check("Opportunity links are rendered only for users who can open Opportunities", () => {
  assert.match(quotePage, /hasModuleAccess\("sales_opportunities"\)/);
  assert.match(quotePage, /canViewOpportunities \? <Link href=\{`\/admin\/sales\/opportunities\/\$\{opportunity\.id\}`\}>/);
  assert.match(quoteList, /const canViewOpportunities = await hasModuleAccess\("sales_opportunities"\);/);
  assert.equal((quoteList.match(/canViewOpportunities \? <Link/g) ?? []).length, 2);
  assert.match(taskPage, /hasModuleAccess\("sales_leads"\)\)/);
});
check("Task: read-only reason distinguishes View access from not being the owner", () => {
  assert.match(taskPage, /You have view-only access to Tasks\. Changes require Edit access\./);
  assert.match(taskPage, /\{readOnlyReason\}/);
  assert.doesNotMatch(taskPage, /staffNames\.get\(t\.assigned_to\) \?\? "—"/);
});
check("Task: Save returns to the task detail with an 'updated' notice", () => {
  assert.match(taskForm, /name="return_mode" value="detail"/);
  assert.match(taskActions, /redirect\(taskActionReturnHref\(formData, taskId, "updated"\)\);/);
});
check("Follow-ups: message distinguishes View-only Admins from non-Admins", () => {
  assert.match(followUps, /You have view-only access to Leads\. Changing follow-up dates requires Leads Edit access\./);
  assert.doesNotMatch(followUps, /Only an Admin can change follow-up dates\. Open a lead/);
});
check("Create Lead: typed values survive a failed submit; no raw RPC text", () => {
  assert.match(leadActions, /values\?: Record<string, string>;/);
  assert.match(leadActions, /return \{ errors: fieldErrors\(parsed\.error\), values \};/);
  assert.doesNotMatch(leadActions, /return \{ message: error\?\.message \?\? "Unable to create the lead\." \};/);
  assert.match(leadActions, /You don't have permission to create leads\./);
  for (const f of ["contact_name", "company_name", "email", "phone", "course_interest", "notes", "attribution_notes"]) {
    assert.match(leadForm, new RegExp(`defaultValue=\\{v\\.${f} \\?\\? ""\\}`), f);
  }
});
check("No window.confirm() in Sales action panels (in-page confirmation instead)", () => {
  for (const [n, t] of [["quotation", quotePanel], ["opportunity", oppPanel], ["lead", leadPanel]] as const) {
    assert.doesNotMatch(t.replace(/\/\/[^\n]*|\{\/\*[\s\S]*?\*\/\}/g, ""), /\bconfirm\(/, n);
  }
  assert.match(quotePanel, /name="confirm_accept" required/);
  assert.match(oppPanel, /name="confirm_lost" required/);
});
check("Quotation form explains prefilled customer fields", () => {
  assert.match(itemsEditor, /Prefilled from the opportunity and lead\./);
});

const uiKit = read("components/admin/ui/index.tsx");
check("F-UAT-1: an existing invoice is reported before the create-invoice permission message", () => {
  const i = quotePanel.indexOf('if (status === "accepted" && hasExistingInvoice)');
  const j = quotePanel.indexOf('deniedReason ?? "Status changes require');
  assert.ok(i > 0 && j > i, "existing-invoice branch must precede the denied message");
  const branch = quotePanel.slice(i, j);
  assert.ok(branch.includes("An invoice already exists for this quotation."));
  assert.ok(branch.includes("{existingInvoiceId && <Link href={`/admin/invoices/${existingInvoiceId}`}"));
});
check("F-UAT-2: a field error replaces its hint (no duplicate Email-or-phone message)", () => {
  assert.ok(uiKit.includes("{hint && !error && <small id={hintId}"));
  assert.ok(uiKit.includes("hint && !error ? hintId : null"));
});
check("F-UAT-3: completed/cancelled tasks are read-only in the UI and in updateTask", () => {
  assert.ok(taskPage.includes('const isClosed = t.status === "completed" || t.status === "cancelled";'));
  assert.ok(taskPage.includes("canManage && isClosed ? ("));
  assert.ok(taskActions.includes("Completed or cancelled tasks are read-only. Reopen the task to edit it."));
  assert.ok(taskActions.includes('.in("status", ["open", "in_progress"])'));
});

console.log(`${passed} check(s) passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed) process.exit(1);
