#!/usr/bin/env bash
# Training T1 local test runner (Docker only; never touches Staging or Production). OWNER-TRAINING-T1-20261125.
#   bash supabase/tests/crm_rbac/run_t1.sh <container-at-S0> <evidence-dir>
# The container must hold the S0 fixture (build_fixture.sh; plus the Staging overlays for the Staging-equivalent run).
# Every stage runs in ONE transaction that is rolled back, so the container stays at S0.
#   E = M-01..M-11 (released state, regression baseline)   F = E + T1-a + T1-b
# At E and F: the released persona matrix, checks, M-10, M-11 and the T1 matrix (60_t1.sql).
# Then: exact rollback (F -> E and all thirteen -> S0, incl. constraints/indexes/comments), re-run, order, drift,
# data-safety of the T1-b rollback and Staging-shape preservation.
set -u; export MSYS_NO_PATHCONV=1
C=${1:?container}; OUT=${2:?evidence dir}; mkdir -p "$OUT"
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); cd "$ROOT"
T=supabase/tests/crm_rbac; M=supabase/migrations; R=docs/security/crm-rbac
DBA="20261201100000 20261201101000 20261201102000 20261201103000 20261201104000"
DBB="20261201110000 20261201111000"
DBC="20261201120000 20261201121000"
DBD="20261201130000"
DBE="20261201140000"
DBF="20261201150000 20261201151000"
REL="$DBA $DBB $DBC $DBD $DBE"
mig(){ local v f; for v in "$@"; do f=$(ls $M | grep "^${v}_"); [ "$v" = 20261201121000 ] && [ -n "${M05_FILE:-}" ] && f=; if [ -z "$f" ]; then echo "\\echo == apply ${M05_FILE}"; cat "$M05_FILE"; else echo "\\echo == apply $f"; cat "$M/$f"; fi; echo; done; }
rbk(){ local v f; for v in "$@"; do f=$(ls $R | grep "^${v}_"); [ "$v" = 20261201121000 ] && [ -n "${M05_ROLLBACK:-}" ] && f=; if [ -z "$f" ]; then echo "\\echo == rollback ${M05_ROLLBACK}"; cat "$M05_ROLLBACK"; else echo "\\echo == rollback $f"; cat "$R/$f"; fi; echo; done; }
q(){ docker exec -i $C psql -U postgres -h localhost -X -q -v ON_ERROR_STOP=1 -At "$@"; }
log(){ echo "$*" | tee -a "$OUT/run.log"; }
# fingerprint.sql plus what it does not cover: constraints, indexes and column comments (T1-b adds all three).
fp(){ cat $T/fingerprint.sql; cat <<'SQL'
select 'con', conrelid::regclass||'.'||conname, md5(pg_get_constraintdef(oid)) from pg_constraint where connamespace = 'public'::regnamespace
union all select 'idx', indexname, md5(indexdef) from pg_indexes where schemaname = 'public'
union all select 'cmt', c.relname||'.'||a.attname, md5(col_description(c.oid, a.attnum)) from pg_attribute a join pg_class c on c.oid = a.attrelid
  where c.relnamespace = 'public'::regnamespace and a.attnum > 0 and col_description(c.oid, a.attnum) is not null order by 1, 2;
SQL
}
FPRE='^(pol|fn|tbl|col|trg|fk|con|idx|cmt)\|'
: > "$OUT/run.log"; log "evidence: $OUT  container: $C  M05_FILE=${M05_FILE:-<production>}"
fp | q -F'|' | grep -E "$FPRE" > "$OUT/fp_S0.txt"; log "S0 fingerprint: $(md5sum < "$OUT/fp_S0.txt" | cut -c1-32) ($(wc -l < "$OUT/fp_S0.txt") objects)"

stage(){ # name, versions...
  local name=$1; shift
  { echo "begin;"; mig "$@"; cat $T/10_seed.sql $T/20_matrix.sql $T/30_checks.sql $T/40_m10.sql $T/50_m11.sql $T/60_t1.sql
    # Intended T1 change to one released case: T28 (Trainer updates an unlocked assessment) now needs the actual
    # Assessor and an evidence reference, so without them the Trainer write is refused (N = denied or error; 60_t1.sql W28 pins the exact 23514 rule).
    [ "$name" = F ] && echo "update rbac_test.cases set post = overlay(post placing 'N' from 11 for 1) where id = 'T28';"
    echo "select * from rbac_test.run('$name');"; echo "select rbac_test.checks('$name');"; echo "select * from rbac_test.m10('$name');"
    echo "select * from rbac_test.m11('$name');"; echo "select * from rbac_test.t1('$name');"; echo "rollback;"; } | q > "$OUT/stage_$name.txt" 2>&1
  grep -E 'ERROR' "$OUT/stage_$name.txt" | head -5 | tee -a "$OUT/run.log"
  sed 's/^psql:[^ ]* NOTICE:  //; s/^NOTICE:  //' "$OUT/stage_$name.txt" | grep -E '^(FAIL|TOTAL|CHECK)' | tee -a "$OUT/run.log"
  sed 's/^psql:[^ ]* NOTICE:  //; s/^NOTICE:  //' "$OUT/stage_$name.txt" | grep -E '^GRID T1' > "$OUT/grid_t1_$name.txt"
}
stage E $REL
stage F $REL $DBF

