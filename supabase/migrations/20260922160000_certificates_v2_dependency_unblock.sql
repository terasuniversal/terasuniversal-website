-- Certificates V2 dependency unblock.
-- Forward-only and additive. Apply to Canonical STAGING first.
-- Production is explicitly out of scope for this task.
-- C7A training-period verification is not implemented here.

begin;

-- 1. Small structured issuing-branch master. No staff management UI is added.
create table if not exists public.certificate_branches (
  id uuid primary key default gen_random_uuid(),
  branch_code text not null,
  branch_name text not null,
  display_address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certificate_branches_code_key unique (branch_code),
  constraint certificate_branches_code_not_blank check (length(btrim(branch_code)) > 0),
  constraint certificate_branches_name_not_blank check (length(btrim(branch_name)) > 0)
);

create index if not exists certificate_branches_active_idx
  on public.certificate_branches (is_active)
  where is_active;

comment on table public.certificate_branches is
  'Structured TERAS issuing branch identity used by certificate issuance. Historical certificates snapshot display values; no certificate renders from this table after issuance.';

alter table public.certificate_branches enable row level security;
alter table public.certificate_branches force row level security;
revoke all on public.certificate_branches from anon;
revoke all on public.certificate_branches from authenticated;
grant select on public.certificate_branches to authenticated;

drop policy if exists certificate_branches_read on public.certificate_branches;
create policy certificate_branches_read
  on public.certificate_branches
  for select to authenticated
  using (public.has_module_access('certificates'));

-- A schedule may optionally identify the issuing branch. New issuance requires
-- an active branch; existing historical schedules remain nullable and are not
-- backfilled by this migration.
alter table public.course_schedules
  add column if not exists branch_id uuid
    references public.certificate_branches (id) on delete set null;

create index if not exists course_schedules_branch_idx
  on public.course_schedules (branch_id)
  where branch_id is not null and deleted_at is null;

-- 2. Preserve structured historical values on the certificate row as well as
-- the existing immutable snapshot. Existing names/columns are retained.
alter table public.certificates
  add column if not exists schedule_code text,
  add column if not exists exam_date date,
  add column if not exists branch_id uuid references public.certificate_branches (id) on delete set null,
  add column if not exists branch_code text,
  add column if not exists branch_name text,
  add column if not exists branch_address text,
  add column if not exists effective_assessor_name text,
  add column if not exists participant_code_snapshot text,
  add column if not exists company_snapshot text;

alter table public.certificate_issuance_snapshots
  add column if not exists company_snapshot text,
  add column if not exists participant_code_snapshot text,
  add column if not exists course_code text,
  add column if not exists schedule_code text,
  add column if not exists exam_date date,
  add column if not exists branch_id uuid references public.certificate_branches (id) on delete set null,
  add column if not exists branch_code text,
  add column if not exists branch_name text,
  add column if not exists branch_address text,
  add column if not exists effective_trainer_id uuid,
  add column if not exists effective_assessor_id uuid,
  add column if not exists effective_assessor_name text,
  add column if not exists group_id uuid,
  add column if not exists group_name text,
  add column if not exists assessment_result text,
  add column if not exists competency_status text,
  add column if not exists issue_date date;

comment on column public.certificate_issuance_snapshots.company_snapshot is
  'Nullable participant company captured at issuance. Company is never an eligibility requirement.';
comment on column public.certificate_issuance_snapshots.render_payload is
  'Immutable renderer payload. Includes certificate-facing historical values and the skill snapshot; never rebuilt from live master data.';

-- 3. Extend historical immutability to the newly captured certificate fields.
create or replace function app.certificate_historical_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public, app, extensions
as $$
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
$$;

drop trigger if exists trg_certificate_historical_update_guard on public.certificates;
create trigger trg_certificate_historical_update_guard
  before update on public.certificates
  for each row execute function app.certificate_historical_update_guard();

