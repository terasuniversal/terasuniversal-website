import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../supabase/migrations/20260914090000_certificate_verification_training_period.sql", import.meta.url), "utf8");
const sqlContract = readFileSync(new URL("../supabase/tests/certificate_verification_training_period_contract.sql", import.meta.url), "utf8");
const verify = readFileSync(new URL("../app/verify/VerificationResult.tsx", import.meta.url), "utf8");

assert.match(migration, /drop function if exists public\.verify_and_log\(text, text, text, text\)/);
assert.match(migration, /returns table \([\s\S]*training_start_date date,[\s\S]*training_end_date date/);
assert.match(migration, /security definer/);
assert.match(migration, /set search_path = public/);
assert.match(migration, /certificate_issuance_snapshots/);
assert.match(migration, /coalesce\(s\.training_start_date, c\.training_start_date\)/);
assert.match(migration, /coalesce\(s\.training_end_date, c\.training_end_date\)/);
assert.match(migration, /to_regprocedure\('public\.verify_and_log\(text,text,text,text\)'\)/);
assert.doesNotMatch(migration, /course_schedules|training_schedules|participant_skill_results|attendance|assessment/);
assert.match(migration, /revoke all on function public\.verify_and_log/);
assert.match(migration, /grant execute on function public\.verify_and_log[\s\S]*to anon/);
assert.match(migration, /grant execute on function public\.verify_and_log[\s\S]*to authenticated/);
assert.match(migration, /snapshot cardinality is not one row per certificate/);
assert.match(sqlContract, /modern snapshot dates/);
assert.match(sqlContract, /legacy certificate dates/);
assert.match(sqlContract, /start-only\/end-only/);
assert.match(sqlContract, /verification log row/);
assert.match(verify, /training_start_date\?: string \| null/);
assert.match(verify, /training_end_date\?: string \| null/);
assert.match(verify, /training_date\?: string \| null/);
assert.match(verify, /resolveTrainingPeriod\(result\)/);

console.log("C7A design contract passed: additive public dates, snapshot precedence, no schedule inference, preserved security/grants/logging.");
