-- DRAFT -- NOT APPLIED. C4E-1B: Working at Height snapshot dispatch (Production).
--
-- Target: Production iagzkrzeuawaxvacqprk only. Forward-only, additive. Kept in
-- post_baseline_drafts until the owner separately authorizes promotion. The
-- precondition below aborts on Staging, whose WAH course has a different UUID.
--
-- What this changes, and nothing else:
--   1. app.capture_c4_wave1_erector_snapshot(): adds a branch for exactly one
--      course, 963b1f6b-4c15-4833-90da-21aa0af0f544 (re-verified live, read-only,
--      2026-11-01). New WAH issuances freeze certificate_family
--      'working_at_height', renderer_version 'c4_wave1_wah_v1', the owner title
--      and the content of lib/working-at-height-programme.ts verbatim. The
--      design-variant check becomes per-family; scaffold families keep theirs.
--      A new WAH issuance whose frozen Practical Assessment is 'failed' aborts,
--      which rolls back the whole issuance. Passed, not_recorded and missing
--      source rows are not blocked by this rule.
--   2. app.persist_certificate_render_contract_marker() and
--      app.guard_certificate_render_contract(): accept the one new version,
--      with a WAH-specific contract check.
--   3. certificate_issuance_snapshots_c4_content_digest_check: covers the new
--      version (no existing row carries it).
--
-- Not changed: app.issue_certificate_with_skill_snapshot, app.duplicate_
-- certificate_with_skill_snapshot, v_certificate_eligibility, the WAH template
-- row, course rows, schedules, branches, grants, RLS, and every existing
-- certificate and snapshot. No weighting, threshold or eligibility rule is
-- introduced, and Skills Record rows are frozen exactly as issuance wrote them.

begin;

-- 0. Precondition: the deployed Inspector C4 baseline and the exact Production
--    WAH course/template binding must be present.
do $$
begin
  -- Checks attachment and the baseline's own contract markers, not just
  -- object names, so a same-named but different object set is refused.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'certificates'
                    and column_name = 'render_contract_version')
     or not exists (select 1 from pg_trigger
                     where tgname = 'trg_capture_c4_wave1_erector_snapshot' and not tgisinternal
                       and tgrelid = to_regclass('public.certificate_issuance_snapshots')
                       and tgfoid = to_regprocedure('app.capture_c4_wave1_erector_snapshot()'))
     or not exists (select 1 from pg_trigger
                     where tgname = 'trg_persist_certificate_render_contract_marker' and not tgisinternal
                       and tgrelid = to_regclass('public.certificate_issuance_snapshots')
                       and tgfoid = to_regprocedure('app.persist_certificate_render_contract_marker()'))
     or not exists (select 1 from pg_trigger
                     where tgname = 'trg_guard_certificate_render_contract' and not tgisinternal
                       and tgrelid = to_regclass('public.certificates')
                       and tgfoid = to_regprocedure('app.guard_certificate_render_contract()'))
     or coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('app.capture_c4_wave1_erector_snapshot()')), '')
          not like '%teras_erector_catalog_2026_v1%'
     or coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('app.persist_certificate_render_contract_marker()')), '')
          not like '%c4_wave1_v1%'
     or coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('app.guard_certificate_render_contract()')), '')
          not like '%pg_trigger_depth%'
     or coalesce((select p.prosrc from pg_proc p where p.oid = to_regprocedure('app.capture_c4_wave1_erector_snapshot()')), '')
          not like '%teras_inspector_catalog_2026_v1%'
     or not exists (select 1 from pg_constraint
                     where conname = 'certificate_issuance_snapshots_c4_content_digest_check'
                       and conrelid = to_regclass('public.certificate_issuance_snapshots')
                       and pg_get_constraintdef(oid) like '%c4_wave1_inspector_v1%md5-jsonb-text-v1%') then
    raise exception 'WAH C4 migration requires the Inspector C4 baseline (20261101124601) to be applied first';
  end if;
  -- This check, not the filename, is what keeps this Production-specific draft
  -- off Staging.
  if not exists (select 1
                   from public.courses co
                   join public.certificate_templates t on t.id = co.certificate_template_id
                  where co.id = '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid
                    and co.deleted_at is null
                    and t.deleted_at is null
                    and t.config->>'design_variant' = 'working_at_height_certificate') then
    raise exception 'WAH C4 migration requires the Production WAH course and template binding';
  end if;