-- 4. Canonical issuance path. Eligibility remains the sole eligibility source;
-- branch/trainer/assessor values are issuance metadata only.
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
  v_schedule public.course_schedules%rowtype;
  v_course public.courses%rowtype;
  v_participant public.participants%rowtype;
  v_branch public.certificate_branches%rowtype;
  v_cert_id uuid;
  v_token text;
  v_area text;
  v_status text;
  v_score numeric;
  v_notes text;
  v_src_id uuid;
  v_group_id uuid;
  v_group_name text;
  v_trainer_id uuid;
  v_trainer_name text;
  v_assessor_id uuid;
  v_assessor_name text;
  v_template_name text;
  v_template_config jsonb := '{}'::jsonb;
  v_signature_reference text;
  v_design_variant text;
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

  select cs.* into v_schedule from public.course_schedules cs where cs.id = p_schedule_id and cs.deleted_at is null for update;
  select co.* into v_course from public.courses co where co.id = v_schedule.course_id and co.deleted_at is null;
  select p.* into v_participant from public.participants p where p.id = p_participant_id;

  if v_schedule.branch_id is null then
    raise exception 'Certificate issuing branch is not configured.' using errcode = 'P0001';
  end if;
  select b.* into v_branch
  from public.certificate_branches b
  where b.id = v_schedule.branch_id and b.is_active;
  if not found then
    raise exception 'Certificate issuing branch is inactive or missing.' using errcode = 'P0001';
  end if;

  -- Effective trainer: active group assignment first, schedule free-text fallback.
  select sp.schedule_group_id, g.name, g.trainer_id, t.full_name
    into v_group_id, v_group_name, v_trainer_id, v_trainer_name
  from public.schedule_participants sp
  join public.schedule_groups g on g.id = sp.schedule_group_id
    and g.schedule_id = p_schedule_id and g.deleted_at is null
  left join public.trainers t on t.id = g.trainer_id
  where sp.schedule_id = p_schedule_id
    and sp.participant_id = p_participant_id
    and sp.deleted_at is null
  limit 1;
  if v_trainer_name is null then
    v_trainer_name := nullif(btrim(v_schedule.trainer_name), '');
    v_trainer_id := null;
  end if;
  if v_trainer_name is null then
    raise exception 'Effective trainer is not configured.' using errcode = 'P0001';
  end if;

  -- Effective assessor: group override, otherwise the schedule primary assessor.
  if v_group_id is not null then
    select g.assessor_id, a.full_name into v_assessor_id, v_assessor_name
    from public.schedule_groups g
    left join public.assessors a on a.id = g.assessor_id
    where g.id = v_group_id and g.assessor_id is not null;
  end if;
  if v_assessor_id is null then
    select sa.assessor_id, a.full_name into v_assessor_id, v_assessor_name
    from public.schedule_assessors sa
    join public.assessors a on a.id = sa.assessor_id
    where sa.schedule_id = p_schedule_id and sa.is_primary = true
    order by sa.assigned_at nulls last, sa.created_at
    limit 1;
  end if;

  select t.name, t.config, t.config->>'design_variant',
    coalesce(t.config->>'signature_url',
      case t.config->>'design_variant'
        when 'standard_scaffold_certificate' then '/signatures/director-signature-v2.png'
        when 'professional_scaffold_erection_skills' then '/signatures/director-signature.png'
        when 'working_at_height_certificate' then '/signatures/director-signature.png'
        else null
      end)
  into v_template_name, v_template_config, v_design_variant, v_signature_reference
  from public.certificate_templates t
  where t.id = v_elig.certificate_template_id
    and t.is_active and t.deleted_at is null;
  if not found or v_template_name is null then
    raise exception 'Certificate template resolution is not deterministic.' using errcode = 'P0001';
  end if;

  insert into public.certificates (
    participant_id, schedule_id, course_id, template_id,
    certificate_number, holder_name, participant_name, participant_code_snapshot, company_snapshot,
    course_name, course_code, schedule_code, exam_date,
    training_start_date, training_end_date, venue, trainer_name,
    branch_id, branch_code, branch_name, branch_address,
    effective_assessor_name, status, issue_date, issued_by
  ) values (
    p_participant_id, p_schedule_id, v_elig.course_id, v_elig.certificate_template_id,
    p_certificate_number, v_elig.holder_name, v_elig.holder_name, coalesce(v_participant.participant_id, v_participant.participant_code), v_participant.company,
    v_elig.course_name, v_course.course_code, v_schedule.schedule_code, v_schedule.exam_date,
    v_schedule.start_date, v_schedule.end_date, v_schedule.venue, v_trainer_name,
    v_branch.id, v_branch.branch_code, v_branch.branch_name, v_branch.display_address,
    v_assessor_name, 'valid', current_date, auth.uid()
  ) returning certificates.id, certificates.verification_token into v_cert_id, v_token;

  update public.certificates set verification_url = '/verify/' || v_token where certificates.id = v_cert_id;

  foreach v_area in array array['theory_session', 'practical_training', 'safety_awareness', 'practical_assessment'] loop
    select psr.status, psr.score, psr.notes, psr.id into v_status, v_score, v_notes, v_src_id
    from public.participant_skill_results psr
    where psr.schedule_id = p_schedule_id and psr.participant_id = p_participant_id
      and psr.area = v_area and psr.deleted_at is null;
    insert into public.certificate_skill_results (certificate_id, area, status, score, notes, source_skill_result_id)
    values (
      v_cert_id,
      v_area,
      case
        when v_area = 'practical_assessment' then case when v_status = 'passed' then 'passed' when v_status = 'failed' then 'failed' else 'not_recorded' end
        else case when v_status = 'completed' then 'completed' else 'not_recorded' end
      end,
      v_score, v_notes, v_src_id
    );
    v_status := null; v_score := null; v_notes := null; v_src_id := null;
  end loop;

  insert into public.certificate_skill_results (certificate_id, area, status)
  values (v_cert_id, 'attendance_requirement', case when v_elig.attendance_satisfied is null then 'not_recorded' when v_elig.attendance_satisfied then 'met' else 'not_met' end);

  insert into public.certificate_issuance_snapshots (
    certificate_id, snapshot_version, renderer_version, holder_name, identity_no, identity_last4,
    company_snapshot, participant_code_snapshot, course_name, course_code, schedule_code, training_start_date, training_end_date,
    exam_date, venue, branch_id, branch_code, branch_name, branch_address,
    trainer_name, effective_trainer_id, effective_assessor_id, effective_assessor_name,
    group_id, group_name, assessment_result, competency_status, issue_date,
    template_id, template_name, template_config, signature_reference,
    verification_metadata, render_payload, created_by
  )
  select v_cert_id, 2, 'certificate_renderer_v1', c.holder_name, c.identity_no, c.identity_last4,
    c.company_snapshot, c.participant_code_snapshot, c.course_name, c.course_code, c.schedule_code, c.training_start_date, c.training_end_date,
    c.exam_date, c.venue, c.branch_id, c.branch_code, c.branch_name, c.branch_address,
    c.trainer_name, v_trainer_id, v_assessor_id, v_assessor_name,
    v_group_id, v_group_name, v_elig.result, v_elig.competency_status, c.issue_date,
    c.template_id, v_template_name, coalesce(v_template_config, '{}'::jsonb), v_signature_reference,
    jsonb_build_object('certificate_number', c.certificate_number, 'verification_token', c.verification_token,
      'verification_path', c.verification_url, 'verification_enabled', c.verification_enabled,
      'public_verification_enabled', c.public_verification_enabled),
    jsonb_build_object('certificate_number', c.certificate_number, 'holder_name', c.holder_name,
      'identity_no', c.identity_no, 'participant_code_snapshot', c.participant_code_snapshot, 'company_snapshot', c.company_snapshot, 'course_name', c.course_name,
      'course_code', c.course_code, 'schedule_code', c.schedule_code, 'training_start_date', c.training_start_date,
      'training_end_date', c.training_end_date, 'exam_date', c.exam_date, 'venue', c.venue,
      'branch_code', c.branch_code, 'branch_name', c.branch_name, 'branch_address', c.branch_address,
      'trainer_name', c.trainer_name, 'effective_assessor_name', c.effective_assessor_name,
      'assessment_result', v_elig.result, 'competency_status', v_elig.competency_status,
      'issue_date', c.issue_date, 'skills_record', coalesce((select jsonb_agg(jsonb_build_object('area', s.area, 'status', s.status, 'score', s.score, 'notes', s.notes) order by s.area) from public.certificate_skill_results s where s.certificate_id = c.id), '[]'::jsonb)),
    auth.uid()
  from public.certificates c where c.id = v_cert_id;

  return query select v_cert_id, v_token;
