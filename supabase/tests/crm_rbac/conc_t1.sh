#!/usr/bin/env bash
# Training T1 F1-a / F2 concurrency test (Docker only, synthetic data; Owner GO 26 Nov).
# Builds a throw-away database (t1conc) from the container's S0 fixture, applies M01-M11 + T1-a + T1-b and the seeds
# COMMITTED, then races a Super Admin finalisation (session A, holds its row lock ~3 s) against a Training Ops write
# (session B, starts ~1 s later) with two real psql sessions. Each race also has a control run where A rolls back.
#   bash supabase/tests/crm_rbac/conc_t1.sh <container-at-S0> <evidence-dir>
# The scratch database is dropped at the end; the S0 database is only read (pg_dump). T1B_FILE overrides the T1-b
# migration (used by mutations_t1.sh for the concurrency mutant).
set -u; export MSYS_NO_PATHCONV=1
C=${1:?container}; OUT=${2:?evidence dir}; mkdir -p "$OUT"
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); cd "$ROOT"
T=supabase/tests/crm_rbac; M=supabase/migrations
ALL="20261201100000 20261201101000 20261201102000 20261201103000 20261201104000 20261201110000 20261201111000 20261201120000 20261201121000 20261201130000 20261201140000 20261201150000 20261201151000"
DB=t1conc
q(){ docker exec -i $C psql -U postgres -h localhost -X -q -v ON_ERROR_STOP=1 -At "$@"; }
qd(){ docker exec -i $C psql -U postgres -h localhost -X -v ON_ERROR_STOP=1 -At -d $DB "$@"; }
log(){ echo "$*" | tee -a "$OUT/conc.log"; }
: > "$OUT/conc.log"

q -c "drop database if exists $DB;" -c "create database $DB;"
docker exec $C sh -c "pg_dump -U postgres -h localhost --no-owner postgres | psql -U postgres -h localhost -X -q -d $DB" > "$OUT/conc_dump.txt" 2>&1
{ for v in $ALL; do f=$(ls $M | grep "^${v}_"); [ "$v" = 20261201121000 ] && [ -n "${M05_FILE:-}" ] && { cat "$M05_FILE"; echo; continue; }
    [ "$v" = 20261201151000 ] && [ -n "${T1B_FILE:-}" ] && { cat "$T1B_FILE"; echo; continue; }; cat "$M/$f"; echo; done
  cat $T/10_seed.sql $T/20_matrix.sql $T/30_checks.sql $T/40_m10.sql $T/50_m11.sql $T/60_t1.sql $T/61_t1_c4.sql
  cat <<'SQL'
reset role;
-- r4 certificate-issuance race fixtures on the C4 schedule (completed, branch + template): i1..i6 eligible (present + pass).
do $r4conc$
declare v_s uuid := (select id from rbac_test.ids where k = 'c4_s'); v_p uuid; i int;
begin
  for i in 1..6 loop
    insert into public.participants (full_name, status) values ('RBAC R4 I' || i, 'registered') returning id into v_p;
    insert into public.schedule_participants (schedule_id, participant_id, registration_status) values (v_s, v_p, 'registered');
    insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values (v_s, v_p, current_date - 1, 'present');
    insert into public.assessments (schedule_id, participant_id, result, competency_status, theory_score, practical_score)
    values (v_s, v_p, 'pass', 'competent', 80, 85);
    insert into rbac_test.ids values ('r4_i' || i, v_p);
  end loop;
end;
$r4conc$;
-- race fixtures: an UNLOCKED skill result for p9 and an UNLOCKED assessment for p8
insert into public.participant_skill_results (schedule_id, participant_id, area, status)
values ((select id from rbac_test.ids where k = 't1f_s'), (select id from rbac_test.ids where k = 't1f_p9'), 'practical_training', 'completed');
insert into rbac_test.ids select 'conc_k', id from public.participant_skill_results
 where participant_id = (select id from rbac_test.ids where k = 't1f_p9') and area = 'practical_training';
-- (r4: an UNcertified participant; p8 holds a certificate, so since D-A2 its results are Super Admin only)
insert into public.participants (full_name, status) values ('RBAC CONC PA', 'registered');
insert into rbac_test.ids select 'conc_pa', id from public.participants where full_name = 'RBAC CONC PA';
insert into public.schedule_participants (schedule_id, participant_id, registration_status)
values ((select id from rbac_test.ids where k = 't1f_s'), (select id from rbac_test.ids where k = 'conc_pa'), 'registered');
insert into public.assessments (schedule_id, participant_id, result, remarks)
values ((select id from rbac_test.ids where k = 't1f_s'), (select id from rbac_test.ids where k = 'conc_pa'), 'pending', 'race');
insert into rbac_test.ids select 'conc_a8', id from public.assessments where participant_id = (select id from rbac_test.ids where k = 'conc_pa');
SQL
} | qd -q > "$OUT/conc_setup.txt" 2>&1 || { log "FAIL setup (see conc_setup.txt)"; q -c "drop database if exists $DB;"; exit 1; }
log "setup: $DB built from S0 + all thirteen migrations + seeds (committed)"

