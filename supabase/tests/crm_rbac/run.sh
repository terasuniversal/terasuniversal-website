#!/usr/bin/env bash
# RBAC hardening local test runner (Docker only, --network none; never touches Staging or Production).
#   bash supabase/tests/crm_rbac/run.sh [container] [evidence-dir]
# 1. build_fixture.sh: Production-equivalent schema (proven by fingerprint, see evidence).
# 2. For each release stage, in ONE transaction that is rolled back: apply that stage's migrations, seed synthetic
#    personas/data, run the persona matrix (RLS / RPC EXECUTE / function gates), the extra checks and the M-10
#    contact-PII matrix.
#      S0 = no RBAC migrations      A = DB A (M-01, M-06, M-07, M-08, M-09)
#      B  = DB A + DB B (M-02, M-03)  C = all nine (DB A + B + C: M-04, M-05)   D = all nine + M-10
#      E  = D + M-11 (certificate records, verification log, participant feedback)
# 3. Rollback proof: apply all ten, then every rollback script in reverse order, and compare the fingerprint with S0.
# 4. Idempotency/fail-closed: re-running any migration after it applied must abort with nothing changed.
# M05_FILE overrides the M-05 file (the Staging-only variant is tested this way on the Staging-equivalent fixture).
set -u; export MSYS_NO_PATHCONV=1
C=${1:-rbacdev}; OUT=${2:-$(mktemp -d)}; mkdir -p "$OUT"
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); cd "$ROOT"
T=supabase/tests/crm_rbac; M=supabase/migrations; R=docs/security/crm-rbac
DBA="20261201100000 20261201101000 20261201102000 20261201103000 20261201104000"
DBB="20261201110000 20261201111000"
DBC="20261201120000 20261201121000"
DBD="20261201130000"
DBE="20261201140000"
mig(){ local v f; for v in "$@"; do f=$(ls $M | grep "^${v}_"); [ "$v" = 20261201121000 ] && [ -n "${M05_FILE:-}" ] && f=; if [ -z "$f" ]; then echo "\\echo == apply ${M05_FILE}"; cat "$M05_FILE"; else echo "\\echo == apply $f"; cat "$M/$f"; fi; echo; done; }
rbk(){ local v f; for v in "$@"; do f=$(ls $R | grep "^${v}_"); [ "$v" = 20261201121000 ] && [ -n "${M05_ROLLBACK:-}" ] && f=; if [ -z "$f" ]; then echo "\\echo == rollback ${M05_ROLLBACK}"; cat "$M05_ROLLBACK"; else echo "\\echo == rollback $f"; cat "$R/$f"; fi; echo; done; }
q(){ docker exec -i $C psql -U postgres -h localhost -X -q -v ON_ERROR_STOP=1 -At "$@"; }
log(){ echo "$*" | tee -a "$OUT/run.log"; }
: > "$OUT/run.log"; log "evidence: $OUT"

[ "${SKIP_BUILD:-0}" = 1 ] || bash $T/build_fixture.sh $C > "$OUT/build.log" 2>&1
[ -f "$OUT/build.log" ] && grep -E '^(FAIL|skip)' "$OUT/build.log" | tee -a "$OUT/run.log"
q -F'|' < $T/fingerprint.sql > "$OUT/fp_S0.txt"; log "fixture fingerprint S0: $(md5sum < "$OUT/fp_S0.txt" | cut -c1-32) ($(wc -l < "$OUT/fp_S0.txt") objects)"

stage(){ # name, versions...
  local name=$1; shift
  { echo "begin;"; mig "$@"; cat $T/10_seed.sql $T/20_matrix.sql $T/30_checks.sql $T/40_m10.sql $T/50_m11.sql; echo "select * from rbac_test.run('$name');"; echo "select rbac_test.checks('$name');"; echo "select * from rbac_test.m10('$name');"; echo "select * from rbac_test.m11('$name');"; echo "rollback;"; } \
    | q > "$OUT/stage_$name.txt" 2>&1
  grep -E 'ERROR' "$OUT/stage_$name.txt" | head -5 | tee -a "$OUT/run.log"
  sed 's/^psql:[^ ]* NOTICE:  //; s/^NOTICE:  //' "$OUT/stage_$name.txt" | grep -E '^(FAIL|TOTAL|CHECK)' | tee -a "$OUT/run.log"
}
stage S0
stage A $DBA
stage B $DBA $DBB
stage C $DBA $DBB $DBC
stage D $DBA $DBB $DBC $DBD
stage E $DBA $DBB $DBC $DBD $DBE