log "--- C4 certificate regression (61_t1_c4.sql): every C4| line identical at E and F"
c4(){ local name=$1; shift
  { echo "begin;"; mig "$@"; cat $T/10_seed.sql $T/20_matrix.sql $T/30_checks.sql $T/40_m10.sql $T/50_m11.sql $T/60_t1.sql $T/61_t1_c4.sql; echo "rollback;"; } \
    | q 2>&1 | grep -E '^(C4|ERROR)' > "$OUT/c4_$name.txt"; }
c4 E $REL; c4 F $REL $DBF
grep -E '^ERROR' "$OUT/c4_E.txt" "$OUT/c4_F.txt" | head -3 | tee -a "$OUT/run.log"
if diff <(grep '^C4|' "$OUT/c4_E.txt") <(grep '^C4|' "$OUT/c4_F.txt") > "$OUT/c4_E_vs_F.diff" && [ "$(grep -c '^C4|' "$OUT/c4_F.txt")" -eq 14 ]; then
  log "PASS C4 identical at E and F (14 lines: eligibility, issuance, /verify, WAH protection, audited WAH correction)"
else log "FAIL C4 differs between E and F (see c4_E_vs_F.diff)"; fi
grep -q '^C4|SA issue|ok:1$' "$OUT/c4_F.txt" && grep -q '^C4|verify by number|ok:valid$' "$OUT/c4_F.txt" && log "PASS C4 Super Admin issues and /verify returns valid with T1" || log "FAIL C4 issuance or /verify"
grep -q '^C4F|TO direct overwrite of WAH Failed (with evidence)|err:42501:WAH_FAILED_RESULT_PROTECTED' "$OUT/c4_F.txt" && log "PASS C4 WAH Failed result still protected from Training Ops with T1" || log "FAIL C4 WAH protection for Training Ops"

log "--- F1-a / F2 audit, refusal and RPC checks (62_t1_f1f2.sql) at F"
{ echo "begin;"; mig $REL $DBF; cat $T/10_seed.sql $T/20_matrix.sql $T/30_checks.sql $T/40_m10.sql $T/50_m11.sql $T/60_t1.sql $T/62_t1_f1f2.sql; echo "rollback;"; } \
  | q 2>&1 | grep -E 'CHECK (PASS|FAIL)|ERROR' | sed -E 's/^(psql:[^ ]* )?NOTICE: +//' > "$OUT/f1f2_F.txt"
cat "$OUT/f1f2_F.txt" | tee -a "$OUT/run.log" > /dev/null
n_f=$(grep -c '^CHECK PASS' "$OUT/f1f2_F.txt"); [ "$n_f" -eq 58 ] && ! grep -qE '^(CHECK FAIL|ERROR)' "$OUT/f1f2_F.txt" \
  && log "PASS F1-a/F2/C1-b + K2 checks: $n_f/58" || log "FAIL F1-a/F2/C1-b + K2 checks ($n_f/58 passed; see f1f2_F.txt)"

log "--- exact rollback"
{ echo "begin;"; mig $REL; fp; echo "rollback;"; } | q -F'|' 2>/dev/null | grep -E "$FPRE" > "$OUT/fp_E.txt"
{ echo "begin;"; mig $REL $DBF; rbk 20261201151000 20261201150000; fp; echo "rollback;"; } | q -F'|' > "$OUT/fp_F_to_E_raw.txt" 2>&1
grep -E "$FPRE" "$OUT/fp_F_to_E_raw.txt" > "$OUT/fp_F_to_E.txt"; grep ERROR "$OUT/fp_F_to_E_raw.txt" | head -3 | tee -a "$OUT/run.log"
diff "$OUT/fp_E.txt" "$OUT/fp_F_to_E.txt" > "$OUT/fp_F_to_E.diff" && log "PASS rollback F -> E: identical ($(wc -l < "$OUT/fp_E.txt") objects incl. constraints/indexes/comments)" || log "FAIL rollback F -> E ($(grep -c '^[<>]' "$OUT/fp_F_to_E.diff") lines)"
{ echo "begin;"; mig $REL $DBF; fp; echo "rollback;"; } | q -F'|' 2>/dev/null | grep -E "$FPRE" > "$OUT/fp_F.txt"
log "F differs from E in $(diff "$OUT/fp_E.txt" "$OUT/fp_F.txt" | grep -c '^[<>]') fingerprint lines (expected change set)"
{ echo "begin;"; mig $REL $DBF; rbk 20261201151000 20261201150000 20261201140000 20261201130000 20261201121000 20261201120000 20261201111000 20261201110000 20261201104000 20261201103000 20261201102000 20261201101000 20261201100000; fp; echo "rollback;"; } \
  | q -F'|' 2>/dev/null | grep -E "$FPRE" > "$OUT/fp_all_to_S0.txt"
