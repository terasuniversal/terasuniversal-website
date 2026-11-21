-- ROLLBACK for 09_external_evidence.sql (local only). Removes the evidence functions, the gate and the policy windows.
-- Refuses to run while any acknowledgement or verification row exists: that is evidence of what the external store holds, and
-- dropping it needs an offline export and explicit owner sign-off (CLAUDE.md section 11 rule 5). The two NOLOGIN group roles are
-- cluster-level objects owned by the owner's custody procedure and are left in place (all their privileges disappear with the functions).
--
-- Anchor continuity: removing the gate and functions changes the guard fingerprint back. That transition is anchored ONLY when the
-- audit state was clean beforehand and the only objects that changed are 09's own seven; otherwise a warning is raised and no anchor
-- is recorded, so drift stays visible.
begin;

do $$
begin
  if exists (select 1 from identity_audit.evidence_acks) or exists (select 1 from identity_audit.evidence_verifications) then
    raise exception 'rollback refused: evidence acknowledgements or verifications exist; export them and obtain owner sign-off first';
  end if;
end $$;

create temporary table _idc_before on commit drop as
  select identity_audit.guard_snapshot() as snap, identity_audit.guard_state_clean() as clean;

drop trigger if exists requests_evidence_gate_ins on identity_audit.requests;
drop trigger if exists requests_evidence_gate_apply on identity_audit.requests;
drop function if exists identity_audit.evidence_gate();
drop function if exists identity_audit.external_evidence_ready();
drop function if exists public.identity_evidence_snapshot();
drop function if exists public.identity_evidence_ack(bigint, bigint, text, text);
drop function if exists public.identity_evidence_heartbeat(text, bigint, text, bigint, text[]);
drop table if exists identity_audit.evidence_verifications;
drop table if exists identity_audit.evidence_acks;
alter table identity_audit.policy drop constraint if exists policy_evidence_windows_positive;
alter table identity_audit.policy drop column if exists verification_max_age;
alter table identity_audit.policy drop column if exists max_requests_per_day;

select identity_audit.finish_guard_transition((select snap from _idc_before),
  array['fn:identity_audit.evidence_gate()', 'fn:identity_audit.external_evidence_ready()',
        'fn:public.identity_evidence_snapshot()', 'fn:public.identity_evidence_ack(bigint,bigint,text,text)',
        'fn:public.identity_evidence_heartbeat(text,bigint,text,bigint,text[])',
        'trg:identity_audit.requests.requests_evidence_gate_ins', 'trg:identity_audit.requests.requests_evidence_gate_apply'],
  (select clean from _idc_before), false);

commit;