log "--- rollback proof: apply all eleven, roll back in reverse, compare with S0"
{ echo "begin;"; mig $DBA $DBB $DBC $DBD $DBE; rbk 20261201140000 20261201130000 20261201121000 20261201120000 20261201111000 20261201110000 20261201104000 20261201103000 20261201102000 20261201101000 20261201100000;
  cat $T/fingerprint.sql; echo "rollback;"; } | q -F'|' > "$OUT/fp_rolled_back_raw.txt" 2>&1
grep -E '^(pol|fn|tbl|col|trg|fk)\|' "$OUT/fp_rolled_back_raw.txt" > "$OUT/fp_rolled_back.txt"
grep ERROR "$OUT/fp_rolled_back_raw.txt" | head -3 | tee -a "$OUT/run.log"
if diff "$OUT/fp_S0.txt" "$OUT/fp_rolled_back.txt" > "$OUT/fp_rollback.diff"; then log "PASS rollback: fingerprint after full rollback == S0 ($(wc -l < "$OUT/fp_S0.txt") objects)";
else log "FAIL rollback: $(grep -c '^[<>]' "$OUT/fp_rollback.diff") differing lines (see fp_rollback.diff)"; fi

log "--- stage rollbacks (E -> D -> C -> B -> A -> S0), each compared with that stage's own fingerprint"
for spec in "E:D:$DBA $DBB $DBC $DBD $DBE:20261201140000" "D:C:$DBA $DBB $DBC $DBD:20261201130000" "C:B:$DBA $DBB $DBC:20261201121000 20261201120000" "B:A:$DBA $DBB:20261201111000 20261201110000" "A:S0:$DBA:20261201104000 20261201103000 20261201102000 20261201101000 20261201100000"; do
  IFS=: read from to apply back <<<"$spec"
  base=""; case $to in D) base="$DBA $DBB $DBC $DBD";; C) base="$DBA $DBB $DBC";; B) base="$DBA $DBB";; A) base="$DBA";; S0) base="";; esac
  { echo "begin;"; mig $base; cat $T/fingerprint.sql; echo "rollback;"; } | q -F'|' 2>/dev/null | grep -E '^(pol|fn|tbl|col|trg|fk)\|' > "$OUT/fp_stage_$to.txt"
  { echo "begin;"; mig $apply; rbk $back; cat $T/fingerprint.sql; echo "rollback;"; } | q -F'|' 2>/dev/null | grep -E '^(pol|fn|tbl|col|trg|fk)\|' > "$OUT/fp_${from}_to_$to.txt"
  diff -q "$OUT/fp_stage_$to.txt" "$OUT/fp_${from}_to_$to.txt" >/dev/null && log "PASS rollback $from -> $to" || log "FAIL rollback $from -> $to"
done

log "--- re-run safety: every migration aborts with nothing changed when run a second time"
for v in $DBA $DBB $DBC $DBD $DBE; do
  f=$(ls $M | grep "^${v}_"); [ "$v" = 20261201121000 ] && [ -n "${M05_FILE:-}" ] && f=$(basename "$M05_FILE")
  out=$( { echo "begin;"; mig $DBA $DBB $DBC $DBD $DBE; echo "\\echo == second run $f"; mig $v; echo "rollback;"; } | q 2>&1 )
  echo "$out" | grep -q -E 'precondition_failed|already exists' && log "PASS rerun $f: $(echo "$out" | grep -o -E '[a-z0-9_]*precondition_failed[^-]*|already exists' | head -1)" || log "FAIL rerun $f"
done

log "--- out-of-order safety: DB C before DB B must fail (can_module missing), nothing applied"
out=$( { echo "begin;"; mig $DBA $DBC; echo "rollback;"; } | q 2>&1 ); echo "$out" | grep -q 'app.can_module' && log "PASS order: M-04 without M-02 fails ($(echo "$out" | grep -m1 ERROR | cut -c1-110))" || log "FAIL order"