end $$;

-- 1. BEFORE INSERT on certificate_issuance_snapshots.
create or replace function app.capture_c4_wave1_erector_snapshot()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
declare
  v_course_id uuid;
  v_certificate_contract text;
  v_replaces_certificate_id uuid;
  v_target_renderer_version text;
  v_family text;
  v_level text;
  v_key text;
  v_expected_design_variant text;
  v_programme_content jsonb;
  v_skills jsonb;
  v_skill_count integer;
  v_attendance text;
  v_verification_path text;
  v_verification_token text;
begin
  select c.course_id, c.render_contract_version, c.replaces_certificate_id
    into v_course_id, v_certificate_contract, v_replaces_certificate_id
  from public.certificates c
  where c.id = new.certificate_id;
  if not found then
    raise exception 'Issuance snapshot has no matching certificate';
  end if;

  -- A duplicate already carries the source contract marker and a copied
  -- immutable snapshot. Preserve that snapshot byte-for-byte.
  if v_replaces_certificate_id is not null then
    if v_certificate_contract is distinct from new.renderer_version then
      raise exception 'Certificate duplicate marker does not match its copied snapshot renderer';
    end if;
    return new;
  end if;

  if v_certificate_contract is not null then
    raise exception 'New issuance unexpectedly already has a render contract marker';
  end if;
  if new.renderer_version is distinct from 'certificate_renderer_v1' then
    raise exception 'Unknown initial certificate renderer version %', new.renderer_version;
  end if;
  v_target_renderer_version := 'certificate_renderer_v1';

  -- Explicit allowlist; every other course is an unconditional legacy
  -- pass-through (any unlisted course stays certificate_renderer_v1).
  if v_course_id is null then
    return new;
  end if;

  case v_course_id
    when '2a78decf-6997-4626-a7cc-a1a23a110cf8'::uuid then
      v_family := 'scaffold_erector'; v_level := 'basic'; v_key := 'basic_erection';
    when '904293c4-8792-41d7-8744-42143887e577'::uuid then
      v_family := 'scaffold_erector'; v_level := 'intermediate'; v_key := 'intermediate_erection';
    when 'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'::uuid then
      v_family := 'scaffold_erector'; v_level := 'advanced'; v_key := 'advanced_erection';
    when 'b10c2e4b-f35f-478b-b450-f98323926345'::uuid then
      v_family := 'scaffold_inspector'; v_level := 'basic'; v_key := 'basic_inspection';
    when '18945a4b-8df0-4f39-bbf9-7bd91c1bb58d'::uuid then
      v_family := 'scaffold_inspector'; v_level := 'intermediate'; v_key := 'intermediate_inspection';
    when 'b7c0866c-fe4e-4ccb-ad66-e18d3572ed3c'::uuid then
      v_family := 'scaffold_inspector'; v_level := 'advanced'; v_key := 'advanced_inspection';
    when '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid then
      -- WAH is one programme with no Basic/Intermediate/Advanced levels.
      v_family := 'working_at_height'; v_level := 'standard'; v_key := 'working_at_height';
    else
      v_key := null;
  end case;

  if v_key is null then
    return new;
  end if;

  -- Erector and Inspector share the standard scaffold template; WAH has its
  -- own. A mapped course bound to any other design fails closed rather than
  -- freezing a certificate in the wrong family.
  v_expected_design_variant := case v_family
    when 'working_at_height' then 'working_at_height_certificate'
    else 'standard_scaffold_certificate'
  end;
  if new.template_config->>'design_variant' is distinct from v_expected_design_variant then
    raise exception 'C4 Wave 1 fail-closed: unsupported % certificate family (expected design_variant %, got %)', v_family, v_expected_design_variant, new.template_config->>'design_variant';
  end if;

  -- The eligibility view deliberately has no WAH assessment gate, and every
  -- new issuance passes through this trigger, so the owner's Failed hold lives
  -- here. Duplicates returned above, so issued certificates are unaffected.
  if v_family = 'working_at_height' and exists (
    select 1 from public.certificate_skill_results s
    where s.certificate_id = new.certificate_id
      and s.area = 'practical_assessment'
      and s.status = 'failed'
  ) then
    raise exception 'WAH_FAILED_PRACTICAL_ASSESSMENT_HOLD: certificate not issued because Practical Assessment is recorded as Failed.'
      using errcode = 'P0001';
  end if;

  v_target_renderer_version := case v_family
    when 'scaffold_erector' then 'c4_wave1_v1'
    when 'working_at_height' then 'c4_wave1_wah_v1'
    else 'c4_wave1_inspector_v1'
  end;

  case v_key
    when 'basic_erection' then
      v_programme_content := pg_catalog.jsonb_build_object(
        'programme_title', 'TERAS BASIC SCAFFOLD ERECTION PROGRAMME',
        'programme_duration', '10-Day Practical Training',
        'objectives', 'Fundamental knowledge and practical skills to safely erect, modify, inspect and dismantle scaffolding structures in accordance with industry standards and workplace safety requirements.',
        'coverage', pg_catalog.jsonb_build_array('Scaffolding Components & Terminology','Workplace Hazard Identification','Personal Protective Equipment (PPE)','Safe Scaffold Erection & Dismantling','Pre-Use Component Inspection','Safety Procedures & Best Practices','Teamwork in Scaffolding Operations'),
        'outcomes', pg_catalog.jsonb_build_array('Identify scaffolding components and terminology correctly','Recognise and control common workplace hazards','Select and use PPE correctly','Erect and dismantle basic scaffold structures safely','Carry out a pre-use inspection of scaffold components'),
        'assessment', pg_catalog.jsonb_build_array('Theory Assessment','Practical Assessment','Continuous Trainer Evaluation'),
        'content_source', 'data/courseCatalog.js — Basic Scaffolder (Level 1), TERAS UNIVERSAL Training Course Catalogue 2026');
    when 'intermediate_erection' then
      v_programme_content := pg_catalog.jsonb_build_object(
        'programme_title', 'TERAS INTERMEDIATE SCAFFOLD ERECTION PROGRAMME',
        'programme_duration', '10-Day Practical Training',
        'objectives', 'Further develops the knowledge, technical skills and practical competency of scaffolders who have completed Basic Scaffold Erection, for greater responsibilities in construction, maintenance, petrochemical and Oil & Gas operations.',
        'coverage', pg_catalog.jsonb_build_array('Work Planning & Organisation','Reading Scaffold Drawings & Instructions','Erecting Complex Scaffold Structures','Hazard Identification & Control Measures','Inspecting Completed Structures','Safe Supervision Practices','Industry Standards & Regulatory Requirements'),
        'outcomes', pg_catalog.jsonb_build_array('Plan scaffolding work activities safely','Interpret scaffold drawings and work instructions','Erect, modify and dismantle more complex scaffold structures','Identify hazards and apply effective control measures','Conduct inspections on completed scaffold structures'),
        'assessment', pg_catalog.jsonb_build_array('Theory Assessment','Practical Assessment','Continuous Trainer Evaluation'),
        'content_source', 'data/courseCatalog.js — Intermediate Scaffolder (Level 2), TERAS UNIVERSAL Training Course Catalogue 2026');
    when 'advanced_erection' then
      v_programme_content := pg_catalog.jsonb_build_object(
        'programme_title', 'TERAS ADVANCED SCAFFOLD ERECTION PROGRAMME',
        'programme_duration', '10-Day Practical Training',
        'objectives', 'Designed for experienced scaffolders who wish to further enhance their technical expertise and leadership capabilities in complex scaffolding operations, covering advanced planning, supervision, structural stability, inspection and risk management.',
        'coverage', pg_catalog.jsonb_build_array('Planning Complex Scaffolding Operations','Team Supervision & Safety','Advanced Drawings & Specifications','Scaffold Stability Evaluation','Comprehensive Inspection & Corrective Action','Risk Management & Compliance','Leadership & Communication'),
        'outcomes', pg_catalog.jsonb_build_array('Plan and coordinate complex scaffolding operations','Supervise scaffolding teams effectively and safely','Evaluate scaffold stability and identify structural hazards','Conduct comprehensive scaffold inspections','Apply risk management strategies and regulatory requirements'),
        'assessment', pg_catalog.jsonb_build_array('Theory Assessment','Practical Assessment','Continuous Trainer Evaluation'),
        'content_source', 'data/courseCatalog.js — Advanced Scaffolder (Level 3), TERAS UNIVERSAL Training Course Catalogue 2026');
    when 'basic_inspection' then
      v_programme_content := pg_catalog.jsonb_build_object(
        'programme_title', 'TERAS BASIC SCAFFOLD INSPECTION PROGRAMME',
        'programme_duration', '2-Day Practical Training',
        'objectives', 'Equips participants with the fundamental knowledge and practical skills required to inspect scaffolding structures safely and effectively, in accordance with industry standards and regulatory requirements.',
        'coverage', pg_catalog.jsonb_build_array('Principles of Scaffold Inspection','Scaffolding Components & Functions','Basic Visual Inspection Techniques','Defect & Hazard Recognition','Compliance Verification','Inspection Records & Reporting','Safe Work Practices'),
        'outcomes', pg_catalog.jsonb_build_array('Explain the principles of scaffold inspection','Identify scaffolding components and their functions','Conduct a basic visual inspection of a scaffold structure','Recognise defects, hazards and unsafe conditions','Complete a basic scaffold inspection record'),
        'assessment', pg_catalog.jsonb_build_array('Theory Assessment','Practical Inspection Assessment','Continuous Trainer Evaluation'),
        'content_source', 'data/courseCatalog.js — "Scaffolding Inspector (Basic)" (TERAS UNIVERSAL Training Course Catalogue 2026)');
    when 'intermediate_inspection' then
      v_programme_content := pg_catalog.jsonb_build_object(
        'programme_title', 'TERAS INTERMEDIATE SCAFFOLD INSPECTION PROGRAMME',
        'programme_duration', '2-Day Practical Training',
        'objectives', 'Enhances participants'' competency in inspecting more complex scaffolding structures and evaluating compliance with industry standards, safety regulations and workplace requirements.',
        'coverage', pg_catalog.jsonb_build_array('Inspecting Complex Scaffold Structures','Stability & Structural Integrity Evaluation','Defect & Non-Compliance Identification','Applying Industry Standards','Comprehensive Inspection Reporting','Corrective Action Assessment','Scaffold Safety Best Practices'),
        'outcomes', pg_catalog.jsonb_build_array('Inspect intermediate and complex scaffold structures','Evaluate scaffold stability and structural integrity','Identify defects, hazards and non-compliance issues','Prepare a comprehensive scaffold inspection report','Assess corrective actions before approving a scaffold for use'),
        'assessment', pg_catalog.jsonb_build_array('Theory Assessment','Practical Inspection Assessment','Continuous Trainer Evaluation'),
        'content_source', 'data/courseCatalog.js — "Scaffolding Inspector (Intermediate)" (TERAS UNIVERSAL Training Course Catalogue 2026)');
    when 'advanced_inspection' then
      v_programme_content := pg_catalog.jsonb_build_object(
        'programme_title', 'TERAS ADVANCED SCAFFOLD INSPECTION PROGRAMME',
        'programme_duration', '2-Day Practical Training',
        'objectives', 'Designed for experienced scaffolding inspectors responsible for inspecting complex scaffolding systems, evaluating structural integrity and ensuring full compliance with industry standards, regulatory requirements and workplace safety practices.',
        'coverage', pg_catalog.jsonb_build_array('Comprehensive Structural Inspections','Structural Integrity Evaluation','Critical Defect Identification','Advanced Risk Assessment','Standards & Regulatory Compliance','Technical Inspection Reporting','Technical Judgement & Approval'),
        'outcomes', pg_catalog.jsonb_build_array('Conduct comprehensive inspections of complex scaffolding structures','Evaluate structural integrity and overall safety performance','Identify critical defects and high-risk conditions','Perform advanced risk assessments with recommended corrective actions','Prepare detailed technical inspection reports'),
        'assessment', pg_catalog.jsonb_build_array('Theory Assessment','Practical Inspection Assessment','Continuous Trainer Evaluation'),
        'content_source', 'data/courseCatalog.js — "Scaffolding Inspector (Advanced)" (TERAS UNIVERSAL Training Course Catalogue 2026)');
    when 'working_at_height' then
      v_programme_content := pg_catalog.jsonb_build_object(
        'programme_title', 'Working at Height',
        'programme_duration', '2-Day Practical Training',
        'objectives', 'To provide participants with the knowledge and practical awareness required to identify working-at-height hazards, understand fall-prevention and fall-protection principles, select and use appropriate access and personal protective equipment, and apply safe work practices for activities performed at height.',
        'coverage', pg_catalog.jsonb_build_array('Working at Height Hazards and Risk Controls','Hierarchy of Fall Prevention and Fall Protection','Safe Access and Egress','Ladders, Platforms and Elevated Work Areas','Full-Body Harnesses, Lanyards and Anchorage Awareness','Inspection and Proper Use of PPE','Safe Work Planning and Permit/Control Requirements','Emergency and Rescue Awareness','Practical Scenario Review'),
        'outcomes', pg_catalog.jsonb_build_array('Identify common hazards associated with working at height','Explain appropriate fall-prevention and fall-protection control measures','Recognise suitable access and fall-protection equipment','Perform basic pre-use checks on relevant PPE','Apply safe work practices and planning principles for work at height','Respond appropriately to unsafe conditions or emergency situations involving work at height'),
        'assessment', pg_catalog.jsonb_build_array('Theory Knowledge Assessment','Practical Demonstration / Scenario-Based Assessment','PPE and Equipment Identification / Pre-Use Check','Trainer Observation and Continuous Evaluation','100% Attendance Requirement'),
        'content_source', 'lib/working-at-height-programme.ts — Business-approved TERAS programme content, approved 2026-08-21');
  end case;

  v_verification_path := new.verification_metadata->>'verification_path';
  v_verification_token := new.verification_metadata->>'verification_token';
  if nullif(pg_catalog.btrim(new.holder_name), '') is null
     or nullif(pg_catalog.btrim(new.course_name), '') is null
     or new.training_start_date is null or new.training_end_date is null
     or nullif(pg_catalog.btrim(new.venue), '') is null
     or nullif(pg_catalog.btrim(new.branch_code), '') is null
     or nullif(pg_catalog.btrim(new.branch_name), '') is null
     or nullif(pg_catalog.btrim(new.branch_address), '') is null
     or nullif(pg_catalog.btrim(new.signature_reference), '') is null
     or nullif(pg_catalog.btrim(new.render_payload->>'certificate_number'), '') is null
     or nullif(pg_catalog.btrim(v_verification_token), '') is null
     or v_verification_path is null
     or v_verification_path !~ '^/verify/[A-Za-z0-9_-]+$'
     or pg_catalog.regexp_replace(v_verification_path, '^/verify/', '') <> v_verification_token then
    raise exception 'C4 Wave 1 fail-closed: required issuance snapshot fact, signature, or verification reference is missing/invalid';
  end if;

  select pg_catalog.count(*),
         pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('area', s.area, 'status', s.status, 'score', s.score, 'notes', s.notes) order by s.area),
         pg_catalog.max(s.status) filter (where s.area = 'attendance_requirement')
    into v_skill_count, v_skills, v_attendance
  from public.certificate_skill_results s
  where s.certificate_id = new.certificate_id;
  if v_skill_count <> 5 or v_attendance is null or not exists (
    select 1 from public.certificate_skill_results s
    where s.certificate_id = new.certificate_id and s.area = 'attendance_requirement'
  ) then
    raise exception 'C4 Wave 1 fail-closed: the five immutable skill/attendance records are incomplete';
  end if;

  new.renderer_version := v_target_renderer_version;
  new.render_payload := coalesce(new.render_payload, '{}'::jsonb) || pg_catalog.jsonb_build_object(
    'canonical_course_id', v_course_id,
    'certificate_family', v_family,
    'certificate_title', case v_family
      when 'scaffold_erector' then 'SCAFFOLDING TRAINING CERTIFICATE'
      when 'working_at_height' then 'WORKING AT HEIGHT TRAINING CERTIFICATE'
      else 'SCAFFOLDING INSPECTION CERTIFICATE'
    end,
    'programme_level', v_level,
    'programme_resolver_version', v_family || '_resolver_v1',
    'programme_content_version', case v_family
      when 'scaffold_erector' then 'teras_erector_catalog_2026_v1'
      when 'working_at_height' then 'teras_wah_catalog_2026_v1'
      else 'teras_inspector_catalog_2026_v1'
    end,
    'programme_key', v_key,
    'programme_content', v_programme_content,
    'programme_content_digest_algorithm', 'md5-jsonb-text-v1',
    'programme_content_digest', pg_catalog.md5(v_programme_content::text),
    'programme_title', v_programme_content->>'programme_title',
    'programme_duration', v_programme_content->>'programme_duration',
    'skills_record', v_skills,
    'attendance_requirement', v_attendance,
    'signature_reference', new.signature_reference,
    'verification_path', v_verification_path,
    'verification_token', v_verification_token,
    'branch_code', new.branch_code,
    'branch_name', new.branch_name,
    'branch_address', new.branch_address
  ) || case v_family
    -- Erector keeps its existing frozen key; Inspector freezes its level
    -- (resolved by the app to inspector-<level>.svg). Never both.
    when 'scaffold_erector' then pg_catalog.jsonb_build_object('watermark_asset_family', 'scaffolding-technical')
    when 'working_at_height' then pg_catalog.jsonb_build_object('watermark_asset_family', 'working-at-height')
    else pg_catalog.jsonb_build_object('inspector_watermark_level', v_level)
  end;

  return new;
