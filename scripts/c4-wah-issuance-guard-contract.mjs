// Replays the applied WAH chain plus the issuance guard draft on a disposable
// PostgreSQL container and exercises it with synthetic data only. It never connects
// to Supabase, Staging or Production.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL) {
  throw new Error("Refusing database test: external database environment variables are set");
}

const root = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const container = `teras-c4-wah-guard-${process.pid}`;
const WAH = "963b1f6b-4c15-4833-90da-21aa0af0f544";
const ERECTOR = "2a78decf-6997-4626-a7cc-a1a23a110cf8";
const INSPECTOR = "b10c2e4b-f35f-478b-b450-f98323926345";
const OTHER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRAINER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EDITOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ERECTOR_MIGRATION = "supabase/migrations/20261101091525_production_erector_c4_snapshot_dispatch.sql";
const INSPECTOR_MIGRATION = "supabase/migrations/20261101124601_production_inspector_c4_snapshot_dispatch.sql";
const WAH_DRAFT = "supabase/migrations/20261102030425_production_wah_c4_snapshot_dispatch.sql";
const WAH_HARDENING = "supabase/migrations/20261102030656_production_wah_failed_result_hardening.sql";
const WAH_SKILLS_GATE = "supabase/migrations/20261102051041_production_wah_skills_complete_gate.sql";
const GUARD = "supabase/migrations/20261102092155_production_wah_issuance_guard.sql";

