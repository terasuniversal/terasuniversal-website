-- C2C: Database enforcement for immutable modern certificate history.
-- Forward-only, additive, and intentionally does not backfill or rewrite data.
-- Apply to Canonical Staging first; Production is out of scope.

begin;

create or replace function app.certificate_historical_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions
as $$
begin
  -- Legacy rows remain compatible with the existing pre-C2 policy. Once a
  -- modern issuance snapshot exists, the certificate row is historical data.
  if exists (
    select 1
    from public.certificate_issuance_snapshots s
    where s.certificate_id = old.id
  ) then
    if new.certificate_no is distinct from old.certificate_no
      or new.participant_name is distinct from old.participant_name
      or new.identity_last4 is distinct from old.identity_last4
      or new.course_name is distinct from old.course_name
      or new.course_code is distinct from old.course_code
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
      raise exception 'Modern certificate historical fields are immutable.'
        using errcode = '22000';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function app.certificate_historical_update_guard() from public;

drop trigger if exists trg_certificate_historical_update_guard on public.certificates;
create trigger trg_certificate_historical_update_guard
  before update on public.certificates
  for each row execute function app.certificate_historical_update_guard();

-- Ordinary CRM identities may read certificates. All writes, including
-- operational lifecycle changes, go through explicit SECURITY DEFINER RPCs.
revoke all on public.certificates from anon, authenticated;
grant select on public.certificates to authenticated;

drop policy if exists certificates_insert on public.certificates;
drop policy if exists certificates_delete on public.certificates;
drop policy if exists certificates_update on public.certificates;

-- Keep this policy name explicit for the focused contract: there is no DELETE
-- policy and no authenticated DELETE privilege after this migration.
comment on table public.certificates is
  'Certificate rows are historically immutable after issuance snapshot capture; all lifecycle changes use approved RPCs.';

-- Harden the existing duplicate flow without changing its identity semantics.
-- Modern sources carry their own issuance snapshot forward; legacy sources do
-- not receive fabricated historical data.
create or replace function app.duplicate_certificate_with_skill_snapshot(
  p_source_certificate_id uuid
)
returns table (id uuid, verification_token text)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_src public.certificates%rowtype;
  v_src_snapshot public.certificate_issuance_snapshots%rowtype;
  v_new_id uuid;
  v_token text;
  v_has_snapshot boolean;
  r record;
begin
  if v_actor is null or not app.is_active() or not app.is_admin()
    or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to duplicate certificates.' using errcode = '42501';
  end if;

  select * into v_src
  from public.certificates cert
  where cert.id = p_source_certificate_id
  for update;
  if not found or v_src.deleted_at is not null then
    raise exception 'Source certificate not found.' using errcode = 'P0002';
  end if;

  select * into v_src_snapshot
  from public.certificate_issuance_snapshots s
  where s.certificate_id = p_source_certificate_id;
  v_has_snapshot := found;

  insert into public.certificates (
    participant_id, schedule_id, course_id, template_id, holder_name, status,
    issue_date, issued_by, expiry_date, remarks
  ) values (
    v_src.participant_id, v_src.schedule_id, v_src.course_id, v_src.template_id, v_src.holder_name, 'draft',
    current_date, v_actor, v_src.expiry_date, v_src.remarks
  )
  returning certificates.id, certificates.verification_token into v_new_id, v_token;

  -- The new row has no issuance snapshot yet, so the C2C historical guard
  -- permits this initialization update. It becomes immutable below.
  update public.certificates
  set verification_url = '/verify/' || v_token
  where certificates.id = v_new_id;

  for r in
    select area, status, score, notes, source_skill_result_id
    from public.certificate_skill_results
    where certificate_id = p_source_certificate_id
  loop
    insert into public.certificate_skill_results (certificate_id, area, status, score, notes, source_skill_result_id)
    values (v_new_id, r.area, r.status, r.score, r.notes, r.source_skill_result_id);
  end loop;

  if v_has_snapshot then
    insert into public.certificate_issuance_snapshots (
      certificate_id, snapshot_version, renderer_version,
      holder_name, identity_no, identity_last4, course_name,
      training_start_date, training_end_date, venue, trainer_name,
      template_id, template_name, template_config, signature_reference,
      verification_metadata, render_payload, created_by
    )
    select
      c.id, v_src_snapshot.snapshot_version, v_src_snapshot.renderer_version,
      c.holder_name, c.identity_no, c.identity_last4, c.course_name,
      c.training_start_date, c.training_end_date, c.venue, c.trainer_name,
      c.template_id, v_src_snapshot.template_name, v_src_snapshot.template_config,
      v_src_snapshot.signature_reference,
      coalesce(v_src_snapshot.verification_metadata, '{}'::jsonb) || jsonb_build_object(
        'certificate_number', c.certificate_number,
        'verification_token', c.verification_token,
        'verification_path', c.verification_url,
        'verification_enabled', c.verification_enabled,
        'public_verification_enabled', c.public_verification_enabled
      ),
      coalesce(v_src_snapshot.render_payload, '{}'::jsonb) || jsonb_build_object(
        'certificate_number', c.certificate_number,
        'holder_name', c.holder_name,
        'identity_no', c.identity_no,
        'course_name', c.course_name,
        'training_start_date', c.training_start_date,
        'training_end_date', c.training_end_date,
        'venue', c.venue,
        'trainer_name', c.trainer_name,
        'issue_date', c.issue_date,
        'skills_record', coalesce((
          select jsonb_agg(jsonb_build_object('area', s.area, 'status', s.status, 'score', s.score, 'notes', s.notes) order by s.area)
          from public.certificate_skill_results s where s.certificate_id = c.id
        ), '[]'::jsonb)
      ),
      v_actor
    from public.certificates c
    where c.id = v_new_id;
  end if;

  return query select v_new_id, v_token;