end;
$function$;

-- 2. AFTER INSERT on certificate_issuance_snapshots: validate, then persist
--    the write-once marker.
create or replace function app.persist_certificate_render_contract_marker()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
declare
  v_existing_marker text;
  v_replaces_certificate_id uuid;
  v_course_id uuid;
  v_expected_level text;
begin
  if new.renderer_version is null or new.renderer_version not in ('certificate_renderer_v1', 'c4_wave1_v1', 'c4_wave1_inspector_v1', 'c4_wave1_wah_v1') then
    raise exception 'Unknown issuance snapshot renderer version %', new.renderer_version;
  end if;

  select c.render_contract_version, c.replaces_certificate_id, c.course_id
    into v_existing_marker, v_replaces_certificate_id, v_course_id
  from public.certificates c
  where c.id = new.certificate_id;
  if not found then
    raise exception 'Issuance snapshot has no matching certificate for marker persistence';
  end if;

  if v_replaces_certificate_id is not null then
    if v_existing_marker is distinct from new.renderer_version then
      raise exception 'Certificate duplicate marker does not match its immutable issuance snapshot';
    end if;
    return new;
  end if;

  if not exists (
    select 1 from public.certificate_issuance_snapshots snap
    where snap.certificate_id = new.certificate_id
      and snap.renderer_version = new.renderer_version
  ) then
    raise exception 'Render contract marker requires its matching inserted snapshot';
  end if;

  if new.renderer_version = 'c4_wave1_v1' then
    v_expected_level := case v_course_id
      when '2a78decf-6997-4626-a7cc-a1a23a110cf8'::uuid then 'basic'
      when '904293c4-8792-41d7-8744-42143887e577'::uuid then 'intermediate'
      when 'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'::uuid then 'advanced'
      else null
    end;
    if v_expected_level is null
       or new.template_config->>'design_variant' is distinct from 'standard_scaffold_certificate'
       or new.render_payload->>'canonical_course_id' is distinct from v_course_id::text
       or new.render_payload->>'certificate_family' is distinct from 'scaffold_erector'
       or new.render_payload->>'programme_level' is distinct from v_expected_level
       or new.render_payload->>'programme_key' is null
       or new.render_payload->'programme_content' is null
       or new.render_payload->'skills_record' is null
       or new.render_payload->>'attendance_requirement' is null
       or new.render_payload->>'programme_content_digest_algorithm' is distinct from 'md5-jsonb-text-v1'
       or new.render_payload->>'programme_content_digest' is distinct from pg_catalog.md5((new.render_payload->'programme_content')::text)
    then
      raise exception 'C4 Wave1 persisted snapshot does not match its certificate course and required renderer contract';
    end if;
  elsif new.renderer_version = 'c4_wave1_inspector_v1' then
    v_expected_level := case v_course_id
      when 'b10c2e4b-f35f-478b-b450-f98323926345'::uuid then 'basic'
      when '18945a4b-8df0-4f39-bbf9-7bd91c1bb58d'::uuid then 'intermediate'
      when 'b7c0866c-fe4e-4ccb-ad66-e18d3572ed3c'::uuid then 'advanced'
      else null
    end;
    if v_expected_level is null
       or new.template_config->>'design_variant' is distinct from 'standard_scaffold_certificate'
       or new.render_payload->>'canonical_course_id' is distinct from v_course_id::text
       or new.render_payload->>'certificate_family' is distinct from 'scaffold_inspector'
       or new.render_payload->>'certificate_title' is distinct from 'SCAFFOLDING INSPECTION CERTIFICATE'
       or new.render_payload->>'programme_level' is distinct from v_expected_level
       or new.render_payload->>'programme_key' is distinct from (v_expected_level || '_inspection')
       or new.render_payload->'programme_content' is null
       or new.render_payload->'skills_record' is null
       or new.render_payload->>'attendance_requirement' is null
       or new.render_payload->>'inspector_watermark_level' is distinct from v_expected_level
       or new.render_payload ? 'watermark_asset_family'
       or new.render_payload->>'programme_content_digest_algorithm' is distinct from 'md5-jsonb-text-v1'
       or new.render_payload->>'programme_content_digest' is distinct from pg_catalog.md5((new.render_payload->'programme_content')::text)
    then
      raise exception 'C4 Wave1 Inspector persisted snapshot does not match its certificate course and required renderer contract';
    end if;
  elsif new.renderer_version = 'c4_wave1_wah_v1' then
    if v_course_id is distinct from '963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid
       or new.template_config->>'design_variant' is distinct from 'working_at_height_certificate'
       or new.render_payload->>'canonical_course_id' is distinct from v_course_id::text
       or new.render_payload->>'certificate_family' is distinct from 'working_at_height'
       or new.render_payload->>'certificate_title' is distinct from 'WORKING AT HEIGHT TRAINING CERTIFICATE'
       or new.render_payload->>'programme_key' is distinct from 'working_at_height'
       or new.render_payload->'programme_content' is null
       or new.render_payload->'programme_content'->>'programme_duration' is distinct from '2-Day Practical Training'
       or new.render_payload->'skills_record' is null
       or new.render_payload->>'attendance_requirement' is null
       or new.render_payload->>'watermark_asset_family' is distinct from 'working-at-height'
       or new.render_payload ? 'inspector_watermark_level'
       or new.render_payload->>'programme_content_digest_algorithm' is distinct from 'md5-jsonb-text-v1'
       or new.render_payload->>'programme_content_digest' is distinct from pg_catalog.md5((new.render_payload->'programme_content')::text)
    then
      raise exception 'C4 Wave1 WAH persisted snapshot does not match its certificate course and required renderer contract';
    end if;
  end if;

  if v_existing_marker is not null then
    raise exception 'New issuance certificate already has a render contract marker';
  end if;
  update public.certificates
     set render_contract_version = new.renderer_version
   where id = new.certificate_id
     and render_contract_version is null;
  if not found then
    raise exception 'Certificate render contract marker could not be persisted from its matching snapshot';
  end if;
  return new;
