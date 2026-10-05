-- C4 Wave 1A: capture an immutable Erector rendering contract for new issuance only.
-- The issuer marker and snapshot facts are written atomically in its issuance transaction.

alter table public.certificates
  add column render_contract_version text;

comment on column public.certificates.render_contract_version is
  'Immutable issuance-time renderer contract discriminator copied from trusted snapshots; NULL is reserved for legacy certificates without an issuance snapshot.';

-- Existing modern rows are identified from their immutable snapshot, never from
-- mutable course/template data. Legacy rows without a snapshot remain NULL.
update public.certificates c
   set render_contract_version = s.renderer_version
  from public.certificate_issuance_snapshots s
 where s.certificate_id = c.id
   and s.renderer_version is not null
   and c.render_contract_version is null;

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

do $marker_authority_preflight$
begin
  if current_user <> 'postgres' then
    raise exception 'C4 Wave 1A precondition failed: migration requires migration role postgres';
  end if;
  if (select r.rolcanlogin from pg_catalog.pg_roles r
      where r.rolname = 'certificate_lifecycle_executor') is distinct from false
     or pg_catalog.pg_has_role('anon', 'certificate_lifecycle_executor', 'SET')
     or pg_catalog.pg_has_role('authenticated', 'certificate_lifecycle_executor', 'SET')
     or pg_catalog.pg_has_role('service_role', 'certificate_lifecycle_executor', 'SET') then
    raise exception 'C4 Wave 1A precondition failed: executor identity is login-capable or reachable by an API role';
  end if;
end;
$marker_authority_preflight$;

-- Ownership model for the three new trigger functions below (guard, capture,
-- persist): all three are SECURITY INVOKER and execute with the privileges of
-- whichever role performed the triggering INSERT/UPDATE. That role is always
-- certificate_lifecycle_executor in practice, because public.certificates and
-- public.certificate_issuance_snapshots writes are reachable only through the
-- SECURITY DEFINER app.issue_certificate_with_skill_snapshot (and its sibling
-- lifecycle RPCs) owned by certificate_lifecycle_executor — current_user is
-- already that role for the whole nested call chain, including these
-- triggers. Ownership of the trigger functions therefore does not need to be
-- certificate_lifecycle_executor: only EXECUTE privilege matters for a
-- SECURITY INVOKER function. Each function keeps its default owner (the
-- migration role, postgres) and is granted EXECUTE to certificate_lifecycle_executor
-- only, with PUBLIC/anon/authenticated/service_role explicitly revoked.
-- This avoids the unsupported alternative of transferring ownership to
-- certificate_lifecycle_executor, which would require either CREATE ON
-- SCHEMA app for that role or SET-capable membership for postgres — both of
-- which I3 (20260924180000) deliberately withholds as a standing security
-- invariant and which this migration must not weaken.

create or replace function app.guard_certificate_render_contract()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $guard$
declare
  v_source_marker text;
  v_source_renderer text;
begin
  if tg_op = 'INSERT' then
    if new.replaces_certificate_id is not null then
      if current_user <> 'certificate_lifecycle_executor' then
        raise exception 'Certificate duplicates may only be created by the trusted lifecycle executor';
      end if;
      select src.render_contract_version, snap.renderer_version
        into v_source_marker, v_source_renderer
      from public.certificates src
      join public.certificate_issuance_snapshots snap on snap.certificate_id = src.id
      where src.id = new.replaces_certificate_id;
      if not found or v_source_marker is distinct from v_source_renderer then
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
    if current_user <> 'certificate_lifecycle_executor'
       or pg_catalog.pg_trigger_depth() <= 1
       or old.render_contract_version is not null
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
$guard$;

-- SECURITY INVOKER / owner postgres (default) / required current_user at
-- trigger-fire-time: certificate_lifecycle_executor (enforced inside the
-- function body). No ownership transfer: see ownership-model note above.
revoke all on function app.guard_certificate_render_contract() from public, anon, authenticated, service_role;
grant execute on function app.guard_certificate_render_contract() to certificate_lifecycle_executor;