end;
$$;

revoke all on function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) from public;
grant execute on function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) to authenticated;

comment on function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) is
  'Canonical atomic certificate issuance. Rechecks v_certificate_eligibility, resolves branch/trainer/assessor/template at issuance, snapshots all certificate-facing history and skills, and never reads live master data for modern rendering.';

-- Replacement/duplicate copies the source immutable snapshot. It never
-- reconstructs historical facts from current schedule/course/trainer/assessor/branch rows.
create or replace function app.duplicate_certificate_with_skill_snapshot(p_source_certificate_id uuid)
returns table (id uuid, verification_token text)
language plpgsql security definer set search_path = public, app, extensions
as $$
declare
  v_actor uuid := auth.uid();
  v_src public.certificates%rowtype;
  v_src_snapshot public.certificate_issuance_snapshots%rowtype;
  v_new_id uuid;
  v_token text;
  r record;
begin
  if v_actor is null or not app.is_active() or not app.is_admin() or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to duplicate certificates.' using errcode = '42501';
  end if;
  select * into v_src from public.certificates cert where cert.id = p_source_certificate_id for update;
  if not found or v_src.deleted_at is not null then raise exception 'Source certificate not found.' using errcode = 'P0002'; end if;
  select * into v_src_snapshot from public.certificate_issuance_snapshots s where s.certificate_id = p_source_certificate_id;
  if not found then raise exception 'Source certificate has no immutable snapshot.' using errcode = 'P0001'; end if;

  insert into public.certificates (
    participant_id, schedule_id, course_id, template_id, holder_name, participant_name, participant_code_snapshot, company_snapshot,
    course_name, course_code, schedule_code, exam_date, training_start_date, training_end_date, venue, trainer_name,
    branch_id, branch_code, branch_name, branch_address, effective_assessor_name, status, issue_date, issued_by,
    expiry_date, remarks, replaces_certificate_id
  ) values (
    v_src.participant_id, null, v_src.course_id, v_src.template_id, v_src.holder_name, v_src.participant_name, v_src.participant_code_snapshot, v_src.company_snapshot,
    v_src.course_name, v_src.course_code, v_src.schedule_code, v_src.exam_date, v_src.training_start_date, v_src.training_end_date, v_src.venue, v_src.trainer_name,
    v_src.branch_id, v_src.branch_code, v_src.branch_name, v_src.branch_address, v_src.effective_assessor_name, 'draft', current_date, v_actor,
    v_src.expiry_date, v_src.remarks, v_src.id
  ) returning certificates.id, certificates.verification_token into v_new_id, v_token;

  update public.certificates set verification_url = '/verify/' || v_token where certificates.id = v_new_id;

  for r in select area, status, score, notes, source_skill_result_id from public.certificate_skill_results where certificate_id = p_source_certificate_id loop
    insert into public.certificate_skill_results (certificate_id, area, status, score, notes, source_skill_result_id)
    values (v_new_id, r.area, r.status, r.score, r.notes, r.source_skill_result_id);
  end loop;

  insert into public.certificate_issuance_snapshots (
    certificate_id, snapshot_version, renderer_version, holder_name, identity_no, identity_last4,
    company_snapshot, participant_code_snapshot, course_name, course_code, schedule_code, training_start_date, training_end_date,
    exam_date, venue, branch_id, branch_code, branch_name, branch_address,
    trainer_name, effective_trainer_id, effective_assessor_id, effective_assessor_name,
    group_id, group_name, assessment_result, competency_status, issue_date,
    template_id, template_name, template_config, signature_reference, verification_metadata, render_payload, created_by
  )
  select c.id, v_src_snapshot.snapshot_version, v_src_snapshot.renderer_version, v_src_snapshot.holder_name, v_src_snapshot.identity_no, v_src_snapshot.identity_last4,
    v_src_snapshot.company_snapshot, v_src_snapshot.participant_code_snapshot, v_src_snapshot.course_name, v_src_snapshot.course_code, v_src_snapshot.schedule_code, v_src_snapshot.training_start_date, v_src_snapshot.training_end_date,
    v_src_snapshot.exam_date, v_src_snapshot.venue, v_src_snapshot.branch_id, v_src_snapshot.branch_code, v_src_snapshot.branch_name, v_src_snapshot.branch_address,
    v_src_snapshot.trainer_name, v_src_snapshot.effective_trainer_id, v_src_snapshot.effective_assessor_id, v_src_snapshot.effective_assessor_name,
    v_src_snapshot.group_id, v_src_snapshot.group_name, v_src_snapshot.assessment_result, v_src_snapshot.competency_status, v_src_snapshot.issue_date,
    c.template_id, v_src_snapshot.template_name, v_src_snapshot.template_config, v_src_snapshot.signature_reference,
    coalesce(v_src_snapshot.verification_metadata, '{}'::jsonb) || jsonb_build_object('certificate_number', c.certificate_number, 'verification_token', c.verification_token, 'verification_path', c.verification_url),
    coalesce(v_src_snapshot.render_payload, '{}'::jsonb) || jsonb_build_object('certificate_number', c.certificate_number, 'issue_date', c.issue_date), v_actor
  from public.certificates c where c.id = v_new_id;

  return query select v_new_id, v_token;
