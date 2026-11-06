#!/usr/bin/env bash
# Disposable PostgreSQL 17 test-suite for the PROPOSED identity-correction migrations.
# SYNTHETIC DATA ONLY. Nothing here touches Supabase, staging or Production.
#   bash scripts/identity-correction/run.sh            # starts and stops its own container
#   IDC_CONTAINER=name bash scripts/identity-correction/run.sh   # reuse a running postgres:17 container
set -u
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../../supabase/proposed-migrations/identity-correction"
OWN=0
if [ -z "${IDC_CONTAINER:-}" ]; then
  IDC_CONTAINER="idc-test-$$"; OWN=1
  docker run --rm -d --name "$IDC_CONTAINER" -e POSTGRES_PASSWORD=disposable_only postgres:17 >/dev/null
  for i in $(seq 1 60); do docker exec "$IDC_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done; sleep 2
fi
C="$IDC_CONTAINER"; DB="idc_$$"; TMP="$(mktemp -d)"
cleanup() { [ "$OWN" = 1 ] && docker stop "$C" >/dev/null 2>&1; rm -rf "$TMP"; }
trap cleanup EXIT

pass=0; fail=0
ck()    { if [ "$2" = "$3" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 (got '$2', want '$3')"; fail=$((fail+1)); fi; }
ckre()  { if echo "$2" | grep -q -E -- "$3"; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 (output did not match /$3/: $(echo "$2" | head -2 | tr '\n' ' '))"; fail=$((fail+1)); fi; }
cknre() { if echo "$2" | grep -q -E -- "$3"; then echo "FAIL $1 (output unexpectedly matched /$3/)"; fail=$((fail+1)); else echo "PASS $1"; pass=$((pass+1)); fi; }

createdb() { docker exec "$C" psql -U postgres -qtA -c "create database $1" >/dev/null; }
pg()  { docker exec -i "$C" psql -U postgres -d "$DB" -qtA -X "$@"; }
q()   { pg -v ON_ERROR_STOP=1 2>&1; }
val() { echo "$1" | q; }
run_as() { # role uid  (sql on stdin)
  { printf "set role %s;\n" "$1"
    [ -n "${2:-}" ] && printf "do \$d\$ begin perform set_config('request.jwt.claim.sub','%s',false); end \$d\$;\n" "$2"
    cat; } | pg -v ON_ERROR_STOP=1 2>&1
}
asq() { run_as "$1" "$2" <<< "$3"; }   # role uid "sql"
apply() { ( echo "set role migrator;"; cat "$MIG/$1" ) | q; }
rollback() { ( echo "set role migrator;"; cat "$MIG/rollback/$1" ) | q; }

SA=00000000-0000-0000-0000-0000000000a1; SA2=00000000-0000-0000-0000-0000000000a2
ADM=00000000-0000-0000-0000-0000000000a3; ED=00000000-0000-0000-0000-0000000000a4; SAX=00000000-0000-0000-0000-0000000000a5
GUARD_MSG='Modern certificate historical fields are immutable'

# ---- request/apply helpers ------------------------------------------------------------------------
REQ() { # uid pcode kind newname newic apply seed evn namedec identab identc [reason]
  local uid="$1" pc="$2" kind="$3" nn="$4" ni="$5" ap="$6" seed="$7" evn="$8" nd="$9" iab="${10}" ic="${11}"
  local reason="${12:-Synthetic test reason: document reviewed by the owner}" ev dec dr
  dr="'${DECREASON:-synthetic decision reason}'"; [ "${DECREASON:-}" = NONE ] && dr=null
  ev=$(val "select t.ev($evn,'$seed')"); dec=$(val "select t.dec(t.pid('$pc'), $nd, $iab, $ic, $dr)")
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
LEDGER() { val "select count(*) from identity_audit.corrections"; }
COLS_C() { val "select holder_name||'/'||participant_name||'/'||coalesce(identity_no,'~')||'/'||coalesce(identity_last4,'~') from public.certificates where participant_id=t.pid('$1') and certificate_no='$2'"; }
CERT_OF() { val "select certificate_no from public.certificates where participant_id=t.pid('$1') order by certificate_no limit 1 offset ${2:-0}"; }
STATE_HASH() { val "select md5(coalesce(string_agg(x, '|' order by x), '')) from (
    select md5(row_to_json(p)::text) x from public.participants p where p.participant_code='$1'
    union all select md5(row_to_json(c)::text) from public.certificates c where c.participant_id=t.pid('$1')
    union all select md5(row_to_json(s)::text) from public.certificate_issuance_snapshots s join public.certificates c on c.id=s.certificate_id where c.participant_id=t.pid('$1')) z"; }

# ======================================================================================================
echo "== setup: fresh database, Production-structure fixture, synthetic data"
createdb "$DB"
q < "$HERE/fixture.sql" >/dev/null; ck "fixture loads" "$?" "0"
q < "$HERE/testdata.sql" >/dev/null; ck "synthetic data loads" "$?" "0"
ck "fixture historical guard equals the reviewed Production baseline md5" \
   "$(val "select md5(regexp_replace(pg_get_functiondef('app.certificate_historical_update_guard()'::regprocedure), '\s+', ' ', 'g'))")" "5fba4ed1890f4f0b211802a91f6e56ba"

echo "== baseline behaviour BEFORE any migration (documents today's gaps)"
OUT=$(asq authenticated "$SA" "update public.certificates set holder_name='x' where participant_id=t.pid('PB')"); ckre "baseline: authenticated has no UPDATE on certificates" "$OUT" "permission denied for table certificates"
OUT=$(asq service_role "" "update public.certificates set holder_name='x' where participant_id=t.pid('PB')"); ckre "baseline: historical guard blocks a snapshot-backed certificate" "$OUT" "$GUARD_MSG"
ck "baseline GAP: a legacy certificate (no snapshot) name can be changed directly" \
   "$(asq service_role "" "with u as (update public.certificates set holder_name='Synthetic Gap Probe' where participant_id=t.pid('PW') returning 1) select count(*) from u")" "1"
q <<< "update public.certificates set holder_name='Synthetic Whiskey Person', participant_name='Synthetic Whiskey Person' where participant_id=t.pid('PW')" >/dev/null
ck "baseline GAP: a snapshot row name can be changed directly" \
   "$(asq service_role "" "with u as (update public.certificate_issuance_snapshots set holder_name='Synthetic Gap Probe' where certificate_id=(select id from public.certificates where participant_id=t.pid('PB')) returning 1) select count(*) from u")" "1"
q <<< "update public.certificate_issuance_snapshots set holder_name='Synthetic Bravo Person' where certificate_id=(select id from public.certificates where participant_id=t.pid('PB'))" >/dev/null
ck "baseline GAP: an admin can edit the name of a participant who holds certificates" \
   "$(asq authenticated "$ADM" "with u as (update public.participants set full_name='Synthetic Gap Probe' where participant_code='PC' returning 1) select count(*) from u")" "1"
q <<< "update public.participants set full_name='Synthetic Charlie Person' where participant_code='PC'" >/dev/null

# ======================================================================================================
echo "== migrations 01-03 (schema, helpers, workflow): install, idempotence, privileges"
for f in 01_identity_audit_schema.sql 02_identity_audit_helpers.sql 03_identity_correction_workflow.sql; do
  OUT=$(apply $f); cknre "first apply of $f has no error" "$OUT" "ERROR"
  OUT=$(apply $f); cknre "re-apply of $f has no error (idempotent)" "$OUT" "ERROR"
done
for r in anon authenticated service_role outsider; do
  ck "$r has no USAGE on schema identity_audit" "$(val "select has_schema_privilege('$r','identity_audit','usage')")" "f"
  ck "$r has no SELECT/INSERT/UPDATE/DELETE on the ledger" \
     "$(val "select (has_table_privilege('$r','identity_audit.corrections','select') or has_table_privilege('$r','identity_audit.corrections','insert') or has_table_privilege('$r','identity_audit.corrections','update') or has_table_privilege('$r','identity_audit.corrections','delete'))")" "f"
  ck "$r cannot execute identity_audit.authorized()" "$(val "select has_function_privilege('$r','identity_audit.authorized(text,uuid,text,text,text)','execute')")" "f"
  ck "$r cannot execute identity_audit.record()" "$(val "select has_function_privilege('$r','identity_audit.record(uuid,text,uuid,uuid,uuid,text,text,text,uuid)','execute')")" "f"
done
ck "workflow functions: 14 exist (7 app + 7 public)" "$(val "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','public') and p.proname like 'identity_correction\_%'")" "14"
ck "only authenticated can execute the workflow functions (anon/service_role/outsider/PUBLIC cannot)" \
   "$(val "select count(*) filter (where has_function_privilege('authenticated',p.oid,'execute'))||'/'||count(*) filter (where has_function_privilege('anon',p.oid,'execute') or has_function_privilege('service_role',p.oid,'execute') or has_function_privilege('outsider',p.oid,'execute')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('app','public') and p.proname like 'identity_correction\_%'")" "14/0"
ck "apply takes exactly one argument (no caller-supplied values)" "$(val "select pronargs from pg_proc where oid='app.identity_correction_apply(uuid)'::regprocedure")" "1"
ck "sealing key setting rejects private keys" "$(echo "update identity_audit.policy set sealing_public_key='-----BEGIN PGP PRIVATE KEY BLOCK-----'" | q | grep -c 'policy_no_private_key')" "1"

echo "== controls not configured: workflow must be inert (decision 8)"
OUT=$(asq authenticated "$SA" "select public.identity_correction_enable()"); ckre "enable refused while controls are unconfigured" "$OUT" "IDC_CONTROLS_NOT_CONFIGURED"
REQ $SA PN name "'Synthetic November Corrected'" null true x1 1 "'correct'" null null
ckre "request refused while the workflow is disabled" "$OUT" "IDC_CONTROLS_NOT_CONFIGURED"
ck "policy cannot be switched on directly without sealing key + sinks" "$(echo "update identity_audit.policy set enabled_at=now()" | q | grep -c 'policy_enabled_requires_controls')" "1"

echo "== migrations 04-06 (guards)"
for f in 04_guard_snapshot_identity.sql 05_guard_certificate_identity.sql 06_guard_participant_identity.sql; do
  OUT=$(apply $f); cknre "first apply of $f has no error" "$OUT" "ERROR"
  OUT=$(apply $f); cknre "re-apply of $f has no error (idempotent)" "$OUT" "ERROR"
done
ck "guard triggers present and enabled" "$(val "select ok from identity_audit.verify_ledger() where check_name='guard_triggers_present_and_enabled'")" "t"
ck "05 changed ONLY four conditions of the historical guard (line diff vs baseline)" \
   "$(rollback_diff=$(val "select count(*) from regexp_split_to_table(pg_get_functiondef('app.certificate_historical_update_guard()'::regprocedure), E'\n') l where l ~ 'identity_audit.authorized'"); echo "$rollback_diff")" "4"

echo "== direct-update bypass tests (guards) -- every role, including the owner"
CA=$(CERT_OF PA 0); LB=$(val "select certificate_no from public.certificates where participant_id=t.pid('PA') and identity_no is not null and not exists (select 1 from public.certificate_issuance_snapshots s where s.certificate_id=certificates.id)")
LC=$(val "select certificate_no from public.certificates where participant_id=t.pid('PA') and identity_no is null")
SNAPA=$(val "select certificate_no from public.certificates c where participant_id=t.pid('PA') and exists (select 1 from public.certificate_issuance_snapshots s where s.certificate_id=c.id)")
for f in holder_name participant_name identity_no identity_last4; do
  OUT=$(asq service_role "" "update public.certificates set $f='SYN-DIRECT' where certificate_no='$SNAPA'"); ckre "service_role cannot change snapshot-backed certificates.$f" "$OUT" "$GUARD_MSG"
  OUT=$(q <<< "set role migrator; update public.certificates set $f='SYN-DIRECT' where certificate_no='$SNAPA'"); ckre "the table OWNER cannot change snapshot-backed certificates.$f either" "$OUT" "$GUARD_MSG"
  OUT=$(asq service_role "" "update public.certificates set $f='SYN-DIRECT' where certificate_no='$LB'"); ckre "service_role cannot change legacy certificates.$f" "$OUT" "IDC_CORRECTION_REQUIRED"
done
for f in holder_name identity_no identity_last4; do
  OUT=$(asq service_role "" "update public.certificate_issuance_snapshots set $f='SYN-DIRECT' where certificate_id=(select id from public.certificates where certificate_no='$SNAPA')"); ckre "service_role cannot change snapshots.$f" "$OUT" "IDC_CORRECTION_REQUIRED"
done
OUT=$(asq service_role "" "update public.certificate_issuance_snapshots set render_payload=jsonb_set(render_payload,'{holder_name}','\"SYN-DIRECT\"') where certificate_id=(select id from public.certificates where certificate_no='$SNAPA')"); ckre "service_role cannot change snapshot render_payload.holder_name" "$OUT" "IDC_CORRECTION_REQUIRED"
OUT=$(asq service_role "" "update public.certificate_issuance_snapshots set render_payload=jsonb_set(render_payload,'{identity_no}','\"SYN-DIRECT\"') where certificate_id=(select id from public.certificates where certificate_no='$SNAPA')"); ckre "service_role cannot change snapshot render_payload.identity_no" "$OUT" "IDC_CORRECTION_REQUIRED"
OUT=$(asq service_role "" "update public.certificate_issuance_snapshots set render_payload=render_payload||'{\"x\":1}' where certificate_id=(select id from public.certificates where certificate_no='$SNAPA')"); ckre "service_role cannot add other keys to the snapshot payload" "$OUT" "immutable"
OUT=$(asq service_role "" "update public.certificate_issuance_snapshots set venue='SYN' where certificate_id=(select id from public.certificates where certificate_no='$SNAPA')"); ckre "service_role cannot change any other snapshot column" "$OUT" "immutable"
OUT=$(asq service_role "" "delete from public.certificate_issuance_snapshots where certificate_id=(select id from public.certificates where certificate_no='$SNAPA')"); ckre "service_role cannot delete a snapshot" "$OUT" "Issuance snapshots are immutable"
for f in "certificate_no='SYN-X'" "issue_date=date '2020-01-01'" "verification_token='abc'" "course_name='SYN'" "metadata='{}'::jsonb" "participant_id=t.pid('PB')" "certificate_file_url='x'" "issued_by='$SA'" "branch_name='SYN'" "venue='SYN'"; do
  OUT=$(asq service_role "" "update public.certificates set $f where certificate_no='$SNAPA'"); ckre "existing guard still blocks: $f" "$OUT" "$GUARD_MSG"
done
OUT=$(asq service_role "" "do \$b\$ declare r record; n int := 0; tot int := 0; e text; begin
  for r in select a.attname::text col, format_type(a.atttypid, a.atttypmod) typ from pg_attribute a
            where a.attrelid = 'public.certificates'::regclass and a.attnum > 0 and not a.attisdropped
              and a.attname::text = any (array['certificate_no','course_name','course_code','schedule_code','exam_date','training_start_date','training_end_date','participant_id','course_id','schedule_id','template_id','trainer_name','instructor','venue','branch_id','branch_code','branch_name','branch_address','effective_assessor_name','participant_code_snapshot','company_snapshot','issue_date','certificate_number','verification_token','verification_url','issued_by','replaces_certificate_id','certificate_file_url','metadata','legacy_batch_id']) loop
    tot := tot + 1;
    e := case when r.typ = 'date' then quote_literal('2031-01-01') || '::date' when r.typ = 'uuid' then quote_literal(gen_random_uuid()::text) || '::uuid'
              when r.typ = 'jsonb' then quote_literal('{\"z\":1}') || '::jsonb' else quote_literal('SYN-CHG') end;
    begin
      execute format('update public.certificates set %I = %s where certificate_no = %L', r.col, e, '$SNAPA');
    exception when sqlstate '22000' then n := n + 1; when others then raise notice 'col % raised %', r.col, sqlerrm; end;
  end loop;
  raise notice 'GUARDED %/%', n, tot;
end \$b\$")
ckre "ALL 30 pre-existing protected columns are still blocked by the extended guard (30/30)" "$OUT" "GUARDED 30/30"
OUT=$(asq authenticated "$ADM" "update public.participants set full_name='SYN-DIRECT' where participant_code='PA'"); ckre "admin cannot rename a participant who holds certificates" "$OUT" "IDC_CORRECTION_REQUIRED"
for f in ic_passport_no identity_no; do
  OUT=$(asq authenticated "$ADM" "update public.participants set $f='SYN-DIRECT' where participant_code='PA'"); ckre "admin cannot change participants.$f of a certificate holder" "$OUT" "IDC_CORRECTION_REQUIRED"
done
# identity_last4 is re-derived from identity_no by sync_participant_last4(), so a direct write is neutralised
# when identity_no is set; it is guarded where identity_no is empty (PB stores only ic_passport_no).
OUT=$(asq authenticated "$ADM" "update public.participants set identity_last4='SYN-DIRECT' where participant_code='PB'"); ckre "admin cannot change participants.identity_last4 where it stands alone" "$OUT" "IDC_CORRECTION_REQUIRED"
ck "writing identity_last4 where identity_no is set changes nothing (sync trigger re-derives it)" \
   "$(asq authenticated "$ADM" "update public.participants set identity_last4='XXXX' where participant_code='PA'" >/dev/null; val "select identity_last4 from public.participants where participant_code='PA'")" "0001"
OUT=$(q <<< "update public.participants set full_name='SYN-DIRECT' where participant_code='PA'"); ckre "superuser cannot rename a certificate holder either" "$OUT" "IDC_CORRECTION_REQUIRED"
OUT=$(asq service_role "" "set identity_audit.authorized = 'true'; set app.identity_correction = 'on'; update public.certificates set holder_name='SYN-DIRECT' where certificate_no='$SNAPA'"); ckre "session settings cannot open the guard" "$OUT" "$GUARD_MSG"
OUT=$(asq service_role "" "insert into identity_audit.corrections (request_id,target,row_id,participant_id,field,salt,applied_by) values (gen_random_uuid(),'certificate',gen_random_uuid(),gen_random_uuid(),'holder_name','x',gen_random_uuid())"); ckre "service_role cannot forge a ledger row" "$OUT" "permission denied for schema identity_audit"
OUT=$(asq authenticated "$SA" "select * from identity_audit.corrections"); ckre "even a Super Admin session cannot read the ledger directly" "$OUT" "permission denied for schema identity_audit"
OUT=$(asq authenticated "$SA" "select identity_audit.authorized('certificate',gen_random_uuid(),'holder_name','a','b')"); ckre "authenticated cannot call identity_audit.authorized()" "$OUT" "permission denied"

echo "== compatibility: operations the existing RPCs/flows perform must still work"
ck "participant without certificates: name still editable by admin" \
   "$(asq authenticated "$ADM" "with u as (update public.participants set full_name='Synthetic Charlie Person' where participant_code='PC' returning 1) select count(*) from u")" "1"
ck "participant WITH certificates: phone/email/company still editable (finalize_public_registration_crm columns)" \
   "$(asq authenticated "$ADM" "with u as (update public.participants set email='syn@example.invalid', phone='000', company='Synthetic Co 2', updated_at=now() where participant_code='PA' returning 1) select count(*) from u")" "1"
ck "participant WITH certificates: soft-delete/restore still possible (deleted_at)" \
   "$(q <<< "with u as (update public.participants set deleted_at=now() where participant_code='PU' returning 1) select count(*) from u")" "1"
q <<< "update public.participants set deleted_at=null where participant_code='PU'" >/dev/null
ck "revoke_certificate body (status, remarks) still allowed on snapshot-backed certificate" \
   "$(q <<< "with u as (update public.certificates set status='revoked', remarks='synthetic' where certificate_no='$SNAPA' returning 1) select count(*) from u")" "1"
ck "update_certificate_metadata body (expiry_date, remarks) still allowed" \
   "$(q <<< "with u as (update public.certificates set expiry_date=date '2030-01-01', remarks='synthetic2' where certificate_no='$SNAPA' returning 1) select count(*) from u")" "1"
ck "set_certificate_deleted body (deleted_at) still allowed" \
   "$(q <<< "with u as (update public.certificates set deleted_at=now() where certificate_no='$SNAPA' returning 1) select count(*) from u")" "1"
q <<< "update public.certificates set deleted_at=null, status='valid', remarks=null, expiry_date=null where certificate_no='$SNAPA'" >/dev/null
ck "set_certificate_verification_enabled body still allowed" \
   "$(q <<< "with u as (update public.certificates set verification_enabled=false where certificate_no='$SNAPA' returning 1) select count(*) from u")" "1"
q <<< "update public.certificates set verification_enabled=true where certificate_no='$SNAPA'" >/dev/null
ck "issue/duplicate flow: inserting a new participant + certificate + snapshot still works" \
   "$(q <<< "select t.mk_part('PY','Synthetic Yankee Person','SYN-Y-240024'); select 'ok' from (select t.mk_cert(t.pid('PY'),'A')) z" | tail -1)" "ok"
ck "issue flow: verification_url update right after INSERT (before the snapshot exists) still works" \
   "$(q <<< "insert into public.certificates (certificate_no,participant_name,holder_name,identity_no,course_name,course_id,participant_id,issue_date,status) select 'SYN-ISSUE-1',full_name,full_name,'SYN-Y-240024','x','c0000000-0000-0000-0000-000000000001', id, date '2026-10-01','valid' from public.participants where participant_code='PY'; with u as (update public.certificates set verification_url='/verify/x' where certificate_no='SYN-ISSUE-1' returning 1) select count(*) from u")" "1"
ck "audit trigger still writes one row per ordinary update" \
   "$(b=$(val "select count(*) from public.audit_logs where entity_type='certificates'"); q <<< "update public.certificates set remarks='audit probe' where certificate_no='$SNAPA'" >/dev/null; a=$(val "select count(*) from public.audit_logs where entity_type='certificates'"); echo $((a-b)))" "1"
q <<< "update public.certificates set remarks=null where certificate_no='$SNAPA'" >/dev/null
ck "RLS: editor cannot update participants (policy requires admin)" \
   "$(asq authenticated "$ED" "with u as (update public.participants set phone='111' where participant_code='PC' returning 1) select count(*) from u")" "0"

# ======================================================================================================
echo "== configure controls with a TEST-ONLY key (private key stays in the test container/harness)"
# The primary key only signs; an encryption-capable subkey is required (the enable self-test rejects a key without one).
docker exec "$C" sh -c 'export GNUPGHOME=/tmp/gh; rm -rf $GNUPGHOME; mkdir -m 700 $GNUPGHOME; gpg --batch --pinentry-mode loopback --passphrase "" --quick-gen-key "idc-test <idc-test@example.invalid>" rsa2048 default never; F=$(gpg --list-keys --with-colons | grep "^fpr" | head -1 | cut -d: -f10); gpg --batch --pinentry-mode loopback --passphrase "" --quick-add-key $F rsa2048 encr never' >/dev/null 2>&1
PUB=$(docker exec "$C" sh -c 'GNUPGHOME=/tmp/gh gpg --armor --export idc-test')
SEC=$(docker exec "$C" sh -c 'GNUPGHOME=/tmp/gh gpg --batch --pinentry-mode loopback --passphrase "" --armor --export-secret-keys idc-test')
ckre "test key generated" "$PUB" "BEGIN PGP PUBLIC KEY BLOCK"
OUT=$(printf "update identity_audit.policy set anchor_sink_configured_at=now(), notification_sink_configured_at=now(), sealing_public_key='not a key';\n" | q)
OUT=$(asq authenticated "$SA" "select public.identity_correction_enable()"); ckre "enable refuses an unusable sealing key" "$OUT" "IDC_SEALING_KEY_INVALID"
printf "update identity_audit.policy set sealing_public_key = \$k\$%s\$k\$;\n" "$PUB" | q >/dev/null
for who in "$ADM" "$ED" "$SAX"; do
  OUT=$(asq authenticated "$who" "select public.identity_correction_enable()"); ckre "non-Super-Admin/inactive cannot enable ($who)" "$OUT" "Not authorized"
done
OUT=$(asq authenticated "$SA" "select public.identity_correction_enable()"); cknre "Super Admin can enable once controls are configured" "$OUT" "ERROR"
ck "policy is enabled" "$(val "select (enabled_at is not null)::text from identity_audit.policy")" "true"
q <<< "update identity_audit.policy set wait_name=interval '0', wait_identity=interval '0'" >/dev/null   # test-only override of provisional 24h/72h

echo "== unauthorized callers (all seven workflow entry points)"
for fn in "public.identity_correction_assess(gen_random_uuid())" "public.identity_correction_apply(gen_random_uuid())" \
          "public.identity_correction_approve(gen_random_uuid())" "public.identity_correction_cancel(gen_random_uuid(),'twelve chars!')" \
          "public.identity_correction_enable()" "public.identity_correction_disable()" \
          "public.identity_correction_request(gen_random_uuid(),'name','x',null,true,'twelve chars twelve','[]'::jsonb,'[]'::jsonb)"; do
  short=$(echo "$fn" | sed 's/(.*//')
  for r in anon service_role outsider; do
    OUT=$(asq $r "$SA" "select $fn"); ckre "$r denied: $short" "$OUT" "permission denied for function"
  done
  for who in "$ADM" "$ED" "$SAX"; do
    OUT=$(asq authenticated "$who" "select $fn"); ckre "non-Super-Admin $who denied: $short" "$OUT" "Not authorized"
  done
  OUT=$(asq authenticated "" "select $fn"); ckre "authenticated without a user id denied: $short" "$OUT" "Not authorized"
done

echo "== assess returns structure only (no names or identity numbers)"
OUT=$(asq authenticated "$SA" "select public.identity_correction_assess(t.pid('PA'))")
ckre "assess lists the three certificate classes for PA" "$OUT" '"identity_class": "A".*"identity_class": "B".*"identity_class": "C"|"identity_class": "A"'
ck "assess classes are A, B and C" "$(echo "$OUT" | grep -o '"identity_class": "[ABC]"' | sort | tr -d '\n ')" '"identity_class":"A""identity_class":"B""identity_class":"C"'
cknre "assess output contains no participant name" "$OUT" "Synthetic Alpha"
cknre "assess output contains no identity number" "$OUT" "SYN-A-100001"

# ======================================================================================================
echo "== request validation (security + identity substitution)"
REQ $SA PN name "'Synthetic November Corrected'" null true reuse 1 "'correct'" null null "too short"
ckre "reason shorter than 20 characters refused" "$OUT" "IDC_REASON_REQUIRED"
REQ $SA PN name "'Synthetic November Corrected'" null true x0 0 "'correct'" null null
ckre "no evidence refused" "$OUT" "IDC_EVIDENCE_REQUIRED|IDC_EVIDENCE_INVALID|syntax|violates"
OUT=$(run_as authenticated "$SA" <<SQL
select public.identity_correction_request(t.pid('PN'),'name','Synthetic November Corrected',null,true,'Synthetic test reason: document reviewed',
 '[{"type":"national_id","reference":"ab","sha256":"zz","reviewed_on":"2026-11-01"}]'::jsonb, '$(val "select t.dec(t.pid('PN'),'correct',null,null)")'::jsonb);
SQL
); ckre "malformed evidence (short reference, bad sha256) refused" "$OUT" "IDC_EVIDENCE_INVALID"
REQ $SA PN name "'Synthetic November Person'" null true x2 1 "'correct'" null null
ckre "new name equal to current name refused" "$OUT" "IDC_NO_CHANGE"
REQ $SA PN name "'Bad' || chr(7) || 'Name'" null true x2 1 "'correct'" null null
ckre "control characters in the new name refused" "$OUT" "IDC_BAD_NAME"
REQ $SA PN name "'Synthetic November Corrected'" "'SYN-ZZ-999999'" true x2 1 "'correct'" null null
ckre "name request that also carries an identity refused" "$OUT" "IDC_BAD_VALUES"
REQ $SA PN name "'Synthetic November Corrected'" null true x3 1 "'correct'" "'correct'" null
ckre "identity decision on a name-only request refused" "$OUT" "IDC_DECISION_INVALID"
REQ $SA PN name "'Synthetic November Corrected'" null true x3 1 null null null
ckre "missing name decision refused" "$OUT" "IDC_DECISION_INVALID"
OUT=$(run_as authenticated "$SA" <<SQL
select public.identity_correction_request(t.pid('PN'),'name','Synthetic November Corrected',null,true,'Synthetic test reason: document reviewed','$(val "select t.ev(1,'x4')")'::jsonb,'[]'::jsonb);
SQL
); ckre "empty decision list refused (every certificate needs a decision)" "$OUT" "IDC_DECISION_MISSING"
OUT=$(run_as authenticated "$SA" <<SQL
select public.identity_correction_request(t.pid('PN'),'name','Synthetic November Corrected',null,true,'Synthetic test reason: document reviewed','$(val "select t.ev(1,'x5')")'::jsonb,
  '$(val "select t.dec(t.pid('PN'),'correct',null,null)")'::jsonb || '$(val "select t.dec(t.pid('PB'),'correct',null,null)")'::jsonb);
SQL
); ckre "decision for another participant's certificate refused" "$OUT" "IDC_DECISION_FOREIGN_CERT"
REQ $SA PA name "'Synthetic Alpha Corrected'" null true x6 1 "'correct'" null null
ckre "touching legacy certificates with a single evidence type refused" "$OUT" "IDC_EVIDENCE_INSUFFICIENT"
REQ $SA PB identity null "'SYN-ZZ-999999'" true x7 1 null "'correct'" null
ckre "identity change with one evidence item refused" "$OUT" "IDC_EVIDENCE_INSUFFICIENT"
OUT=$(run_as authenticated "$SA" <<SQL
select public.identity_correction_request(t.pid('PB'),'identity',null,'SYN-ZZ-999999',true,'Synthetic test reason: document reviewed',
 '[{"type":"employer_letter","reference":"SYN-DOC-A","sha256":"$(val "select encode(sha256('a'::bytea),'hex')")","reviewed_on":"2026-11-01"},{"type":"signed_declaration","reference":"SYN-DOC-B","sha256":"$(val "select encode(sha256('b'::bytea),'hex')")","reviewed_on":"2026-11-01"}]'::jsonb,
 '$(val "select t.dec(t.pid('PB'),null,'correct',null)")'::jsonb);
SQL
); ckre "identity change without a government document refused" "$OUT" "IDC_EVIDENCE_INSUFFICIENT"

echo "== identity collision and Working-at-Height duplicate-prevention"
REQ $SA PB identity null "'SYN-A-100001'" true c1 2 null "'correct'" null
ckre "new IC equal to another participant's IC refused" "$OUT" "IDC_IDENTITY_COLLISION"
REQ $SA PB identity null "'syn a 100001'" true c1 2 null "'correct'" null
ckre "collision is detected after normalisation (case/punctuation)" "$OUT" "IDC_IDENTITY_COLLISION"
REQ $SA PB identity null "'SYN-Z-150025'" true c2 2 null "'correct'" null
ckre "new IC that only exists on another person's certificate refused" "$OUT" "IDC_IDENTITY_COLLISION"
REQ $SA PB identity null "'SYN-Z-150026'" true c2b 2 null "'correct'" null
ckre "new IC equal to a SOFT-DELETED participant's IC refused (strict default; owner decision)" "$OUT" "IDC_IDENTITY_COLLISION"
REQ $SA PB identity null "'SYN-W-DUP-0005'" true c3 2 null "'correct'" null
ckre "new IC equal to a Working-at-Height holder's certificate identity refused" "$OUT" "IDC_IDENTITY_COLLISION"
REQ $SA PB identity null "'ab1'" true c4 2 null "'correct'" null
ckre "implausible identity format refused" "$OUT" "IDC_IDENTITY_FORMAT"
WAH_PD_BEFORE=$(val "select app.wah_participant_holds_certificate(t.pid('PD'))")
REQ $SA PD identity null "'SYN-D-250099'" true c5 2 null "'correct'" null
ckre "duplicate profile cannot shed its WAH duplicate hold by changing IC" "$OUT" "IDC_WAH_DUPLICATE_RELEASE_BLOCKED"
ck "WAH hold for the duplicate profile is unchanged by the refused request" "$(val "select app.wah_participant_holds_certificate(t.pid('PD'))")" "$WAH_PD_BEFORE"
ck "the duplicate profile really is blocked today (WAH hold = true)" "$WAH_PD_BEFORE" "t"
ck "control participant holds no WAH certificate (false)" "$(val "select app.wah_participant_holds_certificate(t.pid('PC'))")" "f"
REQ $SA PC identity null "'SYN-C-399999'" true c6 2 null null null
ckre "participant with no certificates is not a correction target (ordinary edit applies)" "$OUT" "IDC_NO_CERTIFICATES"

# ======================================================================================================
echo "== Class C legacy certificates need explicit per-certificate decisions (decision 6)"
REQ $SA PK identity null "'SYN-K-120099'" true k1 2 null "'correct'" null
ckre "profile change with a Class C certificate and no decision refused" "$OUT" "IDC_CLASS_C_DECISION_REQUIRED"
REQ $SA PK identity null "'SYN-K-120099'" true k1 2 null "'correct'" "'leave'"
ckre "'leave' is not allowed for Class C when the profile identity changes" "$OUT" "IDC_CLASS_C_DECISION_REQUIRED"
DECREASON=x REQ $SA PK identity null "'SYN-K-120099'" true k1 2 null "'correct'" "'accept_display_change'"
ckre "non-default decision needs a reason of 10+ characters" "$OUT" "IDC_DECISION_REASON_REQUIRED"

echo "== functional corrections: name only (PN) with ledger, sealing and invariants"
L0=$(LEDGER); A0=$(val "select count(*) from identity_audit.anchors")
REQ $SA PN name "'Synthetic November Corrected'" null true reuse 1 "'correct'" null null
ckre "name-only request accepted" "$RID" "^[0-9a-f-]{36}$"; RN="$RID"
ck "the requested new name is held only on the request until applied" "$(val "select new_full_name from identity_audit.requests where id='$RN'")" "Synthetic November Corrected"
ck "nothing changes at request time" "$(val "select full_name from public.participants where participant_code='PN'")" "Synthetic November Person"
REQ $SA PN name "'Synthetic November Other'" null true y1 1 "'correct'" null null
ckre "a second open request for the same participant refused" "$OUT" "IDC_REQUEST_ALREADY_OPEN"
REQ $SA PB name "'Synthetic Bravo Corrected'" null true reuse 1 "'correct'" null null
ckre "an evidence document already used for another participant cannot be reused" "$OUT" "IDC_EVIDENCE_REUSED"
APPLY $SA "$RN"; ckre "apply succeeds" "$OUT" '"request_id"'
CN=$(CERT_OF PN 0)
ck "certificate name + participant_name corrected, identity untouched" "$(COLS_C PN "$CN")" "Synthetic November Corrected/Synthetic November Corrected/SYN-N-500006/0006"
ck "snapshot name and payload name corrected" "$(val "select s.holder_name||'/'||(s.render_payload->>'holder_name') from public.certificate_issuance_snapshots s join public.certificates c on c.id=s.certificate_id where c.participant_id=t.pid('PN')")" "Synthetic November Corrected/Synthetic November Corrected"
ck "profile name corrected" "$(val "select full_name from public.participants where participant_code='PN'")" "Synthetic November Corrected"
ck "ledger rows: certificate x2, snapshot, payload, profile = 5" "$(( $(LEDGER) - L0 ))" "5"
ck "one anchor recorded" "$(( $(val "select count(*) from identity_audit.anchors") - A0 ))" "1"
ck "request is applied and the new value was cleared" "$(val "select status||'/'||coalesce(new_full_name,'<cleared>') from identity_audit.requests where id='$RN'")" "applied/<cleared>"
printf "select extensions.pgp_pub_decrypt(old_sealed, extensions.dearmor(\$k\$%s\$k\$)) from identity_audit.corrections where request_id='%s' and target='participant' and field='full_name';\n" "$SEC" "$RN" > "$TMP/dec.sql"
ck "sealed ORIGINAL value is recoverable only with the private key" "$(q < "$TMP/dec.sql")" "Synthetic November Person"
ck "no private key stored in the database" "$(val "select (sealing_public_key ~* 'PRIVATE KEY')::text from identity_audit.policy")" "false"
ck "ledger does not hold plaintext values (sealed bytea + salted fingerprints)" "$(val "select count(*) from identity_audit.corrections where position('November' in encode(old_sealed,'escape'))>0 or position('November' in encode(new_sealed,'escape'))>0")" "0"
ck "audit_logs metadata holds no name or identity" "$(val "select count(*) from public.audit_logs where entity_type='identity_correction_requests' and (metadata::text ~* 'Synthetic|SYN-' or summary ~* 'Synthetic|SYN-')")" "0"
ck "verify_ledger: all checks ok" "$(val "select count(*) filter (where not ok) from identity_audit.verify_ledger()")" "0"
OUT=$(asq service_role "" "update public.certificates set holder_name='Synthetic November Person' where certificate_no='$CN'"); ckre "after correction the window is closed: direct reversal still refused" "$OUT" "$GUARD_MSG"
APPLY $SA "$RN"; ckre "re-applying the same request refused" "$OUT" "IDC_REQUEST_NOT_PENDING"

echo "== Class A/B/C name correction with sufficient evidence (PA: three classes)"
REQ $SA PA name "'Synthetic Alpha Corrected'" null true pa1 2 "'correct'" null null
ckre "PA name request accepted (2 evidence types because legacy certificates are touched)" "$RID" "^[0-9a-f-]{36}$"; RA="$RID"; L0=$(LEDGER)
APPLY $SA "$RA"; ckre "PA name apply succeeds" "$OUT" '"request_id"'
ck "all three PA certificates carry the corrected name" "$(val "select count(*) from public.certificates where participant_id=t.pid('PA') and holder_name='Synthetic Alpha Corrected' and participant_name='Synthetic Alpha Corrected'")" "3"
ck "PA ledger rows: A(2+1+1) + B(2) + C(2) + profile(1) = 9" "$(( $(LEDGER) - L0 ))" "9"
ck "PA identity numbers untouched by a name-only correction" "$(val "select string_agg(coalesce(identity_no,'~'), ',' order by certificate_no) from public.certificates where participant_id=t.pid('PA')")" "SYN-A-100001,SYN-A-100001,~"

echo "== IC/Passport correction (PB) and Class C decisions (PA pin_old, PK accept, PL materialize)"
REQ $SA PB identity null "'SYN-B-209999'" true pb1 2 null "'correct'" null
ckre "PB identity request accepted (2 types incl. national_id)" "$RID" "^[0-9a-f-]{36}$"; RB="$RID"; L0=$(LEDGER)
APPLY $SA "$RB"; ckre "PB identity apply succeeds" "$OUT" '"request_id"'
CB=$(CERT_OF PB 0)
ck "PB certificate identity + last4 corrected" "$(COLS_C PB "$CB")" "Synthetic Bravo Person/Synthetic Bravo Person/SYN-B-209999/9999"
ck "PB snapshot identity, last4 and payload corrected" "$(val "select s.identity_no||'/'||s.identity_last4||'/'||(s.render_payload->>'identity_no') from public.certificate_issuance_snapshots s join public.certificates c on c.id=s.certificate_id where c.participant_id=t.pid('PB')")" "SYN-B-209999/9999/SYN-B-209999"
ck "PB profile ic_passport_no corrected (identity_no was empty and stays empty)" "$(val "select ic_passport_no||'/'||coalesce(identity_no,'~') from public.participants where participant_code='PB'")" "SYN-B-209999/~"
ck "PB: certificate number, QR token (still equals the token frozen in the snapshot) and issue date unchanged" \
   "$(val "select (c.certificate_no = '$CB' and c.certificate_no = c.certificate_number and c.verification_token = s.verification_metadata->>'verification_token' and c.issue_date = date '2026-10-01')::text from public.certificates c join public.certificate_issuance_snapshots s on s.certificate_id=c.id where c.participant_id=t.pid('PB')")" "true"

REQ $SA PA identity null "'SYN-A-109999'" true pa2 2 null "'correct'" "'pin_old'"
ckre "PA identity request with pin_old accepted" "$RID" "^[0-9a-f-]{36}$"; RA2="$RID"
APPLY $SA "$RA2"; ckre "PA identity apply succeeds" "$OUT" '"request_id"'
ck "PA: both profile identity columns corrected consistently, last4 re-derived" "$(val "select ic_passport_no||'/'||identity_no||'/'||identity_last4 from public.participants where participant_code='PA'")" "SYN-A-109999/SYN-A-109999/9999"
ck "PA: stored-IC legacy + snapshot certificates corrected; Class C pinned to the OLD displayed IC" \
   "$(val "select string_agg(coalesce(identity_no,'~'), ',' order by certificate_no) from public.certificates where participant_id=t.pid('PA')")" "SYN-A-109999,SYN-A-109999,SYN-A-100001"
REQ $SA PK identity null "'SYN-K-120099'" true k2 2 null "'correct'" "'accept_display_change'"
KID="$RID"; APPLY $SA "$KID"
ck "PK: Class C with accept_display_change keeps identity_no NULL (display follows the corrected profile)" \
   "$(val "select count(*) from public.certificates where participant_id=t.pid('PK') and identity_no is null")" "1"
ck "PK: profile IC corrected" "$(val "select ic_passport_no from public.participants where participant_code='PK'")" "SYN-K-120099"
REQ $SA PL identity null "'SYN-L-139999'" false l1 2 null null "'materialize_new'"
LID="$RID"; APPLY $SA "$LID"
ck "PL: materialize_new stores the corrected IC on the legacy certificate, profile untouched (apply_to_profile=false)" \
   "$(val "select c.identity_no||'/'||p.ic_passport_no from public.certificates c join public.participants p on p.id=c.participant_id where p.participant_code='PL'")" "SYN-L-139999/SYN-L-130013"
OUT=$(asq authenticated "$ADM" "update public.participants set ic_passport_no='SYN-DIRECT' where participant_code='PL'"); ckre "profile still guarded after a correction" "$OUT" "IDC_CORRECTION_REQUIRED"
ck "profile whose identity lives only in identity_no: its legacy certificate is NOT Class C (renderer never reads that column)" \
   "$(val "select identity_audit.identity_class(id) from public.certificates where participant_id=t.pid('PIDN')")" "none"
REQ $SA PIDN identity null "'SYN-IDN-169999'" true idn1 2 null null null
ckre "identity_no-only profile: request needs no Class C decision" "$RID" "^[0-9a-f-]{36}$"; IDN="$RID"; APPLY $SA "$IDN"
ck "identity_no-only profile: identity_no and last4 corrected, ic_passport_no stays empty, certificate untouched" \
   "$(val "select p.identity_no||'/'||p.identity_last4||'/'||coalesce(p.ic_passport_no,'~')||'/'||coalesce(c.identity_no,'~') from public.participants p join public.certificates c on c.participant_id=p.id where p.participant_code='PIDN'")" "SYN-IDN-169999/9999/~/~"

echo "== combined name + identity (PJ) and 'leave' decisions (PT)"
REQ $SA PJ combined "'Synthetic Juliet Corrected'" "'SYN-J-119999'" true pj1 2 "'correct'" "'correct'" null
JID="$RID"; APPLY $SA "$JID"; ckre "combined apply succeeds" "$OUT" '"request_id"'
ck "PJ profile: name, ic_passport_no, identity_no, identity_last4 all corrected" "$(val "select full_name||'/'||ic_passport_no||'/'||identity_no||'/'||identity_last4 from public.participants where participant_code='PJ'")" "Synthetic Juliet Corrected/SYN-J-119999/SYN-J-119999/9999"
DECREASON=NONE REQ $SA PT name "'Synthetic Tango Corrected'" null true pt2 1 "'leave'" null null
ckre "'leave' without a reason refused" "$OUT" "IDC_DECISION_REASON_REQUIRED"
REQ $SA PT name "'Synthetic Tango Corrected'" null false pt3 1 "'leave'" null null
ckre "all-leave with apply_to_profile=false refused (no effect)" "$OUT" "IDC_NO_EFFECT"
REQ $SA PT name "'Synthetic Tango Corrected'" null true pt1 1 "'leave'" null null
ckre "explicit 'leave' on every certificate with a profile change accepted" "$RID" "^[0-9a-f-]{36}$"; TID="$RID"
APPLY $SA "$TID"; ckre "apply with all-leave decisions succeeds" "$OUT" '"request_id"'
ck "certificates left untouched by an explicit 'leave' (only the profile changed)" \
   "$(val "select count(*) from public.certificates where participant_id=t.pid('PT') and holder_name='Synthetic Tango Person'")/$(val "select full_name from public.participants where participant_code='PT'")" "2/Synthetic Tango Corrected"

echo "== missing / conflicting snapshot data"
REQ $SA PM combined "'Synthetic Mike Corrected'" "'SYN-M-149999'" true pm1 2 "'correct'" "'correct'" null
MID="$RID"; APPLY $SA "$MID"; ckre "snapshot without IC fields: apply succeeds" "$OUT" '"request_id"'
ck "absent snapshot fields stay absent (shape preserved)" "$(val "select (s.identity_no is null)::text||'/'||(s.identity_last4 is null)::text||'/'||(not (s.render_payload ? 'identity_no'))::text from public.certificate_issuance_snapshots s join public.certificates c on c.id=s.certificate_id where c.participant_id=t.pid('PM')")" "true/true/true"
REQ $SA PO name "'Synthetic Oscar Corrected'" null true po1 1 "'correct'" null null
OID="$RID"; APPLY $SA "$OID"; ckre "snapshot name differs from certificate name: apply succeeds" "$OUT" '"request_id"'
ck "conflicting locations converge on the corrected name (ledger keeps each original)" "$(val "select c.holder_name||'/'||s.holder_name||'/'||(s.render_payload->>'holder_name') from public.certificates c join public.certificate_issuance_snapshots s on s.certificate_id=c.id where c.participant_id=t.pid('PO')")" "Synthetic Oscar Corrected/Synthetic Oscar Corrected/Synthetic Oscar Corrected"

echo "== waiting periods (PROVISIONAL 24h/72h) and tamper-resistance of request evidence"
q <<< "update identity_audit.policy set wait_name=interval '24 hours', wait_identity=interval '72 hours'" >/dev/null
REQ $SA PS name "'Synthetic Sierra Corrected'" null true ps1 1 "'correct'" null null; SID="$RID"
ck "name-only request waits 24h" "$(val "select (abs(extract(epoch from earliest_apply_at - requested_at) - 86400) < 1)::text from identity_audit.requests where id='$SID'")" "true"
APPLY $SA "$SID"; ckre "apply before the waiting period ends refused" "$OUT" "IDC_WAITING_PERIOD"
OUT=$(q <<< "update identity_audit.requests set earliest_apply_at = now() where id='$SID'"); ckre "even the owner cannot shorten the waiting period (evidence is immutable)" "$OUT" "immutable"
REQ $SA PU identity null "'SYN-U-219999'" true pu1 2 null "'correct'" null; UID_="$RID"
ck "identity request waits 72h" "$(val "select (abs(extract(epoch from earliest_apply_at - requested_at) - 259200) < 1)::text from identity_audit.requests where id='$UID_'")" "true"
OUT=$(asq authenticated "$SA" "select public.identity_correction_cancel('$SID','short')"); ckre "cancel needs a reason" "$OUT" "IDC_REASON_REQUIRED"
OUT=$(asq authenticated "$SA" "select public.identity_correction_cancel('$SID','cancelled for the synthetic test')"); cknre "cancel succeeds" "$OUT" "ERROR"
ck "cancelled request cleared its new values" "$(val "select status||'/'||coalesce(new_full_name,'<cleared>') from identity_audit.requests where id='$SID'")" "cancelled/<cleared>"
OUT=$(asq authenticated "$SA" "select public.identity_correction_cancel('$UID_','cancelled for the synthetic test')")
q <<< "update identity_audit.policy set wait_name=interval '0', wait_identity=interval '0'" >/dev/null

echo "== optional independent second approver"
q <<< "update identity_audit.policy set require_second_approver=true" >/dev/null
REQ $SA PH name "'Synthetic Hotel Corrected'" null true ph1 1 "'correct'" null null; HID="$RID"
APPLY $SA "$HID"; ckre "apply without a second approval refused" "$OUT" "IDC_SECOND_APPROVAL_REQUIRED"
OUT=$(asq authenticated "$SA" "select public.identity_correction_approve('$HID')"); ckre "requester cannot approve their own request" "$OUT" "IDC_SELF_APPROVAL"
OUT=$(asq authenticated "$ADM" "select public.identity_correction_approve('$HID')"); ckre "a non-Super-Admin cannot approve" "$OUT" "Not authorized"
OUT=$(asq authenticated "$SA2" "select public.identity_correction_approve('$HID')"); cknre "an independent Super Admin can approve" "$OUT" "ERROR"
APPLY $SA "$HID"; ckre "apply succeeds after the independent approval" "$OUT" '"request_id"'
q <<< "update identity_audit.policy set require_second_approver=false" >/dev/null

echo "== stale requests (concurrent edits, new certificates, deleted snapshots)"
REQ $SA PP name "'Synthetic Papa Corrected'" null true pp1 1 "'correct'" null null; PID_="$RID"
q <<< "alter table public.participants disable trigger trg_participant_identity_guard; update public.participants set full_name='Synthetic Papa Edited Elsewhere' where participant_code='PP'; alter table public.participants enable trigger trg_participant_identity_guard" >/dev/null
APPLY $SA "$PID_"; ckre "profile edited after the request -> stale" "$OUT" "IDC_STALE_REQUEST"
ck "stale request left the request pending and nothing applied" "$(val "select status from identity_audit.requests where id='$PID_'")" "pending"
OUT=$(asq authenticated "$SA" "select public.identity_correction_cancel('$PID_','cancelled for the synthetic test')")
REQ $SA PQ name "'Synthetic Quebec Corrected'" null true pq1 1 "'correct'" null null; QID="$RID"
q <<< "select t.mk_cert(t.pid('PQ'),'A')" >/dev/null
APPLY $SA "$QID"; ckre "a certificate issued after the request -> stale (new certificate has no decision)" "$OUT" "IDC_STALE_REQUEST"
REQ $SA PR name "'Synthetic Romeo Corrected'" null true pr1 1 "'correct'" null null; RRID="$RID"
q <<< "alter table public.certificate_issuance_snapshots disable trigger trg_snapshot_identity_guard; delete from public.certificate_issuance_snapshots where certificate_id=(select id from public.certificates where participant_id=t.pid('PR')); alter table public.certificate_issuance_snapshots enable trigger trg_snapshot_identity_guard" >/dev/null
APPLY $SA "$RRID"; ckre "snapshot removed after the request -> stale" "$OUT" "IDC_STALE_REQUEST"

echo "== failure atomicity: injected failure on the LAST snapshot step leaves no change"
q <<< "create function t.fail_inject() returns trigger language plpgsql as \$f\$ begin if new.holder_name = 'Synthetic FAIL Injected' then raise exception 'injected failure'; end if; return new; end \$f\$; create trigger zz_fail_inject after update on public.certificate_issuance_snapshots for each row execute function t.fail_inject()" >/dev/null
REQ $SA PF name "'Synthetic FAIL Injected'" null true pf1 1 "'correct'" null null; FID="$RID"
H0=$(STATE_HASH PF); L0=$(LEDGER); A0=$(val "select count(*) from identity_audit.anchors"); O0=$(val "select count(*) from identity_audit.outbox"); AU0=$(val "select count(*) from public.audit_logs")
APPLY $SA "$FID"; ckre "apply fails with the injected error" "$OUT" "injected failure"
ck "participant + certificate + snapshot unchanged after the failure" "$(STATE_HASH PF)" "$H0"
ck "no ledger rows, anchors or outbox rows were left behind" "$(LEDGER)/$(val "select count(*) from identity_audit.anchors")/$(val "select count(*) from identity_audit.outbox")" "$L0/$A0/$O0"
ck "no audit_logs rows were left behind" "$(val "select count(*) from public.audit_logs")" "$AU0"
ck "request is still pending (retry possible)" "$(val "select status from identity_audit.requests where id='$FID'")" "pending"
q <<< "drop trigger zz_fail_inject on public.certificate_issuance_snapshots" >/dev/null
APPLY $SA "$FID"; ckre "after the cause is removed the same request applies" "$OUT" '"request_id"'

echo "== repeated corrections"
REQ $SA PI name "'Synthetic India First'" null true pi1 1 "'correct'" null null; APPLY $SA "$RID"
REQ $SA PI name "'Synthetic India Second'" null true pi2 1 "'correct'" null null; APPLY $SA "$RID"
ck "second correction applied on top of the first" "$(val "select full_name from public.participants where participant_code='PI'")" "Synthetic India Second"
ck "ledger keeps both corrections for the participant (2 requests, 10 rows)" "$(val "select count(distinct request_id)||'/'||count(*) from identity_audit.corrections where participant_id=t.pid('PI')")" "2/10"

echo "== concurrency: two sessions apply the same request"
REQ $SA PG name "'Synthetic Golf Corrected'" null true pg1 1 "'correct'" null null; GID="$RID"; L0=$(LEDGER)
( APPLY $SA "$GID"; echo "$OUT" > "$TMP/c1" ) & ( APPLY $SA "$GID"; echo "$OUT" > "$TMP/c2" ) & wait
ck "exactly one of two concurrent applies succeeded" "$(cat "$TMP/c1" "$TMP/c2" | grep -c '"request_id"')" "1"
ck "the other was refused as not pending" "$(cat "$TMP/c1" "$TMP/c2" | grep -c 'IDC_REQUEST_NOT_PENDING')" "1"
ck "ledger holds exactly one application (5 rows)" "$(( $(LEDGER) - L0 ))" "5"

echo "== invariants after all corrections"
ck "no certificate column other than the four identity fields changed anywhere" \
   "$(val "select count(*) from t.pre_c p join public.certificates c on c.id=p.id where p.h <> md5((to_jsonb(c) - array['holder_name','participant_name','identity_no','identity_last4','updated_at'])::text)")" "0"
ck "no snapshot column other than the identity fields changed anywhere" \
   "$(val "select count(*) from t.pre_s p join public.certificate_issuance_snapshots s on s.certificate_id=p.certificate_id where p.h <> md5((to_jsonb(s) - array['holder_name','identity_no','identity_last4','render_payload'])::text || (s.render_payload - array['holder_name','identity_no'])::text)")" "0"
ck "Working-at-Height duplicate-prevention results unchanged for every participant" \
   "$(val "select count(*) from t.wah_before w where w.v is distinct from app.wah_participant_holds_certificate(w.id)")" "0"
ck "verify_ledger: all checks ok before any tampering" "$(val "select count(*) filter (where not ok) from identity_audit.verify_ledger()")" "0"
ck "an anchor exists for every applied correction" "$(val "select (select count(*) from identity_audit.anchors)||'/'||(select count(*) from identity_audit.requests where status='applied')")" "$(val "select (select count(*) from identity_audit.requests where status='applied')||'/'||(select count(*) from identity_audit.requests where status='applied')")"

echo "== audit tampering: append-only, immutability, and DETECTION of a privileged writer"
OUT=$(asq service_role "" "update identity_audit.corrections set field='x'"); ckre "service_role cannot touch the ledger" "$OUT" "permission denied for schema identity_audit"
OUT=$(q <<< "set role migrator; update identity_audit.corrections set field='x'"); ckre "owner UPDATE of the ledger refused" "$OUT" "append-only"
OUT=$(q <<< "set role migrator; delete from identity_audit.corrections"); ckre "owner DELETE of the ledger refused" "$OUT" "append-only"
OUT=$(q <<< "set role migrator; truncate identity_audit.corrections cascade"); ckre "owner TRUNCATE of the ledger refused" "$OUT" "append-only"
OUT=$(q <<< "set role migrator; update identity_audit.anchors set ledger_head='x'"); ckre "anchors are immutable" "$OUT" "immutable"
OUT=$(q <<< "set role migrator; update identity_audit.request_certificates set decision_reason='x'"); ckre "recorded decisions are immutable" "$OUT" "immutable"
OUT=$(q <<< "set role migrator; delete from identity_audit.requests"); ckre "requests cannot be deleted" "$OUT" "cannot be deleted"
FP0=$(val "select identity_audit.guard_fingerprint()")
q <<< "alter table public.certificate_issuance_snapshots disable trigger trg_snapshot_identity_guard" >/dev/null
ck "DETECT: disabling a guard trigger is reported by verify_ledger (trigger check)" "$(val "select ok from identity_audit.verify_ledger() where check_name='guard_triggers_present_and_enabled'")" "f"
ck "DETECT: ... and by the guard fingerprint against the latest anchor" "$(val "select ok from identity_audit.verify_ledger() where check_name='guard_fingerprint_matches_latest_anchor'")" "f"
q <<< "alter table public.certificate_issuance_snapshots enable trigger trg_snapshot_identity_guard" >/dev/null
ck "re-enabling restores the original fingerprint" "$(val "select identity_audit.guard_fingerprint()")" "$FP0"
q <<< "alter table identity_audit.corrections disable trigger corrections_append_only; update identity_audit.corrections set new_fp='tampered' where seq=(select min(seq) from identity_audit.corrections); alter table identity_audit.corrections enable trigger corrections_append_only" >/dev/null
ck "DETECT: a tampered ledger row breaks the hash chain" "$(val "select ok from identity_audit.verify_ledger() where check_name='ledger_chain'")" "f"
q <<'SQL' >/dev/null
alter table identity_audit.corrections disable trigger corrections_append_only;
alter table identity_audit.corrections disable trigger corrections_chain;
do $$ declare r record; v_prev text := 'GENESIS'; v_hash text; begin
  for r in select * from identity_audit.corrections order by seq loop
    v_hash := identity_audit.compute_row_hash(r.seq, r.request_id, r.target, r.row_id, r.field, r.old_fp, r.new_fp,
                r.old_sealed, r.new_sealed, r.txid, r.applied_by, r.applied_at, v_prev);
    update identity_audit.corrections set prev_hash = v_prev, row_hash = v_hash where seq = r.seq;
    v_prev := v_hash;
  end loop; end $$;
alter table identity_audit.corrections enable trigger corrections_chain;
alter table identity_audit.corrections enable trigger corrections_append_only;
SQL
ck "a privileged writer who REWRITES the whole chain consistently passes the chain check..." "$(val "select ok from identity_audit.verify_ledger() where check_name='ledger_chain'")" "t"
ck "DETECT: ... but the rewrite disagrees with the externally anchored head (why anchors must leave the database)" "$(val "select ok from identity_audit.verify_ledger() where check_name='anchors_match_ledger'")" "f"

# ======================================================================================================
echo "== owner-level forgery is DETECTED (not prevented) -- fresh database"
DB_MAIN="$DB"; DB="${DB}_b"; createdb "$DB"
q < "$HERE/fixture.sql" >/dev/null; q < "$HERE/testdata.sql" >/dev/null
for f in 01_identity_audit_schema.sql 02_identity_audit_helpers.sql 03_identity_correction_workflow.sql 04_guard_snapshot_identity.sql 05_guard_certificate_identity.sql 06_guard_participant_identity.sql; do apply $f >/dev/null; done
printf "update identity_audit.policy set sealing_public_key = \$k\$%s\$k\$, anchor_sink_configured_at=now(), notification_sink_configured_at=now(), wait_name=interval '0', wait_identity=interval '0';\n" "$PUB" | q >/dev/null
asq authenticated "$SA" "select public.identity_correction_enable()" >/dev/null
REQ $SA PN name "'Synthetic November Corrected'" null true fz1 1 "'correct'" null null; APPLY $SA "$RID"
ck "legitimate state verifies clean" "$(val "select count(*) filter (where not ok) from identity_audit.verify_ledger()")" "0"
q <<'SQL' >/dev/null
set role migrator;
begin;
insert into identity_audit.requests (id, participant_id, change_kind, status, requested_by, earliest_apply_at, apply_to_profile, new_full_name, reason, evidence, baseline, applying_txid)
  values ('11111111-1111-1111-1111-111111111111', (select id from public.participants where participant_code='PB'), 'name', 'pending',
          '00000000-0000-0000-0000-0000000000a1', now(), true, 'Synthetic Forged Name', 'forged request by a privileged writer', '[]', '{}', pg_current_xact_id()::text::bigint);
select identity_audit.record('11111111-1111-1111-1111-111111111111', 'certificate', c.id, c.id, c.participant_id, 'holder_name', c.holder_name, 'Synthetic Forged Name', '00000000-0000-0000-0000-0000000000a1')
  from public.certificates c where c.participant_id=(select id from public.participants where participant_code='PB');
select identity_audit.record('11111111-1111-1111-1111-111111111111', 'certificate', c.id, c.id, c.participant_id, 'participant_name', c.participant_name, 'Synthetic Forged Name', '00000000-0000-0000-0000-0000000000a1')
  from public.certificates c where c.participant_id=(select id from public.participants where participant_code='PB');
select identity_audit.record('11111111-1111-1111-1111-111111111111', 'snapshot', c.id, c.id, c.participant_id, 'holder_name', s.holder_name, 'Synthetic Forged Name', '00000000-0000-0000-0000-0000000000a1')
  from public.certificates c join public.certificate_issuance_snapshots s on s.certificate_id=c.id where c.participant_id=(select id from public.participants where participant_code='PB');
select identity_audit.record('11111111-1111-1111-1111-111111111111', 'snapshot_render_payload', c.id, c.id, c.participant_id, 'holder_name', s.render_payload->>'holder_name', 'Synthetic Forged Name', '00000000-0000-0000-0000-0000000000a1')
  from public.certificates c join public.certificate_issuance_snapshots s on s.certificate_id=c.id where c.participant_id=(select id from public.participants where participant_code='PB');
update public.certificates set holder_name='Synthetic Forged Name', participant_name='Synthetic Forged Name' where participant_id=(select id from public.participants where participant_code='PB');
update public.certificate_issuance_snapshots set holder_name='Synthetic Forged Name', render_payload=jsonb_set(render_payload,'{holder_name}','"Synthetic Forged Name"')
  where certificate_id=(select id from public.certificates where participant_id=(select id from public.participants where participant_code='PB'));
commit;
SQL
ck "the owner CAN forge inside one transaction (honest limit: prevention stops at the owner)" "$(val "select holder_name from public.certificates where participant_id=t.pid('PB')")" "Synthetic Forged Name"
ck "DETECT: the forged ledger rows are not covered by any anchor" "$(val "select ok from identity_audit.verify_ledger() where check_name='no_ledger_rows_beyond_latest_anchor'")" "f"
OUT=$(q <<'SQL'
set role migrator;
begin;
insert into identity_audit.requests (id, participant_id, change_kind, status, requested_by, earliest_apply_at, apply_to_profile, new_full_name, reason, evidence, baseline, applying_txid)
  values ('22222222-2222-2222-2222-222222222222', (select id from public.participants where participant_code='PD'), 'name', 'pending',
          '00000000-0000-0000-0000-0000000000a1', now(), true, 'Synthetic Authorized Name', 'authorisation scope probe request', '[]', '{}', pg_current_xact_id()::text::bigint);
select identity_audit.record('22222222-2222-2222-2222-222222222222', 'certificate', c.id, c.id, c.participant_id, 'holder_name', c.holder_name, 'Synthetic Authorized Name', '00000000-0000-0000-0000-0000000000a1')
  from public.certificates c where c.participant_id=(select id from public.participants where participant_code='PD');
update public.certificates set holder_name='Synthetic Different Name' where participant_id=(select id from public.participants where participant_code='PD');
rollback;
SQL
)
ckre "a ledger authorisation covers only the exact old->new pair it names (a different new value is refused)" "$OUT" "Modern certificate historical fields are immutable"

# ======================================================================================================
echo "== rollback and re-apply on a clean database"
DB="${DB_MAIN}_c"; createdb "$DB"
q < "$HERE/fixture.sql" >/dev/null; q < "$HERE/testdata.sql" >/dev/null
BASE=$(val "select md5(regexp_replace(pg_get_functiondef('app.certificate_historical_update_guard()'::regprocedure), '\s+', ' ', 'g'))")
for f in 01_identity_audit_schema.sql 02_identity_audit_helpers.sql 03_identity_correction_workflow.sql 04_guard_snapshot_identity.sql 05_guard_certificate_identity.sql 06_guard_participant_identity.sql; do apply $f >/dev/null; done
OUT=$(rollback 02_rollback.sql); ckre "02 rollback refused while guards still depend on it" "$OUT" "rollback refused"
OUT=$(rollback 01_rollback.sql); ckre "01 rollback refused while helpers are installed" "$OUT" "rollback refused"
for f in 06_rollback.sql 05_rollback.sql 04_rollback.sql 03_rollback.sql 02_rollback.sql; do OUT=$(rollback $f); cknre "$f runs cleanly" "$OUT" "ERROR"; done
ck "historical guard is back to the exact Production baseline" "$(val "select md5(regexp_replace(pg_get_functiondef('app.certificate_historical_update_guard()'::regprocedure), '\s+', ' ', 'g'))")" "$BASE"
ck "no identity guard trigger remains" "$(val "select count(*) from pg_trigger where tgname like '%identity_guard'")" "0"
ck "baseline behaviour is back: direct legacy update works again" "$(asq service_role "" "with u as (update public.certificates set holder_name='Synthetic Gap Probe' where participant_id=t.pid('PW') returning 1) select count(*) from u")" "1"
OUT=$(rollback 01_rollback.sql); cknre "01 rollback runs when no evidence exists" "$OUT" "ERROR"
ck "evidence schema is gone" "$(val "select count(*) from pg_namespace where nspname='identity_audit'")" "0"
for f in 01_identity_audit_schema.sql 02_identity_audit_helpers.sql 03_identity_correction_workflow.sql 04_guard_snapshot_identity.sql 05_guard_certificate_identity.sql 06_guard_participant_identity.sql; do
  OUT=$(apply $f); cknre "re-apply after full rollback: $f" "$OUT" "ERROR"
done
OUT=$(rollback 05_rollback.sql); cknre "05 rollback with an applied workflow present runs cleanly" "$OUT" "ERROR"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" = 0 ]
