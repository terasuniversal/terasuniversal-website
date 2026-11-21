-- PROPOSED (local only, NOT applied anywhere): tighten certificate_issuance_snapshots.
-- One logical change: today a snapshot is protected only by privileges/RLS (authenticated has SELECT only;
-- postgres and service_role can still UPDATE/DELETE). This trigger makes the snapshot immutable for every
-- role except through an authorised identity-correction ledger row, and only for holder_name / identity_no /
-- identity_last4 and the matching render_payload keys. DELETE is always refused (the FK to certificates is
-- ON DELETE RESTRICT, so no legitimate cascade exists). This never relaxes an existing protection.

do $$
begin
  if to_regprocedure('identity_audit.authorized(text,uuid,text,text,text)') is null then
    raise exception 'snapshot guard pre-check failed: run 02_identity_audit_helpers.sql first';
  end if;
  if to_regclass('public.certificate_issuance_snapshots') is null then
    raise exception 'snapshot guard pre-check failed: certificate_issuance_snapshots is missing';
  end if;
  if exists (select 1 from pg_trigger t where t.tgrelid = 'public.certificate_issuance_snapshots'::regclass
               and t.tgname = 'trg_snapshot_identity_guard') <>
     (to_regprocedure('app.snapshot_identity_guard()') is not null) then
    raise exception 'snapshot guard pre-check failed: function and trigger are in a half-installed state';
  end if;
end $$;

create or replace function app.snapshot_identity_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
declare v_f text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Issuance snapshots are immutable.' using errcode = '22000';
  end if;
  if (pg_catalog.to_jsonb(new) - array['holder_name', 'identity_no', 'identity_last4', 'render_payload'])
     is distinct from (pg_catalog.to_jsonb(old) - array['holder_name', 'identity_no', 'identity_last4', 'render_payload']) then
    raise exception 'Issuance snapshot fields are immutable.' using errcode = '22000';
  end if;
  if (new.render_payload - array['holder_name', 'identity_no']) is distinct from (old.render_payload - array['holder_name', 'identity_no']) then
    raise exception 'Issuance snapshot render payload is immutable.' using errcode = '22000';
  end if;
  foreach v_f in array array['holder_name', 'identity_no', 'identity_last4'] loop
    if (pg_catalog.to_jsonb(new) ->> v_f) is distinct from (pg_catalog.to_jsonb(old) ->> v_f)
       and not identity_audit.authorized('snapshot', old.certificate_id, v_f, pg_catalog.to_jsonb(old) ->> v_f, pg_catalog.to_jsonb(new) ->> v_f) then
      raise exception 'IDC_CORRECTION_REQUIRED: snapshot field % can only change through an approved correction.', v_f using errcode = '22000';
    end if;
  end loop;
  foreach v_f in array array['holder_name', 'identity_no'] loop
    if (new.render_payload -> v_f) is distinct from (old.render_payload -> v_f) then
      if (new.render_payload ? v_f) is distinct from (old.render_payload ? v_f)
         or pg_catalog.jsonb_typeof(new.render_payload -> v_f) is distinct from pg_catalog.jsonb_typeof(old.render_payload -> v_f) then
        raise exception 'Issuance snapshot render payload shape is immutable.' using errcode = '22000';
      end if;
      if not identity_audit.authorized('snapshot_render_payload', old.certificate_id, v_f, old.render_payload ->> v_f, new.render_payload ->> v_f) then
        raise exception 'IDC_CORRECTION_REQUIRED: snapshot render payload key % can only change through an approved correction.', v_f using errcode = '22000';
      end if;
    end if;
  end loop;
  return new;
end $$;

revoke all on function app.snapshot_identity_guard() from public, anon, authenticated, service_role;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_snapshot_identity_guard'
                   and tgrelid = 'public.certificate_issuance_snapshots'::regclass) then
    create trigger trg_snapshot_identity_guard before update or delete on public.certificate_issuance_snapshots
      for each row execute function app.snapshot_identity_guard();
  end if;
end $$;