drop trigger if exists trg_guard_certificate_render_contract on public.certificates;
create trigger trg_guard_certificate_render_contract
before insert or update of render_contract_version on public.certificates
for each row execute function app.guard_certificate_render_contract();

do $preflight$
declare
  v_fn oid := pg_catalog.to_regprocedure('app.issue_certificate_with_skill_snapshot(uuid,uuid,text)');
  v_owner text;
  v_definer boolean;
  v_config text[];
  v_acl text;
  v_definition text;
  v_insert text := 'insert into public.certificate_issuance_snapshots (';
  v_pos integer;
begin
  if v_fn is null or pg_catalog.to_regclass('public.certificate_issuance_snapshots') is null then
    raise exception 'C4 Wave 1A precondition failed: issuer or issuance snapshot table is missing';
  end if;
  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, p.proacl::text
    into v_owner, v_definer, v_config, v_acl
  from pg_catalog.pg_proc p where p.oid = v_fn;
  v_definition := pg_catalog.pg_get_functiondef(v_fn);
  if v_owner <> 'certificate_lifecycle_executor'
     or v_definer is distinct from true
     or v_config is distinct from array['search_path=public, app, extensions']::text[]
     or v_acl is distinct from '{certificate_lifecycle_executor=X/certificate_lifecycle_executor}'
     or not pg_catalog.has_function_privilege('certificate_lifecycle_executor', v_fn, 'EXECUTE')
     or pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')
     or pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')
     or pg_catalog.strpos(v_definition, 'app.request_actor_id()') = 0
     or pg_catalog.strpos(v_definition, 'auth.uid()') > 0 then
    raise exception 'C4 Wave 1A precondition failed: issuer exact owner/security/search_path/ACL/actor contract differs';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(v_fn);
  v_pos := pg_catalog.strpos(v_definition, v_insert);
  if v_pos = 0 or pg_catalog.strpos(pg_catalog.substr(v_definition, v_pos + pg_catalog.length(v_insert)), v_insert) > 0
     or pg_catalog.strpos(v_definition, 'app.c4_wave1_erector_issuance') > 0 then
    raise exception 'C4 Wave 1A precondition failed: trusted issuer snapshot insertion is absent/ambiguous or uses caller-settable marker authority';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid = v_fn
      and pg_catalog.pg_get_userbyid(p.proowner) = 'certificate_lifecycle_executor'
      and p.prosecdef is true
      and p.proconfig is not distinct from array['search_path=public, app, extensions']::text[]
      and p.proacl::text = '{certificate_lifecycle_executor=X/certificate_lifecycle_executor}'
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      and pg_catalog.strpos(p.prosrc, 'app.c4_wave1_erector_issuance') = 0
      and pg_catalog.strpos(p.prosrc, 'app.request_actor_id()') > 0
      and pg_catalog.strpos(p.prosrc, 'auth.uid()') = 0
  ) then
    raise exception 'C4 Wave 1A postcondition failed: issuer exact security, actor attribution, or no-GUC source contract changed';
  end if;
end;
$preflight$;

