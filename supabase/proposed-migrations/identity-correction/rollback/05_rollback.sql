-- ROLLBACK for 05_guard_certificate_identity.sql (local only). Restores the reviewed Production
-- baseline of app.certificate_historical_update_guard() verbatim and removes the legacy identity guard.
drop trigger if exists trg_certificate_legacy_identity_guard on public.certificates;
drop function if exists app.certificate_legacy_identity_guard();

create or replace function app.certificate_historical_update_guard() returns trigger
language plpgsql security definer set search_path to 'public', 'app', 'extensions' as
$function$
begin
  if exists (select 1 from public.certificate_issuance_snapshots s where s.certificate_id = old.id) then
    if new.certificate_no is distinct from old.certificate_no
      or new.participant_name is distinct from old.participant_name
      or new.identity_last4 is distinct from old.identity_last4
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
      or new.holder_name is distinct from old.holder_name
      or new.identity_no is distinct from old.identity_no
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

do $$
begin
  if pg_catalog.md5(regexp_replace(pg_get_functiondef('app.certificate_historical_update_guard()'::regprocedure), '\s+', ' ', 'g'))
     <> '5fba4ed1890f4f0b211802a91f6e56ba' then
    raise exception 'rollback post-check failed: the restored guard does not match the reviewed baseline';
  end if;
end $$;
