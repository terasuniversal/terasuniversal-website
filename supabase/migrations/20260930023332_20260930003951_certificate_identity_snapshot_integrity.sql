-- Capture participant identity exactly once during new certificate issuance.
-- Existing certificates and immutable issuance snapshots are deliberately untouched.
-- CREATE OR REPLACE retains the existing function owner and ACL; pre/postconditions
-- verify the executor owner, SECURITY DEFINER path, and public/authenticated boundary.
begin;

do $identity_snapshot_precondition$
declare
  v_issue regprocedure := to_regprocedure('app.issue_certificate_with_skill_snapshot(uuid,uuid,text)');
  v_public regprocedure := to_regprocedure('public.issue_certificate_with_skill_snapshot(uuid,uuid,text)');
  v_owner text;
  v_is_definer boolean;
  v_search_path text;
begin
  if current_user <> 'postgres' then
    raise exception 'Identity snapshot migration requires migration role postgres';
  end if;
  if pg_has_role(current_user, 'certificate_lifecycle_executor', 'SET')
     or has_schema_privilege('certificate_lifecycle_executor', 'app', 'CREATE')
     or has_schema_privilege('certificate_lifecycle_executor', 'public', 'CREATE')
     or not exists (
       select 1
       from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles member on member.oid = m.member
       join pg_catalog.pg_roles target on target.oid = m.roleid
       where member.rolname = current_user
         and target.rolname = 'certificate_lifecycle_executor'
         and m.admin_option
         and not m.inherit_option
         and not m.set_option
     ) then
    raise exception 'Identity snapshot precondition failed: executor migration privileges drift';
  end if;
  if v_issue is null or v_public is null then
    raise exception 'Identity snapshot precondition failed: issuance RPC is missing';
  end if;
  select r.rolname, p.prosecdef,
         regexp_replace(lower(coalesce(array_to_string(p.proconfig, ','), '')), '\s+', '', 'g')
    into v_owner, v_is_definer, v_search_path
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where p.oid = v_issue;
  if v_owner <> 'certificate_lifecycle_executor'
     or not v_is_definer
     or v_search_path <> 'search_path=public,app,extensions' then
    raise exception 'Identity snapshot precondition failed: internal issuer owner/security/search_path drift';
  end if;
  if has_function_privilege('anon', v_issue, 'EXECUTE')
     or has_function_privilege('authenticated', v_issue, 'EXECUTE')
     or has_function_privilege('service_role', v_issue, 'EXECUTE')
     or not has_function_privilege('authenticated', v_public, 'EXECUTE')
     or has_function_privilege('anon', v_public, 'EXECUTE')
     or has_function_privilege('service_role', v_public, 'EXECUTE') then
    raise exception 'Identity snapshot precondition failed: issuance RPC ACL boundary drift';
  end if;
  if position('Certificate issuing branch is not configured.' in pg_catalog.pg_get_functiondef(v_issue)) = 0
     or position('Certificate issuing branch is inactive or missing.' in pg_catalog.pg_get_functiondef(v_issue)) = 0
     or position('app.request_actor_id()' in pg_catalog.pg_get_functiondef(v_issue)) = 0 then
    raise exception 'Identity snapshot precondition failed: branch or actor invariant missing';
  end if;
  if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'participants' and column_name = 'ic_passport_no'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'certificates' and column_name = 'identity_no'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'certificates' and column_name = 'identity_last4'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'certificate_issuance_snapshots' and column_name = 'identity_no'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'certificate_issuance_snapshots' and column_name = 'identity_last4'
    ) then
    raise exception 'Identity snapshot precondition failed: required identity columns missing';
  end if;
end;
$identity_snapshot_precondition$;