I(){ echo "(select id from rbac_test.ids where k = '$1')"; }
EV="evidence_assessor_id = $(I t1_a1), evidence_reference = 'SHEET-RACE'"
race(){ # label, A-end (commit|rollback), A-sql, B-sql, expected-B-pattern
  local label=$1 aend=$2 asql=$3 bsql=$4 pat=$5 f; f="$OUT/race_$(echo "$label" | tr -c 'a-zA-Z0-9' '_')"
  { echo "begin; select rbac_test.claims('SA'); set local role authenticated;"; echo "$asql;"; echo "select pg_sleep(3);"; echo "$aend;"; } | qd > "$f.A.txt" 2>&1 &
  local pa=$!
  { echo "set lock_timeout = '15s'; begin; select pg_sleep(1); select rbac_test.claims('TO'); set local role authenticated;"; echo "$bsql;"; echo "commit;"; } | qd > "$f.B.txt" 2>&1 &
  local pb=$!
  wait $pa; wait $pb
  if grep -q -E "$pat" "$f.B.txt"; then log "PASS $label: $(grep -o -E "$pat" "$f.B.txt" | head -1)"; else log "FAIL $label (B: $(tr '\n' ' ' < "$f.B.txt" | cut -c1-160))"; fi
}

# F2: Training Ops edits a skill result while a Super Admin finalises it.
race "F2 control: SA lock rolled back -> TO edit succeeds" rollback \
  "update public.participant_skill_results set locked = true, locked_at = now(), locked_by = auth.uid() where id = $(I conc_k)" \
  "update public.participant_skill_results set notes = 'race ok', $EV where id = $(I conc_k)" '^UPDATE 1'
race "F2 race: SA lock commits first -> TO edit refused after waiting" commit \
  "update public.participant_skill_results set locked = true, locked_at = now(), locked_by = auth.uid() where id = $(I conc_k)" \
  "update public.participant_skill_results set notes = 'race tamper', $EV where id = $(I conc_k)" 'Only a Super Admin can unlock or change a finalised skill result'
# Assessment: the existing USING (locked = false) is re-checked on the committed row.
race "assessment control: SA lock rolled back -> TO edit succeeds" rollback \
  "update public.assessments set locked = true, locked_at = now(), locked_by = auth.uid() where id = $(I conc_a8)" \
  "update public.assessments set remarks = 'race ok', $EV where id = $(I conc_a8)" '^UPDATE 1'
race "assessment race: SA lock commits first -> TO edit changes 0 rows" commit \
  "update public.assessments set locked = true, locked_at = now(), locked_by = auth.uid() where id = $(I conc_a8)" \
  "update public.assessments set remarks = 'race tamper', $EV where id = $(I conc_a8)" '^UPDATE 0'
# F1-a: Training Ops Undo while a Super Admin finalises the participant's assessment.
race "F1-a control: SA lock rolled back -> TO Undo succeeds" rollback \
  "update public.assessments set locked = true, locked_at = now(), locked_by = auth.uid() where participant_id = $(I t1f_p9)" \
  "delete from public.attendance where id = $(I t1f_at9)" '^DELETE 1'
