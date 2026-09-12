-- C2A: Historical certificate integrity contract.
-- Forward-only. This migration intentionally does not backfill legacy rows.
-- Apply to Canonical Staging first; Production is out of scope.

begin;

-- A replacement is a new certificate identity linked to the original. The
-- original row remains intact; status vocabulary is deliberately unchanged.
alter table public.certificates
  add column if not exists replaces_certificate_id uuid
    references public.certificates (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.certificates'::regclass
      and conname = 'certificates_not_self_replacement'
  ) then
    alter table public.certificates
      add constraint certificates_not_self_replacement
      check (replaces_certificate_id is null or replaces_certificate_id <> id);
  end if;
end;
$$;

create index if not exists certificates_replaces_certificate_idx
  on public.certificates (replaces_certificate_id)
  where replaces_certificate_id is not null;

-- One immutable rendering/document snapshot per modern issuance. The
-- structured columns support stable querying; JSONB preserves the complete
-- renderer/template contract for C2B without coupling this migration to UI.
create table if not exists public.certificate_issuance_snapshots (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null
    references public.certificates (id) on delete restrict,
  snapshot_version integer not null default 1
    check (snapshot_version > 0),
  renderer_version text not null default 'certificate_renderer_v1',
  holder_name text not null,
  identity_no text,
  identity_last4 text,
  course_name text not null,
  training_start_date date,
  training_end_date date,
  venue text,
  trainer_name text,
  template_id uuid,
  template_name text,
  template_config jsonb not null default '{}'::jsonb,
  signature_reference text,
  verification_metadata jsonb not null default '{}'::jsonb,
  render_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  constraint certificate_issuance_snapshots_certificate_key unique (certificate_id),
  constraint certificate_issuance_snapshots_template_fk
    foreign key (template_id) references public.certificate_templates (id) on delete set null,
  constraint certificate_issuance_snapshots_created_by_fk
    foreign key (created_by) references auth.users (id) on delete set null
);

comment on table public.certificate_issuance_snapshots is
  'Immutable rendering/document snapshot captured by modern certificate issuance. Legacy certificates are intentionally not backfilled.';
comment on column public.certificate_issuance_snapshots.renderer_version is
  'Stable renderer contract identifier. C2B must render from the captured contract rather than current template state.';

-- Reprint/reissue is an event on the same certificate identity, not a new
-- certificate and not an update to the original issue date.
create table if not exists public.certificate_reissue_events (
  id uuid primary key default gen_random_uuid(),
  certificate_id uuid not null
    references public.certificates (id) on delete restrict,
  reissued_at timestamptz not null default now(),
  reissued_by uuid not null references auth.users (id) on delete restrict,
  reason text,
  event_type text not null default 'reissue',
  notes jsonb not null default '{}'::jsonb,
  constraint certificate_reissue_events_type_check
    check (event_type in ('reprint', 'reissue'))
);

comment on table public.certificate_reissue_events is
  'Append-only audit events for reprint/reissue of an existing certificate identity.';

alter table public.certificate_issuance_snapshots enable row level security;
alter table public.certificate_issuance_snapshots force row level security;
alter table public.certificate_reissue_events enable row level security;
alter table public.certificate_reissue_events force row level security;

revoke all on public.certificate_issuance_snapshots from anon, authenticated;
grant select on public.certificate_issuance_snapshots to authenticated;
revoke all on public.certificate_reissue_events from anon, authenticated;
grant select on public.certificate_reissue_events to authenticated;

drop policy if exists certificate_issuance_snapshots_read on public.certificate_issuance_snapshots;
create policy certificate_issuance_snapshots_read
  on public.certificate_issuance_snapshots
  for select to authenticated
  using (public.has_module_access('certificates'));

drop policy if exists certificate_reissue_events_read on public.certificate_reissue_events;
create policy certificate_reissue_events_read
  on public.certificate_reissue_events
  for select to authenticated
  using (public.has_module_access('certificates'));

-- The existing issuance RPC is retained as the canonical entry point and is
-- extended so certificate, verification metadata, skill rows, and document
-- snapshot are one transaction. verification_url is relative by design: SQL
-- does not assume a deployment origin.
create or replace function app.issue_certificate_with_skill_snapshot(
  p_schedule_id uuid,
  p_participant_id uuid,
  p_certificate_number text default null
)
returns table (id uuid, verification_token text)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_elig public.v_certificate_eligibility%rowtype;
  v_cert_id uuid;
  v_token text;
  v_area text;
  v_status text;
  v_score numeric;
  v_notes text;
  v_src_id uuid;
  v_template_name text;
  v_template_config jsonb := '{}'::jsonb;
  v_signature_reference text;