end;
$$;

revoke all on function app.duplicate_certificate_with_skill_snapshot(uuid) from public;
grant execute on function app.duplicate_certificate_with_skill_snapshot(uuid) to authenticated;

create or replace function app.revoke_certificate(
  p_certificate_id uuid,
  p_remarks text default null
)
returns void
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_deleted_at timestamptz;
begin
  if v_actor is null or not app.is_active() or not app.is_admin()
    or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to revoke certificates.' using errcode = '42501';
  end if;
  select deleted_at into v_deleted_at
  from public.certificates where id = p_certificate_id for update;
  if not found or v_deleted_at is not null then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;
  update public.certificates
  set status = 'revoked', remarks = p_remarks
  where id = p_certificate_id;
end;
$$;

create or replace function app.update_certificate_metadata(
  p_certificate_id uuid,
  p_expiry_date date default null,
  p_remarks text default null
)
returns void
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not app.is_active() or not app.is_admin()
    or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to update certificate metadata.' using errcode = '42501';
  end if;
  perform 1 from public.certificates
  where id = p_certificate_id and deleted_at is null for update;
  if not found then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;
  update public.certificates
  set expiry_date = p_expiry_date, remarks = p_remarks
  where id = p_certificate_id;
end;
$$;

create or replace function app.set_certificate_deleted(
  p_certificate_id uuid,
  p_deleted boolean
)
returns void
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not app.is_active() or not app.is_admin()
    or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to change certificate deletion state.' using errcode = '42501';
  end if;
  perform 1 from public.certificates where id = p_certificate_id for update;
  if not found then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;
  update public.certificates
  set deleted_at = case when p_deleted then now() else null end
  where id = p_certificate_id;
end;
$$;

