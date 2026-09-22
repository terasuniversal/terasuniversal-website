import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPath = path.join(root, "supabase", "migrations", "20260922160000_certificates_v2_dependency_unblock.sql");
const sql = fs.readFileSync(migrationPath, "utf8");

for (const token of [
  "create table if not exists public.certificate_branches",
  "alter table public.course_schedules\n  add column if not exists branch_id",
  "add column if not exists course_code text",
  "add column if not exists schedule_code text",
  "add column if not exists exam_date date",
  "add column if not exists effective_assessor_name text",
  "add column if not exists participant_code_snapshot text",
  "create or replace function app.issue_certificate_with_skill_snapshot",
  "create or replace function app.duplicate_certificate_with_skill_snapshot",
  "create or replace function public.verify_and_log",
  "create trigger trg_certificate_historical_update_guard",
  "v_src.participant_id, null, v_src.course_id",
  "when v_area = 'practical_assessment' then",
  "case when s.certificate_id is not null then s.course_name",
  "case when s.certificate_id is not null then coalesce(s.participant_code_snapshot, p.participant_id)",
  "using errcode = 'P0001'",
]) {
  assert.ok(sql.includes(token), `missing contract token: ${token}`);
}

assert.doesNotMatch(sql, /20260914090000|create\s+or\s+replace\s+function[^$]+training-period/i, "C7A implementation must remain out of scope");
assert.doesNotMatch(sql, /participants\.company\s+is not null|company_snapshot\s+text\s+not null/i, "company must remain nullable");
assert.match(sql, /where t\.id = v_elig\.certificate_template_id\s+and t\.is_active and t\.deleted_at is null/s);
assert.match(sql, /never reads live master data for modern rendering/i);

console.log("Certificates V2 dependency unblock contract checks passed");
