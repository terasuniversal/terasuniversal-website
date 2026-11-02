-- Disposable-database fixture only: Production's app.duplicate_certificate_with_
-- skill_snapshot, copied verbatim from pg_get_functiondef (read-only, 2026-11-01).
CREATE OR REPLACE FUNCTION app.duplicate_certificate_with_skill_snapshot(p_source_certificate_id uuid)
 RETURNS TABLE(id uuid, verification_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'app', 'extensions'
AS $function$
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
$function$;
