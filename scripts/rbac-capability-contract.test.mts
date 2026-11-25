// RBAC hardening contract (OWNER-CRM-RBAC-DEV-20261124): application layer + migration files.
// Static and pure checks only - no network, no database. The database behaviour is proven separately by
// supabase/tests/crm_rbac/run.sh (Docker, Production-equivalent fixture, persona matrix).
//   node --experimental-strip-types --no-warnings scripts/rbac-capability-contract.test.mts [--mutations]
import { readFileSync, readdirSync } from "node:fs";
import { isCapabilityRoleEligible, SALES_STAFF_PRESET, FINANCE_STAFF_PRESET, STAFF_ACCESS_PRESETS } from "../lib/auth/rbac.ts";

const A = "app/admin/(protected)/";
const read = (p: string) => readFileSync(p, "utf8");

const ACTIONS: Record<string, [string, string, string?][]> = {
  "sales/leads/actions.ts": [["updateLeadStatus", "sales_leads"], ["assignLead", "sales_leads"], ["setLeadFollowUp", "sales_leads"],
    ["updateLeadQualification", "sales_leads"], ["updateLeadTemperature", "sales_leads"], ["convertLeadToOpportunity", "sales_leads"]],
  "sales/opportunities/actions.ts": [["updateOpportunityStage", "sales_opportunities"], ["assignOpportunity", "sales_opportunities"],
    ["setOpportunityExpectedClose", "sales_opportunities"], ["markOpportunityLost", "sales_opportunities"], ["linkCompany", "sales_opportunities"]],
  "sales/quotations/actions.ts": [["createQuotation", "sales_quotations"], ["updateQuotationDraft", "sales_quotations"], ["markQuotationSent", "sales_quotations"],
    ["acceptQuotationAction", "sales_quotations"], ["rejectQuotationAction", "sales_quotations"], ["createRevision", "sales_quotations"]],
  "invoices/actions.ts": [["createInvoiceFromQuotationAction", "invoices"], ["updateInvoiceDraft", "invoices"], ["issueInvoiceAction", "invoices"],
    ["recordManualPaymentAction", "invoices"], ["checkManualPaymentAttemptAction", "invoices"], ["generateReceiptAction", "invoices"], ["cancelInvoiceAction", "invoices"]],
  "invoices/toyyibpayActions.ts": [["generateToyyibpayPaymentLinkAction", "invoices"], ["refreshToyyibpayStatusAction", "invoices"]],
  "invoices/[id]/actions.ts": [["createHrdfClaimAction", "invoices", "hrdf_claims"], ["transitionHrdfClaimAction", "hrdf_claims"], ["recordHrdfPaymentAction", "invoices", "hrdf_claims"]],
};
const UI_FILES = ["sales/follow-ups/page.tsx", "sales/leads/[id]/page.tsx", "sales/opportunities/[id]/page.tsx", "sales/quotations/[id]/page.tsx",
  "sales/tasks/actions.ts", "sales/tasks/page.tsx", "sales/tasks/[id]/page.tsx", "invoices/[id]/page.tsx"];
const MIGRATIONS = ["20261201100000_rbac_m01", "20261201101000_rbac_m06", "20261201102000_rbac_m07", "20261201103000_rbac_m08", "20261201104000_rbac_m09",
  "20261201110000_rbac_m02", "20261201111000_rbac_m03", "20261201120000_rbac_m04", "20261201121000_rbac_m05", "20261201130000_rbac_m10",
  "20261201140000_rbac_m11"];

type Src = Record<string, string>;
function load(): Src {
  const s: Src = {};
  for (const f of [...Object.keys(ACTIONS), ...UI_FILES]) s[f] = read(A + f);
  s.session = read("lib/auth/session.ts"); s.rbac = read("lib/auth/rbac.ts"); s.form = read(A + "users/StaffUserForm.tsx");
  const migs = readdirSync("supabase/migrations");
  for (const m of MIGRATIONS) { const f = migs.find((x) => x.startsWith(m)); s[m] = f ? read("supabase/migrations/" + f) : ""; }
  return s;
}
function body(src: string, fn: string): string {
  const i = src.indexOf(`export async function ${fn}(`); if (i < 0) return "";
  const j = src.indexOf("{\n", src.indexOf(")", i)); return src.slice(j, j + 600);
}