out=$( { echo "begin;"; mig $DBA 20261201121000; echo "rollback;"; } | q 2>&1 ); echo "$out" | grep -q 'm05_precondition_failed: app.can_module' && log "PASS order: M-05 without M-02 aborts in its precondition (nothing changed)" || log "FAIL order M-05"
out=$( { echo "begin;"; mig $DBA $DBD; echo "rollback;"; } | q 2>&1 ); echo "$out" | grep -q 'm10_precondition_failed: app.can_module' && log "PASS order: M-10 without DB B aborts in its precondition (nothing changed)" || log "FAIL order M-10"
log "--- M-10 drift: a changed pre-state policy makes M-10 abort with nothing changed"
out=$( { echo "begin;"; mig $DBA $DBB $DBC; echo "alter policy enquiries_select on public.enquiries using (app.has_min_role('admin'::public.user_role));"; mig $DBD; echo "rollback;"; } | q 2>&1 ); echo "$out" | grep -q 'm10_precondition_failed: policy enquiries.enquiries_select' && log "PASS drift: M-10 aborts on a drifted enquiries_select" || log "FAIL drift M-10"
out=$( { echo "begin;"; mig $DBA $DBB $DBC; echo "create policy m10_extra_select on public.marketing_contacts for select to authenticated using (true);"; mig $DBD; echo "rollback;"; } | q 2>&1 ); echo "$out" | grep -q 'm10_postcondition_failed: marketing_contacts' && log "PASS drift: M-10 aborts when another SELECT policy would re-open marketing_contacts" || log "FAIL extra-policy M-10"
out=$( { echo "begin;"; mig $DBA $DBE; echo "rollback;"; } | q 2>&1 ); echo "$out" | grep -q 'm11_precondition_failed: app.can_module' && log "PASS order: M-11 without DB B aborts in its precondition (nothing changed)" || log "FAIL order M-11"
log "--- M-11 drift: changed pre-state or an extra SELECT policy makes M-11 abort with nothing changed"
out=$( { echo "begin;"; mig $DBA $DBB $DBC $DBD; echo "alter policy certificates_select on public.certificates using (app.has_min_role('editor'::public.user_role));"; mig $DBE; echo "rollback;"; } | q 2>&1 ); echo "$out" | grep -q 'm11_precondition_failed: policy certificates.certificates_select' && log "PASS drift: M-11 aborts on a drifted certificates_select" || log "FAIL drift M-11 certificates"
out=$( { echo "begin;"; mig $DBA $DBB $DBC $DBD; echo "alter policy cert_verif_staff_read on public.certificate_verifications using (true);"; mig $DBE; echo "rollback;"; } | q 2>&1 ); echo "$out" | grep -q 'm11_precondition_failed: policy certificate_verifications.cert_verif_staff_read' && log "PASS drift: M-11 aborts on a drifted cert_verif_staff_read" || log "FAIL drift M-11 cert_verif"
out=$( { echo "begin;"; mig $DBA $DBB $DBC $DBD; echo "create policy m11_extra_select on public.certificates for select to authenticated using (true);"; mig $DBE; echo "rollback;"; } | q 2>&1 ); echo "$out" | grep -q 'm11_postcondition_failed: certificates' && log "PASS drift: M-11 aborts when another SELECT policy would re-open certificates" || log "FAIL extra-policy M-11"
out=$( { echo "begin;"; mig $DBA $DBB $DBC $DBD; echo "alter policy cert_verif_staff_read on public.certificate_verifications to authenticated;"; mig $DBE; echo "select 'ROLES='||array_to_string(roles,',') from pg_policies where policyname='cert_verif_staff_read';"; rbk 20261201140000; echo "select 'RBROLES='||array_to_string(roles,',')||'|'||qual from pg_policies where policyname='cert_verif_staff_read';"; echo "rollback;"; } | q 2>&1 ); echo "$out" | grep -q '^ROLES=authenticated$' && echo "$out" | grep -q "^RBROLES=authenticated|(app.is_editor() OR" && log "PASS staging-shape: cert_verif_staff_read keeps roles=authenticated through M-11 and its rollback" || log "FAIL staging-shape cert_verif roles"
log "--- summary"; n_total=$(grep -c "^TOTAL" "$OUT/run.log"); n_err=$(grep -c "^ERROR" "$OUT/run.log"); [ "$n_total" -eq 18 ] || log "FAIL expected 18 TOTAL lines (6 stages x matrix + M-10 + M-11), found $n_total"; [ "$n_err" -eq 0 ] || log "FAIL $n_err ERROR lines"
grep -E "^(TOTAL|FAIL|PASS|CHECK)" "$OUT/run.log" | awk '/^FAIL|CHECK FAIL/{f++} /^TOTAL/{print} END{print "failures:", f+0}' | tee -a "$OUT/run.log"
