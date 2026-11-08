#!/usr/bin/env bash
# Disposable test-suite for the EXTERNAL AUDIT ANCHOR prototype (Phase 3A). SYNTHETIC DATA AND TEST-ONLY KEYS ONLY.
# Everything external is simulated locally: the evidence repository is a local bare git repository with an append-only
# pre-receive hook, e-mail is a directory of .eml files, the timestamp authority is a mock signer. Nothing here touches Supabase,
# Staging, Production, GitHub or any account.
#   bash scripts/identity-correction/run-evidence.sh            # starts and stops its own postgres:17 container
set -u
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../../supabase/proposed-migrations/identity-correction"
WKD="$HERE/evidence-worker"
WP() { cygpath -m "$1"; }
HEREW="$(WP "$HERE")"; WKDW="$(WP "$WKD")"
OWN=0
if [ -z "${IDC_CONTAINER:-}" ]; then
  IDC_CONTAINER="idc-ev-$$"; OWN=1
  docker run --rm -d --name "$IDC_CONTAINER" -e POSTGRES_PASSWORD=disposable_only postgres:17 >/dev/null
  for i in $(seq 1 60); do docker exec "$IDC_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done; sleep 2
fi
C="$IDC_CONTAINER"; MAINDB="ev_$$"; DB="$MAINDB"; TMP="$(mktemp -d)"; T="$(WP "$TMP")"
cleanup() { [ "$OWN" = 1 ] && docker stop "$C" >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

pass=0; fail=0
ck()    { if [ "$2" = "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 (got '$2', want '$3')"; fail=$((fail+1)); fi; }
ckre()  { if echo "$2" | grep -q -E -- "$3"; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 (output did not match /$3/: $(echo "$2" | head -2 | tr '\n' ' ' | cut -c1-200))"; fail=$((fail+1)); fi; }
cknre() { if echo "$2" | grep -q -E -- "$3"; then echo "FAIL $1 (output unexpectedly matched /$3/)"; fail=$((fail+1)); else echo "PASS $1"; pass=$((pass+1)); fi; }

createdb() { docker exec "$C" psql -U postgres -qtA -c "create database $1" >/dev/null; }
pg()  { docker exec -i "$C" psql -U postgres -d "$DB" -qtA -X "$@"; }
q()   { pg -v ON_ERROR_STOP=1 2>&1; }
val() { echo "$1" | q; }
run_as() { { printf "set role %s;\n" "$1"; [ -n "${2:-}" ] && printf "do \$d\$ begin perform set_config('request.jwt.claim.sub','%s',false); end \$d\$;\n" "$2"; cat; } | pg -v ON_ERROR_STOP=1 2>&1; }
asq() { run_as "$1" "$2" <<< "$3"; }
apply() { ( echo "set role migrator;"; cat "$MIG/$1" ) | q; }
rollback() { ( echo "set role migrator;"; cat "$MIG/rollback/$1" ) | q; }
as_login() { docker exec -i "$C" psql -U "$1" -d "$DB" -qtA -X -v ON_ERROR_STOP=1 2>&1; }   # a real LOGIN role (no set role)

SA=00000000-0000-0000-0000-0000000000a1
REQ() { # uid pcode kind newname newic apply seed evn namedec identab identc [reason]
  local uid="$1" pc="$2" kind="$3" nn="$4" ni="$5" ap="$6" seed="$7" evn="$8" nd="$9" iab="${10}" ic="${11}" reason="${12:-Synthetic test reason: document reviewed by the owner}" ev dec
  ev=$(val "select t.ev($evn,'$seed')"); dec=$(val "select t.dec(t.pid('$pc'), $nd, $iab, $ic, 'synthetic decision reason')")
  OUT=$(run_as authenticated "$uid" <<SQL
select public.identity_correction_request(t.pid('$pc'), '$kind', $nn, $ni, $ap, '$reason', '$ev'::jsonb, '$dec'::jsonb);
SQL
)
  RID=$(echo "$OUT" | grep -E -o '^[0-9a-f-]{36}$' | head -1)
}
APPLY() { OUT=$(run_as authenticated "$1" <<SQL
select public.identity_correction_apply('$2'::uuid);
SQL
); }
NAMEREQ() { REQ $SA "$1" name "'Synthetic $1 Corrected'" null true "$2" 1 "'correct'" null null; }   # participant seed
READY() { val "select identity_audit.external_evidence_ready()"; }
ANCHORS() { val "select count(*) from identity_audit.anchors"; }

# ---- the simulated world: database + evidence repository + working copies + mailbox -----------------------------------------
RDC() { echo "docker exec -i $C psql -U idc_rd -d $DB -qtA -X -v ON_ERROR_STOP=1"; }
AKC() { echo "docker exec -i $C psql -U idc_ak -d $DB -qtA -X -v ON_ERROR_STOP=1"; }
make_sink() { # dir
  mkdir -p "$1"; local g; g="$(WP "$1")/sink.git"; git init --bare -q -b main "$g"
  git -C "$g" config receive.denyNonFastForwards true; git -C "$g" config receive.denyDeletes true
  cp "$WKD/sink-pre-receive.sh" "$1/sink.git/hooks/pre-receive"; chmod +x "$1/sink.git/hooks/pre-receive"
}
world() { # name  -> sets W_* for the (already existing) sink directory $TMP/name
  W_NAME="$1"; W_SINK="$T/$1/sink.git"; W_WORK="$T/$1/work"; W_ACK="$T/$1/ackwork"; W_MAIL="$T/$1/mail"; W_BK="$T/$1/backup"
}
WK() { # [VAR=value ...] node script args   (standard configuration, extra settings are passed as leading VAR=value words)
  env ENV_NAME=test SINK_REMOTE="$W_SINK" SINK_WORK="$W_WORK" PINNED_OWNER_PUB_FILE="$T/k/owner.pub" PINNED_GENESIS_HASH="${GEN:-}" \
      WORKER_KEY_ID="${WKID:-worker-1}" WORKER_KEY_FILE="$T/k/${WKF:-worker}.key" TSA_KEY_FILE="$T/k/tsa.key" OWNER_KEY_FILE="$T/k/owner.key" \
      PSQL_READER="$(RDC)" PSQL_ACKER="$(AKC)" EXTERNAL_VERIFY_SQL="$HEREW/external-verify.sql" MAIL_DIR="$W_MAIL" MAIL_TO=owner@example.invalid \
      KNOWN_GOOD_HEADS_FILE="${KH:-}" CANARIES="${CAN:-}" "$@"
}
W_RUN() { OUT=$(WK "$@" node "$WKDW/evidence-worker.mjs" run 2>"$TMP/w.err"); RC=$?; LAST=$(echo "$OUT" | tail -1); echo "[$W_NAME rc=$RC] $LAST $(grep -v -E "MODULE_TYPELESS|Reparsing|To eliminate|trace-warnings" "$TMP/w.err" | head -3 | tr '
' ' ')" >> "$TMP/runlog.txt"; }
W_ACK() { AOUT=$(WK SINK_WORK="$W_ACK" "$@" node "$WKDW/ack.mjs" 2>"$TMP/a.err"); ARC=$?; }
W_VERIFY() { VOUT=$(WK VERIFY_DIR="$1" "${@:2}" node "$WKDW/evidence-worker.mjs" verify-chain 2>/dev/null); VRC=$?; }
W_OWNER() { OOUT=$(WK node "$WKDW/owner-tool.mjs" "$@" 2>"$TMP/o.err"); ORC=$?; }
LAB() { node "$WKDW/tamper-lab.mjs" "$@"; }
MAILS() { ls "$TMP/$W_NAME/mail" 2>/dev/null | wc -l | tr -d ' '; }
RECS() { ls "$TMP/$W_NAME/work/env/test/records" 2>/dev/null | grep -c '^[0-9]\{8\}\.json$'; }
NTYPE() { grep -l "\"type\": \"$1\"" "$TMP/$W_NAME/work/env/test/records/"*.json 2>/dev/null | wc -l | tr -d ' '; }
copy_work() { rm -rf "$TMP/lab"; cp -r "$TMP/$W_NAME/work" "$TMP/lab"; }          # a disposable copy for tampering experiments
fork_world() { # newname  -- copy of the database AND of the evidence repository (same trust state)
  docker exec "$C" psql -U postgres -qtA -c "drop database if exists ev_$$_$1" >/dev/null
  docker exec "$C" psql -U postgres -qtA -c "create database ev_$$_$1 template $MAINDB" >/dev/null
  mkdir -p "$TMP/$1"; make_sink "$TMP/$1"
  git -C "$T/main/sink.git" push -q "$T/$1/sink.git" main:main
  world "$1"; DB="ev_$$_$1"
}

# =====================================================================================================================
echo "== setup: database (migrations 01-09), roles, test keys, evidence repository"
createdb "$DB"
q < "$HERE/fixture.sql" >/dev/null; q < "$HERE/testdata.sql" >/dev/null
for f in 01_identity_audit_schema.sql 02_identity_audit_helpers.sql 03_identity_correction_workflow.sql 04_guard_snapshot_identity.sql 05_guard_certificate_identity.sql 06_guard_participant_identity.sql 07_identity_correction_read_and_reject.sql 08_request_text_guard.sql; do OUT=$(apply $f); cknre "setup: $f applies" "$OUT" "ERROR"; done
OUT=$(apply 09_external_evidence.sql); ckre "09 refuses to install without the two evidence roles" "$OUT" "create the roles first"
docker exec "$C" psql -U postgres -qtA -c "do \$r\$ begin
  if not exists (select 1 from pg_roles where rolname='idc_evidence_reader') then create role idc_evidence_reader nologin; end if;
  if not exists (select 1 from pg_roles where rolname='idc_evidence_acker') then create role idc_evidence_acker nologin; end if;
  if not exists (select 1 from pg_roles where rolname='idc_rd') then create role idc_rd login; end if;
  if not exists (select 1 from pg_roles where rolname='idc_ak') then create role idc_ak login; end if;
  grant idc_evidence_reader to idc_rd; grant idc_evidence_acker to idc_ak; end \$r\$" >/dev/null
docker exec "$C" psql -U postgres -qtA -c "grant outsider to idc_evidence_reader" >/dev/null
OUT=$(apply 09_external_evidence.sql); ckre "09 refuses when an evidence group role is a member of another role (privilege inheritance)" "$OUT" "must not be members of any other role"
docker exec "$C" psql -U postgres -qtA -c "revoke outsider from idc_evidence_reader" >/dev/null
OUT=$(apply 09_external_evidence.sql); cknre "09 first apply has no error" "$OUT" "ERROR"
ck "the reader login holds exactly the reader group role and nothing else" "$(val "select string_agg(roleid::regrole::text, ',') from pg_auth_members where member = 'idc_rd'::regrole")" "idc_evidence_reader"
ck "the acker login holds exactly the acker group role and nothing else" "$(val "select string_agg(roleid::regrole::text, ',') from pg_auth_members where member = 'idc_ak'::regrole")" "idc_evidence_acker"
OUT=$(apply 09_external_evidence.sql); cknre "09 re-apply has no error (idempotent)" "$OUT" "ERROR"
ck "ledger verifies clean after 09" "$(val "select count(*) filter (where not ok) from identity_audit.verify_ledger()")" "0"
ck "09 recorded no anchor on an installation without anchors" "$(ANCHORS)" "0"
docker exec "$C" sh -c 'export GNUPGHOME=/tmp/gh; rm -rf $GNUPGHOME; mkdir -m 700 $GNUPGHOME; gpg --batch --pinentry-mode loopback --passphrase "" --quick-gen-key "idc-test <idc-test@example.invalid>" rsa2048 default never; F=$(gpg --list-keys --with-colons | grep "^fpr" | head -1 | cut -d: -f10); gpg --batch --pinentry-mode loopback --passphrase "" --quick-add-key $F rsa2048 encr never' >/dev/null 2>&1
PUB=$(docker exec "$C" sh -c 'GNUPGHOME=/tmp/gh gpg --armor --export idc-test')
printf "update identity_audit.policy set sealing_public_key = \$k\$%s\$k\$, anchor_sink_configured_at=now(), notification_sink_configured_at=now(), wait_name=interval '0', wait_identity=interval '0';\n" "$PUB" | q >/dev/null
asq authenticated "$SA" "select public.identity_correction_enable()" >/dev/null
ck "the workflow is enabled (synthetic database only)" "$(val "select (enabled_at is not null)::text from identity_audit.policy")" "true"

node "$WKDW/test-keygen.mjs" "$T/k" >/dev/null; ck "test-only keys generated" "$(ls "$TMP/k" | wc -l | tr -d ' ')" "10"
mkdir -p "$TMP/main"; make_sink "$TMP/main"; world main
CAN="Synthetic November|SYN-N-500006|Synthetic Bravo|SYN-B-200002|Synthetic Foxtrot|SYN-F-600007|Synthetic Hotel|SYN-H-800009"
W_OWNER genesis "$T/k/worker.pub" "$T/k/tsa.pub"
GEN=$(echo "$OOUT" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).record_hash)")
ckre "owner signs the genesis record (pinned out of band)" "$GEN" "^[0-9a-f]{64}$"
W_OWNER genesis "$T/k/worker.pub" "$T/k/tsa.pub"; ck "a second genesis is refused" "$ORC" "2"

GENSAVE="$GEN"; GEN=""
W_RUN; ck "a worker without a pinned genesis hash refuses to run (exit 64)" "$RC" "64"
W_ACK; ck "the acknowledgement step refuses without a pinned genesis hash" "$ARC" "64"
GEN="$GENSAVE"

echo "== 12. fail-closed from the start: no external evidence yet"
REQ $SA PN name "'Synthetic PN Corrected'" null true gate0 1 "'correct'" null null
ckre "no verification has ever succeeded: a new request is refused" "$OUT" "IDC_EXTERNAL_EVIDENCE_REQUIRED"
ck "the gate reports not ready" "$(READY)" "f"

echo "== 1/2. valid correction and external evidence delivery"
W_RUN; ck "first worker run (no anchors yet) succeeds" "$RC" "0"; ckre "run reports ok" "$LAST" '"status":"ok"'
ck "genesis + first verification are in the sink" "$(RECS)" "2"
ck "the worker alone cannot open the gate (no acknowledgement written yet)" "$(READY)" "f"
W_ACK; ck "ack step succeeds" "$ARC" "0"; ckre "heartbeat written" "$AOUT" '"heartbeat":2'
ck "after the heartbeat the gate is open" "$(READY)" "t"
NAMEREQ PN a1; ckre "request accepted while evidence is fresh" "$RID" "^[0-9a-f-]{36}$"
APPLY $SA "$RID"; cknre "valid correction applies" "$OUT" "ERROR"
ck "the correction created one anchor" "$(ANCHORS)" "1"
ck "an unacknowledged anchor closes the gate" "$(READY)" "f"
NAMEREQ PB a2; ckre "12. a new request is refused until the anchor is acknowledged externally" "$OUT" "IDC_EXTERNAL_EVIDENCE_REQUIRED"
W_RUN; ck "worker delivers the anchor" "$RC" "0"; ckre "delivered anchor 1" "$LAST" '"delivered":\[1\]'
ck "anchor + verification records appended (4 records)" "$(RECS)" "4"
ck "an e-mail head digest was sent" "$(MAILS)" "1"
ckre "the digest carries the evidence head" "$(cat "$TMP/main/mail/00001.eml")" "head=[0-9a-f]{64}"
ck "a timestamp token exists for every record" "$(ls "$TMP/main/work/env/test/tsa" | wc -l | tr -d ' ')" "4"
ck "the remote (sink) head equals the local head" "$(git -C "$T/main/sink.git" rev-parse main)" "$(git -C "$T/main/work" rev-parse HEAD)"
W_ACK; ckre "ack step acknowledges anchor 1" "$AOUT" '"acked":\[1\]'
ck "the gate is open again" "$(READY)" "t"
W_VERIFY "$T/main/work"; ck "verify-chain passes on the sink" "$VRC" "0"; ckre "chain has 4 records" "$VOUT" '"records":4'
EXTFP=$(node -e "const r=JSON.parse(require('fs').readFileSync('$T/main/work/env/test/records/00000003.json','utf8'));console.log(r.payload.external.guard_fingerprint+'|'+r.payload.external.verified)")
ck "the exported anchor carries the INDEPENDENTLY recomputed fingerprint, marked verified" "$EXTFP" "$(val "select identity_audit.guard_fingerprint()")|true"
ck "that independent value equals what external-verify.sql returns for a role with nothing but CONNECT" "$(as_login idc_rd < "$HERE/external-verify.sql")" "$(val "select identity_audit.guard_fingerprint()")"
BEFORE=$(RECS); W_RUN; ck "6. duplicate delivery: a repeated run adds no second anchor record" "$(NTYPE anchor)" "1"
ck "only a verification record was added" "$(RECS)" "$((BEFORE+1))"
W_ACK; ck "the repeated ack is idempotent" "$ARC" "0"

echo "== 2/15. hash chain and signatures (tampering with a copy of the sink)"
copy_work; LAB "$T/lab" test edit-no-rehash 3; W_VERIFY "$T/lab"; ckre "an edited record without re-hashing is caught" "$VOUT" "EVIDENCE_HASH_MISMATCH"; ck "... exit 2" "$VRC" "2"
copy_work; LAB "$T/lab" test edit-rehash 3; W_VERIFY "$T/lab"; ckre "15. an edited + re-hashed record with the old signature is caught" "$VOUT" "EVIDENCE_SIGNATURE_INVALID"
copy_work; LAB "$T/lab" test flip-signature 2; W_VERIFY "$T/lab"; ckre "15. a corrupted signature is caught" "$VOUT" "EVIDENCE_SIGNATURE_INVALID"
copy_work; LAB "$T/lab" test drop 3; W_VERIFY "$T/lab"; ckre "5. a missing record (sequence gap) is caught" "$VOUT" "EVIDENCE_GAP"
copy_work; LAB "$T/lab" test dup 3; W_VERIFY "$T/lab"; ckre "7. two different records for the same sequence are caught" "$VOUT" "EVIDENCE_DUPLICATE_SEQ"
copy_work; cp "$TMP/lab/env/test/records/00000002.json" "$TMP/lab/env/test/records/00000009.json"; W_VERIFY "$T/lab"; ckre "6. REPLAY: an old valid record re-submitted later is caught" "$VOUT" "EVIDENCE_DUPLICATE_SEQ"
copy_work; LAB "$T/lab" test append "$T/k/attacker.key" worker-1 verification; W_VERIFY "$T/lab"; ckre "15. a record signed by a key the chain does not know is caught" "$VOUT" "EVIDENCE_SIGNATURE_INVALID"
copy_work; LAB "$T/lab" test append "$T/k/attacker.key" evil-1 verification; W_VERIFY "$T/lab"; ckre "15. a record naming an unknown key is caught" "$VOUT" "EVIDENCE_SIGNER_UNKNOWN_OR_RETIRED"
copy_work; LAB "$T/lab" test append "$T/k/worker.key" worker-1 rotation; W_VERIFY "$T/lab"; ckre "the worker key cannot sign a key rotation (owner-only)" "$VOUT" "EVIDENCE_SIGNER_ROLE_WRONG"
copy_work; LAB "$T/lab" test append "$T/k/worker.key" worker-1 anchor-conflict; W_VERIFY "$T/lab"; ckre "7. conflicting evidence for the SAME anchor (compromised worker key) is caught" "$VOUT" "EVIDENCE_CONFLICT_SAME_ANCHOR"
echo "-- a consistent rewrite by someone who holds BOTH the sink and the worker key"
copy_work; LAB "$T/lab" test rechain 3 "$T/k/worker.key" worker-1; W_VERIFY "$T/lab"; ckre "the independent TIMESTAMPS expose a rewritten history (tokens bind the original hashes)" "$VOUT" "TSA_TOKEN_INVALID"
rm -rf "$TMP/lab/env/test/tsa"; W_VERIFY "$T/lab"; ck "honest limit: if the tokens are stripped too, the rewritten chain verifies on its own" "$VRC" "0"
HEADMAIL=$(grep -o 'evidence_seq=[0-9]* head=[0-9a-f]\{64\}' "$TMP/main/mail/00001.eml" | head -1)
ESEQ=$(echo "$HEADMAIL" | sed 's/evidence_seq=\([0-9]*\) .*/\1/'); EHASH=$(echo "$HEADMAIL" | sed 's/.* head=//')
echo "[{\"evidence_seq\":$ESEQ,\"record_hash\":\"$EHASH\"}]" > "$TMP/kh.json"
W_VERIFY "$T/lab" KNOWN_GOOD_HEADS_FILE="$T/kh.json"; ckre "...but the head e-mailed to the owner exposes the rewrite" "$VOUT" "EVIDENCE_REWRITTEN_VS_KNOWN_HEAD"
W_VERIFY "$T/main/work" KNOWN_GOOD_HEADS_FILE="$T/kh.json"; ck "the real sink matches the e-mailed head" "$VRC" "0"
echo "-- the append-only ruleset of the evidence repository (test double)"
rm -rf "$TMP/att"; git clone -q "$T/main/sink.git" "$T/att"; git -C "$T/att" config user.name att; git -C "$T/att" config user.email att@invalid
echo '{}' > "$TMP/att/env/test/records/00000003.json"; git -C "$T/att" commit -qam "rewrite 3"
OUT=$(git -C "$T/att" push origin HEAD:main 2>&1); ckre "pushing a change to an existing record is rejected" "$OUT" "only additions are allowed"
git -C "$T/att" reset -q --hard HEAD~1; git -C "$T/att" rm -q "env/test/records/00000002.json"; git -C "$T/att" commit -qm "delete 2"
OUT=$(git -C "$T/att" push origin HEAD:main 2>&1); ckre "pushing a deletion is rejected" "$OUT" "only additions are allowed"
git -C "$T/att" reset -q --hard HEAD~1; git -C "$T/att" reset -q --hard HEAD~2; git -C "$T/att" commit -q --allow-empty -m "diverge"
OUT=$(git -C "$T/att" push --force origin HEAD:main 2>&1); ckre "a force-push that rewrites history is rejected" "$OUT" "non-fast-forward"
OUT=$(git -C "$T/att" push origin :main 2>&1); ckre "deleting the branch is rejected" "$OUT" "deletion|deleting"
ck "the sink head is unchanged by all of those attempts" "$(git -C "$T/main/sink.git" rev-parse main)" "$(git -C "$T/main/work" rev-parse HEAD)"

echo "== 16. unauthorized database access"
for r in anon authenticated service_role outsider; do
  OUT=$(asq $r "" "select public.identity_evidence_snapshot()"); ckre "$r cannot read the evidence snapshot" "$OUT" "permission denied"
  OUT=$(asq $r "" "select public.identity_evidence_ack(1,9,repeat('a',64),'abcdef0')"); ckre "$r cannot acknowledge" "$OUT" "permission denied"
  OUT=$(asq $r "" "select public.identity_evidence_heartbeat('ok',1,repeat('a',64),0,'{}')"); ckre "$r cannot write a heartbeat" "$OUT" "permission denied"
done
OUT=$(echo "select count(*) from identity_audit.anchors" | as_login idc_rd); ckre "the READ-ONLY role cannot select the audit tables" "$OUT" "permission denied"
OUT=$(echo "select public.identity_correction_policy()" | as_login idc_rd); ckre "the read-only role cannot use the workflow RPCs" "$OUT" "permission denied"
OUT=$(echo "select public.identity_evidence_ack(1,9,repeat('a',64),'abcdef0')" | as_login idc_rd); ckre "the read-only role cannot acknowledge" "$OUT" "permission denied"
OUT=$(echo "select public.identity_evidence_heartbeat('ok',9,repeat('a',64),0,'{}')" | as_login idc_rd); ckre "the read-only role cannot write a heartbeat" "$OUT" "permission denied"
OUT=$(echo "update public.certificates set status='revoked'" | as_login idc_rd); ckre "the read-only role cannot modify business data" "$OUT" "permission denied"
OUT=$(echo "select public.identity_evidence_snapshot()" | as_login idc_ak); ckre "the ACKER role cannot read the snapshot" "$OUT" "permission denied"
OUT=$(echo "select count(*) from identity_audit.evidence_acks" | as_login idc_ak); ckre "the acker role cannot read the audit tables" "$OUT" "permission denied"
OUT=$(echo "select public.identity_correction_apply('00000000-0000-0000-0000-000000000000')" | as_login idc_ak); ckre "the acker role cannot use the workflow RPCs" "$OUT" "permission denied"
ck "the reader and the acker are different roles (neither a member of the other)" "$(val "select (pg_has_role('idc_evidence_reader','idc_evidence_acker','member') or pg_has_role('idc_evidence_acker','idc_evidence_reader','member'))::text")" "false"
SNAP=$(echo "select public.identity_evidence_snapshot()" | as_login idc_rd)
cknre "the snapshot carries no synthetic name or identity number" "$SNAP" "Synthetic|SYN-"
cknre "the snapshot carries no salt, fingerprint of personal data or sealed bytes" "$SNAP" "salt|old_fp|new_fp|old_sealed|new_sealed|request_id|participant"
OUT=$(echo "select public.identity_evidence_ack(1, 99, repeat('a',64), 'abcdef0')" | as_login idc_ak); ckre "a conflicting re-acknowledgement is refused" "$OUT" "IDC_EVIDENCE_CONFLICT"
ROW=$(val "select anchor_seq||','||evidence_seq||',''' || evidence_hash || ''',''' || evidence_ref || '''' from identity_audit.evidence_acks where anchor_seq=1")
OUT=$(echo "select public.identity_evidence_ack($ROW)" | as_login idc_ak); cknre "an identical re-acknowledgement is idempotent" "$OUT" "ERROR"
OUT=$(echo "select public.identity_evidence_ack(999, 99, repeat('a',64), 'abcdef0')" | as_login idc_ak); ckre "acknowledging an unknown anchor is refused" "$OUT" "IDC_EVIDENCE_UNKNOWN_ANCHOR"
OUT=$(echo "select public.identity_evidence_ack(1, 99, 'nothex', 'abcdef0')" | as_login idc_ak); ckre "a malformed hash is refused" "$OUT" "IDC_EVIDENCE_ACK_INVALID"
OUT=$(echo "select public.identity_evidence_heartbeat('ok', 9, repeat('a',64), 1, array['FINGERPRINT_MISMATCH'])" | as_login idc_ak); ckre "an 'ok' heartbeat may not carry a non-warning finding" "$OUT" "IDC_EVIDENCE_HEARTBEAT_INVALID"
OUT=$(echo "select public.identity_evidence_heartbeat('ok', 9, repeat('a',64), 1, array['lowercase'])" | as_login idc_ak); ckre "a malformed finding code is refused" "$OUT" "IDC_EVIDENCE_HEARTBEAT_INVALID"
OUT=$(echo "select public.identity_evidence_heartbeat('maybe', 9, repeat('a',64), 1, '{}')" | as_login idc_ak); ckre "an unknown heartbeat status is refused" "$OUT" "IDC_EVIDENCE_HEARTBEAT_INVALID"
OUT=$(echo "select public.identity_evidence_heartbeat('ok', 0, repeat('a',64), 1, '{}')" | as_login idc_ak); ckre "a heartbeat cannot go backwards in the evidence sequence" "$OUT" "IDC_EVIDENCE_SEQUENCE"
OUT=$(echo "select public.identity_evidence_heartbeat('ok', 99999, repeat('a',64), 0, '{}')" | as_login idc_ak); ckre "an 'ok' heartbeat that did not see every current anchor is refused (no stale replay)" "$OUT" "IDC_EVIDENCE_HEARTBEAT_STALE"
OUT=$(q <<< "set role migrator; update identity_audit.evidence_acks set evidence_ref='abcdef0' where anchor_seq=1"); ckre "even the owner cannot edit an acknowledgement (append-only)" "$OUT" "immutable"
OUT=$(q <<< "set role migrator; delete from identity_audit.evidence_verifications"); ckre "even the owner cannot delete verifications (append-only)" "$OUT" "immutable"

ck "the verifier library itself refuses to verify without a pinned genesis (EVIDENCE_PIN_MISSING)" "$(node --input-type=module -e "
import {verifyChain} from 'file:///$WKDW/evidence-lib.mjs'; console.log(verifyChain([], {}).findings.join())")" "EVIDENCE_PIN_MISSING"
ck "a non-string value never satisfies a record pattern (an array that coerces to a hash is rejected)" "$(node --input-type=module -e "
import {shapeProblem} from 'file:///$WKDW/evidence-lib.mjs'; import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync('$T/main/work/env/test/records/00000003.json','utf8')); r.prev_hash=[r.prev_hash]; console.log(shapeProblem(r))")" "EVIDENCE_SHAPE_INVALID"
ck "a null inside a findings list is rejected" "$(node --input-type=module -e "
import {shapeProblem} from 'file:///$WKDW/evidence-lib.mjs'; import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync('$T/main/work/env/test/records/00000002.json','utf8')); r.payload.findings=[null]; console.log(shapeProblem(r))")" "EVIDENCE_SHAPE_INVALID"
ck "the snapshot carries the COMPLETE heartbeat history (list length equals the total)" "$(echo "$SNAP" | node -e "const s=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(s.verifications.length===s.verifications_total && s.verifications_total>0)")" "true"
ck "a truncated heartbeat history is reported by the verifier" "$(node --input-type=module -e "
import {compareWithDatabase} from 'file:///$WKDW/evidence-lib.mjs';
const st={anchors:[],restores:[],verifications:[],epoch:0,lastSeq:0};
const sn={anchors:[],acks:[],ledger:{rows:0,chain:[]},verifications:[],verifications_total:3};
console.log(compareWithDatabase(st,sn,'a'.repeat(64)).critical.join())")" "HEARTBEAT_HISTORY_TRUNCATED"
ck "no fingerprint component is NULL (a NULL ACL is represented, not dropped)" "$(val "select count(*) from identity_audit.guard_components() where v is null")" "0"

echo "== 17. prohibited personal data"
cknre "no synthetic name or identity number appears in any stored record" "$(cat "$TMP"/main/work/env/test/records/*.json "$TMP"/main/work/env/test/tsa/*.json)" "Synthetic|SYN-"
cknre "nor in any e-mail" "$(cat "$TMP"/main/mail/*.eml)" "Synthetic|SYN-"
ck "every stored record passes the prohibited-data scan" "$(node --input-type=module -e "
import {prohibitedData,shapeProblem} from 'file:///$WKDW/evidence-lib.mjs'; import {readdirSync,readFileSync} from 'node:fs';
const d='$T/main/work/env/test/records'; let bad=0;
for (const f of readdirSync(d)) { const r=JSON.parse(readFileSync(d+'/'+f,'utf8')); if (shapeProblem(r)||prohibitedData(r,['Synthetic','SYN-'])) bad++; }
console.log(bad)")" "0"
ck "a record carrying a synthetic identity is rejected by the scan" "$(node --input-type=module -e "
import {prohibitedData} from 'file:///$WKDW/evidence-lib.mjs'; console.log(prohibitedData({x:'owner SYN-N-500006 shown'},['SYN-N-500006']))")" "PROHIBITED_DATA_PRESENT"
ck "an IC-shaped value is rejected by the scan even without a canary" "$(node --input-type=module -e "
import {prohibitedData} from 'file:///$WKDW/evidence-lib.mjs'; console.log(prohibitedData({x:'see 000000-00-0000'},[]))")" "PROHIBITED_DATA_PRESENT"
ck "an ordinary certificate number passes the scan" "$(node --input-type=module -e "
import {prohibitedData} from 'file:///$WKDW/evidence-lib.mjs'; console.log(prohibitedData({x:'CERT-2026-000123'},[]))")" "null"
ck "an unknown extra field makes a record invalid (strict allow-list, no free text)" "$(node --input-type=module -e "
import {shapeProblem} from 'file:///$WKDW/evidence-lib.mjs'; import {readFileSync} from 'node:fs';
const r=JSON.parse(readFileSync('$T/main/work/env/test/records/00000003.json','utf8')); r.payload.note='free text'; console.log(shapeProblem(r))")" "EVIDENCE_SHAPE_INVALID"

echo "== 3/4. unauthorized database changes are detected (fork: attacker holds database-owner rights)"
fork_world rw
ORIGAO=$(val "select pg_get_functiondef('identity_audit.append_only()'::regprocedure)")
q <<'SQL' >/dev/null
set role migrator;
create or replace function identity_audit.append_only() returns trigger language plpgsql set search_path = pg_catalog as $$ begin return old; end $$;
SQL
W_RUN; ck "a tampered guard function is detected by the independent fingerprint (alert, exit 2)" "$RC" "2"; ckre "FINGERPRINT_MISMATCH" "$LAST" "FINGERPRINT_MISMATCH"
ck "an alert e-mail was sent" "$(MAILS)" "1"; ckre "...naming the finding" "$(cat "$TMP/rw/mail/00001.eml")" "ALERT"
W_ACK; ck "the alert is relayed to the database by the acker step" "$ARC" "0"
ck "an alert heartbeat closes the gate" "$(READY)" "f"
NAMEREQ PB rw1; ckre "12. new requests are refused while the alert stands" "$OUT" "IDC_EXTERNAL_EVIDENCE_REQUIRED"
printf "set role migrator;\n%s;\n" "$ORIGAO" | q >/dev/null
W_RUN; ck "after the exact original is restored the worker is clean again" "$RC" "0"; W_ACK; ck "gate reopens after a fresh ok heartbeat" "$(READY)" "t"
OLDHEAD=$(val "select ledger_head from identity_audit.anchors where seq=1")
q <<'SQL' >/dev/null
set role migrator;
alter table identity_audit.anchors disable trigger anchors_immutable;
update identity_audit.anchors set ledger_head = repeat('f',64) where seq = 1;
alter table identity_audit.anchors enable trigger anchors_immutable;
SQL
W_RUN; ck "4. an altered anchor is detected" "$RC" "2"; ckre "ANCHOR_ALTERED_IN_DATABASE" "$LAST" "ANCHOR_ALTERED_IN_DATABASE"
W_ACK; ck "the alert is relayed and closes the gate" "$(READY)" "f"
q <<SQL >/dev/null
set role migrator;
alter table identity_audit.anchors disable trigger anchors_immutable;
update identity_audit.anchors set ledger_head = '$OLDHEAD' where seq = 1;
alter table identity_audit.anchors enable trigger anchors_immutable;
SQL
echo "-- a forged 'ok' heartbeat can open the gate (operational control only) but the evidence still exposes it"
LASTEV=$(val "select max(evidence_seq) from identity_audit.evidence_verifications")
q <<SQL >/dev/null
select public.identity_evidence_heartbeat('ok', $LASTEV, repeat('c',64), (select count(*) from identity_audit.anchors), '{}');
SQL
ck "honest limit: a forged heartbeat that re-uses an EXISTING sequence opens the gate" "$(READY)" "t"
W_RUN; ck "...but the worker matches heartbeats field for field and detects the forgery" "$RC" "2"; ckre "HEARTBEAT_MISMATCH" "$LAST" "HEARTBEAT_MISMATCH"
q <<'SQL' >/dev/null
select public.identity_evidence_heartbeat('ok', 9999, repeat('b',64), (select count(*) from identity_audit.anchors), '{}');
SQL
W_RUN; ck "5. ...but the worker detects a heartbeat ahead of the external evidence" "$RC" "2"; ckre "HEARTBEAT_AHEAD_OF_EVIDENCE" "$LAST" "HEARTBEAT_AHEAD_OF_EVIDENCE"
ck "the attacker's database changes did not alter a single stored evidence file" "$(cd "$TMP/main/work" && git status --porcelain | wc -l | tr -d ' ')" "0"

echo "== 3.1 bounded damage: request throttle, and the run-time scope of the two credentials (forks)"
fork_world rl
q <<< "update identity_audit.policy set max_requests_per_day = 2" >/dev/null
NAMEREQ PQ rl1; ckre "within the daily limit a request is accepted" "$RID" "^[0-9a-f-]{36}$"; RQ1="$RID"
NAMEREQ PR rl2; ckre "...and the request beyond the daily limit is refused whatever the gate says" "$OUT" "IDC_REQUEST_RATE_LIMIT"
OUT=$(run_as authenticated "$SA" <<< "select public.identity_correction_cancel('$RQ1'::uuid,'cancel inside the throttle test')"); cknre "cancel is never throttled" "$OUT" "ERROR"
q <<< "update identity_audit.policy set max_requests_per_day = 0" >/dev/null 2>&1; ck "an invalid throttle value is refused by the constraint" "$(q <<< "update identity_audit.policy set max_requests_per_day = 0" | grep -c policy_evidence_windows_positive)" "1"
echo "-- concurrency: two requests racing for the last slot of the daily limit"
fork_world rc
q <<< "update identity_audit.policy set max_requests_per_day = 2" >/dev/null
rm -f "$TMP/c1.txt" "$TMP/c2.txt"
( NAMEREQ PQ c1; echo "$RID" > "$TMP/c1.txt" ) & ( NAMEREQ PR c2; echo "$RID" > "$TMP/c2.txt" ) & wait
OKN=$(cat "$TMP/c1.txt" "$TMP/c2.txt" | grep -c -E '^[0-9a-f-]{36}$')
ck "at most one of two concurrent requests gets the last slot" "$([ "$OKN" -le 1 ] && echo yes)" "yes"
ck "the number of requests in the window never exceeds the limit" "$([ "$(val "select count(*) from identity_audit.requests")" -le 2 ] && echo yes)" "yes"
ck "the throttle function takes a transaction-scoped advisory lock before counting" "$(val "select (pg_get_functiondef('identity_audit.evidence_gate()'::regprocedure) like '%pg_advisory_xact_lock%')::text")" "true"
ck "09 re-creates its policy constraint on every apply (a weaker same-named constraint cannot survive)" "$(q <<< "set role migrator; alter table identity_audit.policy drop constraint policy_evidence_windows_positive; alter table identity_audit.policy add constraint policy_evidence_windows_positive check (true);" >/dev/null; apply 09_external_evidence.sql >/dev/null; val "select (pg_get_constraintdef(oid) like '%max_requests_per_day%')::text from pg_constraint where conname='policy_evidence_windows_positive'")" "true"
fork_world ro
docker exec "$C" psql -U postgres -qtA -c "grant outsider to idc_rd" >/dev/null
W_RUN; ck "a reader credential that gained an extra role is refused at run time (alert)" "$RC" "2"; ckre "READER_ROLE_TOO_BROAD" "$LAST" "READER_ROLE_TOO_BROAD"
docker exec "$C" psql -U postgres -qtA -c "revoke outsider from idc_rd; alter role idc_rd createdb" >/dev/null
W_RUN; ck "...and one that gained CREATEDB" "$RC" "2"; ckre "READER_ROLE_TOO_BROAD (attribute)" "$LAST" "READER_ROLE_TOO_BROAD"
docker exec "$C" psql -U postgres -qtA -c "alter role idc_rd nocreatedb; grant outsider to idc_ak" >/dev/null
W_ACK; ck "an acker credential that gained an extra role is refused" "$ARC" "2"; ckre "ACKER_ROLE_TOO_BROAD" "$AOUT" "ACKER_ROLE_TOO_BROAD"
docker exec "$C" psql -U postgres -qtA -c "revoke outsider from idc_ak" >/dev/null
W_RUN; ck "with the roles restored the worker is clean again" "$RC" "0"; W_ACK; ck "...and the ack step works again" "$ARC" "0"

echo "== 5/13. missing anchors, rollback and database restore (fork)"
fork_world rs
q <<'SQL' >/dev/null
set role migrator;
alter table identity_audit.evidence_acks disable trigger user;
alter table identity_audit.anchors disable trigger user;
alter table identity_audit.corrections disable trigger user;
delete from identity_audit.evidence_acks; delete from identity_audit.anchors; delete from identity_audit.corrections;
alter table identity_audit.evidence_acks enable trigger user; alter table identity_audit.anchors enable trigger user; alter table identity_audit.corrections enable trigger user;
SQL
W_RUN; ck "a database rolled back behind exported anchors is detected" "$RC" "2"
ckre "DATABASE_ROLLBACK_DETECTED" "$LAST" "DATABASE_ROLLBACK_DETECTED"; ckre "ANCHOR_MISSING_IN_DATABASE" "$LAST" "ANCHOR_MISSING_IN_DATABASE"
W_RUN; ck "it stays an alert until the owner declares the restore" "$RC" "2"
W_OWNER restore PITR 5; ck "6. a restore declaration that does not match the database is refused (typing mistake)" "$ORC" "2"
W_OWNER restore PITR 0; ck "the OWNER key declares the restore (signed record)" "$ORC" "0"
W_RUN; ck "13. after the declaration the worker accepts the restored state" "$RC" "0"
q <<'SQL' >/dev/null
set role migrator;
alter table identity_audit.anchors alter column seq restart with 1;
SQL
W_ACK; ck "the gate reopens" "$(READY)" "t"
NAMEREQ PH rs1; APPLY $SA "$RID"; cknre "a new correction after the restore applies" "$OUT" "ERROR"
ck "the restored database re-uses anchor sequence 1" "$(val "select max(seq) from identity_audit.anchors")" "1"
W_RUN; ck "13. the re-used sequence is accepted under the new epoch" "$RC" "0"; ckre "delivered anchor 1 again (epoch 1)" "$LAST" '"delivered":\[1\]'
W_VERIFY "$T/rs/work"; ck "the chain with the restore declaration verifies" "$VRC" "0"

echo "== 4. unanchored ledger rows and the lying enumerator (forks)"
fork_world ur
q <<'SQL' >/dev/null
set role migrator;
begin;
insert into identity_audit.requests (id, participant_id, change_kind, status, requested_by, earliest_apply_at, apply_to_profile, new_full_name, reason, evidence, baseline, applying_txid)
  values ('11111111-1111-1111-1111-111111111111', (select id from public.participants where participant_code='PB'), 'name', 'pending',
          '00000000-0000-0000-0000-0000000000a1', now(), true, 'Synthetic Forged Name', 'forged request by a privileged writer', '[]', '{}', pg_current_xact_id()::text::bigint);
select identity_audit.record('11111111-1111-1111-1111-111111111111', 'participant', p.id, null, p.id, 'full_name', p.full_name, 'Synthetic Forged Name', '00000000-0000-0000-0000-0000000000a1')
  from public.participants p where p.participant_code='PB';
commit;
SQL
W_RUN; ck "a ledger row written outside the workflow is detected" "$RC" "2"; ckre "UNANCHORED_LEDGER_ROWS" "$LAST" "UNANCHORED_LEDGER_ROWS"
fork_world lie
q <<'SQL' >/dev/null
set role migrator;
create table public._idc_scratch as select k, v from identity_audit.guard_components();
create or replace function identity_audit.guard_components() returns table (k text, v text)
language sql stable security definer set search_path = pg_catalog as $$ select s.k, s.v from public._idc_scratch s $$;
create or replace function identity_audit.append_only() returns trigger language plpgsql set search_path = pg_catalog as $$ begin return old; end $$;
SQL
ck "20. the INTERNAL check is fooled by a compromised enumerator" "$(val "select ok from identity_audit.verify_ledger() where check_name='guard_fingerprint_matches_latest_anchor'")" "t"
W_RUN; ck "20. the EXTERNAL worker still alerts" "$RC" "2"; ckre "FINGERPRINT_MISMATCH" "$LAST" "FINGERPRINT_MISMATCH"

echo "== 8/9/10/12/19. delivery failures and recovery (main world)"
world main; DB="$MAINDB"
echo "-- failed Git evidence delivery"
NAMEREQ PB d1; APPLY $SA "$RID"; cknre "a correction is applied while evidence is ready" "$OUT" "ERROR"
touch "$TMP/main/sink.git/deny-push"
W_RUN; ck "8. a failed push is reported (exit 3)" "$RC" "3"; ckre "SINK_PUSH_FAILED" "$LAST" "SINK_PUSH_FAILED"
ck "...the record exists locally but NOT in the remote" "$([ "$(git -C "$T/main/work" rev-parse HEAD)" != "$(git -C "$T/main/sink.git" rev-parse main)" ] && echo different)" "different"
W_ACK; ckre "the ack step reads only the remote: the unpushed anchor 2 is NOT acknowledged" "$AOUT" '"acked":\[1\],'
ckre "...and a stale 'ok' heartbeat (it did not cover anchor 2) is refused by the database" "$AOUT" "IDC_EVIDENCE_HEARTBEAT_STALE"
ck "12. the gate stays closed" "$(READY)" "f"
rm "$TMP/main/sink.git/deny-push"
W_RUN; ck "recovery: the next run pushes the backlog" "$RC" "0"
ck "...without duplicating the anchor record" "$(NTYPE anchor)" "2"
W_ACK; ckre "the backlog is acknowledged" "$AOUT" '"acked":\[1,2\]'; ck "the gate is open" "$(READY)" "t"
echo "-- failed e-mail notification"
NAMEREQ PF d2; APPLY $SA "$RID"
W_RUN MAIL_FAIL=1; ck "9. a failed e-mail is a warning, the evidence is still delivered (exit 0)" "$RC" "0"; ckre "WARN_MAIL_FAILED" "$LAST" "WARN_MAIL_FAILED"
W_ACK; ck "the gate stays open when mail failure is not blocking" "$(READY)" "t"
NAMEREQ PG d3; APPLY $SA "$RID"
W_RUN MAIL_FAIL=1 MAIL_FAILURE_BLOCKS=1; ck "9. ...but the owner can make mail failure blocking (alert)" "$RC" "2"; ckre "MAIL_FAILURE_BLOCKING" "$LAST" "MAIL_FAILURE_BLOCKING"
W_ACK; ck "a blocking mail failure closes the gate" "$(READY)" "f"
W_RUN MAIL_ALWAYS=1; ck "once mail works again the worker recovers" "$RC" "0"; W_ACK; ck "gate reopens" "$(READY)" "t"
echo "-- failed timestamp service"
NAMEREQ PH d4; APPLY $SA "$RID"
W_RUN TSA_FAIL=1; ck "10. a failed timestamp service does not stop the evidence (exit 0)" "$RC" "0"; ckre "the anchor was delivered" "$LAST" '"delivered":\[5\]'
ck "...but no timestamp token was created for the new records" "$(( $(RECS) - $(ls "$TMP/main/work/env/test/tsa" | wc -l | tr -d ' ') > 0 ))" "1"
W_VERIFY "$T/main/work"; ckre "inside the grace period a missing timestamp is only pending (warning)" "$VOUT" "WARN_TSA_PENDING"; ck "...and does not fail verification" "$VRC" "0"
W_VERIFY "$T/main/work" TSA_GRACE_SECONDS=0; ckre "10. after the grace period a missing timestamp FAILS verification" "$VOUT" "TSA_TOKEN_MISSING"; ck "...exit 2" "$VRC" "2"
W_RUN TSA_FAIL=1 TSA_GRACE_SECONDS=0; ck "10. a timestamp outage beyond the grace period is an alert (exit 2)" "$RC" "2"; ckre "TSA_TOKEN_MISSING" "$LAST" "TSA_TOKEN_MISSING"
W_ACK; ck "...and it closes the gate" "$(READY)" "f"
W_RUN TSA_GRACE_SECONDS=0; ck "once the service is back the missing timestamps are repaired and the worker is clean" "$RC" "0"
W_ACK TSA_GRACE_SECONDS=0; ck "...and the acknowledgement of that clean run REOPENS the gate (no lock-out after an honest outage)" "$(READY)" "t"
W_VERIFY "$T/main/work" TSA_GRACE_SECONDS=0; ck "...verification passes even with zero grace" "$VRC" "0"
copy_work; echo '{"tsa":"mock-tsa-1","hash":"'$(printf 'a%.0s' $(seq 1 64))'","time":"2026-11-08T00:00:00.000Z","signature":"AAAA"}' > "$TMP/lab/env/test/tsa/00000002.json"
W_VERIFY "$T/lab"; ckre "an invalid timestamp token is caught" "$VOUT" "TSA_TOKEN_INVALID"
W_ACK

echo "== 11/12. stale verification and fail-closed request/apply"
q <<< "update identity_audit.policy set verification_max_age = interval '1 second'" >/dev/null; sleep 2
ck "11. a stale external verification closes the gate" "$(READY)" "f"
NAMEREQ PI s1; ckre "...and a request is refused" "$OUT" "IDC_EXTERNAL_EVIDENCE_REQUIRED"
q <<< "update identity_audit.policy set verification_max_age = interval '36 hours'" >/dev/null
NAMEREQ PI s2; ckre "...and is accepted again once evidence is fresh" "$RID" "^[0-9a-f-]{36}$"; RSTALE="$RID"
q <<< "update identity_audit.policy set verification_max_age = interval '1 second'" >/dev/null; sleep 2
BEFORESTATE=$(val "select md5(string_agg(holder_name,',' order by certificate_no)) from public.certificates")
APPLY $SA "$RSTALE"; ckre "12. APPLY is refused when evidence went stale after the request was made" "$OUT" "IDC_EXTERNAL_EVIDENCE_REQUIRED"
ck "...and nothing was changed" "$(val "select md5(string_agg(holder_name,',' order by certificate_no)) from public.certificates")" "$BEFORESTATE"
OUT=$(run_as authenticated "$SA" <<< "select public.identity_correction_cancel('$RSTALE'::uuid,'cancelling while the gate is closed')"); cknre "12. cancel still works while the gate is closed" "$OUT" "ERROR"
q <<< "update identity_audit.policy set verification_max_age = interval '36 hours'" >/dev/null

echo "== 19. worker interruption and recovery"
NAMEREQ PJ i1; APPLY $SA "$RID"; cknre "a correction is applied" "$OUT" "ERROR"
touch "$TMP/main/work/env/test/records/00000099.json.tmp"
W_RUN CRASH_AFTER_WRITE=1; ck "the worker is killed after writing a record but before committing it" "$RC" "137"
ck "...leaving uncommitted files in the working copy" "$([ "$(cd "$TMP/main/work" && git status --porcelain | grep -c '??')" -ge 2 ] && echo yes)" "yes"
W_RUN; ck "the next run recovers" "$RC" "0"; ckre "recovered record reported" "$LAST" "WARN_RECOVERED_UNCOMMITTED_RECORD"
ck "the interrupted anchor exists exactly once (anchors 1..6, no duplicate)" "$(NTYPE anchor)" "6"
ck "the stray temp file was removed" "$(ls "$TMP"/main/work/env/test/records | grep -c tmp | tr -d ' ')" "0"
W_VERIFY "$T/main/work"; ck "the chain still verifies" "$VRC" "0"; W_ACK; ck "gate open" "$(READY)" "t"

echo "== 18. offline backup creation and restoration"
W_RUN BACKUP_DIR="$W_BK" MAIL_ALWAYS=1; ck "run with backup" "$RC" "0"
BUNDLE=$(ls "$TMP"/main/backup/*.bundle | tail -1)
ck "a bundle and its checksum exist" "$(ls "$TMP"/main/backup | wc -l | tr -d ' ')" "2"
ck "the checksum matches" "$(sha256sum "$BUNDLE" | cut -d' ' -f1)" "$(cat "$BUNDLE.sha256" | tr -d '\n ')"
rm -rf "$TMP/restored"; git clone -q "$(WP "$BUNDLE")" "$T/restored"
W_VERIFY "$T/restored"; ck "the restored copy verifies independently" "$VRC" "0"
LASTMAIL=$(ls "$TMP"/main/mail/*.eml | tail -1); MH=$(grep -o 'head=[0-9a-f]\{64\}' "$LASTMAIL" | head -1 | cut -d= -f2)
MS=$(grep -o 'evidence_seq=[0-9]*' "$LASTMAIL" | head -1 | cut -d= -f2)
ck "the head e-mailed to the owner is a record of the restored chain" "$(node -e "console.log(JSON.parse(require('fs').readFileSync('$T/restored/env/test/records/'+String($MS).padStart(8,'0')+'.json','utf8')).record_hash)")" "$MH"
printf 'x' >> "$BUNDLE"; ck "a corrupted bundle no longer matches its checksum" "$([ "$(sha256sum "$BUNDLE" | cut -d' ' -f1)" = "$(cat "$BUNDLE.sha256" | tr -d '\n ')" ] && echo same || echo different)" "different"

echo "== 13. a restore declaration pins the restored ledger (fork at a non-trivial restore point)"
fork_world rs2
q <<'SQL' >/dev/null
set role migrator;
alter table identity_audit.evidence_acks disable trigger user; alter table identity_audit.anchors disable trigger user; alter table identity_audit.corrections disable trigger user;
delete from identity_audit.evidence_acks where anchor_seq = (select max(seq) from identity_audit.anchors);
delete from identity_audit.corrections where seq not in (select seq from identity_audit.corrections order by seq limit (select ledger_rows from identity_audit.anchors order by seq desc offset 1 limit 1));
delete from identity_audit.anchors where seq = (select max(seq) from identity_audit.anchors);
alter table identity_audit.evidence_acks enable trigger user; alter table identity_audit.anchors enable trigger user; alter table identity_audit.corrections enable trigger user;
SQL
W_RUN; ck "restoring behind the newest exported anchor is detected" "$RC" "2"; ckre "DATABASE_ROLLBACK_DETECTED" "$LAST" "DATABASE_ROLLBACK_DETECTED"
MAXA=$(val "select max(seq) from identity_audit.anchors")
W_OWNER restore PITR $((MAXA+3)); ck "a wrong restore point is refused" "$ORC" "2"
W_OWNER restore PITR "$MAXA"; ck "the OWNER declares the restore; the ledger row count and head are read from the database, not typed" "$ORC" "0"
ckre "the declaration records the restored ledger head" "$(cat "$TMP/rs2/work/env/test/records/$(printf '%08d' "$(echo "$OOUT" | node -e "console.log(JSON.parse(require('fs').readFileSync(0,'utf8')).evidence_seq)")").json")" "db_ledger_head_after_restore"
W_RUN; ck "the restored state is accepted" "$RC" "0"
q <<'SQL' >/dev/null
set role migrator;
alter table identity_audit.corrections disable trigger user;
update identity_audit.corrections set row_hash = repeat('0', 64) where seq = (select max(seq) from identity_audit.corrections);
alter table identity_audit.corrections enable trigger user;
SQL
W_RUN; ck "a ledger that no longer matches the declared restored state is detected" "$RC" "2"; ckre "RESTORE_STATE_MISMATCH" "$LAST" "RESTORE_STATE_MISMATCH"

world main; DB="$MAINDB"

echo "== 14. signing-key rotation"
W_OWNER rotate worker-1 worker-2 "$T/k/worker2.pub"; ck "the OWNER key rotates the worker key" "$ORC" "0"
W_RUN; ck "the retired key can no longer append" "$RC" "2"; ckre "WORKER_KEY_NOT_ACTIVE" "$LAST" "WORKER_KEY_NOT_ACTIVE"
copy_work; LAB "$T/lab" test append "$T/k/worker.key" worker-1 verification; W_VERIFY "$T/lab"; ckre "a record signed with the retired key is rejected by the verifier" "$VOUT" "EVIDENCE_SIGNER_UNKNOWN_OR_RETIRED"
NAMEREQ PP k1; APPLY $SA "$RID"
W_RUN WORKER_KEY_ID=worker-2 WORKER_KEY_FILE="$T/k/worker2.key"; ck "the new key works" "$RC" "0"
W_ACK; W_VERIFY "$T/main/work"; ck "the chain verifies across the rotation" "$VRC" "0"
ck "records written before the rotation still verify (history is not rewritten)" "$(echo "$VOUT" | grep -c '"ok":true')" "1"

echo "== 09 rollback preserves evidence; clean rollback and re-apply restore the fingerprint"
fork_world rb
OUT=$(rollback 09_rollback.sql); ckre "09 rollback is refused while acknowledgements exist (evidence is preserved)" "$OUT" "rollback refused"
ck "nothing was removed by the refused rollback" "$(val "select count(*) from pg_proc where proname like 'identity_evidence_%'")" "3"
DB="${MAINDB}_clean"; createdb "$DB"
q < "$HERE/fixture.sql" >/dev/null; q < "$HERE/testdata.sql" >/dev/null
for f in 01_identity_audit_schema.sql 02_identity_audit_helpers.sql 03_identity_correction_workflow.sql 04_guard_snapshot_identity.sql 05_guard_certificate_identity.sql 06_guard_participant_identity.sql 07_identity_correction_read_and_reject.sql 08_request_text_guard.sql; do apply $f >/dev/null; done
FP08=$(val "select identity_audit.guard_fingerprint()")
OUT=$(apply 09_external_evidence.sql); cknre "09 applies" "$OUT" "ERROR"
ck "09 changes the guard fingerprint (its seven components appear)" "$([ "$(val "select identity_audit.guard_fingerprint()")" != "$FP08" ] && echo changed)" "changed"
OUT=$(rollback 09_rollback.sql); cknre "09 rollback runs on an installation without evidence rows" "$OUT" "ERROR"
ck "09 rollback restores the fingerprint exactly" "$(val "select identity_audit.guard_fingerprint()")" "$FP08"
ck "09 rollback removed the evidence functions and the gate" "$(val "select count(*) from pg_proc where proname like 'identity_evidence_%' or proname in ('evidence_gate','external_evidence_ready')")" "0"
OUT=$(apply 09_external_evidence.sql); cknre "09 re-applies after rollback" "$OUT" "ERROR"
ck "ledger verifies clean throughout" "$(val "select count(*) filter (where not ok) from identity_audit.verify_ledger()")" "0"

echo
[ "$fail" != 0 ] && { echo "---- worker run log (diagnostic)"; cut -c1-400 "$TMP/runlog.txt"; }
echo "RESULT: $pass passed, $fail failed"
[ "$fail" = 0 ]