diff "$OUT/fp_S0.txt" "$OUT/fp_all_to_S0.txt" > "$OUT/fp_all_to_S0.diff" && log "PASS rollback all thirteen -> S0: identical" || log "FAIL rollback all -> S0 ($(grep -c '^[<>]' "$OUT/fp_all_to_S0.diff") lines)"

log "--- re-run / order / drift (each must abort with nothing changed)"
chk(){ # label, expected-pattern, sql-producer...
  local label=$1 pat=$2; shift 2
  out=$( { echo "begin;"; "$@"; echo "rollback;"; } | q 2>&1 ); echo "$out" > "$OUT/case_$(echo "$label" | tr -c 'a-zA-Z0-9' '_').txt"
  echo "$out" | grep -q -E "$pat" && log "PASS $label: $(echo "$out" | grep -o -E "$pat" | head -1)" || log "FAIL $label"
}
p_rerun_a(){ mig $REL $DBF; echo "\\echo == second run"; mig 20261201150000; }
p_rerun_b(){ mig $REL $DBF; echo "\\echo == second run"; mig 20261201151000; }
p_b_without_a(){ mig $REL 20261201151000; }
p_a_without_b(){ mig $DBA 20261201150000; }
p_drift_policy(){ mig $REL; echo "alter policy assessors_read on public.assessors using (app.is_admin());"; mig 20261201150000; }
p_drift_helper(){ mig $REL; echo "create or replace function app.can_manage_trainers() returns boolean language sql stable security definer set search_path to 'public' as \$f\$ select true \$f\$;"; mig 20261201150000; }
p_drift_att_delete(){ mig $REL; echo "alter policy attendance_delete on public.attendance using (app.is_active());"; mig 20261201150000; }
p_extra_att_delete(){ mig $REL; echo "create policy t1_extra_att_delete on public.attendance for delete to authenticated using (true);"; mig 20261201150000; }
p_extra_open(){ mig $REL; echo "create policy t1_extra_open on public.assessors for select to authenticated using (true);"; mig 20261201150000; }
rb_data(){ echo "insert into public.trainers (full_name, status) values ('RBAC T1 RB', 'active');"
  echo "insert into public.course_schedules (course_id, start_date, end_date, trainer_id) select (select id from public.courses limit 1), current_date, current_date, (select id from public.trainers where full_name = 'RBAC T1 RB');"
  echo "select 'RB_DATA=' || count(*) from public.course_schedules where trainer_id is not null;"; }
p_rb_refuse(){ mig $REL $DBF; rb_data; rbk 20261201151000; }
p_rb_flag(){ mig $REL $DBF; rb_data
  echo "set local t1.rollback_backup_taken = 'yes';"; rbk 20261201151000 20261201150000; echo "select 'RB_FLAG_OK cols=' || count(*) from information_schema.columns where table_schema = 'public' and column_name in ('trainer_id', 'evidence_assessor_id', 'evidence_reference') and table_name in ('course_schedules', 'assessments', 'participant_skill_results');"; }
p_executor(){ mig $REL $DBF; echo "select 'EXEC_POLICIES=' || count(*) from pg_policies where schemaname = 'public' and 'certificate_lifecycle_executor' = any (roles);"; }
chk "rerun T1-a" 't1a_precondition_failed[^-]*' p_rerun_a
chk "rerun T1-b" 't1b_precondition_failed[^-]*' p_rerun_b
chk "order: T1-b without T1-a" 't1b_precondition_failed: 20261201150000[^-]*' p_b_without_a
chk "order: T1-a without DB B (can_module)" 't1a_precondition_failed: app.can_module[^-]*' p_a_without_b
chk "drift: changed assessors_read" 't1a_precondition_failed: policy assessors.assessors_read[^-]*' p_drift_policy
chk "drift: changed helper body" 't1a_precondition_failed: app.can_manage_trainers[^-]*' p_drift_helper
chk "drift: extra open SELECT policy on assessors" 't1a_postcondition_failed: assessors[^-]*' p_extra_open
chk "drift: changed attendance_delete" 't1a_precondition_failed: policy attendance.attendance_delete[^-]*' p_drift_att_delete
chk "postcondition: extra DELETE policy on attendance" 't1a_postcondition_failed: attendance_delete[^-]*' p_extra_att_delete
chk "T1-b rollback refuses while trainer_id/evidence data exists" 't1b_rollback_refused' p_rb_refuse
chk "T1-b rollback runs once the backup flag is set" 'RB_FLAG_OK cols=0' p_rb_flag
chk "executor-role policies untouched by T1" 'EXEC_POLICIES=[0-9]+' p_executor

log "--- summary"
n_total=$(grep -c "^TOTAL" "$OUT/run.log"); [ "$n_total" -eq 8 ] || log "FAIL expected 8 TOTAL lines (2 stages x matrix + M-10 + M-11 + T1), found $n_total"
n_err=$(grep -c "^ERROR" "$OUT/run.log"); [ "$n_err" -eq 0 ] || log "FAIL $n_err ERROR lines"
grep -E "^(TOTAL|FAIL|PASS|CHECK)" "$OUT/run.log" | awk '/^FAIL|CHECK FAIL/{f++} /^TOTAL/{print} END{print "failures:", f+0}' | tee -a "$OUT/run.log"