create or replace function app.capture_c4_wave1_erector_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $capture$
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
  if current_user <> 'certificate_lifecycle_executor' then
    raise exception 'Issuance snapshots may only be written by the trusted lifecycle executor';
  end if;

  select c.course_id, c.render_contract_version, c.replaces_certificate_id
    into v_course_id, v_certificate_contract, v_replaces_certificate_id
  from public.certificates c
  where c.id = new.certificate_id;
  if not found then
    raise exception 'Issuance snapshot has no matching certificate';
  end if;

  -- A duplicate already carries the source contract marker and a copied
  -- immutable snapshot. Preserve that snapshot byte-for-byte; do not resolve
  -- current course, template, programme, or schedule data again.
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

  if v_course_id is null then
    if new.template_config->>'design_variant' = 'standard_scaffold_certificate' then
      raise exception 'C4 Wave 1A fail-closed: issuance snapshot has no canonical course UUID';
    end if;
    return new;
  end if;

  if v_course_id not in (
      '2a78decf-6997-4626-a7cc-a1a23a110cf8'::uuid,
      '904293c4-8792-41d7-8744-42143887e577'::uuid,
      'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'::uuid
    ) then
    if new.template_config->>'design_variant' = 'standard_scaffold_certificate' then
      raise exception 'C4 Wave 1A fail-closed: unknown Erector course UUID %', v_course_id;
    end if;
    return new;
  end if;
  if new.template_config->>'design_variant' is distinct from 'standard_scaffold_certificate' then
    raise exception 'C4 Wave 1A fail-closed: unsupported Erector certificate family';
  end if;
  v_target_renderer_version := 'c4_wave1_v1';

  case v_course_id
    when '2a78decf-6997-4626-a7cc-a1a23a110cf8'::uuid then
      v_level := 'basic'; v_key := 'basic_erection';
      v_programme_content := pg_catalog.jsonb_build_object(
        'programme_title', 'TERAS BASIC SCAFFOLD ERECTION PROGRAMME',
        'programme_duration', '10-Day Practical Training',
        'objectives', 'Fundamental knowledge and practical skills to safely erect, modify, inspect and dismantle scaffolding structures in accordance with industry standards and workplace safety requirements.',
        'coverage', pg_catalog.jsonb_build_array('Scaffolding Components & Terminology','Workplace Hazard Identification','Personal Protective Equipment (PPE)','Safe Scaffold Erection & Dismantling','Pre-Use Component Inspection','Safety Procedures & Best Practices','Teamwork in Scaffolding Operations'),
        'outcomes', pg_catalog.jsonb_build_array('Identify scaffolding components and terminology correctly','Recognise and control common workplace hazards','Select and use PPE correctly','Erect and dismantle basic scaffold structures safely','Carry out a pre-use inspection of scaffold components'),
        'assessment', pg_catalog.jsonb_build_array('Theory Assessment','Practical Assessment','Continuous Trainer Evaluation'),
        'content_source', 'data/courseCatalog.js — Basic Scaffolder (Level 1), TERAS UNIVERSAL Training Course Catalogue 2026');
    when '904293c4-8792-41d7-8744-42143887e577'::uuid then
      v_level := 'intermediate'; v_key := 'intermediate_erection';
      v_programme_content := pg_catalog.jsonb_build_object(
        'programme_title', 'TERAS INTERMEDIATE SCAFFOLD ERECTION PROGRAMME',
        'programme_duration', '10-Day Practical Training',
        'objectives', 'Further develops the knowledge, technical skills and practical competency of scaffolders who have completed Basic Scaffold Erection, for greater responsibilities in construction, maintenance, petrochemical and Oil & Gas operations.',
        'coverage', pg_catalog.jsonb_build_array('Work Planning & Organisation','Reading Scaffold Drawings & Instructions','Erecting Complex Scaffold Structures','Hazard Identification & Control Measures','Inspecting Completed Structures','Safe Supervision Practices','Industry Standards & Regulatory Requirements'),
        'outcomes', pg_catalog.jsonb_build_array('Plan scaffolding work activities safely','Interpret scaffold drawings and work instructions','Erect, modify and dismantle more complex scaffold structures','Identify hazards and apply effective control measures','Conduct inspections on completed scaffold structures'),
        'assessment', pg_catalog.jsonb_build_array('Theory Assessment','Practical Assessment','Continuous Trainer Evaluation'),
        'content_source', 'data/courseCatalog.js — Intermediate Scaffolder (Level 2), TERAS UNIVERSAL Training Course Catalogue 2026');
    when 'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'::uuid then
      v_level := 'advanced'; v_key := 'advanced_erection';
      v_programme_content := pg_catalog.jsonb_build_object(
        'programme_title', 'TERAS ADVANCED SCAFFOLD ERECTION PROGRAMME',
        'programme_duration', '10-Day Practical Training',
        'objectives', 'Designed for experienced scaffolders who wish to further enhance their technical expertise and leadership capabilities in complex scaffolding operations, covering advanced planning, supervision, structural stability, inspection and risk management.',
        'coverage', pg_catalog.jsonb_build_array('Planning Complex Scaffolding Operations','Team Supervision & Safety','Advanced Drawings & Specifications','Scaffold Stability Evaluation','Comprehensive Inspection & Corrective Action','Risk Management & Compliance','Leadership & Communication'),
        'outcomes', pg_catalog.jsonb_build_array('Plan and coordinate complex scaffolding operations','Supervise scaffolding teams effectively and safely','Evaluate scaffold stability and identify structural hazards','Conduct comprehensive scaffold inspections','Apply risk management strategies and regulatory requirements'),
        'assessment', pg_catalog.jsonb_build_array('Theory Assessment','Practical Assessment','Continuous Trainer Evaluation'),
        'content_source', 'data/courseCatalog.js — Advanced Scaffolder (Level 3), TERAS UNIVERSAL Training Course Catalogue 2026');
    else
      raise exception 'C4 Wave 1A fail-closed: unknown Erector course UUID %', v_course_id;
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
    raise exception 'C4 Wave 1A fail-closed: required issuance snapshot fact, signature, or verification reference is missing/invalid';
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
    raise exception 'C4 Wave 1A fail-closed: the five immutable skill/attendance records are incomplete';
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
$capture$;