create or replace function app.set_certificate_verification_enabled(
  p_certificate_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not app.is_active() or not app.is_admin()
    or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to update verification settings.' using errcode = '42501';
  end if;
  perform 1 from public.certificates
  where id = p_certificate_id and deleted_at is null for update;
  if not found then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;
  update public.certificates
  set verification_enabled = p_enabled
  where id = p_certificate_id;
end;
$$;

revoke all on function app.revoke_certificate(uuid, text) from public;
revoke all on function app.update_certificate_metadata(uuid, date, text) from public;
revoke all on function app.set_certificate_deleted(uuid, boolean) from public;
revoke all on function app.set_certificate_verification_enabled(uuid, boolean) from public;
grant execute on function app.revoke_certificate(uuid, text) to authenticated;
grant execute on function app.update_certificate_metadata(uuid, date, text) to authenticated;
grant execute on function app.set_certificate_deleted(uuid, boolean) to authenticated;
grant execute on function app.set_certificate_verification_enabled(uuid, boolean) to authenticated;

-- Legacy import remains a separate, explicit contract. It intentionally does
-- not create eligibility, skills, or issuance snapshots.
create or replace function app.import_legacy_certificate(
  p_participant_id uuid,
  p_course_id uuid,
  p_certificate jsonb
)
returns table (id uuid, certificate_number text, verification_token text)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_id uuid;
  v_certificate_number text;
  v_token text;
  v_status text := coalesce(nullif(btrim(p_certificate->>'status'), ''), 'valid');
  v_certificate_no text := nullif(btrim(p_certificate->>'certificate_no'), '');
  v_participant_name text := nullif(btrim(p_certificate->>'participant_name'), '');
  v_course_name text := nullif(btrim(p_certificate->>'course_name'), '');
  v_course_date date;
  v_course_end_date date;
  v_expiry_date date;
begin
  if not app.is_active() or not app.is_admin() or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to import legacy certificates.' using errcode = '42501';
  end if;
  if v_certificate_no is null or v_participant_name is null or v_course_name is null then
    raise exception 'Legacy certificate provenance fields are required.' using errcode = '22023';
  end if;
  if v_status not in ('valid', 'expired', 'revoked') then
    raise exception 'Invalid legacy certificate status.' using errcode = '22023';
  end if;

  begin
    v_course_date := nullif(btrim(p_certificate->>'course_date'), '')::date;
    v_course_end_date := nullif(btrim(p_certificate->>'course_end_date'), '')::date;
    v_expiry_date := nullif(btrim(p_certificate->>'expiry_date'), '')::date;
  exception when others then
    raise exception 'Invalid legacy certificate date.' using errcode = '22023';
  end;
  if v_course_date is null then
    raise exception 'Legacy certificate issue date is required.' using errcode = '22023';
  end if;
  if v_course_end_date is not null and v_course_end_date < v_course_date then
    raise exception 'Legacy certificate end date cannot precede its start date.' using errcode = '22023';
  end if;

  insert into public.certificates (
    certificate_no, participant_name, identity_last4, course_name,
    training_start_date, training_end_date, issue_date, expiry_date, status,
    trainer_name, venue, participant_id, course_id, identity_no, instructor,
    certificate_file_url, public_verification_enabled, metadata
  ) values (
    upper(v_certificate_no), v_participant_name,
    right(nullif(btrim(p_certificate->>'identity_no'), ''), 4), v_course_name,
    v_course_date, v_course_end_date, v_course_date, v_expiry_date, v_status,
    nullif(btrim(p_certificate->>'instructor'), ''),
    nullif(btrim(p_certificate->>'venue'), ''), p_participant_id, p_course_id,
    upper(nullif(btrim(p_certificate->>'identity_no'), '')),
    nullif(btrim(p_certificate->>'instructor'), ''),
    nullif(btrim(p_certificate->>'certificate_file_url'), ''),
    coalesce((p_certificate->>'public_verification_enabled')::boolean, true),
    jsonb_set(coalesce(p_certificate->'metadata', '{}'::jsonb), '{provenance}', '"legacy_import"'::jsonb, true)
  )
  returning certificates.id, certificates.certificate_number, certificates.verification_token
  into v_id, v_certificate_number, v_token;

  return query select v_id, v_certificate_number, v_token;
end;
$$;

revoke all on function app.import_legacy_certificate(uuid, uuid, jsonb) from public;
grant execute on function app.import_legacy_certificate(uuid, uuid, jsonb) to authenticated;

-- PostgREST exposes the public schema by default. Keep the implementation in
-- app and expose only this narrow, explicitly named legacy-import wrapper.
create or replace function public.import_legacy_certificate(
  p_participant_id uuid,
  p_course_id uuid,
  p_certificate jsonb
)
returns table (id uuid, certificate_number text, verification_token text)
language sql
security invoker
set search_path = public, app, extensions
as $$
  select * from app.import_legacy_certificate(p_participant_id, p_course_id, p_certificate);
$$;

revoke all on function public.import_legacy_certificate(uuid, uuid, jsonb) from public;
grant execute on function public.import_legacy_certificate(uuid, uuid, jsonb) to authenticated;

-- Explicitly remove broad physical-deletion and direct-insert privileges from
-- ordinary API roles. SECURITY DEFINER issuance, duplicate, and legacy-import
-- functions remain callable through their individually granted EXECUTE rights.
revoke insert, delete, truncate on public.certificates from anon, authenticated;

commit;
