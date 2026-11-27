#!/usr/bin/env bash
# Training T1 mutation test (Docker only). Each mutant weakens ONE T1 rule in a temporary copy of the migrations;
# stage F of the T1 matrix (60_t1.sql) must then report at least one failure ("killed"). The real files are untouched.
#   bash supabase/tests/crm_rbac/mutations_t1.sh <container-at-S0> <evidence-dir>
set -u; export MSYS_NO_PATHCONV=1
C=${1:?container}; OUT=${2:?evidence dir}; mkdir -p "$OUT"
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); cd "$ROOT"
T=supabase/tests/crm_rbac; M=supabase/migrations
REL="20261201100000 20261201101000 20261201102000 20261201103000 20261201104000 20261201110000 20261201111000 20261201120000 20261201121000 20261201130000 20261201140000"
A=$M/20261201150000_training_t1_access.sql; B=$M/20261201151000_training_t1_identity_evidence.sql
q(){ docker exec -i $C psql -U postgres -h localhost -X -q -v ON_ERROR_STOP=1 -At "$@"; }
rel(){ local v f; for v in $REL; do f=$(ls $M | grep "^${v}_"); [ "$v" = 20261201121000 ] && [ -n "${M05_FILE:-}" ] && { cat "$M05_FILE"; echo; continue; }; cat "$M/$f"; echo; done; }
run_f(){ # $1 = T1-a file, $2 = T1-b file
  { echo "begin;"; rel; cat "$1"; echo; cat "$2"; echo; cat $T/10_seed.sql $T/20_matrix.sql $T/30_checks.sql $T/40_m10.sql $T/50_m11.sql $T/60_t1.sql
    echo "select * from rbac_test.t1('F');"; cat $T/62_t1_f1f2.sql; echo "rollback;"; } | q 2>&1; }
TMP="$OUT/mut_tmp"; mkdir -p "$TMP"; : > "$OUT/mutations.log"
base_out=$(run_f "$A" "$B"); base=$(echo "$base_out" | grep -o 'TOTAL T1 F pass=[0-9]* fail=[0-9]*')
echo "baseline: $base; F1-a/F2 checks: $(echo "$base_out" | grep -c 'CHECK PASS') pass, $(echo "$base_out" | grep -c 'CHECK FAIL') fail" | tee -a "$OUT/mutations.log"

mutant(){ # name, file(A|B), python-replace old, new
  local name=$1 which=$2 old=$3 new=$4 src dst
  [ "$which" = A ] && src=$A || src=$B
  dst="$TMP/$(basename "$src")"
  OLD="$old" NEW="$new" python -I -c 'import os,sys; s=open(sys.argv[1],encoding="utf8").read(); o=os.environ["OLD"]; n=os.environ["NEW"]; assert o in s, "pattern not found"; open(sys.argv[2],"w",encoding="utf8",newline="\n").write(s.replace(o,n,1))' "$src" "$dst" \
    || { echo "NOT APPLIED - $name" | tee -a "$OUT/mutations.log"; return; }
  local fa=$A fb=$B; [ "$which" = A ] && fa=$dst || fb=$dst
  local res; res=$(run_f "$fa" "$fb")
  local tot; tot=$(echo "$res" | grep -o 'TOTAL T1 F pass=[0-9]* fail=[0-9]*')
  local err; err=$(echo "$res" | grep -m1 -o 'ERROR: .*' | cut -c1-90)
  local first; first=$(echo "$res" | grep -m1 -o 'FAIL T1 F [A-Z0-9]* [A-Z]*' )
  local cf; cf=$(echo "$res" | grep -m1 -o 'CHECK FAIL [^(]*' | cut -c1-80)
  if [ -n "$err" ] && [ -z "$tot" ]; then echo "killed (migration aborts: $err) - $name" | tee -a "$OUT/mutations.log"
  elif echo "$tot" | grep -q 'fail=0' && [ -n "$cf" ]; then echo "killed ($tot; $cf) - $name" | tee -a "$OUT/mutations.log"
  elif echo "$tot" | grep -q 'fail=0'; then echo "SURVIVED ($tot) - $name" | tee -a "$OUT/mutations.log"
  else echo "killed ($tot; first: $first) - $name" | tee -a "$OUT/mutations.log"; fi
  rm -f "$dst"
}
mutant "S-1 reopened: assessors_read = any active account" A \
  "create policy assessors_read on public.assessors as permissive for select to authenticated
  using (( SELECT app.can_module('assessors'::text, 'view'::text) AS can_module));" \
  "create policy assessors_read on public.assessors as permissive for select to authenticated
  using (app.is_active() and ( SELECT app.can_module('assessors'::text, 'view'::text) AS can_module) is not null);"