qd -q -c "insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values ($(I t1f_s), $(I t1f_p9), current_date, 'present');" \
      -c "update rbac_test.ids set id = (select id from public.attendance where participant_id = $(I t1f_p9) and session_date = current_date) where k = 't1f_at9';" >> "$OUT/conc_setup.txt" 2>&1
race "F1-a race: SA lock commits first -> TO Undo refused after waiting" commit \
  "update public.assessments set locked = true, locked_at = now(), locked_by = auth.uid() where participant_id = $(I t1f_p9)" \
  "delete from public.attendance where id = $(I t1f_at9)" 'Attendance of a finalised participant'

# ---- r4: certificate issuance (D-A1 guard part), D-A2 race, deadlock robustness, C4-HOLD residual
CS="$(I c4_s)"
EVC="evidence_assessor_id = $(I c4_a), evidence_reference = 'SHEET-RACE'"
issue(){ echo "select count(*) from public.issue_certificate_with_skill_snapshot($CS, $(I "$1"), '$2')"; }
race2(){ # label, A-persona, A-sql, B-persona, B-sql, expected-B-pattern
  local label=$1 ap=$2 asql=$3 bp=$4 bsql=$5 pat=$6 f; f="$OUT/race_$(echo "$label" | tr -c 'a-zA-Z0-9' '_')"
  { echo "begin; select rbac_test.claims('$ap'); set local role authenticated;"; echo "$asql;"; echo "select pg_sleep(3);"; echo "commit;"; } | qd > "$f.A.txt" 2>&1 &
  local pa=$!
  { echo "set lock_timeout = '15s'; begin; select pg_sleep(1); select rbac_test.claims('$bp'); set local role authenticated;"; echo "$bsql;"; echo "commit;"; } | qd > "$f.B.txt" 2>&1 &
  local pb=$!; wait $pa; wait $pb
  if grep -q -E "$pat" "$f.B.txt"; then log "PASS $label: $(grep -o -E "$pat" "$f.B.txt" | head -1)"; else log "FAIL $label (A: $(tr '\n' ' ' < "$f.A.txt" | cut -c1-90) | B: $(tr '\n' ' ' < "$f.B.txt" | cut -c1-120))"; fi
}
cstate(){ qd -c "select 'cert=' || (select count(*) from public.certificates where participant_id = $(I "$1") and status not in ('draft','revoked'))
  || ' att=' || (select count(*) from public.attendance where participant_id = $(I "$1") and schedule_id = $CS)
  || ' status=' || coalesce((select string_agg(attendance_status::text, ',') from public.attendance where participant_id = $(I "$1") and schedule_id = $CS), '-')
  || ' result=' || coalesce((select result from public.assessments where participant_id = $(I "$1") and schedule_id = $CS), '-')
  || ' locked=' || coalesce((select locked::text from public.assessments where participant_id = $(I "$1") and schedule_id = $CS), '-');" 2>&1; }
race2 "D-A1 guard: issuance first -> TO Undo refused after waiting" SA "$(issue r4_i1 R4C-0001)" TO \
  "delete from public.attendance where participant_id = $(I r4_i1) and schedule_id = $CS" 'Attendance of a finalised participant'
log "   state i1: $(cstate r4_i1)"
race2 "D-A1 guard: issuance first -> TO assessment change refused after waiting" SA "$(issue r4_i2 R4C-0002)" TO \
  "update public.assessments set result = 'fail', $EVC where participant_id = $(I r4_i2) and schedule_id = $CS" 'Results of a finalised participant'
log "   state i2: $(cstate r4_i2)"
race2 "D-A1 guard: issuance first -> TO attendance status change refused after waiting" SA "$(issue r4_i3 R4C-0003)" TO \
  "update public.attendance set attendance_status = 'absent' where participant_id = $(I r4_i3) and schedule_id = $CS" 'Attendance of a finalised participant'
log "   state i3: $(cstate r4_i3)"
race2 "D-A2: SA finalises the assessment -> TO skill insert refused after waiting" SA \
  "update public.assessments set locked = true, locked_at = now(), locked_by = auth.uid() where participant_id = $(I r4_i4) and schedule_id = $CS" TO \
  "insert into public.participant_skill_results (schedule_id, participant_id, area, status, evidence_assessor_id, evidence_reference) values ($CS, $(I r4_i4), 'practical_training', 'completed', $(I c4_a), 'SHEET-RACE')" 'Results of a finalised participant'
# Deadlock robustness: A takes the assessment row lock first, B (attendance update) takes the enrolment lock first.
f="$OUT/race_deadlock"
{ echo "begin; select rbac_test.claims('SA'); set local role authenticated;"
  echo "select 1 from public.assessments where participant_id = $(I r4_i5) and schedule_id = $CS for update;"
  echo "select pg_sleep(2);"
  echo "update public.assessments set locked = true, locked_at = now(), locked_by = auth.uid() where participant_id = $(I r4_i5) and schedule_id = $CS;"
  echo "commit;"; } | qd > "$f.A.txt" 2>&1 &
pa=$!
{ echo "set lock_timeout = '15s'; begin; select pg_sleep(1); select rbac_test.claims('TO'); set local role authenticated;"
  echo "update public.attendance set attendance_status = 'absent' where participant_id = $(I r4_i5) and schedule_id = $CS;"
  echo "commit;"; } | qd > "$f.B.txt" 2>&1 &
pb=$!; wait $pa; wait $pb
st=$(cstate r4_i5)
if echo "$st" | grep -qE "status=present result=pass locked=true|status=absent result=pass locked=false"; then
  log "PASS deadlock/lock-order robustness: final state consistent ($st; A: $(grep -o -m1 -E 'deadlock detected|COMMIT|ERROR:[^.]*' "$f.A.txt" | head -1); B: $(grep -o -m1 -E 'deadlock detected|finalised participant|UPDATE [0-9]|ERROR:[^.]*' "$f.B.txt" | head -1))"
else log "FAIL deadlock/lock-order robustness: inconsistent final state ($st)"; fi
# Documented residual (D-A1 C4 part is HOLD): a Training write that STARTS before the issuer locks the schedule.
f="$OUT/race_c4_hold"
{ echo "begin; select rbac_test.claims('TO'); set local role authenticated;"; echo "delete from public.attendance where participant_id = $(I r4_i6) and schedule_id = $CS;"; echo "select pg_sleep(3);"; echo "commit;"; } | qd > "$f.A.txt" 2>&1 &
pa=$!
{ echo "set lock_timeout = '15s'; begin; select pg_sleep(1); select rbac_test.claims('SA'); set local role authenticated;"; echo "$(issue r4_i6 R4C-0006);"; echo "commit;"; } | qd > "$f.B.txt" 2>&1 &
pb=$!; wait $pa; wait $pb
st=$(cstate r4_i6)
if echo "$st" | grep -q "cert=1 att=0"; then log "LIMIT C4-HOLD residual reproduced (Training Undo first, issuer reads eligibility before locking): $st"
else log "NOTE C4-HOLD residual not reproduced this run: $st"; fi

# final state: the raced rows are locked and the protected attendance row still exists
st=$(qd -c "select (select locked from public.participant_skill_results where id = $(I conc_k))::text || ',' ||
                   (select locked from public.assessments where id = $(I conc_a8))::text || ',' ||
                   (select count(*) from public.attendance where id = $(I t1f_at9))::text || ',' ||
                   (select count(*) from public.participant_skill_results where id = $(I conc_k) and notes = 'race tamper')::text;" 2>&1)
[ "$st" = "true,true,1,0" ] && log "PASS final state: skill locked, assessment locked, attendance kept, no tamper ($st)" || log "FAIL final state ($st)"
q -c "drop database if exists $DB;" >> "$OUT/conc_setup.txt" 2>&1 && log "scratch database $DB dropped"
k=$(grep -c '^PASS' "$OUT/conc.log"); n=$(grep -c -E '^(PASS|FAIL)' "$OUT/conc.log")
log "# T1 concurrency: $k/$n PASS"