-- SECURITY INVOKER / owner postgres (default) / required current_user at
-- trigger-fire-time: certificate_lifecycle_executor (enforced inside the
-- function body). No ownership transfer: see ownership-model note above.
revoke all on function app.capture_c4_wave1_erector_snapshot() from public, anon, authenticated, service_role;
grant execute on function app.capture_c4_wave1_erector_snapshot() to certificate_lifecycle_executor;

create trigger trg_capture_c4_wave1_erector_snapshot
before insert on public.certificate_issuance_snapshots
for each row execute function app.capture_c4_wave1_erector_snapshot();

-- Persist the discriminator after the matching immutable snapshot row exists.
create or replace function app.persist_certificate_render_contract_marker()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $persist$
declare
  v_existing_marker text;
  v_replaces_certificate_id uuid;
begin
  if current_user <> 'certificate_lifecycle_executor' then
    raise exception 'Render contract markers may only be persisted by the trusted lifecycle executor';
  end if;
  if new.renderer_version not in ('certificate_renderer_v1', 'c4_wave1_v1') then
    raise exception 'Unknown issuance snapshot renderer version %', new.renderer_version;
  end if;
  if not exists (
    select 1 from public.certificate_issuance_snapshots snap
    where snap.certificate_id = new.certificate_id
      and snap.renderer_version = new.renderer_version
  ) then
    raise exception 'Render contract marker requires its matching inserted snapshot';
  end if;

  select c.render_contract_version, c.replaces_certificate_id
    into v_existing_marker, v_replaces_certificate_id
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
$persist$;

-- SECURITY INVOKER / owner postgres (default) / required current_user at
-- trigger-fire-time: certificate_lifecycle_executor (enforced inside the
-- function body). No ownership transfer: see ownership-model note above.
-- This function's UPDATE on public.certificates is column-scoped to
-- render_contract_version only — SELECT privilege on public.certificates
-- is not separately required here: the executor already holds table-level
-- SELECT on public.certificates (20260924180000), and the UPDATE's WHERE
-- clause (id = new.certificate_id and render_contract_version is null)
-- reads columns already covered by the id INSERT privilege and this new
-- render_contract_version UPDATE grant, not any column outside them.
revoke all on function app.persist_certificate_render_contract_marker() from public, anon, authenticated, service_role;
grant execute on function app.persist_certificate_render_contract_marker() to certificate_lifecycle_executor;
grant update (render_contract_version) on public.certificates to certificate_lifecycle_executor;

create trigger trg_persist_certificate_render_contract_marker
after insert on public.certificate_issuance_snapshots
for each row execute function app.persist_certificate_render_contract_marker();