mutant "schedule insert needs only View" A \
  "create policy course_schedules_insert on public.course_schedules as permissive for insert to authenticated
  with check (( SELECT app.can_module('schedules'::text, 'edit'::text) AS can_module));" \
  "create policy course_schedules_insert on public.course_schedules as permissive for insert to authenticated
  with check (( SELECT app.can_module('schedules'::text, 'view'::text) AS can_module));"
mutant "can_manage_assessors = Assessors View" A "select app.can_module('assessors', 'edit');" "select app.can_module('assessors', 'view');"
mutant "lock transition open to non-Super-Admin" B "if not v_super and new.locked and (tg_op = 'INSERT' or not old.locked) then" "if false then"
mutant "evidence: assignment not checked" B "raise exception using errcode = '23514', message = 'The selected Assessor is not assigned to this schedule or group';" "null;"
mutant "evidence: inactive Assessor accepted" B "raise exception using errcode = '23514', message = 'The selected Assessor is not active';" "null;"
mutant "evidence: reference length not checked" B "if p_reference is null or char_length(btrim(p_reference)) < 3 or char_length(p_reference) > 200 then" "if p_reference is null then"
mutant "data-entry actor not forced" B "    new.assessor_id := v_actor;" "    null;"
mutant "locked evidence mutable" B "raise exception using errcode = '42501', message = 'Locked assessment evidence cannot be changed';" "null;"
mutant "skill result allowed while the participant is finalised" B "  if app.t1_participant_finalised(new.schedule_id, new.participant_id) then" "  if false then"
mutant "inactive trainer assignable" B "raise exception using errcode = '23514', message = 'Only an active trainer can be assigned to a schedule';" "null;"
mutant "schedule archive floor removed" B "create trigger trg_t1_soft_delete_floor before update of deleted_at on public.course_schedules
  for each row execute function app.t1_guard_soft_delete();" "select 1;"
mutant "result archive floor removed" B "create trigger trg_t1_result_archive_floor before update of deleted_at on public.assessments
  for each row execute function app.t1_guard_result_archive();" "select 1;"
mutant "authorization-first return removed (rule detail leaks to callers without access)" B "  if not v_super and not (app.can_module('assessment', 'edit') or (app.is_admin_or_trainer() and not app.is_admin())) then
    return new;
  end if;" ""
mutant "Super Admin evidence no longer validated when given" B "  if v_content_changed and (not v_super or new.evidence_assessor_id is not null or new.evidence_reference is not null) then" "  if v_content_changed and not v_super then"
# ---- F1-a / F2 remediation mutants (Owner GO 26 Nov)
mutant "F2: unlock of a finalised skill result open to non-Super-Admin" B "  if tg_op = 'UPDATE' and old.locked then
    raise exception using errcode = '42501', message = 'Only a Super Admin can unlock or change a finalised skill result';
  end if;
" ""
mutant "F2: Admin exempted from the finalised skill-result rule" B "  if tg_op = 'UPDATE' and old.locked then" "  if tg_op = 'UPDATE' and old.locked and not app.is_admin() then"
mutant "finalisation: locked-assessment branch removed (helper)" B "and a.locked and a.deleted_at is null)
      or exists" "and false)
      or exists"
