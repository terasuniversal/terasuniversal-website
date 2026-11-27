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
-- K2 race fixtures: i7..i9 on the C4 schedule; a WAH schedule with a complete Skills Record (Production WAH config).
do $k2conc$
declare v_s uuid := (select id from rbac_test.ids where k = 'c4_s'); v_p uuid; i int; v_tpl uuid; v_ws uuid;
begin
  perform rbac_test.claims('AN');
  for i in 7..9 loop
    insert into public.participants (full_name, status) values ('RBAC K2 I' || i, 'registered') returning id into v_p;
    insert into public.schedule_participants (schedule_id, participant_id, registration_status) values (v_s, v_p, 'registered');
    insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values (v_s, v_p, current_date - 1, 'present');
    insert into public.assessments (schedule_id, participant_id, result, competency_status, theory_score, practical_score)
    values (v_s, v_p, 'pass', 'competent', 80, 85);
    insert into rbac_test.ids values ('r4_i' || i, v_p);
  end loop;
  insert into public.certificate_templates (name, orientation, paper_size, config, is_active, is_default)
  values ('K2 conc WAH template', 'landscape', 'A4', '{"design_variant": "working_at_height_certificate", "signature_url": "https://example.invalid/sig.png"}'::jsonb, true, false)
  returning id into v_tpl;
  update public.courses set certificate_generation_enabled = true, certificate_template_id = v_tpl, assessment_required = false,
         competency_required = false, attendance_min_percent = 100 where id = '963b1f6b-4c15-4833-90da-21aa0af0f544';
  insert into public.course_schedules (course_id, start_date, end_date, capacity, trainer_name, venue, status, branch_id)
  select '963b1f6b-4c15-4833-90da-21aa0af0f544', current_date - 2, current_date - 2, 10, 'K2 WAH Trainer', 'K2 Venue', 'completed', branch_id
  from public.course_schedules where id = v_s returning id into v_ws;
  insert into public.schedule_assessors (schedule_id, assessor_id, is_primary) values (v_ws, (select id from rbac_test.ids where k = 'c4_a'), true);
  insert into public.participants (full_name, ic_passport_no, status) values ('RBAC K2 WAH', 'SYNTH-K2C-W1', 'registered') returning id into v_p;
  insert into public.schedule_participants (schedule_id, participant_id, registration_status) values (v_ws, v_p, 'registered');
  insert into public.attendance (schedule_id, participant_id, session_date, attendance_status) values (v_ws, v_p, current_date - 2, 'present');
  insert into public.participant_skill_results (schedule_id, participant_id, area, status)
  select v_ws, v_p, x.area, x.st from (values ('theory_session', 'completed'), ('practical_training', 'completed'),
    ('safety_awareness', 'completed'), ('practical_assessment', 'passed')) x(area, st);
  insert into rbac_test.ids values ('k2_ws', v_ws), ('k2_wp', v_p);
end;
$k2conc$;
-- K2 restore race fixture: i9 holds certificate R4C-0090, soft-deleted (the replacement is issued during the race)
begin;
select rbac_test.claims('SA');
set local role authenticated;
select count(*) from public.issue_certificate_with_skill_snapshot((select id from rbac_test.ids where k = 'c4_s'), (select id from rbac_test.ids where k = 'r4_i9'), 'R4C-0090');
select app.set_certificate_deleted((select id from public.certificates where certificate_number = 'R4C-0090'), true);
commit;
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

