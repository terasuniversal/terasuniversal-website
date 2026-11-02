// Replays the Erector, Inspector and WAH C4 migrations on a disposable PostgreSQL
// container and exercises issuance with synthetic data only. It never connects
// to Supabase, Staging or Production.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL) {
  throw new Error("Refusing database test: external database environment variables are set");
}

const root = resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(resolve(root, p), "utf8");
const container = `teras-c4-wah-db-${process.pid}`;
const WAH = "963b1f6b-4c15-4833-90da-21aa0af0f544";
const ERECTOR = "2a78decf-6997-4626-a7cc-a1a23a110cf8";
const INSPECTOR = "b10c2e4b-f35f-478b-b450-f98323926345";
const OTHER = "11111111-1111-4111-8111-111111111111";
const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRAINER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const EDITOR = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ERECTOR_MIGRATION = "supabase/migrations/20261101091525_production_erector_c4_snapshot_dispatch.sql";
const INSPECTOR_MIGRATION = "supabase/migrations/20261101124601_production_inspector_c4_snapshot_dispatch.sql";
const WAH_DRAFT = "supabase/post_baseline_drafts/20261102000000_production_wah_c4_snapshot_dispatch.sql";
const WAH_HARDENING = "supabase/post_baseline_drafts/20261102010000_production_wah_failed_result_hardening.sql";

