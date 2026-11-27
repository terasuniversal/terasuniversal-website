// Generates the two Training T1 migrations (and their rollbacks) from a fixture at the post-M11 state.
// It writes ONLY the T1 files, so M01-M11 (already released) are never regenerated.
//   node supabase/tests/crm_rbac/gen_t1.mjs <container-at-post-M11-state>
// Approval: OWNER-TRAINING-T1-20261125 (local and Docker only).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const C = process.argv[2] ?? "rbact1g";
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const MIG = join(ROOT, "supabase/migrations");
const RB = join(ROOT, "docs/security/crm-rbac");
const psql = (sql) =>
  execFileSync("docker", ["exec", "-i", C, "psql", "-U", "postgres", "-h", "localhost", "-X", "-At", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const lit = (s) => (s === null || s === undefined ? "null" : `$q$${s}$q$`);

function policyState(table, name) {
  const out = psql(`select json_build_object('cmd',cmd,'roles',array_to_string(roles,','),'qual',qual,'with_check',with_check)
    from pg_policies where schemaname='public' and tablename='${table}' and policyname='${name}';`);
  if (!out) throw new Error(`policy not found in fixture: ${table}.${name}`);
  return JSON.parse(out);
}
function fnState(name) {
  const out = psql(`select json_build_object('md5', md5(p.prosrc), 'def', pg_get_functiondef(p.oid)) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = '${name}';`);
  if (!out) throw new Error(`function not found: app.${name}`);
  return JSON.parse(out);
}
const createPolicy = (table, name, cmd, roles, using, check) =>
  `create policy ${name} on public.${table} as permissive for ${cmd.toLowerCase()} to ${roles}` +
  (using == null ? "" : `\n  using (${using})`) + (check == null ? "" : `\n  with check (${check})`) + ";";

const CAP = (m, l) => `( SELECT app.can_module('${m}'::text, '${l}'::text) AS can_module)`;
const HAMA = (ms, l) => `( SELECT app.has_any_module_access(ARRAY[${ms.map((m) => `'${m}'::text`).join(", ")}], '${l}'::text) AS has_any_module_access)`;
const TRB = `(app.is_admin_or_trainer() AND (NOT app.is_admin()))`;
const ATT = `(${CAP("attendance", "edit")} OR ${TRB})`;
const ASM = `(${CAP("assessment", "edit")} OR ${TRB})`;
const SCHED_READ = `(app.has_min_role('trainer'::public.user_role) AND ${HAMA(["schedules", "attendance", "assessment", "assessors", "dashboard"], "view")})`;

// ============================== T1-a: Training Operations access (policies + helper functions + audit) ==============
const changes = [
  // S-1: Assessor identity numbers, phone and e-mail only for Assessors module holders (was: any active account).
  { table: "assessors", name: "assessors_read", using: CAP("assessors", "view"), check: null },
  { table: "schedule_assessors", name: "schedule_assessors_read", using: SCHED_READ, check: null },
  { table: "schedule_groups", name: "schedule_groups_read", using: SCHED_READ, check: null },
  // Writes: Admin-role-only -> module capability (Editor with Custom access, Admin, Super Admin).
  { table: "course_schedules", name: "course_schedules_insert", using: null, check: CAP("schedules", "edit") },
  { table: "course_schedules", name: "course_schedules_update", using: CAP("schedules", "edit"), check: CAP("schedules", "edit") },
  { table: "schedule_participants", name: "schedule_participants_insert", using: null, check: CAP("schedules", "edit") },
  { table: "schedule_participants", name: "schedule_participants_update", using: CAP("schedules", "edit"), check: CAP("schedules", "edit") },
  { table: "participants", name: "participants_insert", using: null, check: CAP("participants", "edit") },
  { table: "participants", name: "participants_update", using: CAP("participants", "edit"), check: CAP("participants", "edit") },
  { table: "attendance", name: "attendance_insert", using: null, check: ATT },
  { table: "attendance", name: "attendance_update", using: ATT, check: ATT },
  { table: "attendance", name: "attendance_delete", using: ATT, check: null },
  { table: "assessments", name: "assessments_insert", using: null, check: ASM },
  { table: "assessments", name: "assessments_update_unlocked", using: `(${ASM} AND (locked = false))`, check: ASM },
  { table: "participant_skill_results", name: "participant_skill_results_insert", using: null, check: ASM },
  { table: "participant_skill_results", name: "participant_skill_results_update", using: ASM, check: ASM },
].map((c) => ({ ...c, old: policyState(c.table, c.name) }));
// F1-a: the normalised qual Postgres stores for the approved attendance_delete (read back, never hand-written).
const ATT_DELETE_QUAL = psql(`begin;
drop policy if exists attendance_delete on public.attendance;
${createPolicy("attendance", "attendance_delete", "DELETE", "authenticated", ATT, null)}
select qual from pg_policies where schemaname = 'public' and tablename = 'attendance' and policyname = 'attendance_delete';
rollback;`).split("\n").filter((l) => l && l !== "BEGIN" && l !== "DROP POLICY" && l !== "CREATE POLICY" && l !== "ROLLBACK").join("\n");
if (!ATT_DELETE_QUAL.includes("can_module")) throw new Error("could not read the approved attendance_delete qual");

const helpers = [
  { name: "can_manage_trainers", body: "select app.can_module('trainers', 'edit');" },
  { name: "can_manage_assessors", body: "select app.can_module('assessors', 'edit');" },
  { name: "can_manage_schedule_assessors", body: "select app.can_module('schedules', 'edit') and app.can_module('assessors', 'view');" },
  { name: "can_manage_schedule_groups", body: "select app.can_module('schedules', 'edit');" },
].map((h) => ({ ...h, old: fnState(h.name) }));
const helperDef = (name, body) => `create or replace function app.${name}()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  ${body}
$function$;`;
const AUDIT_TABLES = ["courses", "assessors", "downloads"];

const preRows = changes.map((c) => `      (${lit(c.table)}, ${lit(c.name)}, ${lit(c.old.cmd)}, ${lit(c.old.roles)}, ${lit(c.old.qual)}, ${lit(c.old.with_check)})`).join(",\n");
const fnRows = helpers.map((h) => `      (${lit(h.name)}, ${lit(h.old.md5)})`).join(",\n");
const body = changes.map((c) => `drop policy if exists ${c.name} on public.${c.table};\n${createPolicy(c.table, c.name, c.old.cmd, c.old.roles, c.using, c.check)}`).join("\n\n");
const sqlA = `-- Training T1-a: Training Operations Staff access (Editor + explicit module capability; no Admin role needed).
-- Approval: OWNER-TRAINING-T1-20261125. LOCAL AND DOCKER ONLY until a separate GO.
-- Before: every Training write (schedules, enrolments, participants, attendance, assessments, skill results) required
-- the Admin role (app.is_admin() AND module), so Training work could only be delegated by granting Admin - which also
-- opens the Admin-only public-registration, legacy and profile reads (F-04). Trainers/assessors/schedule assessor and
-- group management required Admin or an Admin-level module grant. public.assessors (identity number, phone, e-mail)
-- and the schedule assessor/group assignments were readable by ANY active account (S-1).
-- After:
--  * writes use app.can_module(<module>, 'edit') - active, catalog-active, Admin OR Editor with Custom access, and the
--    explicit module grant. Admin/Super Admin keep exactly their previous access. The Trainer branch on attendance /
--    assessments / skill results is kept unchanged (no Trainer accounts exist; nothing is widened for trainers).
--  * attendance_delete IS changed (F1-a, Owner-approved): it backs Attendance Undo (resetAttendance returns a session
--    mark to "not recorded"; the live enum has no pending value), so it follows Attendance Edit like insert/update.
--    The postcondition pins its exact text, and 20261201151000 keeps finalised attendance (locked assessment or an
--    issued certificate) Super Admin only and writes a detailed audit row for every Undo.
--  * Every other DELETE policy, assessments_update_super_admin and all certificate objects are NOT changed
--    (Admin-level grants, which Training Ops Staff does not hold, are still required to delete).
--  * S-1: assessors SELECT requires Assessors View; schedule_assessors / schedule_groups SELECT require a Training
--    module (schedules, attendance, assessment, assessors or dashboard) above the trainer floor.
--  * helpers: can_manage_trainers = Trainers Edit, can_manage_assessors = Assessors Edit (adds the missing Editor
--    floor), can_manage_schedule_assessors = Schedules Edit + Assessors View, can_manage_schedule_groups = Schedules Edit.
--  * audit trigger (existing app.audit_trigger) added to courses, assessors and downloads.
-- Requires 20261201110000 (app.can_module) and 20261201140000 (M-11).

do $t1a_requires$
declare r record;
begin
  if to_regprocedure('app.can_module(text,text)') is null or to_regprocedure('app.has_any_module_access(text[],text)') is null then
    raise exception 't1a_precondition_failed: app.can_module / app.has_any_module_access missing - nothing changed' using errcode = 'P0001';
  end if;
  for r in select * from (values
${fnRows}
    ) as t(fn, md5) loop
    if (select md5(p.prosrc) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = r.fn) is distinct from r.md5 then
      raise exception 't1a_precondition_failed: app.% body is not the reviewed pre-state - nothing changed', r.fn using errcode = 'P0001';
    end if;
  end loop;
  for r in select * from unnest(array[${AUDIT_TABLES.map((t) => `'${t}'`).join(", ")}]) as u(tbl) loop
    if exists (select 1 from pg_trigger where tgrelid = ('public.' || r.tbl)::regclass and tgname = 'trg_' || r.tbl || '_audit') then
      raise exception 't1a_precondition_failed: trg_%_audit already exists - nothing changed', r.tbl using errcode = 'P0001';
    end if;
  end loop;
end;
$t1a_requires$;

set local lock_timeout = '5s';

do $t1a_pre$
declare r record;
begin
  for r in
    select * from (values
${preRows}
    ) as t(tbl, pol, cmd, roles, qual, chk)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles and p.permissive = 'PERMISSIVE'
                     and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk) then
      raise exception 't1a_precondition_failed: policy %.% is not the reviewed pre-state - nothing changed', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$t1a_pre$;

${helpers.map((h) => helperDef(h.name, h.body)).join("\n\n")}

${body}

${AUDIT_TABLES.map((t) => `create trigger trg_${t}_audit after insert or delete or update on public.${t} for each row execute function app.audit_trigger();`).join("\n")}

do $t1a_post$
declare r record;
begin
  -- every changed policy now uses the module capability helpers and none still relies on app.is_active() alone
  for r in select * from (values ${changes.map((c) => `(${lit(c.table)}, ${lit(c.name)})`).join(", ")}) as t(tbl, pol) loop
    if not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol
                   and (position('can_module' in coalesce(p.qual, '') || coalesce(p.with_check, '')) > 0
                        or position('has_any_module_access' in coalesce(p.qual, '')) > 0)) then
      raise exception 't1a_postcondition_failed: policy %.% is not as intended', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
  -- S-1: exactly one SELECT policy for anon/authenticated on the assessor tables, and none is app.is_active() alone
  for r in select * from unnest(array['assessors', 'schedule_assessors', 'schedule_groups']) as u(tbl) loop
    if (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.cmd in ('SELECT', 'ALL')
          and p.roles && array['public', 'anon', 'authenticated']::name[]) <> 1
       or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.cmd in ('SELECT', 'ALL')
                  and p.roles && array['public', 'anon', 'authenticated']::name[] and btrim(p.qual) = 'app.is_active()') then
      raise exception 't1a_postcondition_failed: % still has an open or duplicate SELECT policy', r.tbl using errcode = 'P0001';
    end if;
  end loop;
  -- F1-a: attendance has exactly one DELETE-capable policy for client roles, and it is exactly the approved text
  if (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = 'attendance' and p.cmd in ('DELETE', 'ALL')
        and p.roles && array['public', 'anon', 'authenticated']::name[]) <> 1
     or not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = 'attendance'
                    and p.policyname = 'attendance_delete' and p.cmd = 'DELETE' and p.permissive = 'PERMISSIVE'
                    and array_to_string(p.roles, ',') = 'authenticated' and p.with_check is null
                    and p.qual = ${lit(ATT_DELETE_QUAL)}) then
    raise exception 't1a_postcondition_failed: attendance_delete is not exactly the approved Attendance Undo policy' using errcode = 'P0001';
  end if;
  -- every other Training DELETE policy is unchanged: still requires an Admin-level module grant
  if (select count(*) from pg_policies p where p.schemaname = 'public' and p.cmd = 'DELETE'
        and p.tablename in ('assessments', 'participant_skill_results', 'course_schedules', 'schedule_participants', 'participants')
        and position('''admin''::text' in p.qual) > 0) <> 5 then
    raise exception 't1a_postcondition_failed: a Training DELETE policy no longer requires an Admin-level grant' using errcode = 'P0001';
  end if;
  for r in select * from unnest(array[${AUDIT_TABLES.map((t) => `'${t}'`).join(", ")}]) as u(tbl) loop
    if not exists (select 1 from pg_trigger where tgrelid = ('public.' || r.tbl)::regclass and tgname = 'trg_' || r.tbl || '_audit') then
      raise exception 't1a_postcondition_failed: trg_%_audit missing', r.tbl using errcode = 'P0001';
    end if;
  end loop;
end;
$t1a_post$;
`;
const rbA = `-- ROLLBACK for 20261201150000_training_t1_access.sql (local design artefact; separate Owner approval required to run anywhere).
-- Restores the previous policies, helper bodies and removes the three audit triggers added by T1-a.
set local lock_timeout = '5s';
${AUDIT_TABLES.map((t) => `drop trigger if exists trg_${t}_audit on public.${t};`).join("\n")}

${helpers.map((h) => h.old.def.trim() + ";").join("\n\n")}

${changes.map((c) => `drop policy if exists ${c.name} on public.${c.table};\n${createPolicy(c.table, c.name, c.old.cmd, c.old.roles, c.old.qual, c.old.with_check)}`).join("\n\n")}
`;
writeFileSync(join(MIG, "20261201150000_training_t1_access.sql"), sqlA);
writeFileSync(join(RB, "20261201150000_training_t1_access.rollback.sql"), rbA);
console.log(`wrote 20261201150000_training_t1_access.sql (${changes.length} policies, ${helpers.length} helpers, ${AUDIT_TABLES.length} audit triggers)`);
