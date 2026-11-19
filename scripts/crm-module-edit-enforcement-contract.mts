import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// PR-S1 (F1): the Owner's policy is None = no access, View = strictly read-only, Edit = module
// mutation. requireModuleAccess() defaults to "view", so every mutating Server Action must ask
// for "edit" (or the stronger "admin") explicitly. Page guards stay at view and are not checked here.

const root = new URL("../", import.meta.url);
// Comments are stripped so prose that mentions a guard is never mistaken for the guard itself.
const read = (path: string) =>
  readFileSync(new URL(path, root), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

let failures = 0;
let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}\n  ${(error as Error).message}`);
  }
}

// Top-level function blocks of a file, keyed by name; each block runs to the next top-level function.
function functionBlocks(source: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const starts = [...source.matchAll(/^(?:export )?(?:async )?function (\w+)/gm)];
  starts.forEach((match, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : source.length;
    blocks.set(match[1], source.slice(match.index, end));
  });
  return blocks;
}

const guardCalls = (body: string) => [...body.matchAll(/requireModuleAccess\(([^)]*)\)/g)].map((m) => m[1].trim());

const ACTION_FILES = [
  "app/admin/(protected)/sales/leads/actions.ts",
  "app/admin/(protected)/sales/leads/[id]/personal-registration/actions.ts",
  "app/admin/(protected)/sales/opportunities/actions.ts",
  "app/admin/(protected)/sales/quotations/actions.ts",
  "app/admin/(protected)/sales/tasks/actions.ts",
  "app/admin/(protected)/invoices/actions.ts",
  "app/admin/(protected)/invoices/toyyibpayActions.ts",
  "app/admin/(protected)/invoices/[id]/actions.ts",
  "app/admin/(protected)/marketing/campaigns/actions.ts",
  "app/admin/(protected)/marketing/contacts/actions.ts",
  "app/admin/(protected)/companies/actions.ts",
  "app/admin/(protected)/schedules/actions.ts",
];

// Read-only exports and read-only lookups that legitimately stay at view.
const VIEW_ALLOWED: Record<string, string[]> = {
  "app/admin/(protected)/sales/opportunities/actions.ts:searchCompaniesForLink": ['"sales_opportunities"'],
  // Choosing an assessor reads the assessor list; the schedule write itself needs schedules "admin".
  "app/admin/(protected)/schedules/actions.ts:setScheduleAssessor": ['"assessors"'],
};

for (const file of ACTION_FILES) {
  const source = read(file);
  check(`${file} is a Server Action module`, () => assert.match(source, /^"use server";/));
  for (const [name, body] of functionBlocks(source)) {
    const calls = guardCalls(body);
    if (calls.length === 0) continue;
    const allowed = VIEW_ALLOWED[`${file}:${name}`] ?? [];
    check(`${file} ${name}: every module guard requires edit or admin`, () => {
      for (const args of calls) {
        if (allowed.includes(args)) continue;
        assert.match(args, /^"[a-z_]+", "(edit|admin)"$/, `requireModuleAccess(${args}) would admit View-only users`);
      }
    });
  }
}

// Every exported action in these files must be guarded, directly or through a shared guard helper.
const SHARED_GUARDS = /requireModuleAccess\(|requireRegistrationAccess\(|transitionCampaign\(|transitionContactStatus\(/;
for (const file of ACTION_FILES) {
  const source = read(file);
  for (const [name, body] of functionBlocks(source)) {
    if (!new RegExp(`^export async function ${name}\\b`, "m").test(body)) continue;
    check(`${file} ${name}: has a module guard`, () => assert.match(body, SHARED_GUARDS));
  }
}

// T5/T6/T7: financial and HRDF actions.
const invoices = functionBlocks(read("app/admin/(protected)/invoices/actions.ts"));
for (const name of ["createInvoiceFromQuotationAction", "updateInvoiceDraft", "issueInvoiceAction", "recordManualPaymentAction", "generateReceiptAction", "cancelInvoiceAction"]) {
  check(`invoices ${name} requires admin role and invoices edit`, () => {
    const body = invoices.get(name) ?? "";
    assert.match(body, /requireRole\("admin"\)/);
    assert.match(body, /requireModuleAccess\("invoices", "edit"\)/);
  });
}
const toyyibpay = functionBlocks(read("app/admin/(protected)/invoices/toyyibpayActions.ts"));
for (const name of ["generateToyyibpayPaymentLinkAction", "refreshToyyibpayStatusAction"]) {
  check(`toyyibpay ${name} requires admin role and invoices edit`, () => {
    const body = toyyibpay.get(name) ?? "";
    assert.match(body, /requireRole\("admin"\)/);
    assert.match(body, /requireModuleAccess\("invoices", "edit"\)/);
  });
}
const hrdf = functionBlocks(read("app/admin/(protected)/invoices/[id]/actions.ts"));
for (const name of ["createHrdfClaimAction", "recordHrdfPaymentAction"]) {
  check(`HRDF ${name} requires invoices edit and hrdf_claims edit`, () => {
    const body = hrdf.get(name) ?? "";
    assert.match(body, /requireRole\("admin"\)/);
    assert.match(body, /requireModuleAccess\("invoices", "edit"\)/);
    assert.match(body, /requireModuleAccess\("hrdf_claims", "edit"\)/);
  });
}
check("HRDF transitionHrdfClaimAction requires hrdf_claims edit", () => {
  assert.match(hrdf.get("transitionHrdfClaimAction") ?? "", /requireModuleAccess\("hrdf_claims", "edit"\)/);
});

// T9: internal registration writes to leads, participants and schedules.
check("requireRegistrationAccess requires edit on all three modules", () => {
  const body = functionBlocks(read("app/admin/(protected)/sales/leads/[id]/personal-registration/actions.ts")).get("requireRegistrationAccess") ?? "";
  for (const key of ["sales_leads", "participants", "schedules"]) assert.match(body, new RegExp(`requireModuleAccess\\("${key}", "edit"\\)`));
});
check("company registration uses the shared registration guard", () => {
  assert.match(read("app/admin/(protected)/sales/leads/[id]/company-registration/actions.ts"), /await requireRegistrationAccess\(\)/);
});

// Role floors are preserved, not lowered (spot checks on admin-only actions).
const leads = functionBlocks(read("app/admin/(protected)/sales/leads/actions.ts"));
for (const name of ["updateLeadStatus", "assignLead", "setLeadFollowUp", "updateLeadQualification", "updateLeadTemperature", "convertLeadToOpportunity", "markLeadTest"]) {
  check(`leads ${name} keeps requireRole("admin")`, () => assert.match(leads.get(name) ?? "", /requireRole\("admin"\)/));
}

// ---- UI: direct create/edit URLs need edit access (T2/T3) -------------------------------------
const P = "app/admin/(protected)/";
const EDIT_PAGES: Record<string, string> = {
  "sales/leads/new/page.tsx": "sales_leads",
  "sales/quotations/new/page.tsx": "sales_quotations",
  "sales/tasks/new/page.tsx": "sales_tasks",
  "companies/new/page.tsx": "companies",
  "companies/[id]/edit/page.tsx": "companies",
  "schedules/new/page.tsx": "schedules",
  "schedules/[id]/edit/page.tsx": "schedules",
  "marketing/contacts/new/page.tsx": "marketing_contacts",
  "marketing/contacts/[id]/edit/page.tsx": "marketing_contacts",
  "marketing/campaigns/new/page.tsx": "marketing_campaigns",
  "marketing/campaigns/[id]/edit/page.tsx": "marketing_campaigns",
};
for (const [page, key] of Object.entries(EDIT_PAGES)) {
  check(`${page} requires ${key} edit`, () => {
    const source = read(P + page);
    assert.match(source, new RegExp(`requireModuleAccess\\("${key}", "edit"\\)`));
    assert.doesNotMatch(source, new RegExp(`requireModuleAccess\\("${key}"\\)`), "no view-level guard may remain on a create/edit page");
  });
}

// ---- UI: read-only pages derive edit rights on the server and gate controls with them -----------
const UI_GATES: Array<[string, RegExp[]]> = [
  ["sales/leads/page.tsx", [/hasModuleAccess\("sales_leads", "edit"\)/, /canEdit \? <Link href="\/admin\/sales\/leads\/new"/]],
  ["sales/leads/[id]/page.tsx", [/hasModuleAccess\("sales_leads", "edit"\)/, /canManage = isAdmin\(profile\.role\) && canEdit/, /<fieldset disabled=\{!canEdit\}/, /canEdit=\{canEdit\}/, /access_level === "edit" \|\| m\.access_level === "admin"/]],
  ["sales/leads/[id]/LeadActionsPanel.tsx", [/\{canEdit && \(\s*<Card title="Add Note">/]],
  ["sales/opportunities/[id]/page.tsx", [/hasModuleAccess\("sales_opportunities", "edit"\)/, /hasModuleAccess\("sales_quotations", "edit"\)/, /hasModuleAccess\("sales_tasks", "edit"\)/, /hasModuleAccess\("schedules", "edit"\)/, /hasModuleAccess\("companies", "edit"\)/, /canManage=\{admin && canEditSchedules\}/, /canCreateCompany=\{admin && canEditCompanies\}/, /admin && canEditQuotations &&/]],
  ["sales/opportunities/[id]/OpportunityActionsPanel.tsx", [/\{canEdit && \(\s*<Card title="Add Note">/, /\{canAddTask && \(\s*<Card title="Tasks">/]],
  ["sales/opportunities/[id]/ClientOnboardingPanel.tsx", [/\{canCreateCompany && \(/]],
  ["sales/quotations/[id]/page.tsx", [/hasModuleAccess\("sales_quotations", "edit"\)/, /hasModuleAccess\("invoices", "edit"\)/, /canManage = isAdmin\(profile\.role\) && canEditQuotations/, /canCreateInvoice = isAdmin\(profile\.role\) && canEditInvoices/]],
  ["sales/quotations/[id]/QuotationActionsPanel.tsx", [/\) : canCreateInvoice \? \(/]],
  ["sales/tasks/page.tsx", [/hasModuleAccess\("sales_tasks", "edit"\)/, /canEdit \? <Link href="\/admin\/sales\/tasks\/new"/, /const canManage = canEdit && \(/]],
  ["sales/tasks/[id]/page.tsx", [/hasModuleAccess\("sales_tasks", "edit"\)/, /const canManage = canEdit && \(/]],
  ["sales/follow-ups/page.tsx", [/canSchedule = isAdmin\(profile\.role\) && \(await hasModuleAccess\("sales_leads", "edit"\)\)/]],
  ["invoices/[id]/page.tsx", [/hasModuleAccess\("invoices", "edit"\)/, /hasModuleAccess\("hrdf_claims", "edit"\)/, /canManage = isAdmin\(profile\.role\) && canEditInvoices/, /canManage=\{canManageHrdf\} canRecord=\{canManage && canManageHrdf\}/, /canManage && <form action=\{generateReceiptAction\}/]],
  ["invoices/[id]/HrdfClaimCard.tsx", [/\{canRecord && <form action=\{createHrdfClaimAction/, /claim\.status === "claim_approved" && canRecord && <form action=\{recordHrdfPaymentAction/]],
  ["marketing/page.tsx", [/hasModuleAccess\("marketing_contacts", "edit"\)/, /canCreateContact \? <Link/]],
  ["marketing/contacts/page.tsx", [/hasModuleAccess\("marketing_contacts", "edit"\)/]],
  ["marketing/campaigns/page.tsx", [/hasModuleAccess\("marketing_campaigns", "edit"\)/]],
  ["marketing/contacts/[id]/page.tsx", [/hasModuleAccess\("marketing_contacts", "edit"\)/, /!isPromoted && canEdit &&/, /\{canEdit && <ContactActionsPanel/, /canEdit && c\.status === "sales_ready"/]],
  ["marketing/campaigns/[id]/page.tsx", [/hasModuleAccess\("marketing_campaigns", "edit"\)/, /\{canEdit && nextAction && \(/]],
  ["companies/page.tsx", [/canWrite = isAdmin\(profile\.role\) && \(await hasModuleAccess\("companies", "edit"\)\)/]],
  ["companies/[id]/page.tsx", [/canWrite = isAdmin\(profile\.role\) && \(await hasModuleAccess\("companies", "edit"\)\)/]],
  ["schedules/page.tsx", [/canWrite = isAdmin\(profile\.role\) && \(await hasModuleAccess\("schedules", "edit"\)\)/]],
  ["schedules/[id]/page.tsx", [/canWrite = isAdmin\(profile\.role\) && canEditSchedules/, /canAssignAssessor = isAdmin\(profile\.role\) && canAdminSchedules/, /\{canAssignAssessor && \(\s*<Card title="Primary Assessor">/]],
];
for (const [page, patterns] of UI_GATES) {
  check(`${page} gates mutation controls on edit access`, () => {
    const source = read(P + page);
    for (const pattern of patterns) assert.match(source, pattern);
  });
}
check("multi-line create links on marketing lists are wrapped in canEdit", () => {
  for (const page of ["marketing/contacts/page.tsx", "marketing/campaigns/page.tsx"]) {
    const source = read(P + page);
    const links = [...source.matchAll(/<Link href="\/admin\/marketing\/(contacts|campaigns)\/new"/g)].length;
    const gated = [...source.matchAll(/canEdit \? \(\s*<Link href="\/admin\/marketing\/(contacts|campaigns)\/new"/g)].length;
    assert.equal(gated, links, `${page}: every create link must be gated`);
  }
});

if (failures) {
  console.error(`\n${failures} check(s) failed, ${passed} passed.`);
  process.exit(1);
}
console.log(`${passed} check(s) passed.`);