begin
  if not app.is_active() or not app.is_admin() or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to issue certificates.' using errcode = '42501';
  end if;

  select * into v_elig
  from public.v_certificate_eligibility
  where schedule_id = p_schedule_id and participant_id = p_participant_id;

  if not found or not v_elig.eligible then
    raise exception 'Not eligible: %', coalesce(v_elig.ineligibility_reason, 'no_eligibility_row') using errcode = 'P0001';
  end if;

  insert into public.certificates (
    participant_id, schedule_id, course_id, template_id,
    certificate_number, holder_name, participant_name, course_name,
    training_start_date, training_end_date, venue, trainer_name,
    status, issue_date, issued_by
  ) values (
    p_participant_id, p_schedule_id, v_elig.course_id, v_elig.certificate_template_id,
    p_certificate_number, v_elig.holder_name, v_elig.holder_name, v_elig.course_name,
    v_elig.schedule_start_date, v_elig.schedule_end_date, v_elig.venue, v_elig.trainer_name,
    'valid', current_date, auth.uid()
  )
  returning certificates.id, certificates.verification_token into v_cert_id, v_token;

  -- Complete verification metadata inside this same transaction. The trigger
  -- supplies the token; the relative path is stable across environments.
  update public.certificates
  set verification_url = '/verify/' || v_token
  where certificates.id = v_cert_id;

  foreach v_area in array array['theory_session', 'practical_training', 'safety_awareness', 'practical_assessment']
  loop
    select psr.status, psr.score, psr.notes, psr.id
      into v_status, v_score, v_notes, v_src_id
    from public.participant_skill_results psr
    where psr.schedule_id = p_schedule_id
      and psr.participant_id = p_participant_id
      and psr.area = v_area
      and psr.deleted_at is null;

    insert into public.certificate_skill_results (certificate_id, area, status, score, notes, source_skill_result_id)
    values (v_cert_id, v_area, coalesce(v_status, 'not_recorded'), v_score, v_notes, v_src_id);

    v_status := null; v_score := null; v_notes := null; v_src_id := null;
  end loop;

  insert into public.certificate_skill_results (certificate_id, area, status)
  values (
    v_cert_id, 'attendance_requirement',
    case
      when v_elig.attendance_satisfied is null then 'not_recorded'
      when v_elig.attendance_satisfied then 'met'
      else 'not_met'
    end
  );

  select t.name, t.config,
    coalesce(
      t.config->>'signature_url',
      case t.config->>'design_variant'
        when 'standard_scaffold_certificate' then '/signatures/director-signature-v2.png'
        when 'professional_scaffold_erection_skills' then '/signatures/director-signature.png'
        when 'working_at_height_certificate' then '/signatures/director-signature.png'
        else null
      end
    )
  into v_template_name, v_template_config, v_signature_reference
  from public.certificate_templates t
  where t.id = v_elig.certificate_template_id;

  insert into public.certificate_issuance_snapshots (
    certificate_id, snapshot_version, renderer_version,
    holder_name, identity_no, identity_last4, course_name,
    training_start_date, training_end_date, venue, trainer_name,
    template_id, template_name, template_config, signature_reference,
    verification_metadata, render_payload, created_by
  )
  select
    v_cert_id, 1, 'certificate_renderer_v1',
    c.holder_name, c.identity_no, c.identity_last4, c.course_name,
    c.training_start_date, c.training_end_date, c.venue, c.trainer_name,
    c.template_id, v_template_name, coalesce(v_template_config, '{}'::jsonb), v_signature_reference,
    jsonb_build_object(
      'certificate_number', c.certificate_number,
      'verification_token', c.verification_token,
      'verification_path', c.verification_url,
      'verification_enabled', c.verification_enabled,
      'public_verification_enabled', c.public_verification_enabled
    ),
    jsonb_build_object(
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
    auth.uid()
  from public.certificates c
  where c.id = v_cert_id;

  return query select v_cert_id, v_token;
end;
$$;

revoke all on function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) from public;
grant execute on function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) to authenticated;

comment on function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) is
  'Atomically issues a certificate, verification metadata, five skill rows, and one immutable rendering snapshot. Legacy rows are never backfilled.';

-- Controlled event-only reissue. It does not update the certificate row.
create or replace function app.reissue_certificate(
  p_certificate_id uuid,
  p_event_type text default 'reissue',
  p_reason text default null,
  p_notes jsonb default '{}'::jsonb
)
returns table (id uuid, certificate_id uuid, certificate_number text, event_type text, reissued_at timestamptz)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_cert public.certificates%rowtype;
  v_event public.certificate_reissue_events%rowtype;
begin
  if not app.is_active() or not app.is_admin() or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to reissue certificates.' using errcode = '42501';
  end if;
  if p_event_type not in ('reprint', 'reissue') then
    raise exception 'Invalid reissue event type.' using errcode = 'P0001';
  end if;

  select * into v_cert
  from public.certificates c
  where c.id = p_certificate_id
  for update;

  if not found or v_cert.deleted_at is not null then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;
  if v_cert.status not in ('valid', 'expired', 'issued', 'archived') then
    raise exception 'Certificate status does not permit reissue.' using errcode = 'P0001';
  end if;

  insert into public.certificate_reissue_events (certificate_id, reissued_by, reason, event_type, notes)
  values (v_cert.id, auth.uid(), nullif(btrim(p_reason), ''), p_event_type, coalesce(p_notes, '{}'::jsonb))
  returning * into v_event;

  return query select v_event.id, v_cert.id, coalesce(v_cert.certificate_number, v_cert.certificate_no), v_event.event_type, v_event.reissued_at;
end;
$$;

revoke all on function app.reissue_certificate(uuid, text, text, jsonb) from public;
grant execute on function app.reissue_certificate(uuid, text, text, jsonb) to authenticated;

comment on function app.reissue_certificate(uuid, text, text, jsonb) is
  'Creates an append-only reprint/reissue event for an existing certificate identity; never changes issue_date, number, token, or issuance snapshot.';

commit;