# ---- r4: certificate issuance (D-A1 guard part), D-A2 race, deadlock robustness; K2: RA2, WAH, restore, issuer order
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
# K2-a (RA2 closed): a Training write that STARTS before the issuer now finishes first and the issuer sees it.
f="$OUT/race_c4_hold"
{ echo "begin; select rbac_test.claims('TO'); set local role authenticated;"; echo "delete from public.attendance where participant_id = $(I r4_i6) and schedule_id = $CS;"; echo "select pg_sleep(3);"; echo "commit;"; } | qd > "$f.A.txt" 2>&1 &
pa=$!
{ echo "set lock_timeout = '15s'; begin; select pg_sleep(1); select rbac_test.claims('SA'); set local role authenticated;"; echo "$(issue r4_i6 R4C-0006);"; echo "commit;"; } | qd > "$f.B.txt" 2>&1 &
pb=$!; wait $pa; wait $pb
st=$(cstate r4_i6)
if echo "$st" | grep -q "cert=0 att=0" && grep -q "Not eligible" "$f.B.txt"; then log "PASS K2-a RA2 closed: Training Undo first -> issuer waits, then refuses (Not eligible): $st"
else log "FAIL K2-a RA2 still open: $st (B: $(tr '\n' ' ' < "$f.B.txt" | cut -c1-140))"; fi
# K2-a WAH: Training Ops records the practical assessment as Failed (evidence given) while the Super Admin issues WAH.
WS="$(I k2_ws)"; WP="$(I k2_wp)"
race2 "K2-a WAH: TO Failed first -> WAH issuance waits, then refuses" TO \
  "update public.participant_skill_results set status = 'failed', evidence_assessor_id = $(I c4_a), evidence_reference = 'SHEET-RACE' where schedule_id = $WS and participant_id = $WP and area = 'practical_assessment'" SA \
  "select count(*) from public.issue_wah_certificate_as_super_admin($WS, $WP, 'R4C-W001')" 'Skills Record is not complete'
st=$(qd -c "select 'wahcert=' || count(*) from public.certificates where participant_id = $WP and deleted_at is null and status <> 'revoked'" 2>&1)
[ "$st" = "wahcert=0" ] && log "PASS K2-a WAH: no certificate issued over a Failed result ($st)" || log "FAIL K2-a WAH: $st"
# K2-b: a restore that starts while a replacement is being issued waits and is refused.
race2 "K2-b: replacement issuance first -> restore waits, then refuses" SA "$(issue r4_i9 R4C-0091)" SA \
  "select app.set_certificate_deleted((select id from public.certificates where certificate_number = 'R4C-0090'), false)" 'CERTIFICATE_RESTORE_CONFLICT'
st=$(qd -c "select string_agg(certificate_number || '=' || (deleted_at is null)::text, ',' order by certificate_number) from public.certificates where participant_id = $(I r4_i9)" 2>&1)
[ "$st" = "R4C-0090=false,R4C-0091=true" ] && log "PASS K2-b: one active certificate after the race ($st)" || log "FAIL K2-b state: $st"
# K2-a: two Super Admin sessions issue for two participants of one schedule: serialised, both succeed, no deadlock.
race2 "K2-a: concurrent issuance on one schedule serialises" SA "$(issue r4_i7 R4C-0007)" SA "$(issue r4_i8 R4C-0008)" '^1$'
st=$(qd -c "select count(*) from public.certificates where certificate_number in ('R4C-0007', 'R4C-0008') and deleted_at is null" 2>&1)
if [ "$st" = "2" ] && ! cat "$OUT"/race_K2_a__concurrent_issuance*.txt | grep -q 'deadlock'; then log "PASS K2-a: both certificates issued, no deadlock ($st)"; else log "FAIL K2-a concurrent issuance ($st)"; fi

# final state: the raced rows are locked and the protected attendance row still exists
st=$(qd -c "select (select locked from public.participant_skill_results where id = $(I conc_k))::text || ',' ||
                   (select locked from public.assessments where id = $(I conc_a8))::text || ',' ||
                   (select count(*) from public.attendance where id = $(I t1f_at9))::text || ',' ||
                   (select count(*) from public.participant_skill_results where id = $(I conc_k) and notes = 'race tamper')::text;" 2>&1)
[ "$st" = "true,true,1,0" ] && log "PASS final state: skill locked, assessment locked, attendance kept, no tamper ($st)" || log "FAIL final state ($st)"
q -c "drop database if exists $DB;" >> "$OUT/conc_setup.txt" 2>&1 && log "scratch database $DB dropped"
k=$(grep -c '^PASS' "$OUT/conc.log"); n=$(grep -c -E '^(PASS|FAIL)' "$OUT/conc.log")
log "# T1 concurrency: $k/$n PASS"
