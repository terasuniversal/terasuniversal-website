#!/usr/bin/env bash
# Run: bash supabase/tests/fpay1_p2/run.sh   (needs Docker; P2_TEST_OUT=<dir> keeps the evidence elsewhere than a temp dir)
# F-PAY-1 P2 local Docker test (postgres:17, no ports published, no network to any TERAS service). Throwaway container.
set -u
cd "$(dirname "$0")"
C=p2fpay1
OUT=${P2_TEST_OUT:-$(mktemp -d)}; mkdir -p $OUT; : > $OUT/run.log; echo "evidence: $OUT"
log(){ echo "$*" | tee -a $OUT/run.log; }
q(){ docker exec -i $C psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"; }
docker rm -f $C >/dev/null 2>&1
docker run -d --name $C --network none -e POSTGRES_PASSWORD=local postgres:17 >/dev/null || { log "FAIL docker run"; exit 1; }
for i in $(seq 1 60); do docker exec $C pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
log "postgres: $(q -At -c 'select version()' | cut -c1-40)"

for f in 01_fixture.sql 02_originals.sql 03_helpers.sql; do q < $f >> $OUT/run.log 2>&1 || { log "FAIL loading $f"; exit 1; }; done
q -At -F' | ' < fingerprint.sql > $OUT/fp_before.txt; log "--- fingerprint before"; cat $OUT/fp_before.txt | tee -a $OUT/run.log
log "--- baseline (original bodies)"; q < 04_baseline_bugs.sql 2>&1 | grep -E 'PASS|FAIL|ERROR' | tee -a $OUT/run.log

log "--- apply P2 draft (single transaction)"
q -1 < ../../migrations/20261123100000_fpay1_p2_cancel_finalize_guards.sql >> $OUT/run.log 2>&1 && log "apply OK" || { log "FAIL apply"; exit 1; }
q -At -F' | ' < fingerprint.sql > $OUT/fp_after.txt; log "--- fingerprint after"; cat $OUT/fp_after.txt | tee -a $OUT/run.log
paste -d'\n' <(cut -d'|' -f1,3- $OUT/fp_before.txt) <(cut -d'|' -f1,3- $OUT/fp_after.txt) > /dev/null
if diff <(cut -d'|' -f1,3- $OUT/fp_before.txt) <(cut -d'|' -f1,3- $OUT/fp_after.txt) >/dev/null; then log "PASS m1: ACL, owner, SECURITY DEFINER and search_path unchanged for all 4 functions"; else log "FAIL m1: metadata changed"; fi
changed=$(diff <(cut -d'|' -f1,2 $OUT/fp_before.txt) <(cut -d'|' -f1,2 $OUT/fp_after.txt) | grep '^>' | cut -d'|' -f1 | tr -d '> ' | tr '\n' ',')
log "INFO m2: bodies changed = $changed (expected cancel_invoice_unguarded,finalize_toyyibpay_payment_from_callback)"

log "--- functional tests after P2"; q < 05_tests_after_p2.sql 2>&1 | grep -E 'PASS|FAIL|ERROR' | tee -a $OUT/run.log

log "--- direct-call ACL tests after P2"; q < 06_acl_direct_calls.sql 2>&1 | grep -E 'PASS|FAIL|ERROR' | tee -a $OUT/run.log

log "--- p1: reconciliation_required evidence persists after the caller's transaction commits (separate sessions)"
read INV ATT BILL <<<"$(q -At -F' ' -c "select inv, att, bill from public.test_seed(100, true, 'cancelled')")"
out=$(q -At -c "select public.test_finalize('$ATT','$BILL',100,'TXN-P1')->>'outcome'")
chk=$(q -At -c "select (select count(*) from public.audit_logs where record_id='$ATT' and detail->>'provider_transaction_id'='TXN-P1' and message like '%invoice is cancelled%')||'/'||(select status from public.invoice_payments where id='$ATT')||'/'||(select amount_paid from public.invoices where id='$INV')||'/'||(select count(*) from public.sales_activity where note like '%$BILL%')")
[ "$out" = "reconciliation_required" ] && [ "$chk" = "1/pending/0.00/0" ] && log "PASS p1: committed audit row visible from a new session ($chk = audit/attempt/amount_paid/activity)" || log "FAIL p1: $out $chk"

seed(){ q -At -F' ' -c "select inv, att, bill from public.test_seed(100, true)"; }
log "--- concurrency c1: finalize holds the attempt+invoice, cancel_invoice arrives 1s later"
read INV ATT BILL <<<"$(seed)"
( q -c "begin; select public.test_finalize('$ATT','$BILL',100,'TXN-C1'); select pg_sleep(4); commit;" > $OUT/c1_a.txt 2>&1 ) &
sleep 1; t0=$(date +%s)
q -c "set lock_timeout = '15s'; select public.test_as_admin(); select public.cancel_invoice('$INV','race c1');" > $OUT/c1_b.txt 2>&1; t1=$(date +%s); wait
res=$(q -At -c "select i.status||'/'||i.amount_paid||'/'||p.status from public.invoices i join public.invoice_payments p on p.invoice_id=i.id where i.id='$INV'")
grep -q 'cannot_cancel_invoice_with_payments' $OUT/c1_b.txt && [ "$res" = "paid/100.00/successful" ] && log "PASS c1: cancel waited $((t1-t0))s, then cannot_cancel_invoice_with_payments; invoice $res; no deadlock" || log "FAIL c1: $(tail -2 $OUT/c1_b.txt) / $res"

log "--- concurrency c2: app path (supersede then cancel in one tx) holds, callback finalize arrives 1s later"
read INV ATT BILL <<<"$(seed)"
( q -c "begin; select public.test_as_admin(); select public.mark_toyyibpay_attempt_superseded_unguarded('$ATT'); select pg_sleep(4); select public.cancel_invoice('$INV','race c2'); commit;" > $OUT/c2_a.txt 2>&1 ) &
sleep 1; t0=$(date +%s)
q -At -c "set lock_timeout = '15s'; select public.test_finalize('$ATT','$BILL',100,'TXN-C2')->>'outcome';" > $OUT/c2_b.txt 2>&1; t1=$(date +%s); wait
res=$(q -At -c "select i.status||'/'||i.amount_paid||'/'||p.status from public.invoices i join public.invoice_payments p on p.invoice_id=i.id where i.id='$INV'")
grep -qx 'reconciliation_required' $OUT/c2_b.txt && [ "$res" = "cancelled/0.00/superseded" ] && log "PASS c2: finalize waited $((t1-t0))s, then reconciliation_required; invoice $res; no money on cancelled invoice" || log "FAIL c2: $(cat $OUT/c2_b.txt) / $res / A: $(tail -2 $OUT/c2_a.txt)"

log "--- concurrency c3: another session holds the pending attempt row, cancel_invoice must wait and then refuse"
read INV ATT BILL <<<"$(seed)"
( q -c "begin; select 1 from public.invoice_payments where id='$ATT' for update; select pg_sleep(3); rollback;" > $OUT/c3_a.txt 2>&1 ) &
sleep 1; t0=$(date +%s)
q -c "set lock_timeout = '15s'; select public.test_as_admin(); select public.cancel_invoice('$INV','race c3');" > $OUT/c3_b.txt 2>&1; t1=$(date +%s); wait
res=$(q -At -c "select status from public.invoices where id='$INV'")
grep -q 'active_toyyibpay_attempt' $OUT/c3_b.txt && [ "$res" = "issued" ] && log "PASS c3: cancel waited $((t1-t0))s on the attempt lock, then active_toyyibpay_attempt; invoice $res" || log "FAIL c3: $(tail -2 $OUT/c3_b.txt) / $res"

log "--- concurrency c4: 10 simultaneous finalize/cancel pairs"
ok=0
for k in $(seq 1 10); do
  read INV ATT BILL <<<"$(seed)"
  ( q -At -c "select public.test_finalize('$ATT','$BILL',100,'TXN-C4-$k')->>'outcome'" > $OUT/c4_f_$k.txt 2>&1 ) &
  ( q -At -c "set lock_timeout='15s'; select public.test_as_admin(); select public.cancel_invoice('$INV','c4')->>'status'" > $OUT/c4_c_$k.txt 2>&1 ) &
  wait
  st=$(q -At -c "select i.status||'/'||i.amount_paid from public.invoices i where i.id='$INV'")
  { [ "$st" = "paid/100.00" ] || [ "$st" = "issued/0.00" ]; } && ! grep -qi deadlock $OUT/c4_*_$k.txt && ok=$((ok+1))
done
[ $ok -eq 10 ] && log "PASS c4: 10/10 pairs ended paid (or issued with cancel refused); never cancelled with money, no deadlock" || log "FAIL c4: $ok/10"
dl=$(docker logs $C 2>&1 | grep -ci 'deadlock detected'); [ "$dl" = "0" ] && log "PASS d1: 0 'deadlock detected' entries in the server log" || log "FAIL d1: $dl deadlock entries"

log "--- fail-closed: re-applying the draft must refuse (bodies no longer match the reviewed md5)"
q -1 < ../../migrations/20261123100000_fpay1_p2_cancel_finalize_guards.sql > $OUT/reapply.txt 2>&1 && log "FAIL f1: re-apply succeeded" || { grep -q 'fpay1_p2_precondition' $OUT/reapply.txt && log "PASS f1: re-apply refused by precondition ($(grep -o 'fpay1_p2_precondition[^(]*' $OUT/reapply.txt | head -1))"; }

log "--- rollback"
q -1 < ../../../docs/security/fpay1-p2/20261123100000_fpay1_p2_cancel_finalize_guards.rollback.sql >> $OUT/run.log 2>&1 && log "rollback OK" || log "FAIL rollback"
q -At -F' | ' < fingerprint.sql > $OUT/fp_rollback.txt
diff $OUT/fp_before.txt $OUT/fp_rollback.txt >/dev/null && log "PASS rb1: fingerprints after rollback identical to before (md5 + ACL + owner + config)" || log "FAIL rb1"
log "--- baseline again after rollback (bugs return => rollback restores the exact original behaviour)"; q < 04_baseline_bugs.sql 2>&1 | grep -E 'PASS|FAIL|ERROR' | tee -a $OUT/run.log

docker rm -f $C >/dev/null 2>&1; log "container removed"
log "SUMMARY: $(grep -c '^PASS\|NOTICE:  PASS' $OUT/run.log) PASS, $(grep -c 'FAIL' $OUT/run.log) FAIL"