# The concurrency mutant is judged by conc_t1.sh (two real sessions), not by the single-session matrix.
mutant_conc(){ # name, old, new
  local name=$1 dst="$TMP/conc_$(basename "$B")"
  OLD="$2" NEW="$3" python -I -c 'import os,sys; s=open(sys.argv[1],encoding="utf8").read(); o=os.environ["OLD"]; n=os.environ["NEW"]; assert o in s, "pattern not found"; open(sys.argv[2],"w",encoding="utf8",newline="\n").write(s.replace(o,n,1))' "$B" "$dst"     || { echo "NOT APPLIED - $name" | tee -a "$OUT/mutations.log"; return; }
  T1B_FILE="$dst" bash $T/conc_t1.sh "$C" "$TMP/conc_mut" > /dev/null 2>&1
  if grep -q '^FAIL' "$TMP/conc_mut/conc.log"; then echo "killed (concurrency: $(grep -m1 -o '^FAIL [^(]*' "$TMP/conc_mut/conc.log")) - $name" | tee -a "$OUT/mutations.log"
  else echo "SURVIVED (concurrency) - $name" | tee -a "$OUT/mutations.log"; fi
  rm -f "$dst"
}
mutant_conc "finalisation: concurrent assessment lock not awaited (no FOR SHARE)" "    and a.deleted_at is null for share;" "    and a.deleted_at is null;"
mutant "finalisation: issued-certificate branch removed (helper)" B "and c.deleted_at is null and c.status not in ('draft', 'revoked'));" "and false);"
mutant "F1-a: finalised attendance exemption widened to Admin" B "  if not app.is_super_admin() then
    if not (app.can_module('attendance', 'edit')" "  if not app.is_admin() then
    if not (app.can_module('attendance', 'edit')"
mutant "F1-a: Undo audit row not written (entity renamed)" B "'attendance_undo',
      old.id::text, 'Attendance Undo'," "'attendance_undo_off',
      old.id::text, 'Attendance Undo',"
mutant "F1-a: Undo audit drops the removed mark" B "'attendance_status', old.attendance_status, " ""
mutant "F1-a: attendance_delete widened (postcondition must abort)" A "create policy attendance_delete on public.attendance as permissive for delete to authenticated
  using ((( SELECT app.can_module('attendance'::text, 'edit'::text) AS can_module) OR (app.is_admin_or_trainer() AND (NOT app.is_admin()))));" "create policy attendance_delete on public.attendance as permissive for delete to authenticated
  using (app.is_active());"
# ---- r4 remediation mutants (Owner GO 27 Nov)
mutant "D-A3: assessment re-pointing allowed" B "  if tg_op = 'UPDATE' and (new.schedule_id is distinct from old.schedule_id or new.participant_id is distinct from old.participant_id) then
    raise exception using errcode = '42501', message = 'The schedule or participant of an assessment" "  if false then
    raise exception using errcode = '42501', message = 'The schedule or participant of an assessment"
mutant "D-A3: skill-result re-pointing allowed" B "  if tg_op = 'UPDATE' and (new.schedule_id is distinct from old.schedule_id or new.participant_id is distinct from old.participant_id) then
    raise exception using errcode = '42501', message = 'The schedule or participant of a skill result" "  if false then
    raise exception using errcode = '42501', message = 'The schedule or participant of a skill result"
mutant "D-A3: Super Admin exempted from the re-pointing ban" B "  if tg_op = 'UPDATE' and (new.schedule_id is distinct from old.schedule_id or new.participant_id is distinct from old.participant_id) then
    raise exception using errcode = '42501', message = 'The schedule or participant of an assessment" "  if tg_op = 'UPDATE' and not app.is_super_admin() and (new.schedule_id is distinct from old.schedule_id or new.participant_id is distinct from old.participant_id) then
    raise exception using errcode = '42501', message = 'The schedule or participant of an assessment"
mutant "D-A2: assessment finalisation check removed" B "  if not v_super and app.t1_participant_finalised(new.schedule_id, new.participant_id) then" "  if false then"
mutant "D-A2: Admin exempted from the assessment finalisation check" B "  if not v_super and app.t1_participant_finalised(new.schedule_id, new.participant_id) then" "  if not v_super and not app.is_admin() and app.t1_participant_finalised(new.schedule_id, new.participant_id) then"
mutant_conc "D-A1 guard: schedule FOR SHARE removed (issuance not awaited)" "  perform 1 from public.course_schedules s where s.id = p_schedule_id for share;" "  perform 1;"
mutant "C1-b: attendance_undo reservation removed from app.log_event" B "  if p_entity_type = 'attendance_undo' then" "  if false then"
rm -rf "$TMP"
k=$(grep -c '^killed' "$OUT/mutations.log"); n=$(grep -c ' - ' "$OUT/mutations.log")
echo "# T1 DB mutations: $k/$n killed" | tee -a "$OUT/mutations.log"
