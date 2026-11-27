// T1 Training Operations contract (OWNER-TRAINING-T1-20261125). Source-level checks that the application guards,
// the Staff User "Edit allows" table, the UI controls and the two T1 migrations agree with each other:
//  * everyday Training writes = module capability (Admin, or Editor + Custom access + module Edit);
//  * archive / restore keep the Admin role (database: app.t1_guard_soft_delete);
//  * finalising (lock), unlock and WAH corrections are Super Admin only (database: t1 accountability triggers);
//  * results carry the actual Assessor and an evidence reference (Zod here, app.t1_assert_assessment_evidence there).
// The authorization itself is proven in Docker (supabase/tests/crm_rbac/60_t1.sql); this file catches drift.
//   node --experimental-transform-types scripts/t1-training-ops-contract.test.mts [--mutations]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";

// lib/ files use extensionless relative imports (resolved by Next/TypeScript); let Node resolve them to .ts here.
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { EDIT_SCOPE, describeEditScope, summariseEditScope } = await import("../lib/auth/edit-scope.ts");
type EditScopeAction = import("../lib/auth/edit-scope.ts").EditScopeAction;

const repo = join(import.meta.dirname, "..");
const admin = join(repo, "app", "admin", "(protected)");
const FILES = ["schedules/actions.ts", "participants/actions.ts", "participants/import/importActions.ts", "trainers/actions.ts",
  "assessors/actions.ts", "attendance/actions.ts", "assessment/actions.ts"];
const UI = ["assessment/AssessmentTable.tsx", "assessment/[scheduleId]/AssessmentScheduleActions.tsx", "assessment/[scheduleId]/page.tsx",
  "schedules/[id]/page.tsx", "participants/page.tsx", "participants/[id]/page.tsx", "trainers/[id]/page.tsx", "assessors/page.tsx", "assessors/[id]/page.tsx",
  "schedules/ScheduleForm.tsx"];
const LIB = ["lib/auth/session.ts", "lib/auth/rbac.ts", "lib/validation/schemas.ts"];
const MIG_A = "supabase/migrations/20261201150000_training_t1_access.sql";
const MIG_B = "supabase/migrations/20261201151000_training_t1_identity_evidence.sql";
const RB = ["docs/security/crm-rbac/20261201150000_training_t1_access.rollback.sql", "docs/security/crm-rbac/20261201151000_training_t1_identity_evidence.rollback.sql"];
type Sources = Record<string, string>;
const real: Sources = Object.fromEntries([
  ...[...FILES, ...UI].map((f) => [f, readFileSync(join(admin, f), "utf8")]),
  ...[...LIB, MIG_A, MIG_B, ...RB].map((f) => [f, readFileSync(join(repo, f), "utf8")]),
]);
const TRAINING_MODULES = ["schedules", "participants", "trainers", "assessors", "attendance", "assessment"];
// Archive / restore: Admin role on purpose (matches app.t1_guard_soft_delete).
const ADMIN_ROLE_ALLOWED = new Set(["softDeleteSchedule", "restoreSchedule", "softDeleteParticipant", "restoreParticipant",
  "bulkDeleteParticipants", "bulkRestoreParticipants", "softDeleteTrainer", "restoreTrainer"]);

function bodies(src: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /export async function (\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const rest = src.slice(m.index);
    const next = rest.indexOf("\nexport ", 10);
    out.set(m[1], (next > 0 ? rest.slice(0, next) : rest).slice(0, 1800));
  }
  return out;
}
function guardOf(src: string, fn: string, moduleKey: string): EditScopeAction["requires"] | null {
  const head = bodies(src).get(fn);
  if (!head) return null;
  const guardPrelude = head.slice(0, 700);
  if (/requireRole\("super_admin"\)/.test(guardPrelude) || /!isSuperAdmin\(profile\.role\)\) mutationFailure\(scheduleId, "unauthorized_unlock"\)/.test(head)) return "super_admin";
  if (/requireRole\("admin"\)/.test(guardPrelude)) return "admin";
  if (new RegExp(`requireModuleCapability\\("${moduleKey}", "edit"\\)`).test(guardPrelude)) return "capability";
  if (moduleKey === "attendance" && /requireAttendance\(true\)/.test(guardPrelude)) return "capability";
  if (moduleKey === "assessment" && /requireAssessment\(true\)/.test(guardPrelude)) return "capability";
  if (moduleKey === "assessors" && /await guard\(\)/.test(guardPrelude) && /async function guard\(\)[\s\S]{0,300}requireModuleCapability\("assessors", "edit"\)/.test(src)) return "capability";
  return null;
}

