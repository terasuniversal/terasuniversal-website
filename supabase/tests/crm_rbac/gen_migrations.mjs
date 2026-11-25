// Generates the nine RBAC hardening migrations (and their rollback scripts) from the reviewed design.
// Pre-state text is read from the local fixture (built by build_fixture.sh, proven equal to Production by fingerprint)
// and embedded verbatim, so each migration fails closed if the target database has drifted.
// Usage: node supabase/tests/crm_rbac/gen_migrations.mjs <fixture-container>
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const C = process.argv[2] ?? "rbacdev";
const ROOT = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const MIG = join(ROOT, "supabase/migrations");
const RB = join(ROOT, "docs/security/crm-rbac");
mkdirSync(RB, { recursive: true });

const psql = (sql) =>
  execFileSync("docker", ["exec", "-i", C, "psql", "-U", "postgres", "-h", "localhost", "-X", "-At", "-v", "ON_ERROR_STOP=1"], { input: sql, encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const lit = (s) => (s === null || s === undefined ? "null" : `$q$${s}$q$`);
const ident = (s) => (/^[a-z_][a-z0-9_]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);

function policyState(table, name) {
  const out = psql(`select json_build_object('cmd',cmd,'roles',array_to_string(roles,','),'permissive',permissive,'qual',qual,'with_check',with_check)
    from pg_policies where schemaname='public' and tablename='${table}' and policyname='${name.replace(/'/g, "''")}';`);
  if (!out) throw new Error(`policy not found in fixture: ${table}.${name}`);
  return JSON.parse(out);
}
function createPolicy(table, name, cmd, roles, using, check) {
  const u = using == null ? "" : `\n  using (${using})`;
  const w = check == null ? "" : `\n  with check (${check})`;
  return `create policy ${ident(name)} on public.${table} as permissive for ${cmd.toLowerCase()} to ${roles}${u}${w};`;
}

// ---- shared policy-migration emitter -------------------------------------------------------------------------
function policyMigration({ version, slug, tag, header, changes, extraSql = "", extraPost = "", extraRollback = "" }) {
  const pre = changes.map((c) => ({ ...c, old: policyState(c.table, c.name) }));
  const preRows = pre.map((c) => `      (${lit(c.table)}, ${lit(c.name)}, ${lit(c.old.cmd)}, ${lit(c.old.roles)}, ${lit(c.old.qual)}, ${lit(c.old.with_check)})`).join(",\n");
  const body = pre.map((c) => `drop policy if exists ${ident(c.name)} on public.${c.table};\n${createPolicy(c.table, c.name, c.cmd ?? c.old.cmd, c.roles ?? c.old.roles, c.using === undefined ? c.old.qual : c.using, c.check === undefined ? c.old.with_check : c.check)}`).join("\n\n");
  const postRows = pre.map((c) => `      (${lit(c.table)}, ${lit(c.name)}, ${lit(c.cmd ?? c.old.cmd)}, ${lit(c.roles ?? c.old.roles)}, ${lit(c.token)})`).join(",\n");
  const sql = `${header.trim()}

set local lock_timeout = '5s';

do $${tag}_pre$
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
      raise exception '${tag}_precondition_failed: policy %.% is not the reviewed pre-state - nothing changed', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$${tag}_pre$;

${body}
${extraSql}
do $${tag}_post$
declare r record;
begin
  for r in
    select * from (values
${postRows}
    ) as t(tbl, pol, cmd, roles, token)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles
                     and position(r.token in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) > 0) then
      raise exception '${tag}_postcondition_failed: policy %.% is not as intended', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;${extraPost}
end;
$${tag}_post$;
`;
  const rollback = `-- ROLLBACK for ${version}_${slug}.sql (local design artefact; separate Owner approval required to run anywhere).
-- Re-creates the previous policies verbatim (captured from the Production-equivalent fixture, 2026-11-24).
set local lock_timeout = '5s';
${pre.map((c) => `drop policy if exists ${ident(c.name)} on public.${c.table};\n${createPolicy(c.table, c.name, c.old.cmd, c.old.roles, c.old.qual, c.old.with_check)}`).join("\n\n")}
${extraRollback}`;
  writeFileSync(join(MIG, `${version}_${slug}.sql`), sql);
  writeFileSync(join(RB, `${version}_${slug}.rollback.sql`), rollback);
  console.log(`wrote ${version}_${slug}.sql (${pre.length} policies)`);
}

// ---- shared function-gate emitter (replaces exactly one gate line, pins the body hash) -------------------------
function gateMigration({ version, slug, tag, header, gates, requires = [] }) {
  const { forward, rollback } = gateBlocks(tag, gates);
  // Plpgsql bodies are not resolved at CREATE time, so a gate that calls a helper must check it exists first.
  const req = requires.length ? `do $${tag}_requires$
begin
${requires.map((r) => `  if to_regprocedure('${r}') is null then
    raise exception '${tag}_precondition_failed: ${r} is missing - apply its migration first; nothing changed' using errcode = 'P0001';
  end if;`).join("\n")}
end;
$${tag}_requires$;

` : "";
  const sql = `${header.trim()}

set local lock_timeout = '5s';

${req}${forward}
`;
  const rb = `-- ROLLBACK for ${version}_${slug}.sql (local design artefact; separate Owner approval required to run anywhere).
-- Restores each original gate line; every other byte of each body is kept (the forward step changed only that line).
set local lock_timeout = '5s';

${rollback}
`;
  writeFileSync(join(MIG, `${version}_${slug}.sql`), sql);
  writeFileSync(join(RB, `${version}_${slug}.rollback.sql`), rb);
  console.log(`wrote ${version}_${slug}.sql (${gates.length} functions)`);
}

function gateBlocks(tag, gates) {
  const rows = gates.map((g) => {
    const md5 = psql(`select md5(replace(prosrc, chr(13), '')) from pg_proc where oid = to_regprocedure('${g.sig}');`);
    if (!md5) throw new Error(`function not found: ${g.sig}`);
    return { ...g, md5 };
  });
  const values = (dir) => rows.map((g) => `      (${lit(g.sig)}, ${lit(g.md5)}, ${lit(dir ? g.from : g.to)}, ${lit(dir ? g.to : g.from)})`).join(",\n");
  const block = (name, dir, mode) => `do $${name}$
declare
  r record; v_src text; v_def text; v_acl text; v_n int; v_expect text;
begin
  for r in
    select * from (values
${values(dir)}
    ) as t(sig, body_md5, old_line, new_line)
  loop
    select prosrc, coalesce(proacl::text, '') into v_src, v_acl from pg_proc where oid = to_regprocedure(r.sig);
    if v_src is null then
      raise exception '${tag}_precondition_failed: % does not exist - nothing changed', r.sig using errcode = 'P0001';
    end if;
    ${mode === "forward"
      ? "if md5(replace(v_src, chr(13), '')) <> r.body_md5 then"
      : "if md5(replace(replace(v_src, chr(13), ''), r.old_line, r.new_line)) <> r.body_md5 then"}
      raise exception '${tag}_precondition_failed: % body is not the reviewed ${mode === "forward" ? "pre" : "post"}-state - nothing changed', r.sig using errcode = 'P0001';
    end if;
    v_n := (length(v_src) - length(replace(v_src, r.old_line, ''))) / length(r.old_line);
    if v_n <> 1 then
      raise exception '${tag}_precondition_failed: % has % occurrence(s) of the gate line, expected 1', r.sig, v_n using errcode = 'P0001';
    end if;
    v_expect := md5(replace(v_src, r.old_line, r.new_line));
    v_def := replace(pg_get_functiondef(to_regprocedure(r.sig)), r.old_line, r.new_line);
    execute v_def;
    if (select md5(prosrc) from pg_proc where oid = to_regprocedure(r.sig)) <> v_expect
       or (select coalesce(proacl::text, '') from pg_proc where oid = to_regprocedure(r.sig)) <> v_acl then
      raise exception '${tag}_postcondition_failed: % changed beyond the gate line or its ACL changed', r.sig using errcode = 'P0001';
    end if;
  end loop;
end;
$${name}$;`;
  return { forward: block(`${tag}_gates`, true, "forward"), rollback: block(`${tag}_rollback`, false, "rollback") };
}

const HMAL = (m, l) => `( SELECT public.has_module_access_level('${m}'::text, '${l}'::text) AS has_module_access_level)`;
const HAMA = (ms, l) => `( SELECT app.has_any_module_access(ARRAY[${ms.map((m) => `'${m}'::text`).join(", ")}], '${l}'::text) AS has_any_module_access)`;
const CAN = (m, l) => `( SELECT app.can_module('${m}'::text, '${l}'::text) AS can_module)`;
const ADMIN_MOD = (m, l) => `(app.is_admin() AND ${HMAL(m, l)})`;
const TRAINER_BRANCH = `(app.is_admin_or_trainer() AND (NOT app.is_admin()))`;

// =============================== DB A (narrowing only) =========================================================
// M-01 is hand-written (ACL only). M-06, M-07, M-08, M-09 below.

policyMigration({
  version: "20261201101000", slug: "rbac_m06_invoice_items_select", tag: "m06",
  header: `-- RBAC M-06 (M1): invoice line items readable only by staff who may read invoices.
-- Before: invoice_items_select = TO public USING app.has_min_role('editor') - every active editor/admin, including Sales
-- and Management staff without the invoices module, could read every invoice line through PostgREST.
-- After: the same rule as invoices_select (editor floor AND invoices module at View or above), TO authenticated.
-- Narrowing only. Writers are SECURITY DEFINER RPCs owned by postgres (no INSERT/UPDATE/DELETE policy is involved).
-- Approval: OWNER-CRM-RBAC-DEV-20261124 (local development; not applied anywhere).`,
  changes: [{ table: "invoice_items", name: "invoice_items_select", roles: "authenticated",
    using: `(app.has_min_role('editor'::public.user_role) AND ${HAMA(["invoices"], "view")})`, token: "has_any_module_access" }],
});

policyMigration({
  version: "20261201102000", slug: "rbac_m07_participants_select_minimum", tag: "m07",
  header: `-- RBAC M-07 (M2-min, D-14): participant rows readable only for legitimate operational modules.
-- Before: participants_select = has_min_role('editor') - every active editor/admin (Sales, Finance, Management) could
-- read every participant row, including IC/passport, phone and address columns, through PostgREST.
-- After: editor floor (unchanged - Trainers are NOT newly admitted) AND View on one of the operational modules that
-- render participant data: participants, schedules, attendance, assessment, certificates, companies, feedback,
-- feedback_responses. 'reports' is deliberately NOT in the list: the Reports module gets the minimum columns it shows
-- (id, participant_id, full_name, company, status, created_at) through public.get_report_participants(), and the
-- participant total through public.get_report_participant_count(). Both are SECURITY DEFINER with a fixed
-- search_path, gated by the same rule the Reports page uses (editor floor AND reports View), EXECUTE authenticated only.
-- Narrowing for table reads; the two RPCs expose strictly fewer columns than the previous table policy did.
-- Approval: OWNER-CRM-RBAC-DEV-20261124 (local development; not applied anywhere).`,
  changes: [{ table: "participants", name: "participants_select",
    using: `(app.has_min_role('editor'::public.user_role) AND ${HAMA(["participants", "schedules", "attendance", "assessment", "certificates", "companies", "feedback", "feedback_responses"], "view")})`,
    token: "has_any_module_access" }],
  extraSql: `
create or replace function public.get_report_participants(p_limit integer default null)
returns table (id uuid, participant_id text, full_name text, company text, status text, created_at timestamptz)
language sql stable security definer set search_path to 'pg_catalog', 'public'
as $f$
  select p.id, p.participant_id, p.full_name, p.company, p.status, p.created_at
  from public.participants p
  where p.deleted_at is null
    and app.has_min_role('editor'::public.user_role)
    and public.has_module_access_level('reports', 'view')
  order by p.created_at desc
  limit case when p_limit is null then null else greatest(least(p_limit, 10000), 0) end;
$f$;

create or replace function public.get_report_participant_count()
returns bigint
language sql stable security definer set search_path to 'pg_catalog', 'public'
as $f$
  select case when app.has_min_role('editor'::public.user_role) and public.has_module_access_level('reports', 'view')
              then (select count(*) from public.participants p where p.deleted_at is null) else null end;
$f$;

revoke all on function public.get_report_participants(integer) from public, anon, service_role;
revoke all on function public.get_report_participant_count() from public, anon, service_role;
grant execute on function public.get_report_participants(integer) to authenticated;
grant execute on function public.get_report_participant_count() to authenticated;
`,
  extraPost: `
  if has_function_privilege('anon', 'public.get_report_participants(integer)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.get_report_participants(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_report_participant_count()', 'EXECUTE') then
    raise exception 'm07_postcondition_failed: report RPC privileges are not as intended' using errcode = 'P0001';
  end if;`,
  extraRollback: `
drop function if exists public.get_report_participants(integer);
drop function if exists public.get_report_participant_count();
`,
});

policyMigration({
  version: "20261201103000", slug: "rbac_m08_audit_logs_scope", tag: "m08",
  header: `-- RBAC M-08 (M3-min, D-14): the ordinary Reports grant no longer opens the security audit log.
-- Before: audit_staff_read = is_admin() AND any View of [audit, automation, backups, reports].
-- After: is_admin() AND any View of [audit, automation, backups] - the modules whose pages are the audit log itself,
-- the Automation run log and the Backups log. The Reports page "recent activity" panel simply returns no rows for a
-- reports-only holder (RLS filtering, no error). Narrowing only; the audit trigger and log_event writers are unchanged.
-- Approval: OWNER-CRM-RBAC-DEV-20261124 (local development; not applied anywhere).`,
  changes: [{ table: "audit_logs", name: "audit_staff_read",
    using: `(app.is_admin() AND ${HAMA(["audit", "automation", "backups"], "view")})`, token: "'backups'::text], 'view'" }],
});

const TRN = (mod) => `(${ADMIN_MOD(mod, "edit")} OR ${TRAINER_BRANCH})`;
// The seven SECURITY DEFINER legacy-import RPCs: same logical change (D-13), so the gate block lives in M-09.
const LEGACY = gateBlocks("m09_rpc",
  ["legacy_course_map_approve(uuid,uuid,uuid)", "legacy_import_create_batch(text,text,text)", "legacy_import_ingest_rows(uuid,jsonb)",
    "legacy_merge_dry_run(uuid)", "legacy_merge_execute_row(uuid,uuid)", "legacy_merge_finalize_batch(uuid)", "legacy_merge_verify_checkpoint(uuid)"]
    .map((s) => ({ sig: `public.${s}`, from: "if not app.is_admin() then", to: "if not (app.is_admin() and public.has_module_access_level('legacy_import', 'admin')) then" })));
policyMigration({
  extraSql: `\n-- Legacy-import RPC gates: exactly one line per body; pinned hash, single occurrence, ACL compared.\n${LEGACY.forward}\n`,
  extraRollback: `\n${LEGACY.rollback}\n`,
  version: "20261201104000", slug: "rbac_m09_training_ops_write_narrowing", tag: "m09",
  header: `-- RBAC M-09 (D-13): Training Operations writes and destructive DELETEs require the matching module.
-- Finding (read-only, Production 2026-11-24): these write policies checked the role only (app.is_admin() or
-- app.is_admin_or_trainer()). Every active departmental admin (Sales, Finance, Management - none of whom hold any
-- Training module) could insert/update/hard-delete participants, schedules, enrolments, attendance, assessments and
-- skill results through PostgREST; deleting a participant or schedule cascades to attendance, assessments,
-- enrolments, skill results and feedback. Content and course DELETE was likewise role-only (courses has no audit trigger).
--
-- Rule: each new expression = the previous role condition AND a module condition. Nothing is widened.
--   * INSERT/UPDATE: module at Edit.  DELETE: module at Admin (no application path hard-deletes these rows; the
--     app soft-deletes via UPDATE deleted_at), except attendance DELETE which stays at Edit (attendance reset).
--   * Trainer branch unchanged: (app.is_admin_or_trainer() AND NOT app.is_admin()) is exactly what the old
--     is_admin_or_trainer() admitted beyond admins. Trainer scoping (M6) remains backlog.
--   * Module keys follow the Server Actions that legitimately write each table:
--       participants -> participants      schedule_participants, course_schedules -> schedules
--       (the sync_schedule_seats trigger runs as the invoker and updates course_schedules when enrolments change;
--        both tables therefore use the schedules module so legitimate enrolment keeps working)
--       attendance -> attendance  assessments, participant_skill_results -> assessment
--       certificate_templates -> certificate_templates or certificates (the templates screen guards 'certificates')
--       course_commercial_profiles -> courses  legacy_* -> legacy_import at Admin (matches the legacy-import actions)
--       certificate_import_logs -> certificates  courses/news_posts/faqs/downloads/gallery_images/media DELETE -> own module
--   * The seven SECURITY DEFINER legacy_* RPCs get the same legacy_import Admin condition on their single
--     'if not app.is_admin() then' gate (body otherwise byte-for-byte unchanged; see the gate block below).
-- NOT changed: SELECT policies, assessments_update_super_admin, certificate/verification functions and routes,
-- SECURITY DEFINER registration finalisation (owner postgres bypasses RLS), triggers, grants.
-- Super Admin passes everywhere through has_module_access_level. Staff without access control keep role-default access.
-- Approval: OWNER-CRM-RBAC-DEV-20261124 (local development; not applied anywhere).`,
  changes: [
    { table: "participants", name: "participants_insert", check: ADMIN_MOD("participants", "edit"), token: "'participants'::text, 'edit'" },
    { table: "participants", name: "participants_update", using: ADMIN_MOD("participants", "edit"), check: ADMIN_MOD("participants", "edit"), token: "'participants'::text, 'edit'" },
    { table: "participants", name: "participants_delete", using: ADMIN_MOD("participants", "admin"), token: "'participants'::text, 'admin'" },
    { table: "schedule_participants", name: "schedule_participants_insert", check: ADMIN_MOD("schedules", "edit"), token: "'schedules'::text, 'edit'" },
    { table: "schedule_participants", name: "schedule_participants_update", using: ADMIN_MOD("schedules", "edit"), check: ADMIN_MOD("schedules", "edit"), token: "'schedules'::text, 'edit'" },
    { table: "schedule_participants", name: "schedule_participants_delete", using: ADMIN_MOD("schedules", "admin"), token: "'schedules'::text, 'admin'" },
    { table: "course_schedules", name: "course_schedules_insert", check: ADMIN_MOD("schedules", "edit"), token: "'schedules'::text, 'edit'" },
    { table: "course_schedules", name: "course_schedules_update", using: ADMIN_MOD("schedules", "edit"), check: ADMIN_MOD("schedules", "edit"), token: "'schedules'::text, 'edit'" },
    { table: "course_schedules", name: "course_schedules_delete", using: ADMIN_MOD("schedules", "admin"), token: "'schedules'::text, 'admin'" },
    { table: "attendance", name: "attendance_insert", check: TRN("attendance"), token: "'attendance'::text, 'edit'" },
    { table: "attendance", name: "attendance_update", using: TRN("attendance"), check: TRN("attendance"), token: "'attendance'::text, 'edit'" },
    { table: "attendance", name: "attendance_delete", using: TRN("attendance"), token: "'attendance'::text, 'edit'" },
    { table: "assessments", name: "assessments_insert", check: TRN("assessment"), token: "'assessment'::text, 'edit'" },
    { table: "assessments", name: "assessments_update_unlocked", using: `(${TRN("assessment")} AND (locked = false))`, check: TRN("assessment"), token: "'assessment'::text, 'edit'" },
    { table: "assessments", name: "assessments_delete", using: ADMIN_MOD("assessment", "admin"), token: "'assessment'::text, 'admin'" },
    { table: "participant_skill_results", name: "participant_skill_results_insert", check: TRN("assessment"), token: "'assessment'::text, 'edit'" },
    { table: "participant_skill_results", name: "participant_skill_results_update", using: TRN("assessment"), check: TRN("assessment"), token: "'assessment'::text, 'edit'" },
    { table: "participant_skill_results", name: "participant_skill_results_delete", using: ADMIN_MOD("assessment", "admin"), token: "'assessment'::text, 'admin'" },
    { table: "certificate_templates", name: "cert_templates_admin_write",
      using: `(app.is_admin() AND ${HAMA(["certificate_templates", "certificates"], "edit")})`, check: `(app.is_admin() AND ${HAMA(["certificate_templates", "certificates"], "edit")})`, token: "'certificates'::text], 'edit'" },
    { table: "course_commercial_profiles", name: "course_commercial_profiles_insert", check: ADMIN_MOD("courses", "edit"), token: "'courses'::text, 'edit'" },
    { table: "course_commercial_profiles", name: "course_commercial_profiles_update", using: ADMIN_MOD("courses", "edit"), check: ADMIN_MOD("courses", "edit"), token: "'courses'::text, 'edit'" },
    { table: "course_commercial_profiles", name: "course_commercial_profiles_delete", using: ADMIN_MOD("courses", "admin"), token: "'courses'::text, 'admin'" },
    ...["legacy_course_map", "legacy_import_batches", "legacy_participant_staging"].flatMap((t) => [
      { table: t, name: `${t}_insert`, check: ADMIN_MOD("legacy_import", "admin"), token: "'legacy_import'::text, 'admin'" },
      { table: t, name: `${t}_update`, using: ADMIN_MOD("legacy_import", "admin"), check: ADMIN_MOD("legacy_import", "admin"), token: "'legacy_import'::text, 'admin'" },
      { table: t, name: `${t}_delete`, using: ADMIN_MOD("legacy_import", "admin"), token: "'legacy_import'::text, 'admin'" },
    ]),
    { table: "certificate_import_logs", name: "Admins can create import logs",
      check: `((created_by = auth.uid()) AND app.is_admin() AND ${HMAL("certificates", "edit")})`, token: "'certificates'::text, 'edit'" },
    { table: "courses", name: "courses_delete", using: ADMIN_MOD("courses", "admin"), token: "'courses'::text, 'admin'" },
    { table: "news_posts", name: "news_posts_admin_delete", using: ADMIN_MOD("news", "admin"), token: "'news'::text, 'admin'" },
    { table: "faqs", name: "faqs_admin_delete", using: ADMIN_MOD("faq", "admin"), token: "'faq'::text, 'admin'" },
    { table: "downloads", name: "downloads_admin_delete", using: ADMIN_MOD("downloads", "admin"), token: "'downloads'::text, 'admin'" },
    { table: "gallery_images", name: "gallery_images_admin_delete", using: ADMIN_MOD("gallery", "admin"), token: "'gallery'::text, 'admin'" },
    { table: "media", name: "media_admin_delete", using: ADMIN_MOD("media", "admin"), token: "'media'::text, 'admin'" },
  ],
});

// =============================== DB C (controlled widening to explicit Editor grants) ==========================
// Requires M-02 (app.can_module). Admin behaviour is unchanged: for an admin, can_module(m,l) == is_admin() AND
// has_module_access_level(m,l) on every catalog module (0/120 differences per persona, proven on Production data).
policyMigration({
  version: "20261201120000", slug: "rbac_m04_sales_finance_policies", tag: "m04",
  header: `-- RBAC M-04 (H2): Sales and Finance write policies use app.can_module instead of the admin role.
-- Before: the 11 policies below required app.is_admin() AND the module level, so a departmental Editor with explicit
-- Custom Module Access could never perform Sales/Finance duties; departmental staff had to be made admin (H2).
-- After: app.can_module(module, level) - active account, valid catalog module and level, explicit grant at or above the
-- level, AND (admin role OR editor with access_control_enabled). An Editor on Role Default Access (fallback) gains
-- nothing. Business conditions (stage/status guards) are kept verbatim.
-- sales_tasks: an Editor may update only tasks assigned to or created by them (existing branch kept verbatim);
-- managing anyone else's tasks requires the admin role (as before) or sales_tasks at Admin level. Deleting tasks keeps
-- the previous admin rule and additionally allows sales_tasks at Admin level - Sales Staff (Edit) cannot delete tasks.
-- Requires 20261201110000 (app.can_module). Approval: OWNER-CRM-RBAC-DEV-20261124 (local; not applied anywhere).`,
  changes: [
    { table: "sales_lead_metadata", name: "sales_lead_metadata_update", using: CAN("sales_leads", "edit"), check: CAN("sales_leads", "edit"), token: "can_module('sales_leads'" },
    { table: "sales_opportunities", name: "sales_opportunities_insert",
      check: `(${CAN("sales_opportunities", "edit")} AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])))`, token: "can_module('sales_opportunities'" },
    { table: "sales_opportunities", name: "sales_opportunities_update",
      using: `((${CAN("sales_opportunities", "edit")} OR ${CAN("sales_quotations", "edit")}) AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])))`,
      check: `((${CAN("sales_opportunities", "edit")} OR ${CAN("sales_quotations", "edit")}) AND (stage <> ALL (ARRAY['won'::text, 'cancelled'::text])))`, token: "can_module('sales_quotations'" },
    { table: "sales_quotations", name: "sales_quotations_insert",
      check: `(${CAN("sales_quotations", "edit")} AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])))`, token: "can_module('sales_quotations'" },
    { table: "sales_quotations", name: "sales_quotations_update",
      using: `(${CAN("sales_quotations", "edit")} AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])))`,
      check: `(${CAN("sales_quotations", "edit")} AND (status <> ALL (ARRAY['accepted'::text, 'cancelled'::text])))`, token: "can_module('sales_quotations'" },
    { table: "sales_quotation_items", name: "sales_quotation_items_insert", check: CAN("sales_quotations", "edit"), token: "can_module('sales_quotations'" },
    { table: "sales_quotation_items", name: "sales_quotation_items_update", using: CAN("sales_quotations", "edit"), check: CAN("sales_quotations", "edit"), token: "can_module('sales_quotations'" },
    { table: "sales_quotation_items", name: "sales_quotation_items_delete", using: CAN("sales_quotations", "edit"), token: "can_module('sales_quotations'" },
    { table: "sales_tasks", name: "sales_tasks_delete",
      using: `((app.is_admin() AND ${HMAL("sales_tasks", "edit")}) OR ${CAN("sales_tasks", "admin")})`, token: "can_module('sales_tasks'" },
    { table: "sales_tasks", name: "sales_tasks_update",
      using: `(((app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid())) AND ${HMAL("sales_tasks", "edit")}) OR ${CAN("sales_tasks", "admin")})`,
      check: `(((app.is_admin() OR (assigned_to = auth.uid()) OR (created_by = auth.uid())) AND ${HMAL("sales_tasks", "edit")}) OR ${CAN("sales_tasks", "admin")})`, token: "can_module('sales_tasks'" },
    { table: "invoices", name: "invoices_update", using: CAN("invoices", "edit"), check: CAN("invoices", "edit"), token: "can_module('invoices'" },
  ],
});

const INV = "if not app.can_module('invoices', 'edit') then";
gateMigration({
  version: "20261201121000", slug: "rbac_m05_unguarded_gates", tag: "m05", requires: ["app.can_module(text,text)"],
  header: `-- RBAC M-05 (H2): the 17 internal *_unguarded Sales/Finance functions gate on app.can_module, not the admin role.
-- Each body began with exactly one 'if not app.is_admin() then'. Only that line changes; every other byte (financial
-- calculations, status transitions, payment idempotency key handling, duplicate-reference protection, row locks,
-- receipt linkage, invoice immutability checks, ToyyibPay state machine) is preserved. The migration pins each body's
-- hash (line endings normalised), requires exactly one occurrence of the gate line, re-creates the function from
-- pg_get_functiondef (owner, SECURITY DEFINER, search_path and ACL preserved - the *_unguarded functions stay
-- postgres-only) and verifies the stored body equals the pre-state with that single substitution.
-- Mapping (wrapper module check unchanged): quotations -> sales_quotations edit; lead conversion -> sales_leads edit AND
-- sales_opportunities edit; lost -> sales_opportunities edit; invoice, payment, receipt, ToyyibPay -> invoices edit;
-- HRDF claim create/payment -> invoices edit AND hrdf_claims edit; HRDF transition -> hrdf_claims edit.
-- For an admin, can_module == is_admin() AND module level, which the wrappers already require, so admins are unchanged.
-- Requires 20261201110000 (app.can_module). Approval: OWNER-CRM-RBAC-DEV-20261124 (local; not applied anywhere).`,
  gates: [
    ["accept_quotation_unguarded(uuid)", "if not app.can_module('sales_quotations', 'edit') then"],
    ["reject_quotation_unguarded(uuid,text)", "if not app.can_module('sales_quotations', 'edit') then"],
    ["convert_lead_to_opportunity_unguarded(uuid,text,date,numeric)", "if not (app.can_module('sales_leads', 'edit') and app.can_module('sales_opportunities', 'edit')) then"],
    ["mark_opportunity_lost_unguarded(uuid,text)", "if not app.can_module('sales_opportunities', 'edit') then"],
    ["create_invoice_from_quotation_unguarded(uuid)", INV],
    ["issue_invoice_unguarded(uuid)", INV],
    ["cancel_invoice_unguarded(uuid,text)", INV],
    ["record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text)", INV],
    ["record_manual_payment_unguarded(uuid,text,text,numeric,date,text,text,uuid)", INV],
    ["generate_receipt_for_payment_unguarded(uuid)", INV],
    ["record_toyyibpay_bill_unguarded(uuid,uuid,text,text,numeric)", INV],
    ["get_active_toyyibpay_attempt_unguarded(uuid)", INV],
    ["mark_toyyibpay_attempt_superseded_unguarded(uuid)", INV],
    ["log_toyyibpay_conflict_unguarded(uuid,uuid,text)", INV],
    ["create_hrdf_claim_for_invoice_unguarded(uuid)", "if not (app.can_module('invoices', 'edit') and app.can_module('hrdf_claims', 'edit')) then"],
    ["record_hrdf_payment_unguarded(uuid,numeric,text,text,date,text,text)", "if not (app.can_module('invoices', 'edit') and app.can_module('hrdf_claims', 'edit')) then"],
    ["transition_hrdf_claim_unguarded(uuid,text,jsonb)", "if not app.can_module('hrdf_claims', 'edit') then"],
  ].map(([s, to]) => ({ sig: `public.${s}`, from: "if not app.is_admin() then", to })),
});