-- Verify the dispatch marker, trigger boundary, and existing issuer security contract.
do $postconditions$
declare
  v_fn oid := pg_catalog.to_regprocedure('app.issue_certificate_with_skill_snapshot(uuid,uuid,text)');
  v_trigger_fn oid := pg_catalog.to_regprocedure('app.capture_c4_wave1_erector_snapshot()');
  v_marker_fn oid := pg_catalog.to_regprocedure('app.persist_certificate_render_contract_marker()');
  v_guard_fn oid := pg_catalog.to_regprocedure('app.guard_certificate_render_contract()');
  v_trigger_enabled "char";
  v_marker_trigger_enabled "char";
  v_guard_trigger_enabled "char";
begin
  select t.tgenabled into v_trigger_enabled
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.certificate_issuance_snapshots'::regclass
    and t.tgname = 'trg_capture_c4_wave1_erector_snapshot'
    and not t.tgisinternal;
  if v_trigger_fn is null or v_trigger_enabled is distinct from 'O' then
    raise exception 'C4 Wave 1A postcondition failed: issuance snapshot trigger is not enabled';
  end if;
  select t.tgenabled into v_marker_trigger_enabled
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.certificate_issuance_snapshots'::regclass
    and t.tgname = 'trg_persist_certificate_render_contract_marker'
    and not t.tgisinternal
    and (t.tgtype & 1) = 1 and (t.tgtype & 4) = 4 and (t.tgtype & 2) = 0;
  if v_marker_fn is null or v_marker_trigger_enabled is distinct from 'O' then
    raise exception 'C4 Wave 1A postcondition failed: after-snapshot marker persistence trigger is not enabled';
  end if;
  select t.tgenabled into v_guard_trigger_enabled
  from pg_catalog.pg_trigger t
  where t.tgrelid = 'public.certificates'::regclass
    and t.tgname = 'trg_guard_certificate_render_contract'
    and not t.tgisinternal;
  if v_guard_fn is null or v_guard_trigger_enabled is distinct from 'O' then
    raise exception 'C4 Wave 1A postcondition failed: immutable render contract guard is not enabled';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_trigger_fn
      and pg_catalog.pg_get_userbyid(p.proowner) = current_user
      and not p.prosecdef
      and p.proconfig is not distinct from array['search_path=pg_catalog']::text[]
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('certificate_lifecycle_executor', p.oid, 'EXECUTE')
      and exists (select 1 from pg_catalog.aclexplode(p.proacl) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee = 'certificate_lifecycle_executor'::regrole and not acl.is_grantable)
      and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where acl.privilege_type = 'EXECUTE'
          and (acl.grantee not in (p.proowner, 'certificate_lifecycle_executor'::regrole)
            or (acl.grantee = 'certificate_lifecycle_executor'::regrole and acl.is_grantable)))) then
    raise exception 'C4 Wave 1A postcondition failed: capture helper exact owner/security/search_path/ACL contract differs';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_marker_fn
      and pg_catalog.pg_get_userbyid(p.proowner) = current_user
      and not p.prosecdef
      and p.proconfig is not distinct from array['search_path=pg_catalog']::text[]
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('certificate_lifecycle_executor', p.oid, 'EXECUTE')
      and exists (select 1 from pg_catalog.aclexplode(p.proacl) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee = 'certificate_lifecycle_executor'::regrole and not acl.is_grantable)
      and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where acl.privilege_type = 'EXECUTE'
          and (acl.grantee not in (p.proowner, 'certificate_lifecycle_executor'::regrole)
            or (acl.grantee = 'certificate_lifecycle_executor'::regrole and acl.is_grantable)))) then
    raise exception 'C4 Wave 1A postcondition failed: after-snapshot marker helper exact owner/security/search_path/ACL contract differs';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_guard_fn
      and pg_catalog.pg_get_userbyid(p.proowner) = current_user
      and not p.prosecdef
      and p.proconfig is not distinct from array['search_path=pg_catalog']::text[]
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      and pg_catalog.has_function_privilege('certificate_lifecycle_executor', p.oid, 'EXECUTE')
      and exists (select 1 from pg_catalog.aclexplode(p.proacl) acl
        where acl.privilege_type = 'EXECUTE'
          and acl.grantee = 'certificate_lifecycle_executor'::regrole and not acl.is_grantable)
      and not exists (select 1 from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) acl
        where acl.privilege_type = 'EXECUTE'
          and (acl.grantee not in (p.proowner, 'certificate_lifecycle_executor'::regrole)
            or (acl.grantee = 'certificate_lifecycle_executor'::regrole and acl.is_grantable)))) then
    raise exception 'C4 Wave 1A postcondition failed: render contract guard exact security contract differs';
  end if;
  if not pg_catalog.has_column_privilege('certificate_lifecycle_executor', 'public.certificates', 'render_contract_version', 'UPDATE') then
    raise exception 'C4 Wave 1A postcondition failed: executor is missing the narrow render_contract_version UPDATE privilege';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.certificates'::regclass
      and a.attnum > 0 and not a.attisdropped
      and a.attname <> 'render_contract_version'
      and pg_catalog.has_column_privilege('certificate_lifecycle_executor', 'public.certificates', a.attname, 'UPDATE')
      and a.attname not in (
        'verification_url','status','remarks','expiry_date','deleted_at','verification_enabled','public_verification_enabled'
      )
  ) then
    raise exception 'C4 Wave 1A postcondition failed: executor holds an UPDATE privilege on public.certificates beyond the pre-existing I3E grant plus render_contract_version';
  end if;
  if pg_catalog.has_table_privilege('certificate_lifecycle_executor', 'public.certificates', 'UPDATE') then
    raise exception 'C4 Wave 1A postcondition failed: executor must not hold table-wide (whole-row) UPDATE on public.certificates, only column-scoped grants';
  end if;
  if exists (
    select 1
    from public.certificate_issuance_snapshots s
    join public.certificates c on c.id = s.certificate_id
    where s.renderer_version is null
       or s.renderer_version not in ('certificate_renderer_v1', 'c4_wave1_v1')
       or c.render_contract_version is distinct from s.renderer_version
  ) then
    raise exception 'C4 Wave 1A postcondition failed: an existing snapshot marker is missing/mismatched or renderer version is unsupported';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.certificate_issuance_snapshots'::regclass
      and c.conname = 'certificate_issuance_snapshots_c4_content_digest_check'
      and c.contype = 'c' and c.convalidated
  ) then
    raise exception 'C4 Wave 1A postcondition failed: captured programme content digest constraint is absent or unvalidated';
  end if;
  if pg_catalog.pg_has_role('anon', 'certificate_lifecycle_executor', 'SET')
     or pg_catalog.pg_has_role('authenticated', 'certificate_lifecycle_executor', 'SET')
     or pg_catalog.pg_has_role('service_role', 'certificate_lifecycle_executor', 'SET') then
    raise exception 'C4 Wave 1A postcondition failed: an API role can assume the lifecycle executor identity';
  end if;
  if pg_catalog.has_schema_privilege('certificate_lifecycle_executor', 'app', 'CREATE') then
    raise exception 'C4 Wave 1A postcondition failed: executor must not hold CREATE on schema app';
  end if;
  if not exists (select 1 from pg_catalog.pg_proc p where p.oid = v_fn
      and pg_catalog.pg_get_userbyid(p.proowner) = 'certificate_lifecycle_executor'
      and p.prosecdef
      and p.proconfig is not distinct from array['search_path=public, app, extensions']::text[]
      and p.proacl::text = '{certificate_lifecycle_executor=X/certificate_lifecycle_executor}'
      and pg_catalog.has_function_privilege('certificate_lifecycle_executor', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
      and pg_catalog.strpos(p.prosrc, 'app.c4_wave1_erector_issuance') = 0
      and pg_catalog.strpos(p.prosrc, 'app.request_actor_id()') > 0
      and pg_catalog.strpos(p.prosrc, 'auth.uid()') = 0) then
    raise exception 'C4 Wave 1A postcondition failed: issuer exact security, actor attribution, or no-GUC contract differs';
  end if;
end;
$postconditions$;