type Table = typeof EDIT_SCOPE;
function runAll(s: Sources, table: Table): string[] {
  const failures: string[] = [];
  let passed = 0;
  const c = (name: string, ok: boolean) => { if (ok) passed++; else failures.push(name); };

  // 1. The Staff User "Edit allows" table mirrors the real guards.
  for (const moduleKey of TRAINING_MODULES) {
    c(`EDIT_SCOPE describes ${moduleKey}`, Array.isArray(table[moduleKey]) && table[moduleKey].length > 0);
    for (const action of table[moduleKey] ?? []) {
      const src = s[action.source.file];
      c(`${moduleKey}: "${action.label}" mirrors ${action.source.file}#${action.source.fn} (${action.requires})`, !!src && guardOf(src, action.source.fn, moduleKey) === action.requires);
    }
  }
  c("Courses and Certificates stay undescribed (Training Ops hold View only)", !table.courses && !table.certificates);

  // 2. No everyday Training action still needs the Admin role; every exported action has a guard.
  for (const f of FILES) for (const [fn, head] of bodies(s[f])) {
    if (/^(isSessionDateInRange)$/.test(fn)) continue; // helper taking a client, no request input
    const g = /requireRole\("admin"\)/.test(head.slice(0, 700));
    if (g) c(`${f}#${fn}: Admin role only for archive/restore`, ADMIN_ROLE_ALLOWED.has(fn));
    c(`${f}#${fn}: has a guard first`, /require(ModuleCapability|Role|Attendance|Assessment|ModuleAccess)\(|await guard\(\)/.test(head.slice(0, 700)));
  }
  c("setScheduleAssessor mirrors app.can_manage_schedule_assessors (Schedules Edit + Assessors View)",
    /export async function setScheduleAssessor[\s\S]{0,300}requireModuleCapability\("schedules", "edit"\)[\s\S]{0,120}requireModuleCapability\("assessors", "view"\)/.test(s["schedules/actions.ts"]));
  c("lockAssessments: Super Admin + Assessment Edit", /export async function lockAssessments[\s\S]{0,200}requireRole\("super_admin"\);\s*await requireModuleAccess\("assessment", "edit"\)/.test(s["assessment/actions.ts"]));
  c("WAH correction: Super Admin", /export async function correctWahFailedPracticalAssessment[\s\S]{0,200}requireRole\("super_admin"\)/.test(s["assessment/actions.ts"]));

  // 3. Evidence: parsed with the shared Zod schema and sent with every result write.
  const A = s["assessment/actions.ts"];
  c("assessment actions validate evidence with assessmentEvidenceSchema", /assessmentEvidenceSchema\.safeParse/.test(A) && /export const assessmentEvidenceSchema = z\.object\(\{\s*evidence_assessor_id: z\.string\(\)\.trim\(\)\.uuid/.test(s["lib/validation/schemas.ts"]));
  c("updateAssessment, bulkUpdateResult and the skills record read evidence", (A.match(/readEvidence\(formData, isSuperAdmin\(profile\.role\)\)/g) ?? []).length === 3);
  c("evidence reaches each write (upsert, bulk update, skill rows)", /assessor_id: profile\.id,[\s\S]{0,40}\.\.\.evidence,/.test(A) && /competency_status: competency, \.\.\.evidence \}/.test(A) && /deleted_at: null, \.\.\.evidence \}\);/.test(A));
  c("a blank Super Admin entry never overwrites stored evidence with null", /if \(superAdmin && raw\.evidence_assessor_id\.trim\(\) === "" && raw\.evidence_reference\.trim\(\) === ""\) return \{\};/.test(A));

  // 4. Shared guards and UI reflect the effective permissions.
  const S = s["lib/auth/session.ts"];
  c("requireAttendance(true) admits the module capability or the Trainer branch", /canManageAttendance\(profile\.role\) \|\| isCapabilityRoleEligible\(profile\)/.test(S));
  c("requireAssessment(true) admits the module capability or the Trainer branch", /canManageAssessment\(profile\.role\) \|\| isCapabilityRoleEligible\(profile\)/.test(S));
  c("schedule-level lock button is Super Admin only", /\{isSuperAdmin && \(\s*<MutationForm action=\{lockAssessments/.test(s["assessment/[scheduleId]/AssessmentScheduleActions.tsx"]));
  c("bulk lock button is Super Admin only", /\{isSuperAdmin && \(\s*<MutationForm action=\{lockAssessments/.test(s["assessment/AssessmentTable.tsx"]));
  c("WAH correction form only for Super Admin", /canCorrectFailed=\{superAdmin\}/.test(s["assessment/[scheduleId]/page.tsx"]));
  c("assessment controls need Assessment Edit", /\(canManageAssessment\(profile\.role\) \|\| isCapabilityRoleEligible\(profile\)\) && \(await hasModuleAccess\("assessment", "edit"\)\)/.test(s["assessment/[scheduleId]/page.tsx"]));
  c("every result form carries the evidence fields", (s["assessment/AssessmentTable.tsx"].match(/<EvidenceFields /g) ?? []).length === 4);
  c("schedule Delete button needs the Admin role", /canArchive = canWrite && isAdmin\(profile\.role\)/.test(s["schedules/[id]/page.tsx"]) && /\{canArchive && <form action=\{softDeleteSchedule/.test(s["schedules/[id]/page.tsx"]));
  c("participant archive/restore buttons need the Admin role", /canWrite=\{canArchive\}/.test(s["participants/page.tsx"]) && (s["participants/[id]/page.tsx"].match(/\{canArchive && /g) ?? []).length === 2);
  c("trainer archive/restore buttons need the Admin role", (s["trainers/[id]/page.tsx"].match(/\{canArchive && /g) ?? []).length === 2);
  c("assessor write controls need Assessors Edit", /canWrite = await hasModuleCapability\("assessors", "edit", profile\)/.test(s["assessors/page.tsx"]) && /\{canWrite && \(/.test(s["assessors/page.tsx"]) && /\{canWrite && <Link/.test(s["assessors/[id]/page.tsx"]));
  c("assessor pages need Assessors View capability (S-1)", /requireModuleCapability\("assessors", "view"\)/.test(s["assessors/page.tsx"]) && /requireModuleCapability\("assessors", "view"\)/.test(s["assessors/[id]/page.tsx"]));
  c("schedule form links an active trainer and keeps trainer_name", /name="trainer_id"/.test(s["schedules/ScheduleForm.tsx"]) && /name="trainer_name"/.test(s["schedules/ScheduleForm.tsx"]));

  // 5. Preset and sidebar.
  const R = s["lib/auth/rbac.ts"];
  const preset = R.slice(R.indexOf("export const TRAINING_OPS_STAFF_PRESET"), R.indexOf("export const STAFF_ACCESS_PRESETS"));
  c("Training Ops Staff preset is an Editor with Custom access", /role: "editor"/.test(preset) && /accessControlEnabled: true/.test(preset) && /department: "training_operations"/.test(preset));
  c("Training Ops Staff preset holds no admin level", !/accessLevel: "admin"/.test(preset));
  c("Training Ops Staff: Courses and Certificates View", /moduleKey: "courses", accessLevel: "view"/.test(preset) && /moduleKey: "certificates", accessLevel: "view"/.test(preset));
  c("Training Ops Staff: no Sales, Finance, HRDF, users, legacy or template module", !/moduleKey: "(sales[a-z_]*|invoices|hrdf_claims|users|legacy_import|certificate_templates|audit)"/.test(preset));
  c("sidebar honours an explicit Assessors grant for an Editor", /moduleKey === "assessors" && accessControlEnabled && role === "editor"\) return hasExplicitModule/.test(R));

  // 6. Migrations.
  const MA = s[MIG_A], MB = s[MIG_B];
  c("T1-a pins the helper bodies and policy pre-state before changing anything", /t1a_precondition_failed: app\.% body is not the reviewed pre-state/.test(MA) && /t1a_precondition_failed: policy %\.% is not the reviewed pre-state/.test(MA));
  c("T1-a: assessors_read = Assessors View (S-1)", /create policy assessors_read on public\.assessors as permissive for select to authenticated\s+using \(\( SELECT app\.can_module\('assessors'::text, 'view'::text\)/.test(MA));
  c("T1-a: no DELETE policy is changed", !/create policy \w+_delete on public\.(assessments|participant_skill_results|course_schedules|schedule_participants|participants)/.test(MA));
  c("T1-a: no certificate object is touched", !/public\.certificate|certificates_/.test(MA.replace(/--.*$/gm, "")));
  c("T1-a: audit triggers on courses, assessors, downloads", ["courses", "assessors", "downloads"].every((t) => MA.includes(`create trigger trg_${t}_audit after insert or delete or update on public.${t}`)));
  c("T1-b: nullable columns, no backfill", /add column if not exists trainer_id uuid references public\.trainers \(id\);/.test(MB) && !/update public\.(assessments|participant_skill_results|course_schedules)\s+set/i.test(MB));
  c("T1-b: lock transition needs Super Admin", /if not v_super and new\.locked and \(tg_op = 'INSERT' or not old\.locked\) then/.test(MB) && /Only a Super Admin can finalise \(lock\) a skill result/.test(MB));
  c("T1-b: locked evidence is immutable", (MB.match(/if tg_op = 'UPDATE' and old\.locked\s+and \(new\.evidence_assessor_id is distinct from old\.evidence_assessor_id/g) ?? []).length === 2);
  c("T1-b: evidence checks active + assigned Assessor", /a\.is_active/.test(MB) && /from public\.schedule_assessors sa where sa\.schedule_id = p_schedule_id and sa\.assessor_id = p_assessor_id/.test(MB) && /g\.assessor_id = p_assessor_id and g\.deleted_at is null/.test(MB));
  c("T1-b: data-entry actor forced to the signed-in user", /new\.assessor_id := v_actor;/.test(MB) && /new\.assessed_by := v_actor;/.test(MB));
  c("T1-b: WAH correction keeps its own audited path", /current_setting\('app\.wah_failed_correction', true\)/.test(MB));
  c("T1-b: archive/restore floor = Admin role on 4 tables", (MB.match(/create trigger trg_t1_soft_delete_floor before update of deleted_at on public\./g) ?? []).length === 4 && /not app\.is_admin\(\)/.test(MB));
  c("T1-b: helper functions not executable by API roles", /revoke all on function app\.t1_assert_assessment_evidence\(uuid, uuid, uuid, text\) from public, anon, authenticated;/.test(MB));
  c("rollbacks exist and the T1-b rollback refuses to drop recorded data without a backup flag", RB.every((f) => s[f].length > 0) && /t1b_rollback_refused/.test(s[RB[1]]));
  return failures.length ? failures : [`__passed:${passed}`];
}

// Behaviour of the Staff User description for the new entries.
let behaviour = 0;
const b = (name: string, fn: () => void) => { fn(); behaviour++; console.log(`ok - ${name}`); };
b("Training Ops Staff (Editor + Custom): drafts allowed; archive Admin only; finalise Super Admin only", () => {
  const s = summariseEditScope("editor", "assessment", true);
  assert.ok(s.kind === "scoped");
  assert.ok(s.allowed.includes("Enter and edit draft results with the Assessor and evidence reference"));
  assert.deepEqual(s.superAdminOnly, ["Finalise (lock) assessments", "Unlock assessments", "Correct a WAH Failed Practical Assessment"]);
  const sched = summariseEditScope("editor", "schedules", true);
  assert.ok(sched.kind === "scoped" && sched.adminOnly.includes("Archive or restore schedules") && sched.allowed.includes("Create and edit schedules"));
  assert.match(describeEditScope("editor", "assessment", true) ?? "", /Super Admin only: Finalise \(lock\) assessments/);
});
b("Admin: Training archive allowed, finalisation still Super Admin only", () => {
  const s = summariseEditScope("admin", "assessment");
  assert.ok(s.kind === "scoped" && s.adminOnly.length === 0 && s.superAdminOnly.length === 3);
});
b("Editor on Role Default: Training capability actions are not described as allowed", () => {
  const s = summariseEditScope("editor", "participants", false);
  assert.ok(s.kind === "scoped" && !s.allowed.includes("Create and edit participants") && s.needsCustomAccess.includes("Create and edit participants"));
});

const result = runAll(real, EDIT_SCOPE);
for (const f of result.filter((x) => !x.startsWith("__passed"))) console.log(`not ok - ${f}`);
assert.ok(result[0].startsWith("__passed"), `${result.length} T1 contract check(s) failed`);
const contract = Number(result[0].split(":")[1]);
console.log(`ok - ${contract} T1 guard/table/UI/migration contract checks`);
console.log(`\n# t1-training-ops: pass ${contract + behaviour} fail 0`);

if (process.argv.includes("--mutations")) {
  const AS = "assessment/actions.ts", SC = "schedules/actions.ts";
  const retag = (key: string, fn: string, requires: EditScopeAction["requires"]): Table =>
    ({ ...EDIT_SCOPE, [key]: EDIT_SCOPE[key].map((a) => (a.source.fn === fn ? { ...a, requires } : a)) });
  const mutations: Array<[string, Sources, Table]> = [
    ["lock goes back to the Trainer/Admin guard", { ...real, [AS]: real[AS].replace('const profile = await requireRole("super_admin");\n  await requireModuleAccess("assessment", "edit");\n  const ids', 'const profile = await requireAssessment(true);\n  await requireModuleAccess("assessment", "edit");\n  const ids') }, EDIT_SCOPE],
    ["WAH correction back to Admin", { ...real, [AS]: real[AS].replace('await requireRole("super_admin"); // T1 owner matrix', 'await requireRole("admin"); // T1 owner matrix') }, EDIT_SCOPE],
    ["createSchedule back to the Admin role", { ...real, [SC]: real[SC].replace(/(export async function createSchedule[\s\S]*?)requireModuleCapability\("schedules", "edit"\)/, '$1requireRole("admin")') }, EDIT_SCOPE],
    ["archive opened to the capability", { ...real, [SC]: real[SC].replace(/(export async function softDeleteSchedule[\s\S]*?)await requireRole\("admin"\);/, '$1await requireModuleCapability("schedules", "edit");') }, EDIT_SCOPE],
    ["table claims finalise is everyday work", real, retag("assessment", "lockAssessments", "capability")],
    ["table claims schedule archive is everyday work", real, retag("schedules", "softDeleteSchedule", "capability")],
    ["bulk result stops sending evidence", { ...real, [AS]: real[AS].replace("competency_status: competency, ...evidence }", "competency_status: competency }") }, EDIT_SCOPE],
    ["lock button shown to Training Ops", { ...real, ["assessment/AssessmentTable.tsx"]: real["assessment/AssessmentTable.tsx"].replace("{isSuperAdmin && (\n            <MutationForm action={lockAssessments", "{canManage && (\n            <MutationForm action={lockAssessments") }, EDIT_SCOPE],
    ["preset gains an admin level", { ...real, ["lib/auth/rbac.ts"]: real["lib/auth/rbac.ts"].replace('{ moduleKey: "schedules", accessLevel: "edit" },\n    { moduleKey: "participants"', '{ moduleKey: "schedules", accessLevel: "admin" },\n    { moduleKey: "participants"') }, EDIT_SCOPE],
    ["preset gains Certificates Edit", { ...real, ["lib/auth/rbac.ts"]: real["lib/auth/rbac.ts"].replace('{ moduleKey: "certificates", accessLevel: "view" },\n    { moduleKey: "downloads"', '{ moduleKey: "certificates", accessLevel: "edit" },\n    { moduleKey: "downloads"') }, EDIT_SCOPE],
    ["S-1 reopened: assessors_read back to any active account", { ...real, [MIG_A]: real[MIG_A].replace(/(create policy assessors_read on public\.assessors as permissive for select to authenticated\s+using \()[^\n]+/, "$1app.is_active());") }, EDIT_SCOPE],
    ["lock guard dropped from the trigger", { ...real, [MIG_B]: real[MIG_B].replace("if not v_super and new.locked and (tg_op = 'INSERT' or not old.locked) then", "if false then") }, EDIT_SCOPE],
    ["session write guard loses the capability branch", { ...real, ["lib/auth/session.ts"]: real["lib/auth/session.ts"].replace("canManageAssessment(profile.role) || isCapabilityRoleEligible(profile)", "canManageAssessment(profile.role)") }, EDIT_SCOPE],
  ];
  let killed = 0;
  for (const [name, src, table] of mutations) {
    const unchanged = Object.keys(src).every((k) => src[k] === real[k]) && table === EDIT_SCOPE;
    const r = runAll(src, table);
    const dead = !unchanged && !r[0].startsWith("__passed");
    if (dead) killed++;
    console.log(`${dead ? "ok" : "not ok"} - mutation ${dead ? "killed" : unchanged ? "NOT APPLIED" : "survived"}: ${name}`);
  }
  console.log(`# t1-training-ops mutations: ${killed}/${mutations.length} killed`);
  assert.equal(killed, mutations.length, "every mutation must apply and be killed");
}