-- I3E intentionally removed the migration role's SET option and the executor's
-- CREATE privilege. Temporarily restore only these migration-time capabilities
-- inside this transaction, then remove them before COMMIT.
grant create on schema app to certificate_lifecycle_executor;
grant certificate_lifecycle_executor to current_user with set true;
set local role certificate_lifecycle_executor;

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
    identity_no, identity_last4,
    course_name, course_code, schedule_code, exam_date,
    training_start_date, training_end_date, venue, trainer_name,
    branch_id, branch_code, branch_name, branch_address,
    effective_assessor_name, status, issue_date, issued_by
  ) values (
    p_participant_id, p_schedule_id, v_elig.course_id, v_elig.certificate_template_id,
    p_certificate_number, v_elig.holder_name, v_elig.holder_name, coalesce(v_participant.participant_id, v_participant.participant_code), v_participant.company,
    nullif(btrim(v_participant.ic_passport_no), ''),
    case
      when length(regexp_replace(v_participant.ic_passport_no, '[^0-9A-Za-z]', '', 'g')) >= 4
        then upper(right(regexp_replace(v_participant.ic_passport_no, '[^0-9A-Za-z]', '', 'g'), 4))
      else null
    end,
    v_elig.course_name, v_course.course_code, v_schedule.schedule_code, v_schedule.exam_date,
    v_schedule.start_date, v_schedule.end_date, v_schedule.venue, v_trainer_name,
    v_branch.id, v_branch.branch_code, v_branch.branch_name, v_branch.display_address,
    v_assessor_name, 'valid', current_date, app.request_actor_id()
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
    app.request_actor_id()
  from public.certificates c where c.id = v_cert_id;

  return query select v_cert_id, v_token;
end;
$$;

comment on function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) is
  'Canonical atomic certificate issuance. Rechecks eligibility and issuing branch, resolves trainer/assessor/template, snapshots certificate-facing history, participant identity, and skills at issuance; modern rendering uses immutable snapshot data.';

reset role;
revoke create on schema app from certificate_lifecycle_executor;
grant certificate_lifecycle_executor to current_user with set false;

do $identity_snapshot_postcondition$
declare
  v_issue regprocedure := to_regprocedure('app.issue_certificate_with_skill_snapshot(uuid,uuid,text)');
  v_public regprocedure := to_regprocedure('public.issue_certificate_with_skill_snapshot(uuid,uuid,text)');
  v_owner text;
  v_is_definer boolean;
  v_search_path text;
begin
  if current_user <> 'postgres'
     or pg_has_role(current_user, 'certificate_lifecycle_executor', 'SET')
     or has_schema_privilege('certificate_lifecycle_executor', 'app', 'CREATE')
     or has_schema_privilege('certificate_lifecycle_executor', 'public', 'CREATE')
     or not exists (
       select 1
       from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles member on member.oid = m.member
       join pg_catalog.pg_roles target on target.oid = m.roleid
       where member.rolname = current_user
         and target.rolname = 'certificate_lifecycle_executor'
         and m.admin_option
         and not m.inherit_option
         and not m.set_option
     ) then
    raise exception 'Identity snapshot postcondition failed: executor migration privileges were not restored';
  end if;
  if v_issue is null or v_public is null then
    raise exception 'Identity snapshot postcondition failed: issuance RPC is missing';
  end if;
  select r.rolname, p.prosecdef,
         regexp_replace(lower(coalesce(array_to_string(p.proconfig, ','), '')), '\s+', '', 'g')
    into v_owner, v_is_definer, v_search_path
  from pg_catalog.pg_proc p
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where p.oid = v_issue;
  if v_owner <> 'certificate_lifecycle_executor'
     or not v_is_definer
     or v_search_path <> 'search_path=public,app,extensions' then
    raise exception 'Identity snapshot precondition failed: internal issuer owner/security/search_path drift';
  end if;
  if has_function_privilege('anon', v_issue, 'EXECUTE')
     or has_function_privilege('authenticated', v_issue, 'EXECUTE')
     or has_function_privilege('service_role', v_issue, 'EXECUTE')
     or not has_function_privilege('authenticated', v_public, 'EXECUTE')
     or has_function_privilege('anon', v_public, 'EXECUTE')
     or has_function_privilege('service_role', v_public, 'EXECUTE') then
    raise exception 'Identity snapshot precondition failed: issuance RPC ACL boundary drift';
  end if;
  if position('Certificate issuing branch is not configured.' in pg_catalog.pg_get_functiondef(v_issue)) = 0
     or position('Certificate issuing branch is inactive or missing.' in pg_catalog.pg_get_functiondef(v_issue)) = 0
     or position('app.request_actor_id()' in pg_catalog.pg_get_functiondef(v_issue)) = 0 then
    raise exception 'Identity snapshot precondition failed: branch or actor invariant missing';
  end if;
  if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'participants' and column_name = 'ic_passport_no'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'certificates' and column_name = 'identity_no'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'certificates' and column_name = 'identity_last4'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'certificate_issuance_snapshots' and column_name = 'identity_no'
    ) or not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'certificate_issuance_snapshots' and column_name = 'identity_last4'
    ) then
    raise exception 'Identity snapshot precondition failed: required identity columns missing';
  end if;
end;
$identity_snapshot_postcondition$;

commit;
