-- ROLLBACK for 02_identity_audit_helpers.sql (local only). Refuses while any guard still depends on
-- identity_audit.authorized(): roll back 06, 05 and 04 first.
do $$
begin
  if exists (select 1 from pg_trigger where tgname in ('trg_participant_identity_guard', 'trg_certificate_legacy_identity_guard', 'trg_snapshot_identity_guard')) then
    raise exception 'rollback refused: guard triggers still installed; roll back 06, 05 and 04 first';
  end if;
  if pg_catalog.md5(regexp_replace(pg_get_functiondef('app.certificate_historical_update_guard()'::regprocedure), '\s+', ' ', 'g'))
     <> '5fba4ed1890f4f0b211802a91f6e56ba' then
    raise exception 'rollback refused: the historical guard still references identity_audit; run the 05 rollback first';
  end if;
end $$;
drop function if exists identity_audit.verify_ledger();
drop function if exists identity_audit.record_anchor();
drop function if exists identity_audit.guard_fingerprint();
drop function if exists identity_audit.validate_identity_change(uuid, text);
drop function if exists identity_audit.authorized(text, uuid, text, text, text);
drop function if exists identity_audit.record(uuid, text, uuid, uuid, uuid, text, text, text, uuid);
drop function if exists identity_audit.seal(text);
drop function if exists identity_audit.controls_ready();
drop function if exists identity_audit.compute_row_hash(bigint, uuid, text, uuid, text, text, text, bytea, bytea, bigint, uuid, timestamptz, text);
drop function if exists identity_audit.fp(text, text);
drop function if exists identity_audit.norm(text);
