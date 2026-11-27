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

// requireModuleCapability (RBAC) checks the module level too, plus role eligibility.
const guardCalls = (body: string) => [...body.matchAll(/requireModule(?:Access|Capability)\(([^)]*)\)/g)].map((m) => m[1].trim());

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
  // Choosing an assessor reads the assessor list; the schedule write itself needs Schedules Edit capability
  // (T1: mirrors app.can_manage_schedule_assessors = Schedules Edit + Assessors View).
  "app/admin/(protected)/schedules/actions.ts:setScheduleAssessor": ['"assessors", "view"'],
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
        assert.match(args, /^"[a-z_]+", "(edit|admin)"$/, `module guard (${args}) would admit View-only users`);
      }
    });
  }
}

// Every exported action in these files must be guarded, directly or through a shared guard helper.
const SHARED_GUARDS = /requireModuleAccess\(|requireModuleCapability\(|requireRegistrationAccess\(|transitionCampaign\(|transitionContactStatus\(/;
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
    assert.match(body, /requireModuleCapability\("invoices", "edit"\)/);
  });
}
const toyyibpay = functionBlocks(read("app/admin/(protected)/invoices/toyyibpayActions.ts"));
for (const name of ["generateToyyibpayPaymentLinkAction", "refreshToyyibpayStatusAction"]) {
  check(`toyyibpay ${name} requires admin role and invoices edit`, () => {
    const body = toyyibpay.get(name) ?? "";
    assert.match(body, /requireModuleCapability\("invoices", "edit"\)/);
  });
}
const hrdf = functionBlocks(read("app/admin/(protected)/invoices/[id]/actions.ts"));
for (const name of ["createHrdfClaimAction", "recordHrdfPaymentAction"]) {
  check(`HRDF ${name} requires invoices edit and hrdf_claims edit`, () => {
    const body = hrdf.get(name) ?? "";
    assert.match(body, /requireModuleCapability\("invoices", "edit"\)/);
    assert.match(body, /requireModuleCapability\("hrdf_claims", "edit"\)/);
  });
}
check("HRDF transitionHrdfClaimAction requires hrdf_claims edit", () => {
  assert.match(hrdf.get("transitionHrdfClaimAction") ?? "", /requireModuleCapability\("hrdf_claims", "edit"\)/);
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
// RBAC: the six lead-management actions need the sales_leads capability (admin, or Sales Staff with Custom access);
// markLeadTest keeps the admin role (and the database keeps it Super Admin only).
for (const name of ["updateLeadStatus", "assignLead", "setLeadFollowUp", "updateLeadQualification", "updateLeadTemperature", "convertLeadToOpportunity"]) {
  check(`leads ${name} requires requireModuleCapability("sales_leads", "edit")`, () => assert.match(leads.get(name) ?? "", /requireModuleCapability\("sales_leads", "edit"\)/));
}
check(`leads markLeadTest keeps requireRole("admin")`, () => assert.match(leads.get("markLeadTest") ?? "", /requireRole\("admin"\)/));

// T10: activity writes surface their errors instead of dropping them.
const ACTIVITY_FILES = [
  "app/admin/(protected)/sales/leads/actions.ts",
  "app/admin/(protected)/sales/opportunities/actions.ts",
  "app/admin/(protected)/sales/quotations/actions.ts",
  "app/admin/(protected)/sales/tasks/actions.ts",
  "app/admin/(protected)/companies/actions.ts",
  "app/admin/(protected)/schedules/actions.ts",
  "lib/sales/quotation-revision.ts",
];
for (const file of ACTIVITY_FILES) {
  const source = read(file);
  check(`${file}: no sales_activity insert discards its result`, () => {
    assert.doesNotMatch(source, /^\s*await supabase\s*\.from\("sales_activity"\)\s*\.insert\(/m, "insert result must be captured");
    for (const m of source.matchAll(/(const|let)\s*\{\s*error(?::\s*(\w+))?\s*\}\s*=\s*await supabase(?:\s*\.from\("sales_activity"\))\s*\.insert\(/g)) {
      const variable = m[2] ?? "error";
      const after = source.slice(m.index!, m.index! + 900);
      assert.match(after, new RegExp(`if \\(${variable}\\)|return !${variable}`), `${variable} must be checked`);
    }
  });
}
for (const file of ["app/admin/(protected)/sales/leads/actions.ts", "app/admin/(protected)/sales/opportunities/actions.ts", "app/admin/(protected)/sales/quotations/actions.ts"]) {
  check(`${file}: logActivity reports failure to its caller`, () => {
    const body = functionBlocks(read(file)).get("logActivity") ?? "";
    assert.match(body, /Promise<boolean>/);
    assert.match(body, /return !error;/);
  });
}
check("lead actions that return state report a failed timeline write", () => {
  for (const name of ["updateLeadStatus", "assignLead", "setLeadFollowUp", "updateLeadQualification", "updateLeadTemperature"]) {
    assert.match(leads.get(name) ?? "", /if \(!logged\) return \{ message: ACTIVITY_NOT_RECORDED/, name);
  }
  assert.match(leads.get("setLeadAttribution") ?? "", /if \(!logged\) redirect\(/);
});
check("opportunity and quotation actions that return state report a failed timeline write", () => {
  const opp = functionBlocks(read("app/admin/(protected)/sales/opportunities/actions.ts"));
  for (const name of ["updateOpportunityStage", "assignOpportunity"]) assert.match(opp.get(name) ?? "", /if \(!logged\) return \{ message: ACTIVITY_NOT_RECORDED \}/, name);
  const quotes = functionBlocks(read("app/admin/(protected)/sales/quotations/actions.ts"));
  assert.match(quotes.get("markQuotationSent") ?? "", /if \(!logged\) return \{ message: ACTIVITY_NOT_RECORDED \}/);
});
check("activity failures are logged without note text or row data", () => {
  for (const file of ACTIVITY_FILES.slice(0, 6)) {
    for (const m of read(file).matchAll(/console\.error\(([^;]*activity insert failed[^;]*)\);/g)) {
      assert.doesNotMatch(m[1], /note|metadata|message/, `${file}: only type and error code may be logged`);
    }
  }
});

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
    // T1: Training pages use requireModuleCapability(key, "edit") -- the same module level plus role eligibility.
    assert.match(source, new RegExp(`requireModule(?:Access|Capability)\\("${key}", "edit"\\)`));
    assert.doesNotMatch(source, new RegExp(`requireModuleAccess\\("${key}"\\)`), "no view-level guard may remain on a create/edit page");
  });
}

// ---- UI: read-only pages derive edit rights on the server and gate controls with them -----------
const UI_GATES: Array<[string, RegExp[]]> = [
  ["sales/leads/page.tsx", [/hasModuleAccess\("sales_leads", "edit"\)/, /canEdit \? <Link href="\/admin\/sales\/leads\/new"/]],
  ["sales/leads/[id]/page.tsx", [/hasModuleAccess\("sales_leads", "edit"\)/, /canManage = isCapabilityRoleEligible\(profile\) && canEdit/, /<fieldset disabled=\{!canEdit\}/, /canEdit=\{canEdit\}/, /access_level === "edit" \|\| m\.access_level === "admin"/]],
  ["sales/leads/[id]/LeadActionsPanel.tsx", [/\{canEdit && \(\s*<Card title="Add Note">/]],
  ["sales/opportunities/[id]/page.tsx", [/hasModuleAccess\("sales_opportunities", "edit"\)/, /hasModuleAccess\("sales_quotations", "edit"\)/, /hasModuleAccess\("sales_tasks", "edit"\)/, /hasModuleAccess\("schedules", "edit"\)/, /hasModuleAccess\("companies", "edit"\)/, /canManage=\{admin && canEditSchedules\}/, /canCreateCompany=\{admin && canEditCompanies\}/, /salesCapable && canEditQuotations &&/]],
  ["sales/opportunities/[id]/OpportunityActionsPanel.tsx", [/\{canEdit && \(\s*<Card title="Add Note">/, /\{canAddTask && \(\s*<Card title="Tasks">/]],
  ["sales/opportunities/[id]/ClientOnboardingPanel.tsx", [/\{canCreateCompany && \(/]],
  ["sales/quotations/[id]/page.tsx", [/hasModuleAccess\("sales_quotations", "edit"\)/, /hasModuleAccess\("invoices", "edit"\)/, /canManage = capable && canEditQuotations/, /canCreateInvoice = capable && canEditInvoices/]],
  ["sales/quotations/[id]/QuotationActionsPanel.tsx", [/\) : canCreateInvoice \? \(/]],
  ["sales/tasks/page.tsx", [/hasModuleAccess\("sales_tasks", "edit"\)/, /canEdit \? <Link href="\/admin\/sales\/tasks\/new"/, /const canManage = canEdit && \(/]],
  ["sales/tasks/[id]/page.tsx", [/hasModuleAccess\("sales_tasks", "edit"\)/, /const canManage = canEdit && \(/]],
  ["sales/follow-ups/page.tsx", [/canSchedule = leadsCapable && \(await hasModuleAccess\("sales_leads", "edit"\)\)/]],
  // S1 (Owner 2026-11-22): the HRDF claim card is read-only (claims are managed in the HRD Corp portal); its "no
  // mutation control at all" rule is asserted separately below.
  ["invoices/[id]/page.tsx", [/hasModuleAccess\("invoices", "edit"\)/, /canManage = isCapabilityRoleEligible\(profile\) && canEditInvoices/, /<HrdfClaimCard applicable=\{[^}]*\} claim=\{hrdfClaim\} \/>/, /canManage && <form action=\{generateReceiptAction\}/]],
  ["marketing/page.tsx", [/hasModuleAccess\("marketing_contacts", "edit"\)/, /canCreateContact \? <Link/]],
  ["marketing/contacts/page.tsx", [/hasModuleAccess\("marketing_contacts", "edit"\)/]],
  ["marketing/campaigns/page.tsx", [/hasModuleAccess\("marketing_campaigns", "edit"\)/]],
  ["marketing/contacts/[id]/page.tsx", [/hasModuleAccess\("marketing_contacts", "edit"\)/, /!isPromoted && canEdit &&/, /\{canEdit && <ContactActionsPanel/, /canEdit && c\.status === "sales_ready"/]],
  ["marketing/campaigns/[id]/page.tsx", [/hasModuleAccess\("marketing_campaigns", "edit"\)/, /\{canEdit && nextAction && \(/]],
  ["companies/page.tsx", [/canWrite = isAdmin\(profile\.role\) && \(await hasModuleAccess\("companies", "edit"\)\)/]],
  ["companies/[id]/page.tsx", [/canWrite = isAdmin\(profile\.role\) && \(await hasModuleAccess\("companies", "edit"\)\)/]],
  // T1 (OWNER-TRAINING-T1-20261125): schedule writes follow the Schedules Edit capability; archive keeps the Admin role.
  ["schedules/page.tsx", [/canWrite = await hasModuleCapability\("schedules", "edit", profile\)/]],
  ["schedules/[id]/page.tsx", [/hasModuleCapability\("schedules", "edit", profile\)/, /canArchive = canWrite && isAdmin\(profile\.role\)/, /canAssignAssessor = canWrite && canViewAssessors/, /\{canAssignAssessor && \(\s*<Card title="Primary Assessor">/]],
];
for (const [page, patterns] of UI_GATES) {
  check(`${page} gates mutation controls on edit access`, () => {
    const source = read(P + page);
    for (const pattern of patterns) assert.match(source, pattern);
  });
}
check("invoices/[id]/HrdfClaimCard.tsx renders no HRDF mutation control (S1 read-only)", () => {
  const source = read(P + "invoices/[id]/HrdfClaimCard.tsx");
  assert.doesNotMatch(source, /from "\.\/actions"|<form|<button|action=/);
});
check("lead detail offers Add task only with Tasks edit", () => {
  const source = read(P + "sales/leads/[id]/page.tsx");
  assert.match(source, /const canAddTask = await hasModuleAccess\("sales_tasks", "edit"\);/);
  const links = [...source.matchAll(/tasks\/new\?leadId=/g)];
  assert.ok(links.length > 0, "the Add task link is still present for Tasks editors");
  for (const link of links) {
    const before = source.slice(Math.max(0, link.index - 80), link.index);
    assert.match(before, /\{canAddTask && <Link href=\{`\/admin\/sales\/$/, "every tasks/new?leadId link must be gated by canAddTask");
  }
});
check("multi-line create links on marketing lists are wrapped in canEdit", () => {
  for (const page of ["marketing/contacts/page.tsx", "marketing/campaigns/page.tsx"]) {
    const source = read(P + page);
    const links = [...source.matchAll(/<Link href="\/admin\/marketing\/(contacts|campaigns)\/new"/g)].length;
    const gated = [...source.matchAll(/canEdit \? \(\s*<Link href="\/admin\/marketing\/(contacts|campaigns)\/new"/g)].length;
    assert.equal(gated, links, `${page}: every create link must be gated`);
  }
});

// ---- Activity notices after redirects (T10) -----------------------------------------------------
check("activity notices are fixed, data-free values", () => {
  const lib = read("lib/sales/activity-notice.ts");
  assert.match(lib, /ACTIVITY_UNSAVED_NOTICE = "activity-unsaved"/);
  assert.match(lib, /LINK_FAILED_NOTICE = "link-failed"/);
  assert.match(lib, /`\$\{path\}\$\{path\.includes\("\?"\) \? "&" : "\?"\}notice=\$\{notice\}`/);
});
check("createQuotation redirects with a notice when its timeline write fails", () => {
  const body = functionBlocks(read(P + "sales/quotations/actions.ts")).get("createQuotation") ?? "";
  assert.match(body, /const logged = await logActivity\(/);
  assert.match(body, /redirect\(logged \? detailPath : withNotice\(detailPath, ACTIVITY_UNSAVED_NOTICE\)\)/);
});
check("createTask redirects with a warning when its timeline write fails", () => {
  const body = functionBlocks(read(P + "sales/tasks/actions.ts")).get("createTask") ?? "";
  assert.match(body, /const logged = await logTaskActivity\(/);
  assert.match(body, /feedback=created-activity-warning/);
  assert.match(read("lib/sales/task-queue.ts"), /"created-activity-warning": "Task created, but/);
});
check("createCompany handoff checks the opportunity link and the timeline write", () => {
  const body = functionBlocks(read(P + "companies/actions.ts")).get("createCompany") ?? "";
  assert.match(body, /if \(sourceOpportunityId\) await requireModuleAccess\("sales_opportunities", "edit"\)/);
  assert.match(body, /const \{ error: linkError \} = await supabase\s*\.from\("sales_opportunities"\)/);
  assert.match(body, /if \(linkError\) \{[\s\S]*?redirect\(withNotice\(opportunityPath, LINK_FAILED_NOTICE\)\)/);
  assert.match(body, /redirect\(activityLogged \? opportunityPath : withNotice\(opportunityPath, ACTIVITY_UNSAVED_NOTICE\)\)/);
  assert.ok(body.indexOf("linkError") < body.indexOf('from("sales_activity")'), "the timeline write runs only after a successful link");
});
check("createSchedule handoff redirects with a notice when its timeline write fails", () => {
  const body = functionBlocks(read(P + "schedules/actions.ts")).get("createSchedule") ?? "";
  assert.match(body, /redirect\(activityLogged \? schedulePath : withNotice\(schedulePath, ACTIVITY_UNSAVED_NOTICE\)\)/);
});
check("linkCompany reports both link and timeline failures instead of returning silently", () => {
  const body = functionBlocks(read(P + "sales/opportunities/actions.ts")).get("linkCompany") ?? "";
  assert.doesNotMatch(body, /if \(error\) return;/);
  assert.match(body, /redirect\(withNotice\(opportunityPath, LINK_FAILED_NOTICE\)\)/);
  assert.match(body, /if \(!logged\) redirect\(withNotice\(opportunityPath, ACTIVITY_UNSAVED_NOTICE\)\)/);
});
check("notice pages render only the fixed messages for the fixed values", () => {
  const opp = read(P + "sales/opportunities/[id]/page.tsx");
  assert.match(opp, /notice === ACTIVITY_UNSAVED_NOTICE && <div className="ta-alert ta-alert-info" role="status">\{ACTIVITY_UNSAVED_MESSAGE\}/);
  assert.match(opp, /notice === LINK_FAILED_NOTICE && <div className="ta-alert ta-alert-error" role="alert">\{OPPORTUNITY_LINK_FAILED_MESSAGE\}/);
  assert.match(read(P + "sales/quotations/[id]/page.tsx"), /notice === ACTIVITY_UNSAVED_NOTICE && \(\s*<div className="ta-alert ta-alert-info" role="status">\{ACTIVITY_UNSAVED_MESSAGE\}/);
  assert.match(read(P + "schedules/[id]/page.tsx"), /notice === ACTIVITY_UNSAVED_NOTICE && \(\s*<div className="ta-alert ta-alert-info" role="status">\{ACTIVITY_UNSAVED_MESSAGE\}/);
  for (const page of ["sales/tasks/page.tsx", "sales/tasks/[id]/page.tsx"]) assert.match(read(P + page), /isTaskQueueWarning\(sp\.feedback\)/);
});

if (failures) {
  console.error(`\n${failures} check(s) failed, ${passed} passed.`);
  process.exit(1);
}
console.log(`${passed} check(s) passed.`);
