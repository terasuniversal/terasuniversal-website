#!/usr/bin/env bash
# Builds a throwaway Supabase Postgres container (--network none, no published ports) at the Production schema state
# of 2026-11-24 (history 171): Baseline V3 bootstrap + every repo migration after 20260912005428 and BEFORE the RBAC
# set under test (versions >= 20261201100000 are never applied here), then aligns function ACLs to the read-only
# Production snapshot and adds the one Production-only column relevant to the RBAC surface.
# Proven equal to Production afterwards with fingerprint_buckets.sql (see RBAC evidence).
# Usage: bash supabase/tests/crm_rbac/build_fixture.sh <container>
set -u; export MSYS_NO_PATHCONV=1
C=${1:-rbacdev}
RBAC_FIRST=20261201100000
ROOT=$(cd "$(dirname "$0")/../../.." && pwd); cd "$ROOT"
IMG=public.ecr.aws/supabase/postgres:17.6.1.166
MS7_SURFACE='^(record_manual_payment|generate_receipt_for_payment|record_toyyibpay_bill|mark_toyyibpay_attempt_superseded|get_active_toyyibpay_attempt|log_toyyibpay_conflict|record_hrdf_payment|transition_hrdf_claim|finalize_toyyibpay_payment|mark_toyyibpay_attempt_failed|reverse_won_opportunity|next_marketing_contact_number)(_unguarded)?$'
docker rm -f $C >/dev/null 2>&1
docker run -d --name $C --network none -e POSTGRES_PASSWORD=local $IMG >/dev/null || exit 1
for i in $(seq 1 90); do docker exec $C pg_isready -U postgres -h localhost >/dev/null 2>&1 && break; sleep 2; done; sleep 4
q(){ docker exec -i $C psql -U postgres -h localhost -X -q -v ON_ERROR_STOP=1 "$@"; }
q < supabase/tests/crm_rbac/00_platform.sql >/dev/null || { echo "FAIL platform"; exit 1; }
q < supabase/baseline/v3/bootstrap.sql >/dev/null 2>&1 || { echo "FAIL bootstrap"; exit 1; }
for f in $(ls supabase/migrations/ | grep -E '^[0-9]{14}_.*\.sql$' | awk -F_ '$1>"20260912005428"' | sort); do
  v=${f%%_*}; [ "$v" \< "$RBAC_FIRST" ] || break
  # Storage tables come from the storage service, which this fixture does not run; that bucket migration is outside RBAC scope.
  [ "$f" = 20261103085009_production_certificate_render_assets_bucket.sql ] && { echo "skip $f (no Storage service in fixture)"; continue; }
  [ "$v" = 20261102030425 ] && q < supabase/tests/crm_rbac/01_seed_wah_binding.sql >/dev/null
  # Website PKG-1 grants were applied to Production outside this repo; align them (not the M-S7/G1 surface) before M-S7.
  [ "$v" = 20261123090000 ] && node supabase/tests/crm_rbac/gen_acl_align.mjs "$MS7_SURFACE" | q >/dev/null
  if out=$(q -1 < supabase/migrations/$f 2>&1); then
    echo "ok   $f"; q -c "insert into supabase_migrations.schema_migrations(version,name) values ('$v','${f#*_}')" >/dev/null
  else echo "FAIL $f: $(echo "$out" | grep ERROR | head -1)"; fi
done
# Final state: every function ACL equals the Production snapshot (verified afterwards by fingerprint).
node supabase/tests/crm_rbac/gen_acl_align.mjs | q >/dev/null && echo "ok   function ACLs aligned to Production snapshot"
# Production-only object relevant to the RBAC surface that is not in the repo ledger
# (20260917160558 quotation_training_snapshot_v1: one column). The certificate public RPC surface 20260924170000 is
# outside RBAC scope and intentionally absent (recorded as a fixture limitation).
q -c "alter table public.sales_quotations add column if not exists training_details jsonb not null default '{}'::jsonb" >/dev/null && echo "ok   overlay sales_quotations.training_details"
