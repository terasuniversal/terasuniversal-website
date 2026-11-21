-- PROPOSED (local only, NOT applied anywhere): stop ordinary profile edits from silently changing the
-- identity of a participant who already holds certificates.
-- Behaviour change for CRM users (see README): for a participant with at least one non-deleted
-- certificate, changes to full_name / ic_passport_no / identity_no / identity_last4 are refused unless an
-- approved identity-correction ledger row authorises that exact change. Participants without certificates,
-- and every other column (email, phone, company, deleted_at, ...), are unaffected.

do $$
begin
  if to_regprocedure('identity_audit.authorized(text,uuid,text,text,text)') is null then
    raise exception 'participant guard pre-check failed: run 02_identity_audit_helpers.sql first';
  end if;
  if exists (select 1 from pg_trigger t where t.tgrelid = 'public.participants'::regclass and t.tgname = 'trg_participant_identity_guard') <>
     (to_regprocedure('app.participant_identity_guard()') is not null) then
    raise exception 'participant guard pre-check failed: function and trigger are in a half-installed state';
  end if;
end $$;

create or replace function app.participant_identity_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare v_f text;
begin
  if new.full_name is not distinct from old.full_name and new.ic_passport_no is not distinct from old.ic_passport_no
     and new.identity_no is not distinct from old.identity_no and new.identity_last4 is not distinct from old.identity_last4 then
    return new;
  end if;
  if not exists (select 1 from public.certificates c where c.participant_id = old.id and c.deleted_at is null) then
    return new;
  end if;
  foreach v_f in array array['full_name', 'ic_passport_no', 'identity_no', 'identity_last4'] loop
    if (pg_catalog.to_jsonb(new) ->> v_f) is distinct from (pg_catalog.to_jsonb(old) ->> v_f)
       and not identity_audit.authorized('participant', old.id, v_f, pg_catalog.to_jsonb(old) ->> v_f, pg_catalog.to_jsonb(new) ->> v_f) then
      raise exception 'IDC_CORRECTION_REQUIRED: this participant already holds certificates; % can only change through an approved correction.', v_f
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

revoke all on function app.participant_identity_guard() from public, anon, authenticated, service_role;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_participant_identity_guard' and tgrelid = 'public.participants'::regclass) then
    create trigger trg_participant_identity_guard
      before update of full_name, ic_passport_no, identity_no, identity_last4 on public.participants
      for each row execute function app.participant_identity_guard();
  end if;
end $$;
