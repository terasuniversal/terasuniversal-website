-- C4C-2D: Erector-ONLY production migration bringing app.issue_certificate_
-- with_skill_snapshot and the certificate_issuance_snapshots render-contract
-- pipeline up to the behavior already proven on canonical staging
-- (eokiaehnvzbggmacifcf), scoped strictly to the 3 real Scaffolding Erector
-- courses. NOT APPLIED anywhere. Prepared under explicit owner authorization
-- (C4C-2D) for a later, separately-authorized apply to Production
-- (iagzkrzeuawaxvacqprk) only.
--
-- Why this migration exists (read-only production inspection, 2026-11-01,
-- C4C-2C/C4C-2D):
--   - Production's deployed app.issue_certificate_with_skill_snapshot is an
--     older version: it never advances certificate_issuance_snapshots.
--     renderer_version past the literal string 'certificate_renderer_v1',
--     has zero triggers of any kind on certificate_issuance_snapshots, and
--     its INSERT into certificates omits identity_no/identity_last4
--     entirely (confirmed via pg_get_functiondef -- those two columns exist
--     on the table but are simply never populated).
--   - None of app.capture_c4_wave1_erector_snapshot(),
--     app.persist_certificate_render_contract_marker(), or
--     app.guard_certificate_render_contract() exist on Production (zero
--     rows from pg_proc). certificates.render_contract_version does not
--     exist as a column at all (zero rows from information_schema.columns).
--     Zero triggers of any kind exist on certificate_issuance_snapshots.
--   - Production's migration history stops at
--     20260924170000_certificate_public_rpc_surface; staging has ~8 later
--     migrations Production never received, including the one that
--     originally created this pipeline (20261004023132_c4_wave1_erector_
--     snapshot, confirmed absent as a local file in this worktree -- see
--     .ai/DECISIONS.md and 20261031120000_c4_wave1_inspector_wah_snapshot_
--     dispatch.sql's own header for the recovery history of that fact).
--
-- Deliberately NOT ported from staging (scope-minimizing decisions):
--   - staging's trigger functions gate every write with
--     `if current_user <> 'certificate_lifecycle_executor' then raise
--     exception ...`. That role does not exist on Production (confirmed:
--     zero rows from pg_roles) and creating it is a real security-
--     architecture change, not a narrow dispatch fix. Omitted here --
--     Production's certificate_issuance_snapshots already has
--     relrowsecurity=true AND relforcerowsecurity=true (confirmed this
--     session), which is the actual write-path boundary RLS already
--     enforces today, independent of this additional role-based layer.
--     This migration is no less safe than Production's current baseline;
--     it simply does not add staging's extra belt-and-suspenders check.
--     Adding that role, and re-pointing the issuance RPC's ownership at it,
--     is a separate, larger decision left for explicit future authorization
--     if the owner wants it.
--   - Inspector and Working at Height dispatch branches, course UUIDs,
--     programme content, and watermark fields are entirely absent from
--     every function below -- not merely inactive. This migration cannot
--     activate Inspector/WAH because it contains no code path for them.
--     One exception, independently verified (Codex C4C-2D review finding
--     #7): app.issue_certificate_with_skill_snapshot's signature-URL
--     fallback CASE, preserved verbatim from Production's own existing
--     function body, still contains a 'working_at_height_certificate'
--     branch -- inert, already-live, inherited code (see that statement's
--     own inline comment), not new dispatch logic this migration adds.
--   - app.request_actor_id() vs the existing auth.uid() call in Production's
--     issue_certificate_with_skill_snapshot: left exactly as Production has
--     it today (auth.uid()). Not required for Golden Reference dispatch;
--     changing it would widen this migration's diff for no Erector-specific
--     benefit.
--   - Erector theory/practical assessment weighting: untouched. Nothing
--     below reads or writes attendance_min_percent, assessment_required,
--     competency_required, or any scoring logic.
--   - HQ Admin (certificate_branches address editing) and its RPC: entirely
--     unrelated tables/functions, not referenced anywhere below.
--
-- Historical safety: every statement below is CREATE OR REPLACE FUNCTION,
-- ADD COLUMN IF NOT EXISTS, or a guarded CREATE TRIGGER (DROP TRIGGER IF
-- EXISTS immediately before CREATE, so a re-run is idempotent and there is
-- no window where a trigger name collision could fail the migration). No
-- PRE-EXISTING certificates, snapshots, or skill-result row is ever read,
-- written, or backfilled by anything in this file (precise wording per
-- Codex C4C-2D review finding #6: the two UPDATE public.certificates
-- statements inside the function bodies below -- the AFTER-trigger's
-- render_contract_version marker write, and the issuance RPC's
-- verification_url write -- are both scoped by `where id = <the row that
-- very same statement/transaction just inserted>`, never able to reach any
-- row that existed before this migration's functions ran; this was
-- confirmed empirically in isolated testing, where the pre-migration
-- certificate used as a historical baseline was byte-identical across both
-- a first and a second application of this migration). The new
-- render_contract_version column is added as NULL-default, so every
-- historical certificate row
-- keeps its current NULL value untouched; the three functions only ever
-- fire on a genuinely NEW INSERT, never on existing rows. No DROP of any
-- existing object. No destructive statement of any kind.

begin;

-- 1. Additive column. NULL default -- every existing certificate row is
--    unaffected; only a future INSERT (or an explicit, separately-
--    authorized UPDATE, which nothing here performs) ever sets it.
alter table public.certificates
  add column if not exists render_contract_version text;

-- 2. BEFORE INSERT trigger function on certificate_issuance_snapshots.
--    Erector-only: the dispatch table below has exactly the 3 real
--    Scaffolding Erector course UUIDs (re-confirmed live against
--    Production's own public.courses this session) and no other branch.
--    Required-field and skill-result validation mirrors staging's proven
--    logic verbatim (re-read from 20261031120000_c4_wave1_inspector_wah_
--    snapshot_dispatch.sql's own Erector-only lines, which that file's
--    header states are byte-for-byte identical to the original Erector-
--    only version). The current_user role check is intentionally omitted
--    -- see header comment above.
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
  v_level text;
  v_key text;
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

  -- C4C-2G: dispatch is an explicit Erector allowlist; everything else is
  -- an unconditional legacy pass-through (renderer_version stays
  -- 'certificate_renderer_v1', render_payload untouched). Staging's version
  -- raised here for any unrecognised course sharing the
  -- 'standard_scaffold_certificate' design_variant -- safe on staging, where
  -- that variant's course set was fully known, but Production
  -- (iagzkrzeuawaxvacqprk) independently has 3 enabled Inspector courses
  -- (b10c2e4b-..., 18945a4b-..., b7c0866c-...) bound to the same template
  -- and variant, verified read-only 2026-11-01. Raising would reject their
  -- issuance outright. A misconfigured Erector course is still caught
  -- below: an Erector UUID with the wrong design_variant fails closed.
  if v_course_id is null then
    return new;
  end if;

  case v_course_id
    when '2a78decf-6997-4626-a7cc-a1a23a110cf8'::uuid then
      v_level := 'basic'; v_key := 'basic_erection';
    when '904293c4-8792-41d7-8744-42143887e577'::uuid then
      v_level := 'intermediate'; v_key := 'intermediate_erection';
    when 'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'::uuid then
      v_level := 'advanced'; v_key := 'advanced_erection';
    else
      v_key := null;
  end case;

  if v_key is null then
    return new;
  end if;

  if new.template_config->>'design_variant' is distinct from 'standard_scaffold_certificate' then
    raise exception 'C4 Wave 1 fail-closed: unsupported scaffold_erector certificate family (expected design_variant standard_scaffold_certificate, got %)', new.template_config->>'design_variant';
  end if;

  v_target_renderer_version := 'c4_wave1_v1';

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
    'certificate_family', 'scaffold_erector',
    'certificate_title', 'SCAFFOLDING TRAINING CERTIFICATE',
    'programme_level', v_level,
    'programme_resolver_version', 'scaffold_erector_resolver_v1',
    'programme_content_version', 'teras_erector_catalog_2026_v1',
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
    'branch_address', new.branch_address,
    'watermark_asset_family', 'scaffolding-technical'
  );

  return new;
end;
$function$;

-- 3. AFTER INSERT trigger function on certificate_issuance_snapshots.
--    Erector-only: validates the snapshot that statement 2 above just
--    wrote, then persists the write-once render_contract_version marker
--    onto the parent certificate row.
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
  if new.renderer_version is null or new.renderer_version not in ('certificate_renderer_v1', 'c4_wave1_v1') then
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

-- 4. BEFORE INSERT OR UPDATE OF render_contract_version trigger function on
--    certificates. Write-once enforcement for the new column: only this
--    trigger's own caller (via the AFTER INSERT trigger above, which runs
--    inside the same statement as the SECURITY DEFINER issuance RPC) may
--    ever set it, and only from NULL, exactly once.
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
      -- C4C-2H legacy provenance: certificates snapshotted before this
      -- migration carry no marker (the column is new, never backfilled).
      -- Production has exactly 2 such sources (both WAH, verified read-only
      -- 2026-11-01). A NULL source marker is accepted ONLY when the source
      -- provably predates C4: exactly one snapshot, renderer
      -- 'certificate_renderer_v1', and no C4 payload keys. The duplicate is
      -- then pinned to 'certificate_renderer_v1'. Every other NULL-marker
      -- source fails closed; non-NULL markers keep the strict equality rule.
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
       or new.render_contract_version not in ('certificate_renderer_v1', 'c4_wave1_v1') then
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

-- 5. Guarded trigger creation. These three triggers do not exist on
--    Production today (confirmed this session, zero rows from pg_trigger
--    on both target tables) -- this is the first time they are created
--    here, so each is wrapped in DROP TRIGGER IF EXISTS immediately before
--    CREATE TRIGGER for safe re-application.
drop trigger if exists trg_capture_c4_wave1_erector_snapshot on public.certificate_issuance_snapshots;
create trigger trg_capture_c4_wave1_erector_snapshot
  before insert on public.certificate_issuance_snapshots
  for each row execute function app.capture_c4_wave1_erector_snapshot();

drop trigger if exists trg_persist_certificate_render_contract_marker on public.certificate_issuance_snapshots;
create trigger trg_persist_certificate_render_contract_marker
  after insert on public.certificate_issuance_snapshots
  for each row execute function app.persist_certificate_render_contract_marker();

drop trigger if exists trg_guard_certificate_render_contract on public.certificates;
create trigger trg_guard_certificate_render_contract
  before insert or update of render_contract_version on public.certificates
  for each row execute function app.guard_certificate_render_contract();

-- 6. CHECK constraint mirroring the AFTER trigger's own digest cross-check,
--    scoped to the one renderer_version this migration understands.
alter table public.certificate_issuance_snapshots
  drop constraint if exists certificate_issuance_snapshots_c4_content_digest_check;
alter table public.certificate_issuance_snapshots
  add constraint certificate_issuance_snapshots_c4_content_digest_check
  check (
    renderer_version <> 'c4_wave1_v1'
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

-- 7. app.issue_certificate_with_skill_snapshot: narrow, additive patch to
--    Production's existing function body (NOT a wholesale replacement with
--    staging's version -- auth.uid() usage, structure, and every other
--    behavior is preserved exactly as Production has it today). Two
--    changes only:
--      a. identity_no/identity_last4 are now computed and inserted (the
--         certificates table already has both columns; Production's
--         current function simply never populated them, so every
--         certificate's "IC / Passport No." field rendered blank).
--      b. the same C4 Wave1 design-variant safety guard staging has,
--         scoped to only the 3 real Erector course IDs (Inspector/WAH
--         course IDs are not present in this guard at all).
create or replace function app.issue_certificate_with_skill_snapshot(p_schedule_id uuid, p_participant_id uuid, p_certificate_number text DEFAULT NULL::text)
 returns table(id uuid, verification_token text)
 language plpgsql
 security definer
 set search_path to 'public', 'app', 'extensions'
as $function$
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

  -- Signature-URL fallback CASE preserved verbatim from Production's
  -- existing, currently-live function body -- including its
  -- 'working_at_height_certificate' branch. This is pre-existing, already-
  -- deployed code being carried forward unchanged, not new WAH dispatch
  -- logic: this migration creates no WAH course, template, or trigger
  -- branch, so this CASE arm can never actually be reached by anything
  -- this migration adds. Removing it would be an unrelated, unnecessary
  -- edit to code this migration isn't meant to touch (Codex C4C-2D review
  -- finding #7, independently verified: this is the only Inspector/WAH-
  -- adjacent string anywhere in this file, and it's inert, inherited code,
  -- not an activation).
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

  -- C4 Wave1 Erector safety guard, scoped to exactly the 3 real Erector
  -- course IDs -- new in this migration. No Inspector/WAH course ID
  -- appears here.
  if v_elig.course_id in (
    '2a78decf-6997-4626-a7cc-a1a23a110cf8'::uuid,
    '904293c4-8792-41d7-8744-42143887e577'::uuid,
    'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'::uuid
  ) then
    if v_template_config->>'design_variant' is distinct from 'standard_scaffold_certificate' then
      raise exception 'C4_WAVE1_DESIGN_VARIANT_INVALID' using errcode = 'P0001';
    end if;
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
$function$;

commit;
