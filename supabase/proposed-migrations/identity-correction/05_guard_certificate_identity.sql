-- PROPOSED (local only, NOT applied anywhere): certificate identity guards.
-- Two changes that belong together because they protect the same four columns:
--  (a) the CURRENT historical guard is replaced with itself, differing ONLY in four conditions
--      (participant_name, identity_last4, holder_name, identity_no): each such change is still refused
--      unless an identity-correction ledger row authorises that exact old->new change in this transaction.
--      Every other protected column is untouched, so no existing protection is weakened.
--  (b) a new guard covers certificates WITHOUT a snapshot (legacy rows), which the historical guard does
--      not protect today, for the same four columns.

do $$
declare v_md5 text;
begin
  if to_regprocedure('identity_audit.authorized(text,uuid,text,text,text)') is null then
    raise exception 'certificate guard pre-check failed: run 02_identity_audit_helpers.sql first';
  end if;
  if to_regprocedure('app.certificate_historical_update_guard()') is null then
    raise exception 'certificate guard pre-check failed: app.certificate_historical_update_guard() is missing';
  end if;
  -- Refuse to run if the live guard is neither the reviewed baseline nor this migration's own output
  -- (someone changed it since review). Baseline md5 was taken from the live project on 2026-11-06.
  v_md5 := pg_catalog.md5(regexp_replace(pg_get_functiondef('app.certificate_historical_update_guard()'::regprocedure), '\s+', ' ', 'g'));
  if v_md5 not in ('5fba4ed1890f4f0b211802a91f6e56ba', 'c0ff84db6fe8bb416bc7c551c9b58c97') then
    raise exception 'certificate guard pre-check failed: the live historical guard differs from the reviewed baseline (%)', v_md5;
  end if;
end $$;

create or replace function app.certificate_historical_update_guard() returns trigger
language plpgsql security definer set search_path to 'public', 'app', 'extensions' as
$function$
begin
  if exists (select 1 from public.certificate_issuance_snapshots s where s.certificate_id = old.id) then
    if new.certificate_no is distinct from old.certificate_no
      or (new.participant_name is distinct from old.participant_name
          and not identity_audit.authorized('certificate', old.id, 'participant_name', old.participant_name, new.participant_name))
      or (new.identity_last4 is distinct from old.identity_last4
          and not identity_audit.authorized('certificate', old.id, 'identity_last4', old.identity_last4, new.identity_last4))
      or new.course_name is distinct from old.course_name
      or new.course_code is distinct from old.course_code
      or new.schedule_code is distinct from old.schedule_code
      or new.exam_date is distinct from old.exam_date
      or new.training_start_date is distinct from old.training_start_date
      or new.training_end_date is distinct from old.training_end_date
      or new.participant_id is distinct from old.participant_id
      or new.course_id is distinct from old.course_id
      or new.schedule_id is distinct from old.schedule_id
      or new.template_id is distinct from old.template_id
      or (new.holder_name is distinct from old.holder_name
          and not identity_audit.authorized('certificate', old.id, 'holder_name', old.holder_name, new.holder_name))
      or (new.identity_no is distinct from old.identity_no
          and not identity_audit.authorized('certificate', old.id, 'identity_no', old.identity_no, new.identity_no))
      or new.trainer_name is distinct from old.trainer_name
      or new.instructor is distinct from old.instructor
      or new.venue is distinct from old.venue
      or new.branch_id is distinct from old.branch_id
      or new.branch_code is distinct from old.branch_code
      or new.branch_name is distinct from old.branch_name
      or new.branch_address is distinct from old.branch_address
      or new.effective_assessor_name is distinct from old.effective_assessor_name
      or new.participant_code_snapshot is distinct from old.participant_code_snapshot
      or new.company_snapshot is distinct from old.company_snapshot
      or new.issue_date is distinct from old.issue_date
      or new.certificate_number is distinct from old.certificate_number
      or new.verification_token is distinct from old.verification_token
      or new.verification_url is distinct from old.verification_url
      or new.issued_by is distinct from old.issued_by
      or new.replaces_certificate_id is distinct from old.replaces_certificate_id
      or new.certificate_file_url is distinct from old.certificate_file_url
      or new.metadata is distinct from old.metadata
      or new.legacy_batch_id is distinct from old.legacy_batch_id
    then
      raise exception 'Modern certificate historical fields are immutable.' using errcode = '22000';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function app.certificate_legacy_identity_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare v_f text;
begin
  if exists (select 1 from public.certificate_issuance_snapshots s where s.certificate_id = old.id) then
    return new; -- snapshot-backed rows are covered by app.certificate_historical_update_guard()
  end if;
  foreach v_f in array array['holder_name', 'participant_name', 'identity_no', 'identity_last4'] loop
    if (pg_catalog.to_jsonb(new) ->> v_f) is distinct from (pg_catalog.to_jsonb(old) ->> v_f)
       and not identity_audit.authorized('certificate', old.id, v_f, pg_catalog.to_jsonb(old) ->> v_f, pg_catalog.to_jsonb(new) ->> v_f) then
      raise exception 'IDC_CORRECTION_REQUIRED: certificate field % can only change through an approved correction.', v_f using errcode = '22000';
    end if;
  end loop;
  return new;
end $$;

revoke all on function app.certificate_historical_update_guard() from public, anon, authenticated, service_role;
revoke all on function app.certificate_legacy_identity_guard() from public, anon, authenticated, service_role;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_certificate_legacy_identity_guard' and tgrelid = 'public.certificates'::regclass) then
    create trigger trg_certificate_legacy_identity_guard
      before update of holder_name, participant_name, identity_no, identity_last4 on public.certificates
      for each row execute function app.certificate_legacy_identity_guard();
  end if;
end $$;
