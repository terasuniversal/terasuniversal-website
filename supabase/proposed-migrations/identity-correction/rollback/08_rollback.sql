-- ROLLBACK for 08_request_text_guard.sql (local only). Removes the free-text guard triggers and their two functions.
-- It touches no evidence: request rows, the ledger and every anchor are preserved. The pure detection helpers belong to 02
-- and stay. Run it before the 07 and 02 rollbacks.
--
-- Anchor continuity: removing the guard changes the guard fingerprint back. That transition is anchored ONLY when the audit
-- state was clean before the rollback and the only objects that changed are 08's own four; otherwise no anchor is recorded
-- and verify_ledger() keeps reporting the difference (a rollback never approves unrelated drift).
begin;

create temporary table _idc_before on commit drop as
  select identity_audit.guard_snapshot() as snap, identity_audit.guard_state_clean() as clean;

drop trigger if exists requests_text_guard on identity_audit.requests;
drop trigger if exists request_certificates_text_guard on identity_audit.request_certificates;
drop function if exists identity_audit.requests_text_guard();
drop function if exists identity_audit.request_certificates_text_guard();

select identity_audit.finish_guard_transition((select snap from _idc_before),
  array['fn:identity_audit.requests_text_guard()', 'fn:identity_audit.request_certificates_text_guard()',
        'trg:identity_audit.requests.requests_text_guard', 'trg:identity_audit.request_certificates.request_certificates_text_guard'],
  (select clean from _idc_before), false);

commit;