const docker = (args, input) => execFileSync("docker", args, { input, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
const PSQL = ["exec", "-i", container, "psql", "-qtA", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"];
function psql(sql) {
  try {
    return docker(PSQL, sql).trim();
  } catch (error) {
    throw new Error(`${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}
// An independent database session, so two of them can genuinely overlap.
const psqlAsync = (sql) => new Promise((done) => {
  const started = Date.now();
  const child = spawn("docker", PSQL);
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { err += d; });
  child.on("close", (code) => done({ code, out: out.trim(), err, ms: Date.now() - started }));
  child.stdin.end(sql);
});
const asUser = (uid, sql) => `begin; select set_config('test.uid', '${uid}', true); ${sql}; commit;`;
const asRole = (uid, sql, role = "authenticated") => `begin; select set_config('test.uid', '${uid}', true); set local role ${role}; ${sql}; commit;`;
let passed = 0;
const pass = (label) => { passed += 1; console.log(`PASS ${label}`); };
function rejects(sql, pattern, label) {
  let message = "";
  try { psql(sql); } catch (error) { message = error.message; }
  assert.match(message, pattern, label);
  pass(label);
}

let seq = 0;
function seedEnrolment(course, { branch = "(select id from public.certificate_branches limit 1)", days = 2, attended = 2, status = "completed" } = {}) {
  seq += 1;
  const s = `10000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const p = `20000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const sessions = Array.from({ length: attended }, (_, i) => `('${s}','${p}','2026-10-${String(i + 1).padStart(2, "0")}','present')`).join(",");
  psql(`insert into public.participants (id, full_name, participant_code, ic_passport_no) values ('${p}', 'SYNTHETIC PARTICIPANT ${seq}', 'SYN-${seq}', 'SYN0000${seq}');
    insert into public.course_schedules (id, course_id, schedule_code, status, start_date, end_date, venue, trainer_name, branch_id) values ('${s}', '${course}', 'SYN-SCH-${seq}', '${status}', '2026-10-01', date '2026-10-01' + ${days - 1}, 'Synthetic Venue', 'Synthetic Trainer', ${branch});
    insert into public.schedule_participants (schedule_id, participant_id) values ('${s}', '${p}');
    ${attended ? `insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values ${sessions};` : ""}`);
  return { s, p };
}
// Several participants on one WAH schedule, all attending every day.
function seedGroup(count) {
  seq += 1;
  const s = `10000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
  const ps = Array.from({ length: count }, (_, i) => `20000000-0000-4000-8000-${String(seq * 100 + i).padStart(12, "0")}`);
  psql(`insert into public.course_schedules (id, course_id, schedule_code, status, start_date, end_date, venue, trainer_name, branch_id) values ('${s}', '${WAH}', 'SYN-GRP-${seq}', 'completed', '2026-10-01', '2026-10-02', 'Synthetic Venue', 'Synthetic Trainer', (select id from public.certificate_branches limit 1));
    ${ps.map((p, i) => `insert into public.participants (id, full_name, participant_code, ic_passport_no) values ('${p}', 'SYNTHETIC GROUP ${seq}-${i}', 'SYN-G${seq}-${i}', 'SYNG${seq}${i}');
      insert into public.schedule_participants (schedule_id, participant_id) values ('${s}', '${p}');
      insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values ('${s}','${p}','2026-10-01','present'), ('${s}','${p}','2026-10-02','present');`).join("\n")}`);
  return { s, ps };
}
const issue = ({ s, p }, uid = ADMIN) => asUser(uid, `select id from public.issue_certificate_with_skill_snapshot('${s}', '${p}')`);
const certOf = ({ s, p }) => psql(`select id from public.certificates where schedule_id='${s}' and participant_id='${p}' and replaces_certificate_id is null`);
const COMPLETE = { theory_session: "completed", practical_training: "completed", safety_awareness: "completed", practical_assessment: "passed" };
const setSkill = ({ s, p }, area, status) => psql(`insert into public.participant_skill_results (schedule_id, participant_id, area, status) values ('${s}', '${p}', '${area}', '${status}')`);
const withSkills = (values) => {
  const e = seedEnrolment(WAH);
  for (const [area, status] of Object.entries(values)) setSkill(e, area, status);
  return e;
};
const authorize = ({ s, p }, minutes = 30, ref = "OWNER-APPROVAL-SYN-1") => psql(`select app.authorize_wah_first_issuance('${s}', '${p}', ${minutes}, '${ref}')`);
const authRow = (id) => psql(`select consumed_at is not null, revoked_at is not null, coalesce(consumed_certificate_id::text, ''), coalesce(revoke_reason, '') from app.wah_issuance_authorizations where id='${id}'`);
const openCount = () => psql("select count(*) from app.wah_issuance_authorizations where consumed_at is null and revoked_at is null");
const totals = () => psql("select (select count(*) from public.certificates), (select count(*) from public.certificate_issuance_snapshots), (select count(*) from public.certificate_skill_results), (select count(*) from app.wah_issuance_authorizations)");
const seqState = () => psql("select last_value || '|' || is_called from public.certificate_number_seq");
const snapshotHash = () => psql(`select md5(coalesce(string_agg(s::text, '|' order by s.certificate_id), '')) from public.certificate_issuance_snapshots s`);
const auditCount = (event) => psql(`select count(*) from public.audit_logs where entity_type='wah_issuance_authorizations' and metadata->>'event' = '${event}'`);
const NOT_AUTHORIZED = /WAH_ISSUANCE_NOT_AUTHORIZED/;
const INVALID = /WAH_AUTHORIZATION_INVALID/;

docker(["run", "--rm", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=disposable_only", "postgres:17.6-alpine"]);
try {
  let ready = false;
  for (let i = 0; i < 45 && !ready; i += 1) {
    try { docker(["exec", container, "psql", "-U", "postgres", "-c", "select 1"]); ready = true; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  assert.ok(ready, "Disposable PostgreSQL did not become ready");

  // Production's applied chain, in the same order the WAH database contract uses.
  psql(read("supabase/tests/fixtures/c4_wah_production_baseline.sql"));
  psql(read("supabase/tests/fixtures/c4_wah_legacy_paths.sql"));
  psql(read(ERECTOR_MIGRATION));
  psql(`grant execute on function app.issue_certificate_with_skill_snapshot(uuid,uuid,text) to authenticated;
    create function public.issue_certificate_with_skill_snapshot(p_schedule_id uuid, p_participant_id uuid, p_certificate_number text default null)
      returns table(id uuid, verification_token text) language sql set search_path to 'pg_catalog','app' as $f$ select * from app.issue_certificate_with_skill_snapshot(p_schedule_id, p_participant_id, p_certificate_number); $f$;`);
  psql(read(INSPECTOR_MIGRATION));
  psql(`insert into auth.users values ('${ADMIN}'), ('${EDITOR}'), ('${TRAINER}');
    insert into public.profiles (id, email, role) values ('${ADMIN}', 'admin@synthetic.test', 'admin'), ('${EDITOR}', 'editor@synthetic.test', 'editor'), ('${TRAINER}', 'trainer@synthetic.test', 'trainer');
    insert into public.certificate_branches (branch_code, branch_name, display_address) values ('SYN-HQ', 'Synthetic HQ', 'Synthetic Address');
    insert into public.certificate_templates (id, name, config) values
      ('30000000-0000-4000-8000-000000000001', 'WAH', '{"design_variant":"working_at_height_certificate","signature_url":"/signatures/director-signature.png","coverage_items":[],"learning_outcomes":[],"assessment_methods":[],"show_skills_record":true}'),
      ('30000000-0000-4000-8000-000000000002', 'Scaffold', '{"design_variant":"standard_scaffold_certificate","signature_url":"/signatures/director-signature-v2.png","coverage_items":[],"learning_outcomes":[],"assessment_methods":[],"show_skills_record":false}');
    insert into public.courses (id, title, certificate_template_id) values
      ('${WAH}', 'Working at Height', '30000000-0000-4000-8000-000000000001'),
      ('${ERECTOR}', 'Basic Scaffolding Erector', '30000000-0000-4000-8000-000000000002'),
      ('${INSPECTOR}', 'Basic Scaffolding Inspector', '30000000-0000-4000-8000-000000000002'),
      ('${OTHER}', 'Unlisted Course', '30000000-0000-4000-8000-000000000001');`);
  // Issued before the WAH migrations, as in Production: legacy WAH, Erector, Inspector.
  const legacySnapshot = seedEnrolment(WAH);
  psql(issue(legacySnapshot));
  const erectorBefore = seedEnrolment(ERECTOR);
  psql(issue(erectorBefore));
  const inspectorBefore = seedEnrolment(INSPECTOR);
  psql(issue(inspectorBefore));
  psql(read(WAH_DRAFT));
  psql(`create function app.is_admin_or_trainer() returns boolean language sql stable security definer set search_path to 'public' as $f$ select coalesce((select is_active and role in ('admin','super_admin','trainer') from public.profiles where id = auth.uid()), false) $f$;
    create or replace function app.audit_trigger() returns trigger language plpgsql security definer set search_path to 'public' as $f$ begin
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, summary) values (auth.uid(), case tg_op when 'INSERT' then 'create'::audit_action when 'UPDATE' then 'update'::audit_action else 'delete'::audit_action end, tg_table_name, coalesce(new.id, old.id)::text, tg_table_name || ' ' || lower(tg_op));
      if tg_op = 'DELETE' then return old; end if; return new; end $f$;
    create trigger trg_participant_skill_results_audit after insert or delete or update on public.participant_skill_results for each row execute function app.audit_trigger();
    alter table public.participant_skill_results enable row level security;
    create policy participant_skill_results_select on public.participant_skill_results for select using (app.is_admin_or_trainer());
    create policy participant_skill_results_insert on public.participant_skill_results for insert with check (app.is_admin_or_trainer());
    create policy participant_skill_results_update on public.participant_skill_results for update using (app.is_admin_or_trainer()) with check (app.is_admin_or_trainer());
    create policy participant_skill_results_delete on public.participant_skill_results for delete using (app.is_admin());
    grant all on public.participant_skill_results to authenticated, service_role;
    alter table public.audit_logs enable row level security;
    create policy audit_staff_read on public.audit_logs for select using (app.is_admin());
    grant select, update, delete, truncate, references, trigger on public.audit_logs to authenticated, anon;
    grant all on public.audit_logs to service_role;
    grant usage on schema auth to authenticated, service_role;
    alter function app.is_admin() security definer;
    alter function app.is_active() security definer;
    alter function public.has_module_access_level(text, text) security definer;
    alter table public.course_schedules enable row level security;
    create policy course_schedules_select on public.course_schedules for select using (app.is_admin_or_trainer());
    create policy course_schedules_insert on public.course_schedules for insert with check (app.is_admin());
    create policy course_schedules_update on public.course_schedules for update using (app.is_admin()) with check (app.is_admin());
    create policy course_schedules_delete on public.course_schedules for delete using (app.is_admin());
    grant all on public.course_schedules to authenticated, service_role;
    alter table public.schedule_participants enable row level security;
    create policy schedule_participants_all on public.schedule_participants for all using (app.is_admin()) with check (app.is_admin());
    grant all on public.schedule_participants to authenticated, service_role;
    alter table public.legacy_import_batches enable row level security;
    create policy legacy_batches_all on public.legacy_import_batches for all using (app.is_admin()) with check (app.is_admin());
    alter table public.legacy_participant_staging enable row level security;
    create policy legacy_staging_all on public.legacy_participant_staging for all using (app.is_admin()) with check (app.is_admin());
    grant select, insert, update, delete on public.legacy_import_batches, public.legacy_participant_staging to authenticated;`);
  const fnFrom = (file, signature) => {
    const text = read(file);
    const start = text.indexOf(`create or replace function ${signature}`);
    assert.ok(start >= 0, `${signature} not found in ${file}`);
    return text.slice(start, text.indexOf("\n$$;", start) + 4);
  };
  const LEGACY_IMPORT_FILE = "supabase/migrations/20260913010000_certificate_historical_immutability.sql";
  psql(fnFrom(LEGACY_IMPORT_FILE, "app.import_legacy_certificate("));
  psql(fnFrom(LEGACY_IMPORT_FILE, "public.import_legacy_certificate("));
  psql(fnFrom("supabase/migrations/20260824150000_legacy_merge_dry_run_gate.sql", "public.legacy_merge_execute_row("));
  psql(`revoke all on function public.import_legacy_certificate(uuid, uuid, jsonb), app.import_legacy_certificate(uuid, uuid, jsonb), public.legacy_merge_execute_row(uuid, uuid) from public;
    grant execute on function public.import_legacy_certificate(uuid, uuid, jsonb), app.import_legacy_certificate(uuid, uuid, jsonb), public.legacy_merge_execute_row(uuid, uuid) to authenticated;
    grant execute on all functions in schema app to authenticated;`);
  psql(read(WAH_HARDENING));
  // Production's grants and historical guard, as read live: service_role can write
  // certificates, so its tests must reach the guard and not stop at a permission error.
  psql(`${fnFrom("supabase/migrations/20260922160000_certificates_v2_dependency_unblock.sql", "app.certificate_historical_update_guard(")}
    create trigger trg_certificate_historical_update_guard before update on public.certificates for each row execute function app.certificate_historical_update_guard();
    grant select, insert, update on public.certificates to service_role;
    grant usage, select on sequence public.certificate_number_seq to service_role;`);
  psql(read("supabase/tests/fixtures/c4_wah_production_duplicate_rpc.sql"));
  psql(read(WAH_SKILLS_GATE));

  // State immediately before the guard: Production's state after the skills gate.
  const payloadOf = (t) => psql(`select render_payload - 'certificate_number' - 'verification_path' - 'verification_token' - 'holder_name' - 'identity_no' - 'participant_code_snapshot' - 'schedule_code' - 'issue_date' from public.certificate_issuance_snapshots where certificate_id='${t}'`);
  const erectorPayloadBefore = payloadOf(certOf(erectorBefore));
  const inspectorPayloadBefore = payloadOf(certOf(inspectorBefore));
  const wahBefore = withSkills(COMPLETE);
  psql(issue(wahBefore));
  const wahBeforeCert = certOf(wahBefore);
  const withoutGuard = withSkills(COMPLETE);
  psql(issue(withoutGuard));
  pass("before the guard, a complete WAH participant issues without an authorization (Production's current state)");
  const preIds = psql("select string_agg(id::text, ',' order by id) from public.certificates");
  const certsAt = () => psql(`select md5(string_agg(c::text, '|' order by id)) from public.certificates c where id = any(string_to_array('${preIds}', ',')::uuid[])`);
  const snapsAt = () => psql(`select md5(string_agg(s::text, '|' order by certificate_id)) from public.certificate_issuance_snapshots s where certificate_id = any(string_to_array('${preIds}', ',')::uuid[])`);
  const certsBeforeGuard = certsAt();
  const snapsBeforeGuard = snapsAt();
  const skillsBeforeGuard = psql("select md5(string_agg(r::text, '|' order by id)) from public.participant_skill_results r");

  // ---- Apply, ordering, preconditions --------------------------------------
  const guardBody = read(GUARD).replace(/^begin;$/m, "").replace(/^commit;\s*$/m, "");
  rejects(`begin; drop trigger trg_guard_wah_skills_complete on public.certificate_issuance_snapshots; ${guardBody} rollback;`, /requires the applied WAH migrations and skills gate/, "guard aborts without the applied WAH migrations and skills gate");
  rejects(`begin; update public.courses set deleted_at = now() where id = '${WAH}'; ${guardBody} rollback;`, /requires the Production WAH course/, "guard aborts where the Production WAH course is absent");
  psql(read(GUARD));
  psql(read(GUARD));
  pass("guard applies and re-applies idempotently");
  assert.equal(certsAt(), certsBeforeGuard);
  assert.equal(snapsAt(), snapsBeforeGuard);
  assert.equal(psql("select md5(string_agg(r::text, '|' order by id)) from public.participant_skill_results r"), skillsBeforeGuard);
  assert.equal(psql("select count(*) from app.wah_issuance_authorizations"), "0");
  pass("applying the guard changes no certificate, snapshot or skill row, and starts with no authorization");

  const order = psql("select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid='public.certificates'::regclass and not tgisinternal and (tgtype & 2) = 2 and (tgtype & 4) = 4");
  const names = order.split(",");
  assert.ok(names.indexOf("trg_certificates_a_wah_issuance_guard") >= 0);
  assert.ok(names.indexOf("trg_certificates_a_wah_issuance_guard") < names.indexOf("trg_certificates_before_insert"), order);
  assert.equal(psql("select tgenabled from pg_trigger where tgname='trg_certificates_a_wah_issuance_guard'"), "O");
  pass(`BEFORE INSERT order puts the guard first (${order})`);

  // ---- Default deny, every path --------------------------------------------
  const denied = withSkills(COMPLETE);
  const before = totals();
  const seqBefore = seqState();
  rejects(issue(denied), NOT_AUTHORIZED, "default deny: public issuer RPC as Admin");
  rejects(asUser(ADMIN, `select id from app.issue_certificate_with_skill_snapshot('${denied.s}', '${denied.p}')`), NOT_AUTHORIZED, "default deny: app issuer RPC as Admin");
  rejects(asRole(ADMIN, `select id from public.issue_certificate_with_skill_snapshot('${denied.s}', '${denied.p}')`), NOT_AUTHORIZED, "default deny: Admin database session");
  rejects(asRole(ADMIN, `select id from app.issue_certificate_with_skill_snapshot('${denied.s}', '${denied.p}')`, "service_role"), NOT_AUTHORIZED, "default deny: service_role cannot bypass it");
  rejects(`insert into public.certificates (holder_name, course_id, course_name, status, issue_date, schedule_id, participant_id) values ('SYNTHETIC', '${WAH}', 'Working at Height', 'valid', '2026-10-05', '${denied.s}', '${denied.p}')`, NOT_AUTHORIZED, "default deny: direct insert by the database owner");
  rejects(`insert into public.certificates (holder_name, course_id, course_name, status, issue_date) values ('SYNTHETIC', '${WAH}', 'Working at Height', 'valid', '2026-10-05')`, NOT_AUTHORIZED, "default deny: a WAH insert with no schedule or participant");
  rejects(asRole(ADMIN, `insert into public.certificates (holder_name, course_id, course_name, status, issue_date, schedule_id, participant_id) values ('SYNTHETIC', '${WAH}', 'Working at Height', 'valid', '2026-10-05', '${denied.s}', '${denied.p}')`), /permission denied/, "default deny: API roles cannot insert certificates directly");
  rejects(asRole(ADMIN, `insert into public.certificates (holder_name, course_id, course_name, status, issue_date, schedule_id, participant_id) values ('SYNTHETIC', '${WAH}', 'Working at Height', 'valid', '2026-10-05', '${denied.s}', '${denied.p}')`, "service_role"), NOT_AUTHORIZED, "default deny: service_role direct insert reaches the guard and is denied");
  rejects(asRole(ADMIN, `insert into public.certificates (holder_name, course_name, status, issue_date) values ('SYNTHETIC', 'Working at Height', 'valid', '2026-10-05')`, "service_role"), NOT_AUTHORIZED, "default deny: a WAH-named row with no course");
  rejects(asRole(ADMIN, `insert into public.certificates (holder_name, course_id, course_name, status, issue_date) values ('SYNTHETIC', '${OTHER}', 'Work at Height Refresher', 'valid', '2026-10-05')`, "service_role"), NOT_AUTHORIZED, "default deny: a WAH-named row under another course");
  assert.equal(totals(), before);
  assert.equal(psql(`select count(*) from public.certificates where schedule_id='${denied.s}'`), "0");
  pass("every denial rolls back: no certificate, snapshot, frozen skill or authorization row");

  // ---- Certificate numbers ---------------------------------------------------
  assert.equal(seqState(), seqBefore);
  pass(`rejected issuance burns no certificate number (sequence stayed at ${seqBefore})`);


  function rejectsFn(fn, pattern, label) {
    let message = "";
    try { fn(); } catch (error) { message = error.message; }
    assert.match(message, pattern, label);
    pass(label);
  }
  const completeEnrolment = (opts) => {
    const e = seedEnrolment(WAH, opts);
    for (const [area, status] of Object.entries(COMPLETE)) setSkill(e, area, status);
    return e;
  };

  // ---- Authorization preconditions ------------------------------------------
  const authsBefore = psql("select count(*) from app.wah_issuance_authorizations");
  rejectsFn(() => authorize(completeEnrolment(), 4), INVALID, "authorize refuses 4 minutes");
  rejectsFn(() => authorize(completeEnrolment(), 61), INVALID, "authorize refuses 61 minutes");
  rejectsFn(() => authorize(completeEnrolment(), 30, "   "), INVALID, "authorize refuses a blank approval reference");
  rejectsFn(() => authorize(completeEnrolment({ branch: "null" })), INVALID, "authorize refuses a schedule with no issuing branch");
  rejectsFn(() => authorize(completeEnrolment({ attended: 1 })), INVALID, "authorize refuses attendance below 100%");
  rejectsFn(() => authorize(completeEnrolment({ status: "scheduled" })), INVALID, "authorize refuses a schedule that is not completed");
  const erectorLookalike = seedEnrolment(ERECTOR);
  for (const [area, status] of Object.entries(COMPLETE)) setSkill(erectorLookalike, area, status);
  rejectsFn(() => authorize(erectorLookalike), INVALID, "authorize refuses a non-WAH schedule");
  rejectsFn(() => authorize({ s: completeEnrolment().s, p: "99999999-9999-4999-8999-999999999999" }), INVALID, "authorize refuses a participant not on the schedule");
  rejectsFn(() => authorize(withoutGuard), INVALID, "authorize refuses a participant who already holds a certificate");
  rejectsFn(() => authorize(withSkills({ practical_training: "completed", safety_awareness: "completed", practical_assessment: "passed" })), INVALID, "authorize refuses a missing Theory Session");
  rejectsFn(() => authorize(withSkills({ ...COMPLETE, safety_awareness: "not_recorded" })), INVALID, "authorize refuses Safety Awareness Not Recorded");
  rejectsFn(() => authorize(seedEnrolment(WAH)), INVALID, "authorize refuses a participant with no Skills Record");
  rejectsFn(() => authorize(withSkills({ ...COMPLETE, practical_assessment: "failed" })), INVALID, "authorize refuses a Failed Practical Assessment");
  assert.equal(psql("select count(*) from app.wah_issuance_authorizations"), authsBefore);
  pass("no refused request left an authorization behind");

  // ---- Happy path, single use, audit ------------------------------------------
  const createdBefore = auditCount("created");
  const first = completeEnrolment();
  const firstAuth = authorize(first, 30, "OWNER-APPROVAL-SYN-FIRST");
  assert.equal(auditCount("created"), String(Number(createdBefore) + 1));
  assert.equal(openCount(), "1");
  assert.equal(psql(`select approval_ref from app.wah_issuance_authorizations where id='${firstAuth}'`), "OWNER-APPROVAL-SYN-FIRST");
  assert.equal(psql(`select (expires_at - created_at) = interval '30 minutes' from app.wah_issuance_authorizations where id='${firstAuth}'`), "t");
  assert.equal(psql(`select metadata->>'approval_ref' from public.audit_logs where entity_id='${firstAuth}' and metadata->>'event'='created'`), "OWNER-APPROVAL-SYN-FIRST");
  pass("authorize records the approval reference, exact validity and an audit event");

  const consumedBefore = auditCount("consumed");
  const seqPre = Number(seqState().split("|")[0]);
  psql(issue(first));
  const firstCert = certOf(first);
  assert.equal(psql(`select render_contract_version from public.certificates where id='${firstCert}'`), "c4_wave1_wah_v1");
  assert.equal(authRow(firstAuth), `t|f|${firstCert}|`);
  assert.equal(openCount(), "0");
  assert.equal(auditCount("consumed"), String(Number(consumedBefore) + 1));
  assert.equal(psql(`select metadata->>'certificate_id' from public.audit_logs where entity_id='${firstAuth}' and metadata->>'event'='consumed'`), firstCert);
  assert.equal(Number(seqState().split("|")[0]), seqPre + 1);
  pass("the authorized participant issues once: C4 certificate, authorization consumed with its certificate id, audit event, one number used");

  rejects(issue(completeEnrolment()), NOT_AUTHORIZED, "single use: after consumption the next participant is denied");
  rejects(issue(first), /certificate_already_exists/, "single use: the same participant cannot be issued again");
  rejects(`insert into public.certificates (holder_name, course_id, course_name, status, issue_date, schedule_id, participant_id) values ('SYNTHETIC', '${WAH}', 'Working at Height', 'valid', '2026-10-05', '${first.s}', '${first.p}')`, NOT_AUTHORIZED, "single use: a second non-replacement WAH row for the same pair is denied");

  // ---- Narrowness ---------------------------------------------------------
  const narrow = completeEnrolment();
  const otherSchedule = seedEnrolment(WAH);
  psql(`insert into public.schedule_participants (schedule_id, participant_id) values ('${otherSchedule.s}', '${narrow.p}');
    insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values ('${otherSchedule.s}','${narrow.p}','2026-10-01','present'), ('${otherSchedule.s}','${narrow.p}','2026-10-02','present');`);
  for (const [area, status] of Object.entries(COMPLETE)) setSkill({ s: otherSchedule.s, p: narrow.p }, area, status);
  const narrowAuth = authorize(narrow);
  rejects(issue({ s: otherSchedule.s, p: narrow.p }), NOT_AUTHORIZED, "narrow: the same participant on another schedule is denied");
  rejects(issue(completeEnrolment()), NOT_AUTHORIZED, "narrow: another participant is denied");
  assert.equal(authRow(narrowAuth), "f|f||");
  psql(issue(narrow));
  assert.equal(authRow(narrowAuth).split("|")[0], "t");
  pass("narrow: only the named participant and schedule consume the authorization; denials leave it open");

  const group = seedGroup(5);
  for (const p of group.ps) for (const [area, status] of Object.entries(COMPLETE)) setSkill({ s: group.s, p }, area, status);
  authorize({ s: group.s, p: group.ps[2] });
  const outcomes = group.ps.map((p) => { try { psql(issue({ s: group.s, p })); return "issued"; } catch (e) { return NOT_AUTHORIZED.test(e.message) ? "denied" : `other:${e.message}`; } });
  assert.deepEqual(outcomes, ["denied", "denied", "issued", "denied", "denied"]);
  assert.equal(psql(`select count(*) from public.certificates where schedule_id='${group.s}'`), "1");
  assert.equal(openCount(), "0");
  pass("bulk generation over five eligible participants issues exactly the authorized one");

  // ---- Expiry, revocation, one open at a time ---------------------------------
  const expiring = completeEnrolment();
  const expiringAuth = authorize(expiring, 5, "OWNER-APPROVAL-SYN-EXPIRE");
  // Test-only: move the window into the past; the row guard forbids this outside a test.
  psql(`alter table app.wah_issuance_authorizations disable trigger trg_guard_wah_issuance_authorization_rows;
    update app.wah_issuance_authorizations set created_at = created_at - interval '2 hours', expires_at = expires_at - interval '2 hours' where id='${expiringAuth}';
    alter table app.wah_issuance_authorizations enable trigger trg_guard_wah_issuance_authorization_rows;`);
  rejects(issue(expiring), NOT_AUTHORIZED, "expiry: an expired authorization is denied");
  assert.equal(authRow(expiringAuth), "f|f||");
  const expiredAuditBefore = auditCount("expired");
  const afterExpiry = completeEnrolment();
  const afterExpiryAuth = authorize(afterExpiry);
  assert.equal(authRow(expiringAuth), "f|t||expired");
  assert.equal(auditCount("expired"), String(Number(expiredAuditBefore) + 1));
  pass("expiry: the next authorization closes the expired one with an audit event instead of being blocked by it");

  rejectsFn(() => authorize(completeEnrolment()), /WAH_AUTHORIZATION_ALREADY_OPEN/, "one open: a second authorization is refused while one is open");
  rejects(`insert into app.wah_issuance_authorizations (schedule_id, participant_id, approval_ref, expires_at) values (gen_random_uuid(), gen_random_uuid(), 'X', now() + interval '30 minutes')`, /wah_issuance_authorizations_one_open/, "one open: the unique index also stops a direct second open row");
  const revokedBefore = auditCount("revoked");
  rejectsFn(() => psql(`select app.revoke_wah_issuance_authorization('${afterExpiryAuth}', '  ')`), INVALID, "revoke requires a reason");
  psql(`select app.revoke_wah_issuance_authorization('${afterExpiryAuth}', 'Owner withdrew approval')`);
  assert.equal(authRow(afterExpiryAuth), "f|t||Owner withdrew approval");
  assert.equal(auditCount("revoked"), String(Number(revokedBefore) + 1));
  rejects(issue(afterExpiry), NOT_AUTHORIZED, "revocation: a revoked authorization is denied");
  rejectsFn(() => psql(`select app.revoke_wah_issuance_authorization('${afterExpiryAuth}', 'again')`), INVALID, "revocation: a closed authorization cannot be revoked again");
  assert.equal(openCount(), "0");

  // ---- Evidence rows are immutable -----------------------------------------------
  const IMMUTABLE = /WAH_AUTHORIZATION_IMMUTABLE/;
  rejects(`delete from app.wah_issuance_authorizations where id='${firstAuth}'`, IMMUTABLE, "evidence: a row cannot be deleted");
  rejects(`update app.wah_issuance_authorizations set revoked_at = now() where id='${firstAuth}'`, /wah_issuance_authorizations_one_close|WAH_AUTHORIZATION_IMMUTABLE/, "evidence: a consumed row cannot be revoked");
  rejects(`update app.wah_issuance_authorizations set consumed_at = null, consumed_certificate_id = null where id='${firstAuth}'`, IMMUTABLE, "evidence: a consumed row cannot be reopened");
  const identity = completeEnrolment();
  const identityAuth = authorize(identity);
  rejects(`update app.wah_issuance_authorizations set participant_id = gen_random_uuid() where id='${identityAuth}'`, IMMUTABLE, "evidence: the named participant cannot be changed");
  rejects(`update app.wah_issuance_authorizations set expires_at = expires_at + interval '10 minutes' where id='${identityAuth}'`, IMMUTABLE, "evidence: the expiry cannot be extended");
  psql(`select app.revoke_wah_issuance_authorization('${identityAuth}', 'Test cleanup')`);

  // ---- Existing protections still apply under an open authorization ------------------
  const skillGap = completeEnrolment();
  const skillGapAuth = authorize(skillGap);
  psql(`update public.participant_skill_results set status='not_recorded' where schedule_id='${skillGap.s}' and area='safety_awareness'`);
  const totalsBeforeGap = totals();
  const seqBeforeGap = Number(seqState().split("|")[0]);
  rejects(issue(skillGap), /WAH_SKILLS_RECORD_INCOMPLETE/, "protections: an incomplete Skills Record is still refused under an open authorization");
  assert.equal(totals(), totalsBeforeGap);
  // Existing behaviour, not the guard's: this refusal fires after the row got its number.
  assert.equal(Number(seqState().split("|")[0]), seqBeforeGap + 1);
  pass("numbers: a Skills gate refusal under an open authorization still uses one number; the guard's own denial uses none");
  assert.equal(authRow(skillGapAuth), "f|f||");
  pass("protections: the refusal rolls back the consumption, so the authorization stays open");
  psql(`update public.participant_skill_results set status='completed' where schedule_id='${skillGap.s}' and area='safety_awareness'`);
  psql(issue(skillGap));
  assert.equal(authRow(skillGapAuth).split("|")[0], "t");
  pass("protections: once the record is complete the same authorization issues, exactly once");

  const failedGap = completeEnrolment();
  const failedAuth = authorize(failedGap);
  psql(`delete from public.participant_skill_results where schedule_id='${failedGap.s}' and area='practical_assessment'`);
  setSkill(failedGap, "practical_assessment", "failed");
  rejects(issue(failedGap), /WAH_FAILED_PRACTICAL_ASSESSMENT_HOLD/, "protections: a Failed Practical Assessment is still held under an open authorization");
  assert.equal(authRow(failedAuth), "f|f||");
  psql(`select app.revoke_wah_issuance_authorization('${failedAuth}', 'Test cleanup')`);

  // ---- Concurrency: two independent database sessions ----------------------------------
  const session = (e) => `begin; select set_config('test.uid', '${ADMIN}', true); select id from public.issue_certificate_with_skill_snapshot('${e.s}', '${e.p}');`;
  const racer = completeEnrolment();
  const racerAuth = authorize(racer);
  const seqBeforeRace = Number(seqState().split("|")[0]);
  const consumedBeforeRace = auditCount("consumed");
  const sessionA = psqlAsync(`${session(racer)} select pg_sleep(4); commit;`);
  await new Promise((r) => setTimeout(r, 1500));
  const sessionB = psqlAsync(`${session(racer)} commit;`);
  const [a, b] = await Promise.all([sessionA, sessionB]);
  assert.equal(a.code, 0, a.err);
  assert.notEqual(b.code, 0);
  assert.match(b.err, NOT_AUTHORIZED);
  assert.ok(b.ms >= 2000, `session B finished in ${b.ms} ms, so it did not wait for session A`);
  assert.equal(psql(`select count(*) from public.certificates where schedule_id='${racer.s}'`), "1");
  assert.equal(authRow(racerAuth).split("|")[0], "t");
  assert.equal(Number(seqState().split("|")[0]), seqBeforeRace + 1);
  assert.equal(auditCount("consumed"), String(Number(consumedBeforeRace) + 1));
  pass(`concurrency: two issuer sessions, one authorization -> one certificate; B waited ${b.ms} ms and was denied`);

  const rawRacer = completeEnrolment();
  const rawAuth = authorize(rawRacer);
  const rawInsert = `insert into public.certificates (holder_name, course_id, course_name, status, issue_date, schedule_id, participant_id) values ('SYNTHETIC', '${WAH}', 'Working at Height', 'valid', '2026-10-05', '${rawRacer.s}', '${rawRacer.p}');`;
  const rawA = psqlAsync(`begin; ${rawInsert} select pg_sleep(4); commit;`);
  await new Promise((r) => setTimeout(r, 1500));
  const rawB = psqlAsync(`begin; ${rawInsert} commit;`);
  const [ra, rb] = await Promise.all([rawA, rawB]);
  assert.equal(ra.code, 0, ra.err);
  assert.notEqual(rb.code, 0);
  assert.match(rb.err, NOT_AUTHORIZED);
  assert.ok(rb.ms >= 2000, `raw session B finished in ${rb.ms} ms`);
  assert.equal(psql(`select count(*) from public.certificates where schedule_id='${rawRacer.s}'`), "1");
  assert.equal(authRow(rawAuth).split("|")[0], "t");
  pass(`concurrency: two raw inserts with no schedule lock, one authorization -> one row; B waited ${rb.ms} ms and was denied`);

  // ---- Replacements ---------------------------------------------------------------------
  const dupAuth = authorize(completeEnrolment());
  const consumedPre = auditCount("consumed");
  psql(asUser(ADMIN, `select id from app.duplicate_certificate_with_skill_snapshot('${wahBeforeCert}')`));
  psql(asUser(ADMIN, `select id from app.duplicate_certificate_with_skill_snapshot('${firstCert}')`));
  psql(asUser(ADMIN, `select id from app.duplicate_certificate_with_skill_snapshot('${certOf(legacySnapshot)}')`));
  assert.equal(authRow(dupAuth).split("|")[0], "f");
  assert.equal(auditCount("consumed"), consumedPre);
  pass("duplicates: pre-guard, guarded and historical WAH certificates duplicate normally and consume no authorization");
  psql(`select app.revoke_wah_issuance_authorization('${dupAuth}', 'Test cleanup')`);

  const REPLACE_BAD = /WAH_REPLACEMENT_REFERENCE_INVALID/;
  const firstHolder = psql(`select holder_name from public.certificates where id='${firstCert}'`);
  const forge = (participant, replaces, holder = firstHolder) => `insert into public.certificates (holder_name, course_id, course_name, status, issue_date, participant_id, replaces_certificate_id) values ('${holder}', '${WAH}', 'Working at Height', 'draft', '2026-10-05', ${participant}, ${replaces})`;
  rejects(forge(`'${first.p}'`, `'${firstCert}'`, "SOMEONE ELSE"), REPLACE_BAD, "forged replacement: right participant and reference, different holder name");
  rejects(asRole(ADMIN, forge(`'${denied.p}'`, `'${firstCert}'`), "service_role"), REPLACE_BAD, "forged replacement: service_role reaches the guard and is denied");
  rejects(forge(`'${denied.p}'`, `'${firstCert}'`), REPLACE_BAD, "forged replacement: another participant's WAH certificate as the reference");
  rejects(forge(`'${denied.p}'`, `'99999999-9999-4999-8999-999999999999'`), REPLACE_BAD, "forged replacement: a reference to nothing");
  rejects(forge(`'${erectorBefore.p}'`, `'${certOf(erectorBefore)}'`), REPLACE_BAD, "forged replacement: a non-WAH certificate as the reference");
  rejects(forge("null", `'${firstCert}'`), REPLACE_BAD, "forged replacement: no participant");
  rejects(asRole(ADMIN, forge(`'${first.p}'`, `'${firstCert}'`)), /permission denied/, "forged replacement: API roles cannot insert even a well-formed one");
  psql(forge(`'${first.p}'`, `'${firstCert}'`));
  pass("a replacement of the same participant's WAH certificate is accepted (that is how duplication works)");

  // ---- Permission boundaries ----------------------------------------------------------------
  for (const role of ["authenticated", "service_role", "anon"]) {
    rejects(asRole(ADMIN, "select count(*) from app.wah_issuance_authorizations", role), /permission denied/, `permissions: ${role} cannot read authorizations`);
    rejects(asRole(ADMIN, "insert into app.wah_issuance_authorizations (schedule_id, participant_id, approval_ref, expires_at) values (gen_random_uuid(), gen_random_uuid(), 'X', now() + interval '30 minutes')", role), /permission denied/, `permissions: ${role} cannot create authorizations`);
    rejects(asRole(ADMIN, "update app.wah_issuance_authorizations set approval_ref = 'X'", role), /permission denied/, `permissions: ${role} cannot update authorizations`);
    rejects(asRole(ADMIN, "delete from app.wah_issuance_authorizations", role), /permission denied/, `permissions: ${role} cannot delete authorizations`);
    rejects(asRole(ADMIN, `select app.authorize_wah_first_issuance('${denied.s}', '${denied.p}', 30, 'X')`, role), /permission denied/, `permissions: ${role} cannot run authorize`);
    rejects(asRole(ADMIN, `select app.revoke_wah_issuance_authorization(gen_random_uuid(), 'X')`, role), /permission denied/, `permissions: ${role} cannot run revoke`);
    rejects(asRole(ADMIN, "select app.guard_wah_issuance()", role), /permission denied/, `permissions: ${role} cannot call the guard directly`);
  }
  assert.equal(psql("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ilike '%wah_issuance%'"), "0");
  assert.equal(psql("select relrowsecurity from pg_class where oid = 'app.wah_issuance_authorizations'::regclass"), "t");
  pass("permissions: no public wrapper exists and row level security is on");
  rejects(asRole(ADMIN, `update public.certificates set course_id='${WAH}' where id='${certOf(erectorBefore)}'`), /permission denied/, "bypass: an Admin session cannot update certificates at all");
  rejects(asRole(ADMIN, `update public.certificates set course_id='${WAH}' where id='${certOf(erectorBefore)}'`, "service_role"), /immutable/i, "bypass: service_role cannot move a certificate with a snapshot into WAH");
  // The route the historical guard does not cover: a row with no snapshot, moved in later.
  const sidedoor = psql(asRole(ADMIN, `insert into public.certificates (holder_name, course_id, course_name, status, issue_date) values ('SYNTHETIC', '${OTHER}', 'Unlisted Course', 'valid', '2026-10-05') returning id`, "service_role")).split("\n").filter((l) => /^[0-9a-f-]{36}$/.test(l)).pop();
  assert.equal(psql(`select course_id from public.certificates where id='${sidedoor}' and not exists (select 1 from public.certificate_issuance_snapshots s where s.certificate_id = certificates.id)`), OTHER);
  rejects(asRole(ADMIN, `update public.certificates set course_id='${WAH}' where id='${sidedoor}'`, "service_role"), NOT_AUTHORIZED, "bypass: service_role cannot move a snapshot-less row into the WAH course");
  rejects(asRole(ADMIN, `update public.certificates set course_name='Working at Height' where id='${sidedoor}'`, "service_role"), NOT_AUTHORIZED, "bypass: service_role cannot rename a snapshot-less row to WAH");
  psql(asRole(ADMIN, `update public.certificates set course_name='Another Unlisted Course' where id='${sidedoor}'`, "service_role"));
  psql(`update public.certificates set course_name='Working at Height' where id='${certOf(rawRacer)}'`);
  pass("bypass: ordinary course edits on non-WAH rows and on rows already WAH still work");

  // ---- Other courses and history ----------------------------------------------------------------
  for (const [course, version, label] of [[ERECTOR, "c4_wave1_v1", "Erector"], [INSPECTOR, "c4_wave1_inspector_v1", "Inspector"], [OTHER, "certificate_renderer_v1", "unlisted course"]]) {
    const e = seedEnrolment(course);
    psql(issue(e));
    assert.equal(psql(`select renderer_version from public.certificate_issuance_snapshots where certificate_id='${certOf(e)}'`), version);
    pass(`${label} still issues with no authorization`);
  }
  const erectorAfter = seedEnrolment(ERECTOR);
  psql(issue(erectorAfter));
  const inspectorAfter = seedEnrolment(INSPECTOR);
  psql(issue(inspectorAfter));
  assert.equal(payloadOf(certOf(erectorAfter)), erectorPayloadBefore);
  assert.equal(payloadOf(certOf(inspectorAfter)), inspectorPayloadBefore);
  pass("Erector and Inspector payloads are identical before and after the guard");
  assert.equal(certsAt(), certsBeforeGuard);
  assert.equal(snapsAt(), snapsBeforeGuard);
  pass("every certificate and snapshot from before the guard is byte-for-byte unchanged");

  // ---- Audit evidence is free of personal details --------------------------------------------------
  assert.equal(psql("select count(*) from public.audit_logs where entity_type='wah_issuance_authorizations' and (summary || metadata::text) ilike '%SYNTHETIC%'"), "0");
  assert.equal(psql("select count(*) from public.audit_logs where entity_type='wah_issuance_authorizations' and action is null"), "0");
  pass("audit rows carry identifiers and the approval reference, not names");

  // ---- Control: proves the trigger name is what protects the certificate numbers ----------------------
  const control = completeEnrolment();
  const seqBeforeControl = Number(seqState().split("|")[0]);
  rejects(issue(control), NOT_AUTHORIZED, "control: denial with the guard first");
  assert.equal(Number(seqState().split("|")[0]), seqBeforeControl);
  psql("alter trigger trg_certificates_a_wah_issuance_guard on public.certificates rename to trg_guard_zz_wah_issuance_control");
  rejects(issue(control), NOT_AUTHORIZED, "control: denial with the guard moved after number allocation");
  assert.equal(Number(seqState().split("|")[0]), seqBeforeControl + 1);
  psql("alter trigger trg_guard_zz_wah_issuance_control on public.certificates rename to trg_certificates_a_wah_issuance_guard");
  pass("control: sequences do not roll back, so a guard sorted after allocation burns a number and this one does not");

  // ---- Super Admin issuance path (the second draft) -------------------------------------------------------
  const SUPER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const INACTIVE_SUPER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const INACTIVE_ADMIN = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const NO_PROFILE = "99999999-9999-4999-8999-999999999999";
  psql(`insert into auth.users values ('${SUPER}'), ('${INACTIVE_SUPER}'), ('${INACTIVE_ADMIN}'), ('${NO_PROFILE}');
    insert into public.profiles (id, email, role, is_active) values ('${SUPER}', 'super@synthetic.test', 'super_admin', true), ('${INACTIVE_SUPER}', 'off@synthetic.test', 'super_admin', false), ('${INACTIVE_ADMIN}', 'offadmin@synthetic.test', 'admin', false);`);
  const SUPER_ONLY = /WAH_SUPER_ADMIN_REQUIRED/;
  const asSuper = ({ s, p }, uid = SUPER, role = "authenticated") => asRole(uid, `select id from public.issue_wah_certificate_as_super_admin('${s}', '${p}')`, role);
  const SA_DRAFT = "supabase/post_baseline_drafts/20261102120000_production_wah_super_admin_issuance.sql";
  const saBody = read(SA_DRAFT).replace(/^begin;$/m, "").replace(/^commit;\s*$/m, "");

  rejects(asSuper(completeEnrolment()), /does not exist/, "before the draft, the Super Admin function does not exist");
  rejects(`begin; drop trigger trg_certificates_a_wah_issuance_guard on public.certificates; ${saBody} rollback;`, /requires the applied WAH issuance guard/, "draft aborts without the issuance guard");
  rejects(`begin; drop function app.authorize_wah_first_issuance(uuid,uuid,integer,text); ${saBody} rollback;`, /requires the applied WAH issuance guard/, "draft aborts without the owner authorization function");
  psql(read(SA_DRAFT));
  psql(read(SA_DRAFT));
  pass("Super Admin draft applies and re-applies idempotently");
  assert.equal(psql("select pg_get_function_arguments('public.issue_wah_certificate_as_super_admin(uuid,uuid,text)'::regprocedure)"), "p_schedule_id uuid, p_participant_id uuid, p_certificate_number text DEFAULT NULL::text");
  pass("the function takes no role or privilege argument, so the caller cannot choose their own role");
  assert.equal(psql("select count(*) from pg_trigger where tgname in ('trg_guard_wah_skills_complete','trg_guard_wah_skill_result','trg_guard_wah_legacy_certificate','trg_guard_wah_schedule_integrity','trg_certificates_a_wah_issuance_guard','trg_guard_wah_issuance_authorization_rows') and tgenabled='O' and not tgisinternal"), "6");
  pass("the draft leaves all six WAH safety triggers enabled");

  // Success: one atomic authorize-and-issue, with the full evidence trail.
  const saOk = completeEnrolment();
  const saAuthsBefore = Number(psql("select count(*) from app.wah_issuance_authorizations"));
  const saCreated = Number(auditCount("created"));
  const saConsumed = Number(auditCount("consumed"));
  const saCertsBefore = Number(psql("select count(*) from public.certificates"));
  psql(asSuper(saOk));
  const saCert = certOf(saOk);
  assert.equal(psql(`select status || '|' || coalesce(issued_by::text, '') || '|' || (certificate_number is not null)::text from public.certificates where id='${saCert}'`), `valid|${SUPER}|true`);
  assert.equal(psql(`select renderer_version from public.certificate_issuance_snapshots where certificate_id='${saCert}'`), psql(`select renderer_version from public.certificate_issuance_snapshots where certificate_id='${certOf(wahBefore)}'`));
  assert.equal(psql(`select count(*) from public.certificate_skill_results where certificate_id='${saCert}'`), "5");
  assert.equal(psql("select count(*) from public.certificates"), String(saCertsBefore + 1));
  assert.equal(psql("select count(*) from app.wah_issuance_authorizations"), String(saAuthsBefore + 1));
  assert.equal(psql(`select (consumed_at is not null)::text || '|' || (consumed_certificate_id = '${saCert}')::text || '|' || approval_ref from app.wah_issuance_authorizations where schedule_id='${saOk.s}' and participant_id='${saOk.p}'`), `true|true|SUPER_ADMIN_CRM:${SUPER}`);
  assert.equal(openCount(), "0");
  assert.equal(Number(auditCount("created")), saCreated + 1);
  assert.equal(Number(auditCount("consumed")), saConsumed + 1);
  pass("Super Admin issues one WAH certificate: snapshot, Skills results, number, issuer, and a created-and-consumed authorization, with nothing left open");

  // Roles: only an active super_admin gets through, whichever door is used.
  const saTarget = completeEnrolment();
  const saTotals = totals();
  const saSeq = seqState();
  const saDenied = [
    [ADMIN, "authenticated", SUPER_ONLY, "Admin"],
    [EDITOR, "authenticated", SUPER_ONLY, "Editor"],
    [TRAINER, "authenticated", SUPER_ONLY, "Trainer"],
    [INACTIVE_SUPER, "authenticated", SUPER_ONLY, "inactive Super Admin"],
    [INACTIVE_ADMIN, "authenticated", SUPER_ONLY, "inactive Admin"],
    [NO_PROFILE, "authenticated", SUPER_ONLY, "user with no profile"],
    ["", "authenticated", SUPER_ONLY, "signed-out session"],
    [SUPER, "anon", /permission denied/, "anonymous role, even with a Super Admin id"],
    [SUPER, "service_role", /permission denied/, "service_role, even with a Super Admin id"],
  ];
  for (const [uid, role, pattern, label] of saDenied) rejects(asSuper(saTarget, uid, role), pattern, `Super Admin path denies ${label}`);
  rejects(asRole(ADMIN, `select id from app.issue_wah_certificate_as_super_admin('${saTarget.s}', '${saTarget.p}')`), SUPER_ONLY, "Super Admin path denies Admin on the app function directly");
  rejects(asRole(SUPER, `select app.authorize_wah_first_issuance('${saTarget.s}', '${saTarget.p}', 30, 'X')`), /permission denied/, "the owner authorization function stays closed to every API role, Super Admin included");
  assert.equal(totals(), saTotals);
  assert.equal(seqState(), saSeq);
  assert.equal(openCount(), "0");
  pass("every role denial leaves no certificate, snapshot, authorization or burned number");

  // Preconditions are the existing checks, reached through the new door.
  psql("insert into public.certificate_branches (branch_code, branch_name, display_address, is_active) values ('SYN-SA-OFF', 'Inactive', 'Nowhere', false)");
  const saBlocked = [
    ["Skills Record incomplete", () => withSkills({ theory_session: "completed", practical_training: "completed", safety_awareness: "completed" })],
    ["Practical Assessment failed", () => withSkills({ ...COMPLETE, practical_assessment: "failed" })],
    ["Skills Records not recorded", () => seedEnrolment(WAH)],
    ["attendance below 100%", () => completeEnrolment({ attended: 1 })],
    ["no attendance", () => completeEnrolment({ attended: 0 })],
    ["no issuing branch", () => completeEnrolment({ branch: "null" })],
    ["inactive issuing branch", () => completeEnrolment({ branch: "(select id from public.certificate_branches where branch_code='SYN-SA-OFF')" })],
    ["schedule not completed", () => completeEnrolment({ status: "scheduled" })],
    ["Erector schedule", () => seedEnrolment(ERECTOR)],
    ["Inspector schedule", () => seedEnrolment(INSPECTOR)],
  ];
  for (const [label, make] of saBlocked) {
    const e = make();
    const t = totals();
    const q = seqState();
    rejects(asSuper(e), INVALID, `Super Admin path refuses: ${label}`);
    assert.equal(totals(), t, label);
    assert.equal(seqState(), q, label);
    assert.equal(openCount(), "0", label);
  }
  pass("every refused precondition leaves nothing behind");

  // Duplicates, sequential and concurrent.
  const saDup = completeEnrolment();
  psql(asSuper(saDup));
  const saDupTotals = totals();
  rejects(asSuper(saDup), INVALID, "Super Admin path refuses a second certificate for the same participant");
  assert.equal(totals(), saDupTotals);
  pass("a repeat after success is refused and changes nothing");

  const saRace = completeEnrolment();
  const raceCerts = Number(psql("select count(*) from public.certificates"));
  const raceAuths = Number(psql("select count(*) from app.wah_issuance_authorizations"));
  const racers = await Promise.all(Array.from({ length: 6 }, () => psqlAsync(asSuper(saRace))));
  assert.equal(racers.filter((r) => r.code === 0).length, 1, racers.map((r) => r.err).join("\n"));
  assert.ok(racers.filter((r) => r.code !== 0).every((r) => /WAH_AUTHORIZATION_INVALID|certificates_active_schedule_participant_uniq/.test(r.err)), racers.map((r) => r.err).join("\n"));
  assert.equal(psql("select count(*) from public.certificates"), String(raceCerts + 1));
  assert.equal(psql("select count(*) from app.wah_issuance_authorizations"), String(raceAuths + 1));
  assert.equal(openCount(), "0");
  pass("six simultaneous submissions for one participant produce exactly one certificate and one consumed authorization");

  const saGroup = seedGroup(3);
  for (const p of saGroup.ps) for (const [area, status] of Object.entries(COMPLETE)) setSkill({ s: saGroup.s, p }, area, status);
  const groupRace = await Promise.all(saGroup.ps.map((p) => psqlAsync(asSuper({ s: saGroup.s, p }))));
  assert.ok(groupRace.every((r) => r.code === 0), groupRace.map((r) => r.err).join("\n"));
  assert.equal(psql(`select count(*) from public.certificates where schedule_id='${saGroup.s}'`), "3");
  assert.equal(openCount(), "0");
  pass("simultaneous requests for different participants each consume only their own authorization and leave none open");

  // Failure after authorization: the whole transaction, authorization included, rolls back.
  const saFail = completeEnrolment();
  psql(`update public.course_schedules set trainer_name = null where id='${saFail.s}'`);
  const failTotals = totals();
  const failSeq = seqState();
  const failAudit = [auditCount("created"), auditCount("consumed")];
  rejects(asSuper(saFail), /Effective trainer is not configured/, "issuer failure after a valid authorization is reported");
  assert.equal(totals(), failTotals);
  assert.deepEqual([auditCount("created"), auditCount("consumed")], failAudit);
  assert.equal(openCount(), "0");
  assert.equal(psql(`select count(*) from app.wah_issuance_authorizations where schedule_id='${saFail.s}'`), "0");
  pass("a failed issuance rolls back the authorization, its audit row and the certificate");
  psql(`update public.course_schedules set trainer_name = 'Synthetic Trainer' where id='${saFail.s}'`);
  psql(asSuper(saFail));
  pass("after the cause is fixed, the same participant issues normally: nothing usable or blocking was left");

  // An authorization opened by the owner is not borrowed or disturbed.
  const saOwner = completeEnrolment();
  const ownerAuth = authorize(saOwner);
  const saOther = completeEnrolment();
  rejects(asSuper(saOther), /WAH_AUTHORIZATION_ALREADY_OPEN/, "Super Admin path does not run beside an open owner authorization");
  assert.equal(authRow(ownerAuth), "f|f||");
  psql(`select app.revoke_wah_issuance_authorization('${ownerAuth}', 'Test cleanup')`);
  psql(asSuper(saOther));
  pass("an open owner authorization is left untouched, and the Super Admin path works once it is closed");

  // Default deny everywhere else, bulk included, even for the Super Admin.
  const saBulk = seedGroup(3);
  for (const p of saBulk.ps) for (const [area, status] of Object.entries(COMPLETE)) setSkill({ s: saBulk.s, p }, area, status);
  const bulkTotals = totals();
  for (const p of saBulk.ps) rejects(issue({ s: saBulk.s, p }, SUPER), NOT_AUTHORIZED, "old public issuer, as Super Admin, is still denied for WAH (the bulk path)");
  assert.equal(totals(), bulkTotals);
  rejects(asUser(SUPER, `select id from app.issue_certificate_with_skill_snapshot('${saBulk.s}', '${saBulk.ps[0]}')`), NOT_AUTHORIZED, "old app issuer, as Super Admin, is still denied for WAH");
  pass("bulk-style WAH issuance through the old issuer is denied for everyone, Super Admin included");
  const actionsSource = read("app/admin/(protected)/certificates/actions.ts");
  const bulkSource = actionsSource.slice(actionsSource.indexOf("export async function bulkGenerate"), actionsSource.indexOf("export async function revokeCertificate"));
  assert.match(bulkSource, /isWahCourse\(/, "bulkGenerate must exclude WAH");
  assert.match(actionsSource, /issue_wah_certificate_as_super_admin/);
  pass("the CRM's bulk action excludes WAH, and individual WAH requests use the Super Admin function");

  // Erector, Inspector and history are untouched by the new path.
  rejects(asSuper(seedEnrolment(ERECTOR)), INVALID, "Super Admin function cannot be used to issue Erector");
  const erectorLater = seedEnrolment(ERECTOR);
  psql(issue(erectorLater));
  const inspectorLater = seedEnrolment(INSPECTOR);
  psql(issue(inspectorLater));
  assert.equal(payloadOf(certOf(erectorLater)), erectorPayloadBefore);
  assert.equal(payloadOf(certOf(inspectorLater)), inspectorPayloadBefore);
  assert.equal(certsAt(), certsBeforeGuard);
  assert.equal(snapsAt(), snapsBeforeGuard);
  pass("Erector and Inspector issue as before with identical payloads, and every earlier certificate and snapshot is byte-for-byte unchanged");

  // Rollback of this draft alone.
  const saRollback = read(SA_DRAFT).split("\n").filter((l) => l.startsWith("-- rollback> ")).map((l) => l.slice("-- rollback> ".length)).join("\n");
  const saKept = psql("select count(*) from app.wah_issuance_authorizations");
  const rolledOut = psql(`begin; ${saRollback}
    select count(*) from pg_proc where proname='issue_wah_certificate_as_super_admin';
    select count(*) from app.wah_issuance_authorizations;
    select count(*) from pg_trigger where tgname='trg_certificates_a_wah_issuance_guard' and tgenabled='O';
    rollback;`);
  assert.deepEqual(rolledOut.split("\n").slice(-3), ["0", saKept, "1"]);
  pass("this draft's rollback removes only the new functions: the guard stays enforcing and every authorization row stays");
  assert.equal(psql("select count(*) from pg_proc where proname='issue_wah_certificate_as_super_admin'"), "2");

  // ---- Re-apply with state, then rollback ------------------------------------------------------------
  const carried = completeEnrolment();
  const carriedAuth = authorize(carried);
  const rowsBefore = psql("select md5(string_agg(a::text, '|' order by id)) from app.wah_issuance_authorizations a");
  psql(read(GUARD));
  assert.equal(psql("select md5(string_agg(a::text, '|' order by id)) from app.wah_issuance_authorizations a"), rowsBefore);
  assert.equal(authRow(carriedAuth), "f|f||");
  pass("re-applying the migration keeps every authorization row, including an open one");
  psql(`select app.revoke_wah_issuance_authorization('${carriedAuth}', 'Test cleanup')`);

  const rollback = read(GUARD).split("\n").filter((l) => l.startsWith("-- rollback> ")).map((l) => l.slice("-- rollback> ".length)).join("\n");
  assert.ok(rollback.includes("disable trigger"));
  const rolled = completeEnrolment();
  const kept = psql("select count(*) from app.wah_issuance_authorizations");
  const out = psql(`begin; ${rollback}
    select set_config('test.uid', '${ADMIN}', true);
    select count(*) from pg_trigger where tgname='trg_certificates_a_wah_issuance_guard';
    select count(*) from app.wah_issuance_authorizations;
    select 'issued' from public.issue_certificate_with_skill_snapshot('${rolled.s}', '${rolled.p}');
    rollback;`);
  assert.deepEqual(out.split("\n").slice(-3), ["0", kept, "issued"]);
  pass("rollback script removes the guard and keeps every authorization row; issuance then behaves as before");
  assert.equal(psql("select count(*) from pg_trigger where tgname='trg_certificates_a_wah_issuance_guard'"), "1");
  rejects(issue(rolled), NOT_AUTHORIZED, "the rollback test itself rolled back: the guard is still in force");
  assert.equal(openCount(), "0");

  console.log(`\n${passed} checks passed`);
} finally {
  docker(["rm", "-f", container]);
}