end;
$function$;

-- 3. BEFORE INSERT OR UPDATE OF render_contract_version on certificates.
--    Identical to the Inspector baseline except the allowed-version list.
create or replace function app.guard_certificate_render_contract()
 returns trigger
 language plpgsql
 set search_path to 'pg_catalog'
as $function$
declare
  v_source_marker text;
  v_source_renderer text;
begin
  if tg_op = 'INSERT' then
    if new.replaces_certificate_id is not null then
      select src.render_contract_version, snap.renderer_version
        into v_source_marker, v_source_renderer
      from public.certificates src
      join public.certificate_issuance_snapshots snap on snap.certificate_id = src.id
      where src.id = new.replaces_certificate_id;
      if not found then
        raise exception 'Certificate duplicate source marker/snapshot is missing or inconsistent';
      end if;
      -- C4C-2H legacy provenance: a NULL source marker is accepted ONLY when
      -- the source provably predates C4 (exactly one snapshot, renderer
      -- 'certificate_renderer_v1', no C4 payload keys); the duplicate is
      -- then pinned to 'certificate_renderer_v1'.
      if v_source_marker is null then
        if v_source_renderer is distinct from 'certificate_renderer_v1'
           or (select pg_catalog.count(*) from public.certificate_issuance_snapshots s
                where s.certificate_id = new.replaces_certificate_id) <> 1
           or exists (select 1 from public.certificate_issuance_snapshots s
                       where s.certificate_id = new.replaces_certificate_id
                         and (s.render_payload ? 'certificate_family'
                              or s.render_payload ? 'programme_content'
                              or s.render_payload ? 'canonical_course_id')) then
          raise exception 'Certificate duplicate source marker/snapshot is missing or inconsistent';
        end if;
        v_source_marker := 'certificate_renderer_v1';
      elsif v_source_marker is distinct from v_source_renderer then
        raise exception 'Certificate duplicate source marker/snapshot is missing or inconsistent';
      end if;
      if new.render_contract_version is not null
         and new.render_contract_version is distinct from v_source_marker then
        raise exception 'Certificate duplicate cannot supply a different render contract marker';
      end if;
      new.render_contract_version := v_source_marker;
    elsif new.render_contract_version is not null then
      raise exception 'A render contract marker may not be supplied on ordinary certificate INSERT';
    end if;
    return new;
  end if;

  if old.render_contract_version is distinct from new.render_contract_version then
    if pg_catalog.pg_trigger_depth() <= 1
       or old.render_contract_version is not null
       or new.render_contract_version is null
       or new.render_contract_version not in ('certificate_renderer_v1', 'c4_wave1_v1', 'c4_wave1_inspector_v1', 'c4_wave1_wah_v1') then
      raise exception 'Certificate render contract is immutable outside trusted snapshot issuance';
    end if;
    if not exists (
      select 1
      from public.certificate_issuance_snapshots snap
      where snap.certificate_id = new.id
        and snap.renderer_version = new.render_contract_version
    ) then
      raise exception 'Certificate marker requires its matching immutable issuance snapshot';
    end if;
  end if;
  return new;
end;
$function$;

-- 4. Digest CHECK extended to the new version. Every row this trigger set
--    writes already satisfies it, so re-validation is safe on first apply
--    and on any re-application.
alter table public.certificate_issuance_snapshots
  drop constraint if exists certificate_issuance_snapshots_c4_content_digest_check;
alter table public.certificate_issuance_snapshots
  add constraint certificate_issuance_snapshots_c4_content_digest_check
  check (
    renderer_version not in ('c4_wave1_v1', 'c4_wave1_inspector_v1', 'c4_wave1_wah_v1')
    or coalesce(
      render_payload ? 'programme_content'
      and render_payload->>'programme_content_digest_algorithm' = 'md5-jsonb-text-v1'
      and render_payload->>'programme_content_digest' =
        pg_catalog.md5((render_payload->'programme_content')::text),
      false
    )
  ) not valid;
alter table public.certificate_issuance_snapshots
  validate constraint certificate_issuance_snapshots_c4_content_digest_check;

commit;