end;
$$;

revoke all on function app.duplicate_certificate_with_skill_snapshot(uuid) from public;
grant execute on function app.duplicate_certificate_with_skill_snapshot(uuid) to authenticated;

-- Public verification is snapshot-first for modern certificates. It retains the
-- existing safe return shape and does not expose new private historical fields.
create or replace function public.verify_and_log(
  p_query text,
  p_method text default 'auto',
  p_ip text default null,
  p_ua text default null
)
returns table (
  found boolean,
  certificate_number text,
  holder_name text,
  participant_code_masked text,
  company text,
  course_title text,
  training_date date,
  training_start_date date,
  training_end_date date,
  issue_date date,
  expiry_date date,
  status text,
  is_valid boolean,
  verified_at timestamptz
)
language plpgsql security definer
set search_path = public
as $$
declare
  v record;
  v_status text;
  v_ip inet;
  q text := trim(coalesce(p_query, ''));
begin
  if q = '' then return; end if;
  begin v_ip := nullif(p_ip, '')::inet; exception when others then v_ip := null; end;

  select c.id, c.certificate_number, c.holder_name, c.status, c.issue_date, c.expiry_date,
    c.verification_enabled,
    case when s.certificate_id is not null then coalesce(s.participant_code_snapshot, p.participant_id) else p.participant_id end as p_code,
    case when s.certificate_id is not null then s.company_snapshot else p.company end as p_company,
    case when s.certificate_id is not null then s.course_name else coalesce(co.title, co.course_name) end as course_title,
    coalesce(s.training_start_date, c.training_start_date) as training_start_date,
    coalesce(s.training_end_date, c.training_end_date) as training_end_date
  into v
  from public.certificates c
  left join public.participants p on p.id = c.participant_id
  left join public.courses co on co.id = c.course_id
  left join public.certificate_issuance_snapshots s on s.certificate_id = c.id
  where c.deleted_at is null
    and (((p_method in ('auto', 'token')) and c.verification_token = q)
      or ((p_method in ('auto', 'number')) and upper(c.certificate_number) = upper(q)))
  limit 1;

  if not found then
    insert into public.certificate_verifications(method, query_value, status_returned, ip_address, user_agent)
    values (p_method, q, 'not_found', v_ip, p_ua);
    return;
  end if;

  if coalesce(v.verification_enabled, true) = false then
    insert into public.certificate_verifications(certificate_id, certificate_number, method, query_value, status_returned, ip_address, user_agent)
    values (v.id, v.certificate_number, p_method, q, 'disabled', v_ip, p_ua);
    return;
  end if;

  if v.status in ('valid', 'issued') and (v.expiry_date is null or v.expiry_date >= current_date) then
    v_status := 'valid';
  elsif v.status = 'revoked' then
    v_status := 'revoked';
  elsif v.status = 'expired' or (v.expiry_date is not null and v.expiry_date < current_date) then
    v_status := 'expired';
  else
    v_status := v.status;
  end if;

  insert into public.certificate_verifications(certificate_id, certificate_number, method, query_value, status_returned, ip_address, user_agent)
  values (v.id, v.certificate_number, p_method, q, v_status, v_ip, p_ua);

  return query select true, v.certificate_number, v.holder_name,
    case when v.p_code is null then null when length(v.p_code) <= 6 then v.p_code
      else left(v.p_code, 4) || repeat('•', greatest(length(v.p_code) - 6, 1)) || right(v.p_code, 2) end,
    v.p_company, v.course_title, v.training_start_date, v.training_start_date,
    v.training_end_date, v.issue_date, v.expiry_date, v.status, (v_status = 'valid'), now();
end;
$$;

revoke all on function public.verify_and_log(text, text, text, text) from public;
grant execute on function public.verify_and_log(text, text, text, text) to anon, authenticated;

commit;