function checks(s: Src, eligible: typeof isCapabilityRoleEligible, presets = STAFF_ACCESS_PRESETS): [string, boolean][] {
  const out: [string, boolean][] = [];
  const c = (n: string, ok: boolean) => out.push([n, ok]);
  // 1. Role-eligibility truth table (mirror of app.can_module condition 3+4).
  const P = (role: any, is_active: any, access_control_enabled: any) => ({ role, is_active, access_control_enabled });
  c("eligible: super_admin", eligible(P("super_admin", true, false)));
  c("eligible: admin (custom or default)", eligible(P("admin", true, true)) && eligible(P("admin", true, false)));
  c("eligible: editor with Custom Module Access", eligible(P("editor", true, true)));
  c("not eligible: editor on Role Default Access", !eligible(P("editor", true, false)) && !eligible(P("editor", true, null)));
  c("not eligible: trainer / client / participant", !eligible(P("trainer", true, true)) && !eligible(P("client", true, true)) && !eligible(P("participant", true, true)));
  c("not eligible: inactive (any role)", !eligible(P("super_admin", false, true)) && !eligible(P("admin", false, true)) && !eligible(P("editor", false, true)) && !eligible(P("editor", null, true)));
  c("not eligible: missing profile / null role", !eligible(null) && !eligible(undefined) && !eligible(P(null, true, true)));
  // 2. Guard implementation.
  c("requireModuleCapability exported", /export async function requireModuleCapability\(moduleKey: string, level: ModuleAccessLevel = "edit"\)/.test(s.session));
  c("requireModuleCapability = active editor+ AND eligible AND module level",
    /requireModuleCapability[\s\S]{0,200}requireRole\("editor"\);\s*if \(!isCapabilityRoleEligible\(profile\)\) redirect\("\/admin\/no-access"\);\s*await requireModuleAccess\(moduleKey, level\);/.test(s.session));
  c("hasModuleCapability = eligible AND hasModuleAccess", /hasModuleCapability[\s\S]{0,300}if \(!isCapabilityRoleEligible\(current\)\) return false;\s*return hasModuleAccess\(moduleKey, level\);/.test(s.session));
  // 3. The 30 Sales/Finance actions: capability guard first, no admin-role guard.
  for (const [file, fns] of Object.entries(ACTIONS)) for (const [fn, mod, mod2] of fns) {
    const b = body(s[file], fn);
    const first = b.match(/await requireModuleCapability\("([a-z_]+)", "([a-z]+)"\)/);
    c(`${fn}: first guard requireModuleCapability(${mod}, edit)`, !!first && first[1] === mod && first[2] === "edit" && b.indexOf("requireModuleCapability") < 40);
    if (mod2) c(`${fn}: also requires ${mod2} edit`, new RegExp(`requireModuleCapability\\("${mod2}", "edit"\\)`).test(b));
    c(`${fn}: no requireRole("admin")`, !/requireRole\("admin"\)/.test(b.slice(0, 300)));
  }
  c("markLeadTest unchanged (admin role; DB keeps super_admin only)", /export async function markLeadTest[\s\S]{0,120}requireRole\("admin"\);\s*await requireModuleAccess\("sales_leads", "edit"\)/.test(s["sales/leads/actions.ts"]));
  const adminLeft = Object.keys(ACTIONS).reduce((n, f) => n + (s[f].match(/requireRole\("admin"\)/g) ?? []).length, 0);
  c(`only markLeadTest keeps requireRole("admin") in the six action files (found ${adminLeft})`, adminLeft === 1);
  // 4. Eight UI/invariant files.
  for (const f of ["sales/follow-ups/page.tsx", "sales/leads/[id]/page.tsx", "sales/quotations/[id]/page.tsx", "invoices/[id]/page.tsx", "sales/opportunities/[id]/page.tsx"])
    c(`${f}: write controls follow isCapabilityRoleEligible`, /isCapabilityRoleEligible\(profile\)/.test(s[f]) && !/canManage = isAdmin\(profile\.role\)/.test(s[f]));
  c("opportunity page: quotation button follows capability", /salesCapable && canEditQuotations/.test(s["sales/opportunities/[id]/page.tsx"]));
  c("opportunity page: schedule/company creation keep admin role (Training/Companies tables)", /canManage=\{admin && canEditSchedules\}/.test(s["sales/opportunities/[id]/page.tsx"]) && /canCreateCompany=\{admin && canEditCompanies\}/.test(s["sales/opportunities/[id]/page.tsx"]));
  const MO = 'isAdmin(profile.role) || (await hasModuleCapability("sales_tasks", "admin", profile))';
  c("tasks actions: managing others = admin role OR sales_tasks Admin (4 branches + delete)", s["sales/tasks/actions.ts"].split(MO).length - 1 === 5 && !/!isAdmin\(profile\.role\)/.test(s["sales/tasks/actions.ts"]));
  c("deleteTask: Tasks edit AND (admin OR sales_tasks Admin)", /export async function deleteTask[\s\S]{0,400}requireModuleAccess\("sales_tasks", "edit"\);\s*if \(!\(isAdmin\(profile\.role\) \|\| \(await hasModuleCapability\("sales_tasks", "admin", profile\)\)\)\) redirect/.test(s["sales/tasks/actions.ts"]));
  for (const f of ["sales/tasks/page.tsx", "sales/tasks/[id]/page.tsx"]) c(`${f}: own-task rule kept, others need canManageOthers`, s[f].includes(`const canManageOthers = (${MO});`) && /canManageOthers \|\| t\.assigned_to === profile\.id \|\| t\.created_by === profile\.id/.test(s[f]));
  // 5. Presets (least privilege; D-05 / D-06).
  const lvl = (p: any, k: string) => p.modules.find((m: any) => m.moduleKey === k)?.accessLevel ?? "none";
  const sales = presets.find((p) => p.id === "sales_staff"), fin = presets.find((p) => p.id === "finance_staff");
  c("two presets: Sales Staff + Finance Staff", !!sales && !!fin && presets.length === 2);
  for (const p of [sales, fin]) if (p) {
    c(`${p.id}: Editor + Custom Module Access`, p.role === "editor" && p.accessControlEnabled === true);
    c(`${p.id}: no admin level, no administration/Training/content/marketing/companies modules`,
      p.modules.every((m: any) => m.accessLevel !== "admin") &&
      !p.modules.some((m: any) => ["users", "audit", "system", "backups", "automation", "participants", "schedules", "attendance", "assessment", "certificates",
        "certificate_templates", "courses", "legacy_import", "companies", "news", "faq", "gallery", "downloads", "media", "company", "marketing", "marketing_contacts",
        "marketing_campaigns", "trainers", "assessors", "dashboard", "reports"].includes(m.moduleKey)));
  }
  if (sales) c("Sales Staff: leads/opportunities/quotations Edit (D-06); no invoices or HRDF",
    lvl(sales, "sales_leads") === "edit" && lvl(sales, "sales_opportunities") === "edit" && lvl(sales, "sales_quotations") === "edit"
    && lvl(sales, "invoices") === "none" && lvl(sales, "hrdf_claims") === "none");
  if (fin) c("Finance Staff: invoices Edit, quotations View (D-05), HRDF View only, no Sales write",
    lvl(fin, "invoices") === "edit" && lvl(fin, "sales_quotations") === "view" && lvl(fin, "hrdf_claims") === "view"
    && ["sales_leads", "sales_opportunities", "sales_tasks", "sales_followups"].every((k) => lvl(fin, k) === "none"));
  c("Staff form offers every preset", /STAFF_ACCESS_PRESETS\.map\(\(preset\) =>/.test(s.form) && /applyPreset\(preset\)/.test(s.form));
  // 6. Migration files.
  c("ten RBAC migration files present (nine + M-10)", MIGRATIONS.every((m) => s[m].length > 0));
  const all = MIGRATIONS.map((m) => s[m]).join("\n");
  c("no DROP TABLE / DROP COLUMN / TRUNCATE / DELETE FROM in migrations", !/drop\s+table|drop\s+column|truncate|delete\s+from/i.test(all.replace(/^--.*$/gm, "")));
  c("every migration has a fail-closed precondition", MIGRATIONS.every((m) => /precondition_failed/.test(s[m])));
  c("M-01 revokes authenticated EXECUTE on both H1 functions, no DROP/CREATE",
    /revoke execute on function public\.verify_public_registration_manual_payment\([^)]*\) from public, anon, authenticated;/.test(s["20261201100000_rbac_m01"])
    && /revoke execute on function public\.finalize_public_registration_crm\(uuid\) from public, anon, authenticated;/.test(s["20261201100000_rbac_m01"])
    && !/create (or replace )?function|drop function/i.test(s["20261201100000_rbac_m01"].replace(/^--.*$/gm, "")));
  const m02 = s["20261201110000_rbac_m02"];
  c("M-02 can_module: valid level, active catalog module, is_active, admin-or-custom-editor, module level, fail closed",
    /p_level in \('view', 'edit', 'admin'\)/.test(m02) && /c\.module_key = p_module and c\.is_active/.test(m02) && /\n\s*and app\.is_active\(\)\n/.test(m02)
    && /app\.is_admin\(\)\s*or \(app\.has_min_role\('editor'::public\.user_role\)\s*and coalesce\(\(select pr\.access_control_enabled from public\.profiles pr where pr\.id = auth\.uid\(\)\), false\)\)/.test(m02)
    && /public\.has_module_access_level\(p_module, p_level\),\s*false\);/.test(m02));
  c("M-02 can_module: SECURITY DEFINER, fixed search_path, authenticated only",
    /security definer\s*set search_path to 'pg_catalog', 'public'/.test(m02) && /revoke all on function app\.can_module\(text, text\) from public, anon, service_role;/.test(m02)
    && /grant execute on function app\.can_module\(text, text\) to authenticated;/.test(m02));
  c("M-03 sets default true only (no row update)", /alter column access_control_enabled set default true;/.test(s["20261201111000_rbac_m03"]) && !/update public\.profiles/i.test(s["20261201111000_rbac_m03"]));
  c("M-04 uses can_module and keeps the stage/status guards", (s["20261201120000_rbac_m04"].match(/app\.can_module\(/g) ?? []).length >= 15
    && /stage <> ALL \(ARRAY\['won'::text, 'cancelled'::text\]\)/.test(s["20261201120000_rbac_m04"]) && /status <> ALL \(ARRAY\['accepted'::text, 'cancelled'::text\]\)/.test(s["20261201120000_rbac_m04"]));
  c("M-04 tasks: own-task branch kept verbatim; others via admin role or sales_tasks Admin",
    /\(app\.is_admin\(\) OR \(assigned_to = auth\.uid\(\)\) OR \(created_by = auth\.uid\(\)\)\) AND \( SELECT public\.has_module_access_level\('sales_tasks'::text, 'edit'::text\)/.test(s["20261201120000_rbac_m04"])
    && /app\.can_module\('sales_tasks'::text, 'admin'::text\)/.test(s["20261201120000_rbac_m04"]));
  const m05 = s["20261201121000_rbac_m05"];
  c("M-05 replaces exactly the gate line in 17 signatures", (m05.match(/\$q\$if not app\.is_admin\(\) then\$q\$/g) ?? []).length === 17 && /v_n <> 1/.test(m05) && /body_md5/.test(m05));
  c("M-05 does not touch mark_lead_test_unguarded", !/mark_lead_test_unguarded/.test(m05));
  c("M-06 invoice_items: editor floor AND invoices View, TO authenticated", /create policy invoice_items_select on public\.invoice_items as permissive for select to authenticated\s*using \(\(app\.has_min_role\('editor'::public\.user_role\) AND \( SELECT app\.has_any_module_access\(ARRAY\['invoices'::text\], 'view'::text\)/.test(s["20261201101000_rbac_m06"]));
  const m07 = s["20261201102000_rbac_m07"];
  c("M-07 participants: editor floor kept (Trainers not newly admitted) and 'reports' removed",
    /create policy participants_select[\s\S]{0,200}app\.has_min_role\('editor'::public\.user_role\) AND/.test(m07) && !/create policy participants_select[^;]*'reports'/.test(m07));
  c("M-07 report RPCs return six reporting columns only", /returns table \(id uuid, participant_id text, full_name text, company text, status text, created_at timestamptz\)/.test(m07)
    && /public\.has_module_access_level\('reports', 'view'\)/.test(m07) && /grant execute on function public\.get_report_participants\(integer\) to authenticated;/.test(m07));
  c("M-08 audit log: reports removed", /create policy audit_staff_read[\s\S]{0,300}ARRAY\['audit'::text, 'automation'::text, 'backups'::text\]/.test(s["20261201103000_rbac_m08"]) && !/create policy audit_staff_read[^;]*'reports'/.test(s["20261201103000_rbac_m08"]));
  const m09 = s["20261201104000_rbac_m09"];
  c("M-09 participants/schedules: Edit for writes, Admin for DELETE", /create policy participants_delete[\s\S]{0,200}'participants'::text, 'admin'::text/.test(m09) && /create policy course_schedules_delete[\s\S]{0,200}'schedules'::text, 'admin'::text/.test(m09)
    && /create policy schedule_participants_insert[\s\S]{0,200}'schedules'::text, 'edit'::text/.test(m09));
  c("M-09 trainer branch unchanged", (m09.match(/\(app\.is_admin_or_trainer\(\) AND \(NOT app\.is_admin\(\)\)\)/g) ?? []).length === 10);
  c("M-09 content/course DELETE need module Admin", ["courses_delete", "news_posts_admin_delete", "faqs_admin_delete", "downloads_admin_delete", "gallery_images_admin_delete", "media_admin_delete"]
    .every((p) => new RegExp(`create policy ${p}[\\s\\S]{0,250}'admin'::text\\)`).test(m09)));
  c("M-09 legacy RPC gates: 7 signatures", (m09.match(/\$q\$if not app\.is_admin\(\) then\$q\$/g) ?? []).length === 7);
  // M-10: contact PII SELECT by module capability (policies only).
  const m10 = s["20261201130000_rbac_m10"];
  const m10Body = m10.replace(/^--.*$/gm, "");
  const m10Create = (p: string) => (m10Body.match(new RegExp(`create policy ${p} [^;]*;`)) ?? [""])[0];
  const leadRule = "( SELECT app.has_any_module_access(ARRAY['sales'::text, 'sales_leads'::text, 'sales_opportunities'::text, 'sales_tasks'::text, 'sales_followups'::text, 'marketing_contacts'::text], 'view'::text) AS has_any_module_access)";
  c("M-10 changes exactly the six contact SELECT policies and nothing else",
    (m10Body.match(/create policy /g) ?? []).length === 6 && (m10Body.match(/drop policy if exists /g) ?? []).length === 6
    && ["enquiries_select", "proposal_requests_select", "sales_internal_lead_sources_select", "sales_lead_contact_overrides_select", "marketing_contacts_select", "marketing_contact_events_select"]
      .every((p) => / as permissive for select to authenticated\n/.test(m10Create(p)))
    && !/grant |revoke |create (or replace )?function|alter table|for (insert|update|delete|all) /i.test(m10Body));
  c("M-10 lead-contact tables: editor floor AND Sales modules (no sales_reports)",
    ["enquiries_select", "proposal_requests_select", "sales_internal_lead_sources_select", "sales_lead_contact_overrides_select"]
      .every((p) => m10Create(p).includes(`(app.has_min_role('editor'::public.user_role) AND ${leadRule})`) && !m10Create(p).includes("sales_reports")));
  c("M-10 marketing_contacts: Marketing View, or a Sales module only for contacts promoted to a lead",
    /ARRAY\['marketing'::text, 'marketing_contacts'::text\][\s\S]*EXISTS \( SELECT 1 FROM public\.sales_lead_metadata m WHERE \(\(m\.lead_source = 'marketing_contact'::text\) AND \(m\.source_id = marketing_contacts\.id\)\)\)/.test(m10Create("marketing_contacts_select"))
    && !m10Create("marketing_contacts_select").includes("sales_reports"));
  c("M-10 marketing_contact_events: Marketing Contacts View only",
    m10Create("marketing_contact_events_select").includes("( SELECT app.has_any_module_access(ARRAY['marketing_contacts'::text], 'view'::text) AS has_any_module_access)"));
  c("M-10 pins the pre-state, requires DB B and checks one SELECT policy per table",
    /m10_precondition_failed: policy/.test(m10) && /to_regprocedure\('app\.can_module\(text,text\)'\)/.test(m10) && /m10_postcondition_failed: % has RLS off, more than one SELECT policy/.test(m10));
  const m11 = s["20261201140000_rbac_m11"];
  const m11Body = m11.replace(/^--.*$/gm, "");
  const m11Create = (p: string) => (m11Body.match(new RegExp(`create policy ${p} [^;]*;`)) ?? [""])[0];
  c("M-11 changes SELECT policies only (no grant, function, table or write-policy change)",
    (m11Body.match(/create policy /g) ?? []).length === 3 && (m11Body.match(/drop policy if exists /g) ?? []).length === 2
    && (m11Body.match(/create policy cert_verif_staff_read on public\.certificate_verifications as permissive for select to %s/g) ?? []).length === 1
    && !/grant |revoke |create (or replace )?function|alter table|for (insert|update|delete|all) /i.test(m11Body));
  c("M-11 certificates need certificates, participants or companies View (not reports) above the trainer floor",
    m11Create("certificates_select").includes("(app.has_min_role('trainer'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['certificates'::text, 'participants'::text, 'companies'::text], 'view'::text) AS has_any_module_access))")
    && !m11Create("certificates_select").includes("'reports'"));
  c("M-11 verification log needs certificates View above the trainer floor and drops the role-only trainer branch",
    m11Body.includes("$q$(app.has_min_role('trainer'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['certificates'::text], 'view'::text) AS has_any_module_access))$q$")
    && !/\$m11_cv\$[\s\S]*current_role[\s\S]*\$m11_cv\$;/.test(m11Body));
  c("M-11 feedback needs feedback, feedback_responses or schedules View above the editor floor",
    m11Create("participant_feedback_staff_select").includes("(app.has_min_role('editor'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['feedback'::text, 'feedback_responses'::text, 'schedules'::text], 'view'::text) AS has_any_module_access))")
    && !m11Create("participant_feedback_staff_select").includes("feedback_issues"));
  c("M-11 pins the pre-state, requires DB B and checks one staff SELECT policy per table",
    /m11_precondition_failed: policy/.test(m11) && /to_regprocedure\('app\.can_module\(text,text\)'\)/.test(m11)
    && /m11_postcondition_failed: % has RLS off, more than one staff SELECT policy/.test(m11));
  return out;
}

const src = load();
const base = checks(src, isCapabilityRoleEligible);
let fail = 0;
for (const [n, ok] of base) { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} ${n}`); }
console.log(`${base.length - fail}/${base.length} contract checks pass`);

if (process.argv.includes("--mutations")) {
  const mut = (name: string, apply: (s: Src) => Src, eligible = isCapabilityRoleEligible, presets = STAFF_ACCESS_PRESETS): [string, boolean] => {
    const r = checks(apply(structuredClone(src)), eligible, presets);
    return [name, r.some(([, ok]) => !ok)];
  };
  const swap = (k: string, a: string | RegExp, b: string) => (s: Src) => ({ ...s, [k]: s[k].replace(a, b) });
  const mutants: [string, boolean][] = [
    mut("eligibility admits Role Default editors", (s) => s, ((p: any) => !!p && p.is_active === true && ["super_admin", "admin", "editor"].includes(p.role)) as any),
    mut("eligibility ignores is_active", (s) => s, ((p: any) => !!p && (["super_admin", "admin"].includes(p.role) || (p.role === "editor" && p.access_control_enabled === true))) as any),
    mut("eligibility admits trainers", (s) => s, ((p: any) => !!p && p.is_active === true && (p.role !== "client" && p.role !== "participant")) as any),
    mut("guard drops the eligibility check", swap("session", 'if (!isCapabilityRoleEligible(profile)) redirect("/admin/no-access");', "")),
    mut("guard drops the module level check", swap("session", "await requireModuleAccess(moduleKey, level);\n  return profile;", "return profile;")),
    mut("accept quotation guarded at View", swap("sales/quotations/actions.ts", 'export async function acceptQuotationAction(quotationId: string, _prev: SalesActionState, _formData: FormData): Promise<SalesActionState> {\n  await requireModuleCapability("sales_quotations", "edit")', 'export async function acceptQuotationAction(quotationId: string, _prev: SalesActionState, _formData: FormData): Promise<SalesActionState> {\n  await requireModuleCapability("sales_quotations", "view")')),
    mut("record payment loses its guard", swap("invoices/actions.ts", /(export async function recordManualPaymentAction[\s\S]*?\{\n)\s*await requireModuleCapability\("invoices", "edit"\);/, "$1")),
    mut("HRDF payment loses the HRDF grant", swap("invoices/[id]/actions.ts", /(export async function recordHrdfPaymentAction[\s\S]*?)await requireModuleCapability\("hrdf_claims", "edit"\);[^\n]*\n/, "$1")),
    mut("cancel invoice uses wrong module", swap("invoices/actions.ts", /(export async function cancelInvoiceAction[\s\S]*?)requireModuleCapability\("invoices"/, '$1requireModuleCapability("sales_quotations"')),
    mut("task manage-others becomes Edit", (s) => ({ ...s, "sales/tasks/actions.ts": s["sales/tasks/actions.ts"].split('hasModuleCapability("sales_tasks", "admin"').join('hasModuleCapability("sales_tasks", "edit"') })),
    mut("quotation page shows buttons by admin role", swap("sales/quotations/[id]/page.tsx", "const canManage = capable && canEditQuotations;", "const canManage = isAdmin(profile.role) && canEditQuotations;")),
    mut("Sales preset gains invoices Edit", (s) => s, undefined, [{ ...SALES_STAFF_PRESET, modules: [...SALES_STAFF_PRESET.modules, { moduleKey: "invoices", accessLevel: "edit" }] } as any, FINANCE_STAFF_PRESET]),
    mut("Finance preset gains quotations Edit", (s) => s, undefined, [SALES_STAFF_PRESET, { ...FINANCE_STAFF_PRESET, modules: FINANCE_STAFF_PRESET.modules.map((m) => m.moduleKey === "sales_quotations" ? { ...m, accessLevel: "edit" } : m) } as any]),
    mut("Finance preset gains companies", (s) => s, undefined, [SALES_STAFF_PRESET, { ...FINANCE_STAFF_PRESET, modules: [...FINANCE_STAFF_PRESET.modules, { moduleKey: "companies", accessLevel: "view" }] } as any]),
    mut("M-02 drops the Custom-access condition", swap("20261201110000_rbac_m02", "and coalesce((select pr.access_control_enabled from public.profiles pr where pr.id = auth.uid()), false))", ")")),
    mut("M-02 drops is_active", swap("20261201110000_rbac_m02", "    and app.is_active()\n", "\n")),
    mut("M-02 grants anon", swap("20261201110000_rbac_m02", "grant execute on function app.can_module(text, text) to authenticated;", "grant execute on function app.can_module(text, text) to authenticated, anon;")),
    mut("M-01 keeps authenticated", swap("20261201100000_rbac_m01", "revoke execute on function public.finalize_public_registration_crm(uuid) from public, anon, authenticated;", "revoke execute on function public.finalize_public_registration_crm(uuid) from public, anon;")),
    mut("M-07 re-adds reports", swap("20261201102000_rbac_m07", "'feedback_responses'::text]", "'feedback_responses'::text, 'reports'::text]")),
    mut("M-08 keeps reports", swap("20261201103000_rbac_m08", "'backups'::text]", "'backups'::text, 'reports'::text]")),
    mut("M-09 participant DELETE at Edit", swap("20261201104000_rbac_m09", /(create policy participants_delete[\s\S]{0,200})'participants'::text, 'admin'::text/, "$1'participants'::text, 'edit'::text")),
    mut("M-05 skips one signature", swap("20261201121000_rbac_m05", /\(\$q\$public\.issue_invoice_unguarded\(uuid\)\$q\$[^\n]*\n/, "")),
    mut("M-03 rewrites existing profiles", swap("20261201111000_rbac_m03", "alter table public.profiles alter column access_control_enabled set default true;", "alter table public.profiles alter column access_control_enabled set default true;\nupdate public.profiles set access_control_enabled = true;")),
    mut("M-10 overrides keep sales_reports", swap("20261201130000_rbac_m10", /(create policy sales_lead_contact_overrides_select[^;]*?'sales_followups'::text, )/, "$1'sales_reports'::text, ")),
    mut("M-10 enquiries stays role-only", swap("20261201130000_rbac_m10", /(create policy enquiries_select[^;]*?using )\(\(app\.has_min_role[^;]*;/, "$1(app.has_min_role('editor'::public.user_role));")),
    mut("M-10 marketing_contacts drops the promoted-lead condition", swap("20261201130000_rbac_m10", / AND \(EXISTS \( SELECT 1 FROM public\.sales_lead_metadata m WHERE \(\(m\.lead_source = 'marketing_contact'::text\) AND \(m\.source_id = marketing_contacts\.id\)\)\)\)/, "")),
    mut("M-10 adds a grant", swap("20261201130000_rbac_m10", "set local lock_timeout = '5s';", "set local lock_timeout = '5s';\ngrant select on public.enquiries to anon;")),
    mut("M-10 events open to Sales", swap("20261201130000_rbac_m10", "ARRAY['marketing_contacts'::text], 'view'::text)", "ARRAY['marketing_contacts'::text, 'sales'::text], 'view'::text)")),
    mut("M-11 certificates admit reports", swap("20261201140000_rbac_m11", "'participants'::text, 'companies'::text], 'view'::text)", "'participants'::text, 'companies'::text, 'reports'::text], 'view'::text)")),
    mut("M-11 certificates stay role-only", swap("20261201140000_rbac_m11", /(create policy certificates_select[^;]*?using )\(\(app\.has_min_role[^;]*;/, "$1(app.has_min_role('trainer'::public.user_role));")),
    mut("M-11 verification log opens to participants", swap("20261201140000_rbac_m11", "ARRAY['certificates'::text], 'view'::text)", "ARRAY['certificates'::text, 'participants'::text], 'view'::text)")),
    mut("M-11 feedback admits feedback_issues", swap("20261201140000_rbac_m11", "'feedback_responses'::text, 'schedules'::text]", "'feedback_responses'::text, 'schedules'::text, 'feedback_issues'::text]")),
    mut("M-11 adds a grant", swap("20261201140000_rbac_m11", "set local lock_timeout = '5s';", "set local lock_timeout = '5s';\ngrant select on public.certificates to anon;")),
  ];
  let killed = 0;
  for (const [n, k] of mutants) { if (k) killed++; console.log(`${k ? "KILLED " : "SURVIVED"} ${n}`); }
  console.log(`${killed}/${mutants.length} mutants killed`);
  if (killed !== mutants.length) fail++;
}
process.exit(fail ? 1 : 0);