const docker = (args, input) => execFileSync("docker", args, { input, encoding: "utf8", stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
function psql(sql) {
  try {
    return docker(["exec", "-i", container, "psql", "-qtA", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], sql).trim();
  } catch (error) {
    throw new Error(`${error.stdout ?? ""}${error.stderr ?? ""}`);
  }
}
const asUser = (uid, sql) => `begin; select set_config('test.uid', '${uid}', true); ${sql}; commit;`;
function rejects(sql, pattern, label) {
  let message = "";
  try { psql(sql); } catch (error) { message = error.message; }
  assert.match(message, pattern, label);
  console.log(`PASS ${label}`);
}
const pass = (label) => console.log(`PASS ${label}`);

// One participant on a fresh schedule of `course`, attending every day.
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
const issue = ({ s, p }, uid = ADMIN) => asUser(uid, `select id from public.issue_certificate_with_skill_snapshot('${s}', '${p}')`);
const certOf = ({ s, p }) => psql(`select id from public.certificates where schedule_id='${s}' and participant_id='${p}'`);
const snapshotHash = () => psql(`select md5(coalesce(string_agg(s::text, '|' order by s.certificate_id), '')) from public.certificate_issuance_snapshots s`);

docker(["run", "--rm", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=disposable_only", "postgres:17.6-alpine"]);
try {
  let ready = false;
  for (let i = 0; i < 45 && !ready; i += 1) {
    try { docker(["exec", container, "psql", "-U", "postgres", "-c", "select 1"]); ready = true; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  assert.ok(ready, "Disposable PostgreSQL did not become ready");

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

  // Pre-migration state: legacy WAH with and without a snapshot, Erector, Inspector.
  const legacySnapshot = seedEnrolment(WAH);
  psql(issue(legacySnapshot));
  const legacyNoSnapshot = psql(`insert into public.certificates (holder_name, course_id, course_name, status, issue_date) values ('SYNTHETIC LEGACY', '${WAH}', 'Working at Height', 'valid', '2026-08-25') returning id`);
  const legacyMarkedBefore = psql(`insert into public.certificates (certificate_no, holder_name, course_id, course_name, status, issue_date, metadata) values ('SYN-OLD-LEGACY', 'SYNTHETIC OLD LEGACY', '${WAH}', 'Working at Height', 'valid', '2020-01-01', '{"provenance":"legacy_import"}') returning id`);
  const erectorBefore = seedEnrolment(ERECTOR, { days: 2 });
  psql(issue(erectorBefore));
  const inspectorBefore = seedEnrolment(INSPECTOR);
  psql(issue(inspectorBefore));
  const payloadOf = (t) => psql(`select render_payload - 'certificate_number' - 'verification_path' - 'verification_token' - 'holder_name' - 'identity_no' - 'participant_code_snapshot' - 'schedule_code' - 'issue_date' from public.certificate_issuance_snapshots where certificate_id='${t}'`);
  const erectorPayloadBefore = payloadOf(certOf(erectorBefore));
  const inspectorPayloadBefore = payloadOf(certOf(inspectorBefore));
  const legacyRow = psql(`select render_contract_version, renderer_version from public.certificates c join public.certificate_issuance_snapshots s on s.certificate_id=c.id where c.id='${certOf(legacySnapshot)}'`);
  assert.equal(legacyRow, "certificate_renderer_v1|certificate_renderer_v1");
  const hashBefore = snapshotHash();
  const legacyCertsBefore = psql(`select md5(string_agg(c::text, '|' order by id)) from public.certificates c`);

  // Staging safety: the draft refuses a database without the Production course.
  const draftBody = read(WAH_DRAFT).replace(/^begin;$/m, "").replace(/^commit;\s*$/m, "");
  rejects(`begin; update public.certificate_templates set config = config - 'design_variant' where id='30000000-0000-4000-8000-000000000001'; ${draftBody} rollback;`, /requires the Production WAH course/, "draft aborts where the Production WAH course/template binding is absent");

  // Apply twice: idempotency.
  psql(read(WAH_DRAFT));
  psql(read(WAH_DRAFT));
  pass("draft applies and re-applies idempotently");

  // Production's RLS, policies, grants and audit trigger for these tables, as read live.
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
  // The real legacy function bodies, taken from the migrations that define them.
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
  psql(read(WAH_HARDENING));
  pass("hardening draft applies and re-applies idempotently");
  assert.equal(snapshotHash(), hashBefore);
  assert.equal(psql(`select md5(string_agg(c::text, '|' order by id)) from public.certificates c`), legacyCertsBefore);
  assert.equal(psql(`select count(*) from public.certificates where id='${legacyNoSnapshot}' and render_contract_version is null`), "1");
  pass("legacy WAH (snapshot and no-snapshot), Erector and Inspector rows unchanged by the migration");

  // WAH C4 snapshot.
  const wah = seedEnrolment(WAH);
  psql(issue(wah));
  const c = certOf(wah);
  const row = JSON.parse(psql(`select json_build_object('rv', s.renderer_version, 'marker', c.render_contract_version, 'p', s.render_payload, 'digest_ok', s.render_payload->>'programme_content_digest' = md5((s.render_payload->'programme_content')::text)) from public.certificate_issuance_snapshots s join public.certificates c on c.id=s.certificate_id where c.id='${c}'`));
  assert.equal(row.rv, "c4_wave1_wah_v1");
  assert.equal(row.marker, "c4_wave1_wah_v1");
  assert.equal(row.digest_ok, true);
  assert.equal(row.p.certificate_family, "working_at_height");
  assert.equal(row.p.certificate_title, "WORKING AT HEIGHT TRAINING CERTIFICATE");
  assert.equal(row.p.watermark_asset_family, "working-at-height");
  pass("WAH snapshot uses c4_wave1_wah_v1, marker and digest validate");

  // Frozen content must match the approved catalogue byte for byte.
  const catalogue = read("lib/working-at-height-programme.ts");
  const content = row.p.programme_content;
  assert.equal(content.programme_duration, "2-Day Practical Training");
  assert.equal(content.coverage.length, 9);
  assert.equal(content.outcomes.length, 6);
  assert.equal(content.assessment.length, 5);
  for (const text of [content.programme_title, content.programme_duration, content.objectives, ...content.coverage, ...content.outcomes, ...content.assessment]) {
    assert.ok(catalogue.includes(`"${text}"`), `not verbatim from the catalogue: ${text}`);
  }
  pass("frozen programme content is verbatim from lib/working-at-height-programme.ts (9/6/5)");

  // No automatic Skills Record completion.
  assert.deepEqual(row.p.skills_record.map((r) => [r.area, r.status]).sort(), [["attendance_requirement", "met"], ["practical_assessment", "not_recorded"], ["practical_training", "not_recorded"], ["safety_awareness", "not_recorded"], ["theory_session", "not_recorded"]]);
  pass("missing skills input freezes as not_recorded; nothing is auto-completed");

  rejects(issue(seedEnrolment(WAH, { branch: "null" })), /issuing branch is not configured/, "missing branch rejected");
  const noBranchCount = psql(`select count(*) from public.certificates where branch_id is null and course_id='${WAH}' and schedule_id is not null and render_contract_version='c4_wave1_wah_v1'`);
  assert.equal(noBranchCount, "0");
  rejects(issue(seedEnrolment(WAH, { attended: 1 })), /Not eligible: attendance_not_met/, "attendance below 100% rejected");
  rejects(issue(seedEnrolment(WAH, { status: "scheduled" })), /Not eligible: schedule_not_completed/, "incomplete schedule rejected");
  rejects(issue(seedEnrolment(WAH), EDITOR), /Not authorized/, "non-admin issuance rejected");
  rejects(issue(wah), /Not eligible: certificate_already_exists/, "duplicate issuance rejected");
  rejects(`begin; set local role authenticated; update public.certificate_issuance_snapshots set render_payload='{}' where certificate_id='${c}'; commit;`, /permission denied/, "direct snapshot update rejected for authenticated");
  rejects(`begin; set local role authenticated; update public.certificates set render_contract_version=null where id='${c}'; commit;`, /permission denied/, "direct marker update rejected for authenticated");
  rejects(`update public.certificates set render_contract_version='c4_wave1_v1' where id='${c}'`, /immutable outside trusted snapshot issuance/, "marker immutable even for the owner");
  rejects(`update public.certificate_issuance_snapshots set render_payload = render_payload || '{"programme_content_digest":"tampered"}' where certificate_id='${c}'`, /c4_content_digest_check/, "tampered digest rejected");

  // Rollback: a contract failure in the trigger leaves no certificate behind.
  const bad = seedEnrolment(WAH);
  psql(`update public.certificate_templates set config = config || '{"design_variant":"standard_scaffold_certificate"}' where id='30000000-0000-4000-8000-000000000001'`);
  rejects(issue(bad), /fail-closed: unsupported working_at_height/, "wrong design_variant fails closed");
  psql(`update public.certificate_templates set config = config || '{"design_variant":"working_at_height_certificate"}' where id='30000000-0000-4000-8000-000000000001'`);
  assert.equal(psql(`select count(*) from public.certificates where schedule_id='${bad.s}'`), "0");
  assert.equal(psql(`select count(*) from public.certificate_skill_results r where not exists (select 1 from public.certificates c where c.id=r.certificate_id)`), "0");
  pass("failed issuance rolls back with no certificate or skill rows");

  // Duplicate of a WAH C4 keeps its frozen content.
  psql(read("supabase/tests/fixtures/c4_wah_production_duplicate_rpc.sql"));
  psql(asUser(ADMIN, `select id from app.duplicate_certificate_with_skill_snapshot('${c}')`));
  const dup = JSON.parse(psql(`select json_build_object('rv', s.renderer_version, 'marker', d.render_contract_version, 'content', s.render_payload->'programme_content', 'original', o.render_payload->'programme_content') from public.certificates d join public.certificate_issuance_snapshots s on s.certificate_id=d.id join public.certificate_issuance_snapshots o on o.certificate_id=d.replaces_certificate_id where d.replaces_certificate_id='${c}'`));
  assert.equal(dup.rv, "c4_wave1_wah_v1");
  assert.equal(dup.marker, "c4_wave1_wah_v1");
  assert.deepEqual(dup.content, dup.original);
  pass("duplicate of a WAH C4 keeps renderer, marker and frozen content");
  psql(asUser(ADMIN, `select id from app.duplicate_certificate_with_skill_snapshot('${certOf(legacySnapshot)}')`));
  assert.equal(psql(`select string_agg(d.render_contract_version || '|' || s.renderer_version, ',') from public.certificates d join public.certificate_issuance_snapshots s on s.certificate_id=d.id where d.replaces_certificate_id='${certOf(legacySnapshot)}'`), "certificate_renderer_v1|certificate_renderer_v1");
  pass("duplicate of a legacy WAH stays certificate_renderer_v1");

  // Owner rule: a recorded Failed Practical Assessment holds new WAH issuance.
  const HOLD = /WAH_FAILED_PRACTICAL_ASSESSMENT_HOLD/;
  const setSkill = ({ s, p }, area, status) => psql(`insert into public.participant_skill_results (schedule_id, participant_id, area, status) values ('${s}', '${p}', '${area}', '${status}')`);
  const frozen = (e, area) => psql(`select r.status from public.certificate_skill_results r join public.certificates c on c.id = r.certificate_id where c.schedule_id = '${e.s}' and c.participant_id = '${e.p}' and r.area = '${area}'`);
  const totals = () => psql("select (select count(*) from public.certificates), (select count(*) from public.certificate_issuance_snapshots), (select count(*) from public.certificate_skill_results), (select count(*) from public.audit_logs)");
  const failed = seedEnrolment(WAH);
  setSkill(failed, "practical_assessment", "failed");
  const beforeHold = totals();
  rejects(issue(failed), HOLD, "A: Failed rejected with the hold error through the public RPC");
  rejects(asUser(ADMIN, `select id from app.issue_certificate_with_skill_snapshot('${failed.s}', '${failed.p}')`), HOLD, "F: direct app issuer RPC cannot bypass the hold");
  assert.equal(totals(), beforeHold);
  assert.equal(psql(`select count(*) from public.certificates where schedule_id = '${failed.s}'`), "0");
  assert.equal(psql(`select status from public.participant_skill_results where schedule_id = '${failed.s}' and area = 'practical_assessment'`), "failed");
  pass("A/J: full rollback, no certificate, snapshot, frozen skills or audit row; Failed preserved");

  const passedCase = seedEnrolment(WAH);
  setSkill(passedCase, "practical_assessment", "passed");
  psql(issue(passedCase));
  assert.equal(frozen(passedCase, "practical_assessment"), "passed");
  pass("B: Passed issues");
  const notRecorded = seedEnrolment(WAH);
  setSkill(notRecorded, "practical_assessment", "not_recorded");
  psql(issue(notRecorded));
  assert.equal(frozen(notRecorded, "practical_assessment"), "not_recorded");
  pass("C: Not Recorded issues");
  const missing = seedEnrolment(WAH);
  psql(issue(missing));
  assert.equal(frozen(missing, "practical_assessment"), "not_recorded");
  assert.equal(psql(`select count(*) from public.participant_skill_results where schedule_id = '${missing.s}'`), "0");
  pass("D: missing row issues as not_recorded with no source row created");

  // Trainer, Admin and service-role boundaries on the protected Failed row.
  const asRole = (uid, sql, role = "authenticated") => `begin; select set_config('test.uid', '${uid}', true); set local role ${role}; ${sql}; commit;`;
  const failedStatus = (e) => psql(`select status || '|' || coalesce(deleted_at::text, 'active') from public.participant_skill_results where schedule_id = '${e.s}' and participant_id = '${e.p}' and area = 'practical_assessment'`);
  const fRow = `schedule_id = '${failed.s}' and participant_id = '${failed.p}' and area = 'practical_assessment'`;
  const PROTECTED = /WAH_FAILED_RESULT_PROTECTED/;
  rejects(asRole(TRAINER, `update public.participant_skill_results set status = 'passed' where ${fRow}`), PROTECTED, "5: Trainer cannot change Failed");
  rejects(asRole(TRAINER, `update public.participant_skill_results set deleted_at = now() where ${fRow}`), PROTECTED, "6: Trainer cannot soft-delete Failed");
  assert.equal(psql(asRole(TRAINER, `with d as (delete from public.participant_skill_results where ${fRow} returning 1) select count(*) from d`)).split("\n").pop(), "0");
  pass("7: Trainer hard-delete removes nothing (RLS)");
  rejects(asRole(ADMIN, `delete from public.participant_skill_results where ${fRow}`), PROTECTED, "7: Admin hard-delete rejected by the guard");
  rejects(asRole(ADMIN, `update public.participant_skill_results set status = 'passed' where ${fRow}`), PROTECTED, "11: Admin cannot bypass the correction with a direct update");
  rejects(asRole(ADMIN, `update public.participant_skill_results set deleted_at = now() where ${fRow}`), PROTECTED, "6: Admin cannot soft-delete Failed");
  rejects(asRole(ADMIN, `delete from public.participant_skill_results where ${fRow}`, "service_role"), PROTECTED, "7: service_role hard-delete rejected");
  rejects(asRole(ADMIN, `select set_config('app.wah_failed_correction', (select id::text from public.participant_skill_results where ${fRow}) || ':passed', true); update public.participant_skill_results set status = 'passed' where ${fRow}`, "service_role"), PROTECTED, "11: service_role cannot pass by setting the correction marker");
  rejects(`update public.participant_skill_results set status = 'passed' where ${fRow}`, PROTECTED, "11: owner session without the correction function rejected");
  const decoy = seedEnrolment(WAH);
  for (const [field, value] of [["schedule_id", decoy.s], ["participant_id", decoy.p], ["area", "theory_session"]]) {
    rejects(asRole(TRAINER, `update public.participant_skill_results set ${field} = '${value}' where ${fRow}`), /WAH_SKILL_RESULT_IDENTITY_IMMUTABLE/, `8: Trainer cannot alter ${field} to hide Failed`);
  }
  assert.equal(failedStatus(failed), "failed|active");

  // Correction function: authorization and required evidence.
  const correct = (uid, status, reason, evidence) => asUser(uid, `select app.correct_wah_failed_practical_assessment('${failed.s}', '${failed.p}', ${status}, ${reason}, ${evidence})`);
  const GOOD_REASON = "'Assessor sheet shows the result was entered against the wrong participant.'";
  rejects(correct(TRAINER, "'passed'", GOOD_REASON, "'SYN-EV-1'"), /Not authorized/, "5: Trainer cannot use the correction function");
  rejects(correct(EDITOR, "'passed'", GOOD_REASON, "'SYN-EV-1'"), /Not authorized/, "11: Editor cannot use the correction function");
  rejects(correct(ADMIN, "'passed'", "null", "'SYN-EV-1'"), /correction reason/, "9: reason required");
  rejects(correct(ADMIN, "'passed'", "'   short '", "'SYN-EV-1'"), /correction reason/, "9: short or blank reason rejected");
  rejects(correct(ADMIN, "'passed'", GOOD_REASON, "null"), /evidence reference/, "9: evidence reference required");
  rejects(correct(ADMIN, "'passed'", GOOD_REASON, "'  '"), /evidence reference/, "9: blank evidence reference rejected");
  rejects(correct(ADMIN, "'completed'", GOOD_REASON, "'SYN-EV-1'"), /must be Passed or Not Recorded/, "9: invalid target status rejected");
  const beforeFailure = totals();
  psql(`create function public.block_audit() returns trigger language plpgsql as $f$ begin raise exception 'audit unavailable'; end $f$; create trigger block_audit before insert on public.audit_logs for each row when (new.summary like 'WAH Failed%') execute function public.block_audit();`);
  rejects(correct(ADMIN, "'passed'", GOOD_REASON, "'SYN-EV-1'"), /audit unavailable/, "11: correction fails when its audit row cannot be written");
  psql("drop trigger block_audit on public.audit_logs; drop function public.block_audit();");
  assert.equal(failedStatus(failed), "failed|active");
  assert.equal(totals(), beforeFailure);
  pass("11/18: failed correction rolled back with no status change or audit row");
  rejects(issue(failed), HOLD, "1: still held while Failed");

  const lockedCase = seedEnrolment(WAH);
  setSkill(lockedCase, "practical_assessment", "failed");
  setSkill(lockedCase, "theory_session", "not_recorded");
  psql(`insert into public.assessments (schedule_id, participant_id, result, locked) values ('${lockedCase.s}', '${lockedCase.p}', 'fail', true)`);
  const LOCK = /WAH_SKILL_RESULT_LOCKED/;
  rejects(asRole(TRAINER, `update public.participant_skill_results set status = 'completed' where schedule_id = '${lockedCase.s}' and area = 'theory_session'`), LOCK, "12: lock blocks a direct update");
  rejects(asRole(TRAINER, `insert into public.participant_skill_results (schedule_id, participant_id, area, status) values ('${lockedCase.s}', '${lockedCase.p}', 'safety_awareness', 'completed')`), LOCK, "12: lock blocks a direct insert");
  rejects(asUser(ADMIN, `select app.correct_wah_failed_practical_assessment('${lockedCase.s}', '${lockedCase.p}', 'passed', ${GOOD_REASON}, 'SYN-EV-2')`), LOCK, "12: lock blocks the Admin correction");
  rejects(asRole(TRAINER, `insert into public.participant_skill_results (schedule_id, participant_id, area, status) values ('${decoy.s}', '${decoy.p}', 'theory_session', 'passed')`), /WAH_SKILL_RESULT_INVALID_STATUS/, "Per-area status enforced without changing the value");

  psql(asRole(TRAINER, `insert into public.participant_skill_results (schedule_id, participant_id, area, status) values ('${decoy.s}', '${decoy.p}', 'practical_assessment', 'failed')`));
  assert.equal(failedStatus(decoy), "failed|active");
  pass("Trainer may still record a genuine Failed result");

  // Valid correction.
  psql(correct(ADMIN, "'passed'", GOOD_REASON, "'SYN-EV-1'"));
  const history = JSON.parse(psql(`select json_build_object('actor', actor_id, 'email', actor_email, 'at', created_at, 'm', metadata) from public.audit_logs where summary = 'WAH Failed Practical Assessment corrected'`));
  assert.equal(history.actor, ADMIN);
  assert.equal(history.email, "admin@synthetic.test");
  assert.ok(history.at);
  assert.deepEqual([history.m.schedule_id, history.m.participant_id, history.m.area, history.m.old_status, history.m.new_status, history.m.evidence_reference], [failed.s, failed.p, "practical_assessment", "failed", "passed", "SYN-EV-1"]);
  assert.match(history.m.reason, /wrong participant/);
  assert.equal(psql(`select count(*) from public.audit_logs where actor_id = '${ADMIN}' and entity_type = 'participant_skill_results' and action = 'update'`), "2");
  pass("10: correction records schedule, participant, area, old and new values, actor, time, reason and evidence reference");
  assert.equal(psql("select current_setting('app.wah_failed_correction', true) is null or current_setting('app.wah_failed_correction', true) = ''"), "t");
  psql(issue(failed));
  assert.equal(frozen(failed, "practical_assessment"), "passed");
  pass("E: next issuance freezes the corrected result with no override");

  // The audit trail is append-only for staff, and the assessments table stays independent.
  for (const [uid, label] of [[ADMIN, "Admin"], [TRAINER, "Trainer"]]) {
    for (const sql of ["update public.audit_logs set summary = 'x'", "delete from public.audit_logs", "truncate public.audit_logs"]) {
      rejects(asRole(uid, sql), /permission denied/, `${label} cannot run: ${sql}`);
    }
  }
  rejects(asRole(ADMIN, "truncate public.participant_skill_results"), /permission denied/, "Staff cannot truncate skill results");

  const assessFail = seedEnrolment(WAH);
  psql(`insert into public.assessments (schedule_id, participant_id, result, competency_status) values ('${assessFail.s}', '${assessFail.p}', 'fail', 'not_yet_competent')`);
  psql(issue(assessFail));
  assert.equal(frozen(assessFail, "practical_assessment"), "not_recorded");
  pass("13: assessments.result = fail alone does not trigger the hold");

  // C4E-2K legacy paths, through the real functions and an ordinary Admin session.
  const LEGACY_OFF = /WAH_LEGACY_IMPORT_DISABLED/;
  const SCHEDULE_OFF = /WAH_LEGACY_SCHEDULE_DISABLED/;
  const worldCounts = () => psql(`select (select count(*) from public.certificates), (select count(*) from public.participants), (select count(*) from public.course_schedules), (select count(*) from public.schedule_participants)`);
  const certPayload = (name, extra = "") => `'{"certificate_no":"SYN-IMP-' || gen_random_uuid() || '","participant_name":"SYNTHETIC IMPORT","course_name":"${name}","course_date":"2020-01-01"${extra}}'`;
  const directImport = (p, course, name, uid = ADMIN) => asRole(uid, `select * from public.import_legacy_certificate('${p}', ${course ? `'${course}'` : "null"}, (${certPayload(name)})::jsonb)`);

  const certsBeforeLegacy = psql(`select md5(string_agg(c::text, '|' order by id)) from public.certificates c`);
  const legacyClean = seedEnrolment(WAH);
  const legacyFailed = seedEnrolment(WAH);
  setSkill(legacyFailed, "practical_assessment", "failed");
  const countsBefore = worldCounts();
  rejects(directImport(legacyClean.p, WAH, "Working at Height"), LEGACY_OFF, "K1/K4: direct RPC rejected for WAH with no Failed record");
  rejects(asRole(ADMIN, `select * from app.import_legacy_certificate('${legacyClean.p}', '${WAH}', (${certPayload("Working at Height")})::jsonb)`), LEGACY_OFF, "K13: the app schema function cannot bypass the guard");
  rejects(directImport(legacyFailed.p, WAH, "Working at Height"), LEGACY_OFF, "K1: direct RPC rejected for a participant with a Failed record");
  rejects(directImport(legacyClean.p, OTHER, "WORKING-AT-HEIGHT Refresher"), LEGACY_OFF, "K13: another course id with a WAH name rejected");
  rejects(directImport(legacyClean.p, null, "wah"), LEGACY_OFF, "K13: a null course with the WAH code as its name rejected");
  rejects(directImport(legacyClean.p, WAH, "Totally Different Name"), LEGACY_OFF, "K13: the WAH course id under a different name rejected");
  const wahNamedCourse = "44444444-4444-4444-8444-444444444444";
  psql(`insert into public.courses (id, title, course_name) values ('${wahNamedCourse}', 'Working At Heights Training', 'Working At Heights Training')`);
  rejects(directImport(legacyClean.p, wahNamedCourse, "Unrelated Label"), LEGACY_OFF, "K13: a copy course named WAH rejected even with an unrelated certificate name");
  rejects(directImport(legacyClean.p, OTHER, "Working at Height", TRAINER), /Not authorized/, "K13: a Trainer cannot call the import at all");
  rejects(asRole(ADMIN, `insert into public.certificates (certificate_no, course_id, course_name, status, issue_date) values ('SYN-DIRECT', '${WAH}', 'Working at Height', 'valid', '2020-01-01')`), /permission denied/, "K13: direct certificate insert denied to API roles");
  rejects(`insert into public.certificates (certificate_no, course_id, course_name, status, issue_date, legacy_batch_id) values ('SYN-OWNER', '${WAH}', 'Working at Height', 'valid', '2020-01-01', gen_random_uuid())`, LEGACY_OFF, "K13: the trigger also holds for an owner session");
  assert.equal(worldCounts(), countsBefore);
  pass("K14: rejected direct imports leave no certificate, participant, schedule or enrolment");

  // Same label rules as isWahCourseLabel, whose list is in c4-wah-hold-contract.mjs.
  for (const [label, expected] of [["Working at Height", "t"], ["WORKING-AT-HEIGHT", "t"], ["working_at_heights", "t"], ["Workingatheight", "t"], ["Work at Height", "t"], ["WAH", "t"], ["Refresher (WAH)", "t"], ["Basic Scaffolding", "f"], ["OSH Awareness", "f"], ["Wahana Safety", "f"], ["Height Safety", "f"], ["Network at Heights", "f"]]) {
    assert.equal(psql(`select app.is_wah_course_label('${label}')`), expected, label);
  }
  assert.equal(psql(`select app.is_wah_course_label(null)`), "f");
  pass("K: recognised WAH labels match and unrelated names do not");

  // Batch merge, through legacy_merge_execute_row.
  const batch = (rows) => {
    const b = psql(`insert into public.legacy_import_batches (status) values ('approved') returning id`);
    return rows.map((r, i) => ({ b, id: psql(`insert into public.legacy_participant_staging (batch_id, source_row_number, raw_name, raw_ic_passport, normalized_ic_passport, raw_course_name, mapped_course_id, training_start_date, raw_certificate_number, match_status, review_status) values ('${b}', ${i + 1}, 'SYNTHETIC MERGE ${i}', 'SYNMERGE${b.slice(0, 6)}${i}', 'SYNMERGE${b.slice(0, 6)}${i}', ${r.rawName === null ? "null" : `'${r.rawName}'`}, ${r.course ? `'${r.course}'` : "null"}, ${r.date === null ? "null" : `'2020-01-01'`}, ${r.cert ? `'SYN-MERGE-${b.slice(0, 8)}-${i}'` : "null"}, 'new_participant', 'approved') returning id`) }));
  };
  const merge = ({ b, id }, uid = ADMIN) => JSON.parse(psql(asRole(uid, `select public.legacy_merge_execute_row('${b}', '${id}')`)).split("\n").pop());
  const stagingOf = (id) => psql(`select review_status || '|' || coalesce(merge_error, '') || '|' || (result_participant_id is null)::text || (result_schedule_id is null)::text || (result_certificate_id is null)::text from public.legacy_participant_staging where id = '${id}'`);
  const beforeMerge = worldCounts();
  const [wahWithCert, wahNoCert, wahNameOnly] = batch([{ course: WAH, rawName: "Working at Height", cert: true }, { course: WAH, rawName: "Working at Height", cert: false }, { course: OTHER, rawName: "Working at Height", cert: true }]);
  let result = merge(wahWithCert);
  assert.equal(result.status, "failed");
  assert.match(result.error, SCHEDULE_OFF);
  assert.match(stagingOf(wahWithCert.id), /^approved\|WAH_LEGACY_SCHEDULE_DISABLED.*\|truetruetrue$/);
  pass("K2: WAH batch merge with a certificate number rejected, row left approved with the error");
  result = merge(wahNoCert);
  assert.equal(result.status, "failed");
  assert.match(result.error, SCHEDULE_OFF);
  pass("K3: WAH staging row with no certificate number creates no schedule");
  result = merge(wahNameOnly);
  assert.equal(result.status, "failed");
  assert.match(result.error, LEGACY_OFF);
  pass("K2: a merge mapped to another course but named WAH is rejected at the certificate");
  const [noDate] = batch([{ course: WAH, rawName: "Working at Height", cert: true, date: null }]);
  result = merge(noDate);
  assert.equal(result.status, "failed");
  assert.match(result.error, /certificate_date_required/);
  assert.equal(worldCounts(), beforeMerge);
  pass("K14: rejected merges leave no participant, schedule, enrolment or certificate");
  rejects(asRole(ADMIN, `insert into public.course_schedules (course_id, start_date, end_date, status, legacy_batch_id) values ('${WAH}', '2020-01-01', '2020-01-02', 'completed', gen_random_uuid())`), SCHEDULE_OFF, "K13: a direct legacy WAH schedule insert rejected");
  const plainWah = seedEnrolment(WAH);
  rejects(asRole(ADMIN, `update public.course_schedules set legacy_batch_id = gen_random_uuid() where id = '${plainWah.s}'`), SCHEDULE_OFF, "K13: an existing WAH schedule cannot be marked as a legacy batch schedule");

  // Other courses keep both legacy paths.
  const otherImport = seedEnrolment(OTHER);
  const imported = psql(directImport(otherImport.p, OTHER, "Unlisted Course")).split("\n").pop().split("|")[0];
  assert.equal(psql(`select metadata->>'provenance' from public.certificates where id = '${imported}'`), "legacy_import");
  const erectorImport = seedEnrolment(ERECTOR);
  psql(directImport(erectorImport.p, ERECTOR, "Basic Scaffolding Erector"));
  pass("K7: direct legacy import still works for other courses");
  const [otherRow] = batch([{ course: OTHER, rawName: "Unlisted Course", cert: true }]);
  const otherMerged = merge(otherRow);
  assert.equal(otherMerged.status, "merged");
  assert.equal(psql(`select legacy_batch_id is not null from public.certificates where id = '${otherMerged.certificate_id}'`), "t");
  assert.equal(psql(`select legacy_batch_id is not null and status = 'completed' from public.course_schedules where id = '${otherMerged.schedule_id}'`), "t");
  pass("K7: batch merge still works for other courses, with its legacy schedule");

  // Existing certificates and normal issuance.
  const certsAfterLegacy = psql(`select md5(string_agg(c::text, '|' order by id)) from public.certificates c where c.id not in (select id from public.certificates where (metadata->>'provenance' = 'legacy_import' or legacy_batch_id is not null) and id <> '${legacyMarkedBefore}')`);
  assert.equal(certsAfterLegacy, certsBeforeLegacy);
  psql(`update public.certificates set remarks = 'lifecycle update' where id = '${legacyMarkedBefore}'`);
  pass("K5: existing WAH certificates unchanged, and an older legacy-marked row is not blocked from updates");
  const wahIssued = seedEnrolment(WAH);
  psql(issue(wahIssued));
  assert.equal(psql(`select render_contract_version from public.certificates where id = '${certOf(wahIssued)}'`), "c4_wave1_wah_v1");
  psql(asUser(ADMIN, `select id from app.duplicate_certificate_with_skill_snapshot('${certOf(wahIssued)}')`));
  assert.equal(psql(`select count(*) from public.certificates where replaces_certificate_id = '${certOf(wahIssued)}' and render_contract_version = 'c4_wave1_wah_v1'`), "1");
  pass("K6: normal WAH issuance and duplication unaffected");

  // Schedule integrity, as an ordinary Admin session.
  const DELETE_BLOCKED = /WAH_SCHEDULE_DELETE_BLOCKED/;
  const COURSE_LOCKED = /WAH_SCHEDULE_COURSE_LOCKED/;
  const delSchedule = (s) => asRole(ADMIN, `delete from public.course_schedules where id = '${s}'`);
  const moveSchedule = (s, course) => asRole(ADMIN, `update public.course_schedules set course_id = '${course}' where id = '${s}'`);
  const courseOf = (s) => psql(`select course_id from public.course_schedules where id = '${s}'`);

  const enrolledOnly = seedEnrolment(WAH, { attended: 0 });
  rejects(delSchedule(enrolledOnly.s), DELETE_BLOCKED, "K8: WAH schedule with an enrolment cannot be hard-deleted");
  rejects(moveSchedule(enrolledOnly.s, OTHER), COURSE_LOCKED, "K9: WAH schedule with an enrolment cannot change course");
  const skillOnly = seedEnrolment(WAH, { attended: 0 });
  setSkill(skillOnly, "practical_assessment", "failed");
  psql(`delete from public.schedule_participants where schedule_id = '${skillOnly.s}'`);
  rejects(delSchedule(skillOnly.s), DELETE_BLOCKED, "K8: WAH schedule holding only a Failed result cannot be hard-deleted");
  rejects(moveSchedule(skillOnly.s, OTHER), COURSE_LOCKED, "K9: WAH schedule holding only a Failed result cannot change course");
  assert.equal(psql(`select status from public.participant_skill_results where schedule_id = '${skillOnly.s}'`), "failed");
  assert.equal(courseOf(skillOnly.s), WAH);
  const certOnly = seedEnrolment(WAH);
  psql(issue(certOnly));
  psql(`delete from public.schedule_participants where schedule_id = '${certOnly.s}'; delete from public.attendance where schedule_id = '${certOnly.s}'`);
  rejects(delSchedule(certOnly.s), DELETE_BLOCKED, "K8: WAH schedule holding only a certificate cannot be hard-deleted");
  rejects(moveSchedule(certOnly.s, OTHER), COURSE_LOCKED, "K9: WAH schedule holding only a certificate cannot change course");

  const otherPopulated = seedEnrolment(OTHER);
  rejects(moveSchedule(otherPopulated.s, WAH), COURSE_LOCKED, "K10: populated non-WAH schedule cannot move to WAH");
  assert.equal(courseOf(otherPopulated.s), OTHER);

  // Attendance outlives an enrolment's removal, so it counts on its own.
  const attendanceRows = (s) => psql(`select count(*) from public.attendance where schedule_id = '${s}'`);
  const removeEnrolments = (s) => psql(asRole(ADMIN, `delete from public.schedule_participants where schedule_id = '${s}'`));
  const wahAttendance = seedEnrolment(WAH);
  removeEnrolments(wahAttendance.s);
  rejects(delSchedule(wahAttendance.s), DELETE_BLOCKED, "M: WAH schedule holding only attendance cannot be hard-deleted");
  rejects(moveSchedule(wahAttendance.s, OTHER), COURSE_LOCKED, "M: WAH schedule holding only attendance cannot change course");
  assert.equal(attendanceRows(wahAttendance.s), "2");
  psql(`update public.attendance set deleted_at = now() where schedule_id = '${wahAttendance.s}'`);
  rejects(delSchedule(wahAttendance.s), DELETE_BLOCKED, "M: soft-deleted attendance still counts for hard delete");
  rejects(moveSchedule(wahAttendance.s, OTHER), COURSE_LOCKED, "M: soft-deleted attendance still counts for a course change");
  assert.equal(courseOf(wahAttendance.s), WAH);
  psql(`delete from public.attendance where schedule_id = '${wahAttendance.s}'`);
  psql(moveSchedule(wahAttendance.s, OTHER));
  assert.equal(courseOf(wahAttendance.s), OTHER);
  psql(delSchedule(wahAttendance.s));
  pass("M: once attendance is genuinely removed, an emptied schedule can be corrected");
  const otherAttendance = seedEnrolment(OTHER);
  removeEnrolments(otherAttendance.s);
  rejects(moveSchedule(otherAttendance.s, WAH), COURSE_LOCKED, "M: non-WAH attendance cannot be carried on to WAH by emptying enrolments first");
  assert.equal(courseOf(otherAttendance.s), OTHER);
  assert.equal(attendanceRows(otherAttendance.s), "2");
  psql(moveSchedule(otherAttendance.s, ERECTOR));
  assert.equal(courseOf(otherAttendance.s), ERECTOR);
  psql(delSchedule(otherAttendance.s));
  assert.equal(attendanceRows(otherAttendance.s), "0");
  pass("M: attendance-only non-WAH schedules keep their existing behaviour");

  // deleted_at never makes a schedule look empty.
  const softDeleted = seedEnrolment(WAH);
  setSkill(softDeleted, "practical_assessment", "failed");
  psql(asRole(ADMIN, `update public.schedule_participants set deleted_at = now() where schedule_id = '${softDeleted.s}'`));
  psql(asRole(ADMIN, `update public.course_schedules set deleted_at = now() where id = '${softDeleted.s}'`));
  rejects(delSchedule(softDeleted.s), DELETE_BLOCKED, "K12: soft-deleted schedule and enrolment still cannot be hard-deleted");
  rejects(moveSchedule(softDeleted.s, OTHER), COURSE_LOCKED, "K12: soft-deleted schedule still cannot change course");
  const softRow = `schedule_id = '${softDeleted.s}' and area = 'practical_assessment'`;
  rejects(asRole(TRAINER, `update public.participant_skill_results set status = 'passed' where ${softRow}`), PROTECTED, "K12: Failed stays protected while the schedule is soft-deleted");
  rejects(asRole(ADMIN, `delete from public.participant_skill_results where ${softRow}`), PROTECTED, "K12: Failed cannot be hard-deleted while the schedule is soft-deleted");
  psql(asRole(ADMIN, `update public.course_schedules set deleted_at = null where id = '${softDeleted.s}'`));
  psql(asRole(ADMIN, `update public.schedule_participants set deleted_at = null where schedule_id = '${softDeleted.s}'`));
  assert.equal(failedStatus(softDeleted), "failed|active");
  rejects(issue(softDeleted), /WAH_FAILED_PRACTICAL_ASSESSMENT_HOLD/, "K12: the issuance hold still applies after restore");
  pass("K12: soft delete and restore still work and lift no protection");

  rejects(asRole(ADMIN, `delete from public.course_schedules where id = '${enrolledOnly.s}'`, "service_role"), DELETE_BLOCKED, "K13: service_role cannot hard-delete either");
  rejects(`delete from public.course_schedules where id = '${enrolledOnly.s}'`, DELETE_BLOCKED, "K13: an owner session cannot hard-delete either");
  rejects(asRole(ADMIN, `truncate public.course_schedules cascade`), /permission denied/, "K13: staff cannot truncate schedules to skip row triggers");
  rejects(asRole(ADMIN, `truncate public.schedule_participants`), /permission denied/, "K13: staff cannot truncate enrolments to empty a schedule");

  // Controls: with the schedule guard off, the same actions do remove the protection.
  const control = seedEnrolment(WAH);
  setSkill(control, "practical_assessment", "failed");
  assert.equal(psql(`begin; alter table public.course_schedules disable trigger trg_guard_wah_schedule_integrity; delete from public.course_schedules where id = '${control.s}'; select count(*) from public.participant_skill_results where schedule_id = '${control.s}'; rollback;`).split("\n").pop(), "0");
  psql(`begin; alter table public.course_schedules disable trigger trg_guard_wah_schedule_integrity; update public.course_schedules set course_id = '${OTHER}' where id = '${control.s}'; update public.participant_skill_results set status = 'passed' where schedule_id = '${control.s}'; rollback;`);
  assert.equal(failedStatus(control), "failed|active");
  pass("K control: without this guard a cascade deletes Failed and a course move unlocks it, which is the gap it closes");

  // Empty schedules can still be corrected.
  const emptyId = "55555555-5555-4555-8555-555555555555";
  psql(asRole(ADMIN, `insert into public.course_schedules (id, course_id, schedule_code, status, start_date, end_date) values ('${emptyId}', '${WAH}', 'SYN-EMPTY', 'scheduled', '2026-12-01', '2026-12-02')`));
  psql(moveSchedule(emptyId, OTHER));
  assert.equal(courseOf(emptyId), OTHER);
  psql(moveSchedule(emptyId, WAH));
  assert.equal(courseOf(emptyId), WAH);
  psql(asRole(ADMIN, `update public.course_schedules set course_id = '${WAH}', venue = 'Corrected Venue' where id = '${emptyId}'`));
  psql(delSchedule(emptyId));
  assert.equal(psql(`select count(*) from public.course_schedules where id = '${emptyId}'`), "0");
  pass("K11: an empty schedule can move on and off WAH, and be deleted");

  // Saving a populated WAH schedule's other details still works.
  psql(asRole(ADMIN, `update public.course_schedules set course_id = '${WAH}', venue = 'Edited Venue' where id = '${enrolledOnly.s}'`));
  assert.equal(psql(`select venue from public.course_schedules where id = '${enrolledOnly.s}'`), "Edited Venue");
  pass("K: the edit form, which always resends course_id, can still save a populated WAH schedule");

  // Non-WAH schedules keep their behaviour.
  const erectorMove = seedEnrolment(ERECTOR);
  psql(moveSchedule(erectorMove.s, INSPECTOR));
  assert.equal(courseOf(erectorMove.s), INSPECTOR);
  psql(delSchedule(erectorMove.s));
  assert.equal(psql(`select count(*) from public.schedule_participants where schedule_id = '${erectorMove.s}'`), "0");
  pass("K: populated non-WAH schedules can still change course between themselves and be deleted");

  // Unrelated families keep today's behaviour on their skill rows.
  const scaffold = seedEnrolment(ERECTOR);
  setSkill(scaffold, "practical_assessment", "failed");
  psql(asRole(TRAINER, `update public.participant_skill_results set status = 'not_recorded' where schedule_id = '${scaffold.s}' and area = 'practical_assessment'`));
  psql(asRole(TRAINER, `update public.participant_skill_results set deleted_at = now() where schedule_id = '${scaffold.s}' and area = 'practical_assessment'`));
  pass("16: Erector skill rows are not governed by the WAH guard");

  // One held participant must not stop others, as in bulkGenerate's per-row loop.
  const heldBulk = seedEnrolment(WAH);
  setSkill(heldBulk, "practical_assessment", "failed");
  const okBulk = seedEnrolment(WAH);
  rejects(issue(heldBulk), HOLD, "G: held row in a per-row issuance loop returns the hold error");
  psql(issue(okBulk));
  assert.equal(psql(`select count(*) from public.certificates where schedule_id = '${okBulk.s}'`), "1");
  pass("G: the next row in the loop still issues");

  // Duplicating an issued certificate is unaffected by a later Failed entry.
  setSkill(okBulk, "practical_assessment", "failed");
  const okCert = certOf(okBulk);
  const okRowBefore = psql(`select md5(s::text) from public.certificate_issuance_snapshots s where certificate_id = '${okCert}'`);
  psql(asUser(ADMIN, `select id from app.duplicate_certificate_with_skill_snapshot('${okCert}')`));
  assert.equal(psql(`select md5(s::text) from public.certificate_issuance_snapshots s where certificate_id = '${okCert}'`), okRowBefore);
  assert.equal(psql(`select count(*) from public.certificates where replaces_certificate_id = '${okCert}' and render_contract_version = 'c4_wave1_wah_v1'`), "1");
  rejects(issue(okBulk), /certificate_already_exists/, "H: repeat issuance still rejected by the existing duplicate guard");
  pass("H: issued certificate untouched; duplicate keeps its frozen source");

  // The rule belongs to WAH only.
  for (const [course, version, label] of [[ERECTOR, "c4_wave1_v1", "Erector"], [INSPECTOR, "c4_wave1_inspector_v1", "Inspector"], [OTHER, "certificate_renderer_v1", "unlisted course"]]) {
    const e = seedEnrolment(course);
    setSkill(e, "practical_assessment", "failed");
    psql(issue(e));
    assert.equal(frozen(e, "practical_assessment"), "failed");
    assert.equal(psql(`select renderer_version from public.certificate_issuance_snapshots where certificate_id = '${certOf(e)}'`), version);
    pass(`I: ${label} behaviour unchanged by the WAH hold`);
  }

  // Erector and Inspector: same payload as before the migration.
  const erectorAfter = seedEnrolment(ERECTOR);
  psql(issue(erectorAfter));
  const inspectorAfter = seedEnrolment(INSPECTOR);
  psql(issue(inspectorAfter));
  assert.equal(payloadOf(certOf(erectorAfter)), erectorPayloadBefore);
  assert.equal(payloadOf(certOf(inspectorAfter)), inspectorPayloadBefore);
  assert.equal(psql(`select renderer_version from public.certificate_issuance_snapshots where certificate_id='${certOf(erectorAfter)}'`), "c4_wave1_v1");
  assert.equal(psql(`select renderer_version from public.certificate_issuance_snapshots where certificate_id='${certOf(inspectorAfter)}'`), "c4_wave1_inspector_v1");
  pass("Erector and Inspector payloads identical before and after the draft");

  // Unlisted courses still pass through.
  const other = seedEnrolment(OTHER);
  psql(issue(other));
  assert.equal(psql(`select renderer_version from public.certificate_issuance_snapshots where certificate_id='${certOf(other)}'`), "certificate_renderer_v1");
  pass("unlisted course stays certificate_renderer_v1");

  // Old rows still unchanged after all the new issuance.
  assert.equal(psql(`select render_contract_version from public.certificates where id='${certOf(legacySnapshot)}'`), "certificate_renderer_v1");
  assert.equal(psql(`select coalesce(render_contract_version,'NULL') from public.certificates where id='${legacyNoSnapshot}'`), "NULL");
  pass("legacy WAH certificates did not switch to C4");
} finally {
  docker(["rm", "-f", container]);
}
