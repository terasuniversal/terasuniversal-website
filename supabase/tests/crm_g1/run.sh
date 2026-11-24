#!/usr/bin/env bash
# Run: bash supabase/tests/crm_g1/run.sh   (needs Docker; G1_TEST_OUT=<dir> keeps the evidence elsewhere than a temp dir)
# G1 local Docker test (postgres:17, --network none, no ports, no TERAS service). Throwaway container.
# Reuses the F-PAY-1 P2 schema fixture (invoices, invoice_payments, live trigger functions) and adds the two live
# record_manual_payment bodies verbatim.
set -u
cd "$(dirname "$0")"
C=g1crm
MIG=../../migrations/20261129120000_manual_payment_idempotency_reference.sql
RB=../../../docs/security/crm-g1/20261129120000_manual_payment_idempotency_reference.rollback.sql
OUT=${G1_TEST_OUT:-$(mktemp -d)}; mkdir -p $OUT; : > $OUT/run.log; echo "evidence: $OUT"
log(){ echo "$*" | tee -a $OUT/run.log; }
q(){ docker exec -i $C psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
tests(){ q < "$1" 2>&1 | grep -E 'PASS|FAIL|ERROR' | sed 's/^psql:[^ ]* NOTICE:  //; s/^NOTICE:  //' | tee -a $OUT/run.log; }
docker rm -f $C >/dev/null 2>&1
docker run -d --name $C --network none -e POSTGRES_PASSWORD=local postgres:17 >/dev/null || { log "FAIL docker run"; exit 1; }
for i in $(seq 1 60); do docker exec $C pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
log "postgres: $(q -At -c 'select version()' | cut -c1-40)"

for f in ../fpay1_p2/01_fixture.sql ../fpay1_p2/02_originals.sql 00_pre.sql 02_originals.sql ../fpay1_p2/03_helpers.sql 03_g1_helpers.sql; do
  q < $f >> $OUT/run.log 2>&1 || { log "FAIL loading $f"; exit 1; }
done
md5s=$(q -At -c "select string_agg(md5(prosrc), ',' order by proname) from pg_proc where proname in ('record_manual_payment','record_manual_payment_unguarded')")
[ "$md5s" = "95b4afc264c3b4579e49b29b8024fcfc,db3e3d34fce21530c92e3ae8ab43a82d" ] && log "PASS f0: fixture bodies equal the live Production/Staging md5 ($md5s)" || log "FAIL f0: $md5s"

log "--- baseline (pre-G1 behaviour: the gaps are real)"
q -c "select public.test_as_admin()" >/dev/null
read INV <<<"$(q -At -c "select public.g1_inv(1000)")"
q -At -c "select public.test_as_admin(); select public.record_manual_payment('$INV','bank_transfer',null,400,current_date,null,null); select public.record_manual_payment('$INV','bank_transfer',null,400,current_date,null,null);" >/dev/null 2>&1
st=$(q -At -c "select count(*)||'/'||(select amount_paid from public.invoices where id='$INV') from public.invoice_payments where invoice_id='$INV'")
[ "$st" = "2/800.00" ] && log "PASS b1: before G1 a double submit records two payments without any reference ($st)" || log "FAIL b1: $st"

q -At -F' | ' < fingerprint.sql > $OUT/fp_before.txt

log "--- l1: lock_timeout - another session holds invoice_payments, the migration must give up after 5s and change nothing"
( q -c "begin; lock table public.invoice_payments in access share mode; select pg_sleep(9); rollback;" > $OUT/l1_a.txt 2>&1 ) &
sleep 1; t0=$(date +%s)
q -1 < $MIG > $OUT/l1_b.txt 2>&1; rc=$?; t1=$(date +%s); wait
q -At -F' | ' < fingerprint.sql > $OUT/fp_l1.txt
[ $rc -ne 0 ] && grep -q 'lock timeout' $OUT/l1_b.txt && diff $OUT/fp_before.txt $OUT/fp_l1.txt >/dev/null && log "PASS l1: migration aborted after $((t1-t0))s on lock_timeout; fingerprint unchanged" || log "FAIL l1: rc=$rc $(tail -1 $OUT/l1_b.txt)"

log "--- p1: precondition refuses a duplicate reference group already in the data"
read DUP <<<"$(q -At -c "select public.g1_inv(500)")"
q -c "insert into public.invoice_payments (invoice_id, payment_provider, amount, status, payment_reference) values ('$DUP','bank_transfer',10,'successful','X-1'),('$DUP','bank_transfer',10,'successful','x 1')" >/dev/null
q -1 < $MIG > $OUT/p1.txt 2>&1 && log "FAIL p1: applied despite duplicates" || { grep -q 'existing duplicate reference group' $OUT/p1.txt && log "PASS p1: refused ($(grep -o 'g1_precondition_failed[^-]*' $OUT/p1.txt | head -1))" || log "FAIL p1: $(tail -1 $OUT/p1.txt)"; }
q -c "delete from public.invoice_payments where invoice_id='$DUP'" >/dev/null

log "--- apply G1 (single transaction)"
q -1 < $MIG >> $OUT/run.log 2>&1 && log "apply OK" || { log "FAIL apply"; tail -5 $OUT/run.log; exit 1; }
q -At -F' | ' < fingerprint.sql > $OUT/fp_after.txt
log "INFO fingerprint after:"; cat $OUT/fp_after.txt >> $OUT/run.log
old_same=$(grep 'record_manual_payment[_a-z]*(uuid,text,text,numeric,date,text,text) ' $OUT/fp_before.txt | cut -d'|' -f1,2,4,5,6)
old_now=$(grep 'record_manual_payment[_a-z]*(uuid,text,text,numeric,date,text,text) ' $OUT/fp_after.txt | cut -d'|' -f1,2,4,5,6)
[ -n "$old_same" ] && [ "$old_same" = "$old_now" ] && log "PASS m1: both 7-argument functions keep body, owner, SECURITY DEFINER and search_path" || log "FAIL m1"
grep -q '^record_manual_payment(uuid,text,text,numeric,date,text,text) | [0-9a-f]* | {postgres=X/postgres} |' $OUT/fp_after.txt && log "PASS m2: old 7-argument wrapper ACL is now postgres only" || log "FAIL m2"

log "--- functional tests after G1"; tests 05_tests_after_g1.sql

log "--- c1: two sessions submit the same key at the same moment (double click / retry while the first is in flight)"
ok=0
for k in $(seq 1 10); do
  read INV <<<"$(q -At -c "select public.g1_inv(1000)")"; KEY=$(q -At -c "select gen_random_uuid()")
  for s in a b; do ( q -At -c "select public.test_as_admin(); select public.g1_pay('$INV','bank_transfer',250,'DUP-$k','$KEY')->>'payment_id'" > $OUT/c1_${s}_$k.txt 2>&1 ) & done; wait
  a=$(tail -1 $OUT/c1_a_$k.txt); b=$(tail -1 $OUT/c1_b_$k.txt)
  st=$(q -At -c "select public.g1_rows('$INV')||'/'||public.g1_state('$INV')")
  [ "$a" = "$b" ] && [ "$st" = "1/partially_paid/250.00/750.00" ] && ok=$((ok+1))
done
[ $ok -eq 10 ] && log "PASS c1: 10/10 simultaneous same-key pairs produced one payment and both sessions got the same payment id" || log "FAIL c1: $ok/10"

log "--- c2: two administrators record the same bank reference at the same moment with different keys"
ok=0
for k in $(seq 1 10); do
  read INV <<<"$(q -At -c "select public.g1_inv(1000)")"
  for s in a b; do ( q -At -c "select public.test_as_admin(); select public.g1_pay('$INV','bank_transfer',300,'IBG 2026-$k',gen_random_uuid())->>'outcome'" > $OUT/c2_${s}_$k.txt 2>&1 ) & done; wait
  st=$(q -At -c "select public.g1_rows('$INV')||'/'||public.g1_state('$INV')")
  dup=$(cat $OUT/c2_a_$k.txt $OUT/c2_b_$k.txt | grep -c 'duplicate_payment_reference')
  rec=$(cat $OUT/c2_a_$k.txt $OUT/c2_b_$k.txt | grep -cx 'recorded')
  [ "$st" = "1/partially_paid/300.00/700.00" ] && [ "$dup" = "1" ] && [ "$rec" = "1" ] && ok=$((ok+1))
done
[ $ok -eq 10 ] && log "PASS c2: 10/10 races ended with exactly one payment and one duplicate_payment_reference refusal" || log "FAIL c2: $ok/10"

log "--- c3: lost response then retry (network failure after commit)"
read INV <<<"$(q -At -c "select public.g1_inv(800)")"; KEY=$(q -At -c "select gen_random_uuid()")
first=$(q -At -c "select public.test_as_admin(); select public.g1_pay('$INV','cheque',800,'CHQ 001122','$KEY')->>'payment_id'" | tail -1)
retry=$(q -At -c "select public.test_as_admin(); select public.g1_pay('$INV','cheque',800,'CHQ 001122','$KEY')::text" | tail -1)
st=$(q -At -c "select public.g1_rows('$INV')||'/'||public.g1_state('$INV')")
echo "$retry" | grep -q "\"payment_id\": \"$first\"" && echo "$retry" | grep -q duplicate_ignored && [ "$st" = "1/paid/800.00/0.00" ] && log "PASS c3: retry from a new session after the first committed returns the same payment ($st)" || log "FAIL c3: $retry / $st"

log "--- c4: the first call fails (rolled back), the retry with the same key succeeds once"
read INV <<<"$(q -At -c "select public.g1_inv(100)")"; KEY=$(q -At -c "select gen_random_uuid()")
q -c "begin; select public.test_as_admin(); select public.g1_pay('$INV','cash',100,null,'$KEY'); rollback;" >/dev/null 2>&1
again=$(q -At -c "select public.test_as_admin(); select public.g1_pay('$INV','cash',100,null,'$KEY')->>'outcome'" | tail -1)
st=$(q -At -c "select public.g1_rows('$INV')||'/'||public.g1_state('$INV')")
[ "$again" = "recorded" ] && [ "$st" = "1/paid/100.00/0.00" ] && log "PASS c4: a rolled-back attempt leaves no trace; the retry records exactly once" || log "FAIL c4: $again / $st"

dl=$(docker logs $C 2>&1 | grep -ci 'deadlock detected'); [ "$dl" = "0" ] && log "PASS d1: 0 'deadlock detected' entries in the server log" || log "FAIL d1: $dl"

log "--- fail-closed: re-applying must refuse"
q -1 < $MIG > $OUT/reapply.txt 2>&1 && log "FAIL f1: re-apply succeeded" || { grep -q 'g1_precondition_failed' $OUT/reapply.txt && log "PASS f1: re-apply refused by precondition" || log "FAIL f1: $(tail -1 $OUT/reapply.txt)"; }

log "--- rollback"
q -1 < $RB >> $OUT/run.log 2>&1 && log "rollback OK" || log "FAIL rollback"
q -At -F' | ' < fingerprint.sql > $OUT/fp_rollback.txt
diff $OUT/fp_before.txt $OUT/fp_rollback.txt >/dev/null && log "PASS rb1: function and index fingerprints after rollback identical to before" || { log "FAIL rb1"; diff $OUT/fp_before.txt $OUT/fp_rollback.txt | tee -a $OUT/run.log; }
kept=$(q -At -c "select count(*) from information_schema.columns where table_name='invoice_payments' and column_name='idempotency_key'")||true
[ "$kept" = "1" ] && log "PASS rb2: idempotency_key column and its values are kept (no DROP COLUMN)" || log "FAIL rb2: $kept"
read INV <<<"$(q -At -c "select public.g1_inv(50)")"
rbcall=$(q -At -c "set role authenticated; select public.test_as_admin(); select public.record_manual_payment('$INV','cash',null,50,current_date,null,null)->>'status'" 2>&1 | tail -1)
[ "$rbcall" = "paid" ] && log "PASS rb3: after rollback authenticated can call the 7-argument wrapper again (pre-G1 behaviour)" || log "FAIL rb3: $rbcall"
log "--- re-apply after rollback (column already present) must succeed"
q -1 < $MIG >> $OUT/run.log 2>&1 && log "PASS rb4: G1 re-applies cleanly after a rollback" || log "FAIL rb4"

docker rm -f $C >/dev/null 2>&1; log "container removed"
log "SUMMARY: $(grep -c '^PASS' $OUT/run.log) PASS, $(grep -c '^FAIL' $OUT/run.log) FAIL"
