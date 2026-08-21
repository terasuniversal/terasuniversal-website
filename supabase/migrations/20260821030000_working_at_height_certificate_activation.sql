-- Working at Height Certificate — activation migration. Promoted from the
-- reviewed draft at
-- supabase/post_baseline_drafts/20260821020000_working_at_height_certificate_activation.sql
-- (WORKING_AT_HEIGHT_ACTIVATION_MIGRATION_READY_FOR_REVIEW, approved).
-- SQL logic is unchanged from that reviewed draft — only this header and the
-- filename/timestamp changed for promotion into the live migration chain.
--
-- Architectural pattern: identical to the hardened Standard Scaffold
-- activation migration (supabase/migrations/20260821010000_standard_scaffold_certificate_activation.sql,
-- applied to production, gate STANDARD_SCAFFOLD_PRODUCTION_PASS) --
-- duplicate-template detection, deterministic lookup (ORDER BY created_at
-- ASC, id ASC, never an unordered LIMIT 1), deleted_at guards throughout,
-- validation of an existing template before reuse (never silently
-- overwritten), non-clobbering course binding (only touches
-- certificate_template_id IS NULL), explicit expected-count postconditions
-- (never a combined "bad row" count that a missing/deleted target could
-- pass vacuously), and one DO block for atomicity -- any RAISE EXCEPTION
-- rolls back everything, including a freshly-inserted template row.
--
-- Creates the "Working at Height Certificate" template
-- (config.design_variant = 'working_at_height_certificate', rendered by the
-- existing generic CertificateDocument/CertificateBackPage — see
-- components/admin/CertificateDocument.tsx and lib/certificate-html.ts).
-- Per-programme content (title, duration, objectives, coverage, outcomes,
-- assessment) is NOT stored on this row — supplied at render time by
-- lib/working-at-height-programme.ts, keyed by course id (see certData.ts's
-- merge, shipped inert in PR #65, content approved in PR #66).
--
-- Binds exactly ONE course (the only live Working at Height course):
--   Working at Height   963b1f6b-4c15-4833-90da-21aa0af0f544
-- with certificate_generation_enabled = TRUE -- content is business-approved
-- (content_status: "verified", approved 2026-08-21) and the course is
-- published with 0 certificates issued, so there is no legacy-certificate
-- risk and no reason to withhold generation the way Standard Scaffold's
-- still-draft courses were.
--
-- EXCLUDED / PROTECTED, explicitly verified in the postconditions below —
-- this migration must never touch:
--   Template A (courses.id 8f8717a4-56e2-4781-bbd4-644ede64be2e, "TERAS
--     Professional Scaffold Erection Skills Programme"; template
--     738e929c-c9cd-47ce-b46a-a68a737457e8)
--   Standard Scaffold's template row and all 6 of its bound courses
--     (Basic/Advanced Scaffolding Erector — generation enabled; Intermediate
--     Scaffolding Erector + all 3 Inspector courses — generation disabled)
--   Any other course in the database.
--
-- Course UUID re-verified live (published, deleted_at IS NULL, 0
-- certificates issued, unbound) against the connected Supabase project on
-- 2026-08-21, cross-checked against the current
-- lib/working-at-height-programme.ts course_id value.

do $$
declare
  v_template_id uuid;
  v_template_count int;
  v_existing record;
  v_bad_count int;
  v_template_a_binding uuid;
  v_standard_scaffold_template_id uuid;
begin
  -- Snapshot Standard Scaffold's current template id up front, so the
  -- "unchanged" postcondition below checks against what was actually true
  -- before this migration ran, not an assumption.
  select id into v_standard_scaffold_template_id
  from public.certificate_templates
  where config->>'design_variant' = 'standard_scaffold_certificate'
    and deleted_at is null
  order by created_at asc, id asc
  limit 1;

  -- How many live (non-deleted) rows already claim this design_variant.
  -- Never picks one out of several silently -- see the branches below.
  select count(*) into v_template_count
  from public.certificate_templates
  where config->>'design_variant' = 'working_at_height_certificate'
    and deleted_at is null;

  if v_template_count > 1 then
    raise exception 'working_at_height_certificate_ambiguous: % rows already have config->>''design_variant'' = ''working_at_height_certificate''. Refusing to guess which is canonical -- resolve manually (merge/deactivate the extras) before re-running this migration.', v_template_count;

  elsif v_template_count = 1 then
    -- Deterministic even though there's only one row today: ORDER BY
    -- created_at ASC, id ASC (both NOT NULL columns) rather than an
    -- unordered LIMIT 1, so behavior can never depend on physical row order.
    select id, is_active, is_default, orientation, config into v_existing
    from public.certificate_templates
    where config->>'design_variant' = 'working_at_height_certificate'
      and deleted_at is null
    order by created_at asc, id asc
    limit 1;

    if v_existing.is_active is distinct from true
      or v_existing.is_default is distinct from false
      or v_existing.orientation is distinct from 'portrait'
      or (v_existing.config->>'show_skills_record')::boolean is distinct from false
    then
      raise exception 'working_at_height_certificate_conflict: existing template % does not match the approved Working at Height configuration (is_active=%, is_default=%, orientation=%, show_skills_record=%). Refusing to bind the course to an unknown/stale template, and refusing to silently overwrite its config -- resolve manually before re-running this migration.',
        v_existing.id, v_existing.is_active, v_existing.is_default, v_existing.orientation, (v_existing.config->>'show_skills_record');
    end if;

    v_template_id := v_existing.id;

  else
    insert into public.certificate_templates (name, description, orientation, is_active, is_default, config)
    values (
      'TERAS Working at Height Certificate',
      'Template for the Working at Height certificate (single live course). Internal key: working_at_height_certificate. Per-programme content lives in lib/working-at-height-programme.ts, not this row — see certData.ts for the merge. Content approved 2026-08-21.',
      'portrait',
      true,
      false,
      jsonb_build_object(
        'design_variant', 'working_at_height_certificate',
        'logo_url', '/teras-universal-logo.png',
        'primary_color', '#0B3A63',
        'accent_color', '#D4AF37',
        'signature_layout', 'single',
        'signature_name', 'Muhammad Azri Bin Mohd Latifi Amir',
        'signature_title', 'Director',
        'signature_url', '/signatures/director-signature.png',
        'show_qr', true,
        'show_back_page', true,
        'show_skills_record', false,
        'contact_phone', '019-519 3834',
        'contact_email', 'admin@terasuniversal.com.my',
        'contact_website', 'www.terasuniversal.com.my'
      )
    )
    returning id into v_template_id;
  end if;

  -- Bind the single Working at Height course. Only touches it if currently
  -- unbound and not soft-deleted, so re-running this file never clobbers a
  -- manual reassignment made later, and never reaches a course that's since
  -- been deleted.
  update public.courses
  set certificate_template_id = v_template_id,
      certificate_generation_enabled = true
  where id = '963b1f6b-4c15-4833-90da-21aa0af0f544' -- Working at Height
  and certificate_template_id is null
  and deleted_at is null;

  -- ── Postcondition checks ────────────────────────────────────────────────
  -- Any failure here rolls back the entire DO block (including a freshly
  -- inserted template row) via PL/pgSQL's implicit transaction -- there is
  -- no scenario where this migration reports success with a partially-
  -- applied state.

  -- Exactly one live Working at Height template.
  select count(*) into v_template_count
  from public.certificate_templates
  where config->>'design_variant' = 'working_at_height_certificate'
    and deleted_at is null;
  if v_template_count <> 1 then
    raise exception 'postcondition_failed: expected exactly 1 live working_at_height_certificate template after this migration, found %', v_template_count;
  end if;

  -- The target course must still exist live (not missing/soft-deleted) --
  -- an explicit existence count, not inferred from a "bad row" count that a
  -- missing row would silently pass.
  select count(*) into v_bad_count
  from public.courses
  where id = '963b1f6b-4c15-4833-90da-21aa0af0f544'
    and deleted_at is null;
  if v_bad_count <> 1 then
    raise exception 'postcondition_failed: expected exactly 1 live Working at Height target course, found % -- the course is missing or soft-deleted. Refusing to report success.', v_bad_count;
  end if;

  -- It must be bound to this template.
  select count(*) into v_bad_count
  from public.courses
  where id = '963b1f6b-4c15-4833-90da-21aa0af0f544'
    and deleted_at is null
    and certificate_template_id = v_template_id;
  if v_bad_count <> 1 then
    raise exception 'postcondition_failed: expected the Working at Height course to be bound to %, found % matching rows (likely already bound to a different template before this migration ran). Refusing to report success.', v_template_id, v_bad_count;
  end if;

  -- Generation must be enabled.
  select count(*) into v_bad_count
  from public.courses
  where id = '963b1f6b-4c15-4833-90da-21aa0af0f544'
    and deleted_at is null
    and certificate_generation_enabled = true;
  if v_bad_count <> 1 then
    raise exception 'postcondition_failed: expected certificate_generation_enabled = true for the Working at Height course, found %. Refusing to report success.', v_bad_count;
  end if;

  -- No unrelated course was bound to this template: exactly one course in
  -- the whole database points at v_template_id.
  select count(*) into v_bad_count
  from public.courses
  where certificate_template_id = v_template_id;
  if v_bad_count <> 1 then
    raise exception 'postcondition_failed: expected exactly 1 course bound to the working_at_height_certificate template (%), found % -- an unrelated course may have been affected. Refusing to report success.', v_template_id, v_bad_count;
  end if;

  -- Template A must be completely unaffected.
  select certificate_template_id into v_template_a_binding
  from public.courses
  where id = '8f8717a4-56e2-4781-bbd4-644ede64be2e'; -- TERAS Professional Scaffold Erection Skills Programme
  if v_template_a_binding is distinct from '738e929c-c9cd-47ce-b46a-a68a737457e8'::uuid then
    raise exception 'postcondition_failed: Template A''s course (8f8717a4-...) no longer points at Template A''s template (738e929c-...) -- found % instead. This migration must never touch Template A; aborting.', v_template_a_binding;
  end if;

  -- Standard Scaffold's template row and all 6 of its course bindings must
  -- be completely unaffected -- checked against the count of live
  -- standard_scaffold_certificate templates, and, if one exists, against
  -- the exact snapshot captured at the top of this block.
  select count(*) into v_bad_count
  from public.certificate_templates
  where config->>'design_variant' = 'standard_scaffold_certificate'
    and deleted_at is null;
  if v_bad_count <> 1 then
    raise exception 'postcondition_failed: expected exactly 1 live standard_scaffold_certificate template (unrelated to this migration), found %. This migration must never touch Standard Scaffold; aborting.', v_bad_count;
  end if;

  if v_standard_scaffold_template_id is not null then
    select count(*) into v_bad_count
    from public.courses
    where id in (
      '2a78decf-6997-4626-a7cc-a1a23a110cf8', -- Basic Scaffolding Erector
      'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'  -- Advanced Scaffolding Erector
    )
    and deleted_at is null
    and certificate_template_id = v_standard_scaffold_template_id
    and certificate_generation_enabled = true;
    if v_bad_count <> 2 then
      raise exception 'postcondition_failed: Standard Scaffold ACTIVATE_NOW bindings changed -- expected 2 courses still bound to % with generation enabled, found %. This migration must never touch Standard Scaffold; aborting.', v_standard_scaffold_template_id, v_bad_count;
    end if;

    select count(*) into v_bad_count
    from public.courses
    where id in (
      '904293c4-8792-41d7-8744-42143887e577', -- Intermediate Scaffolding Erector
      'b10c2e4b-f35f-478b-b450-f98323926345', -- Basic Scaffolding Inspector
      '18945a4b-8df0-4f39-bbf9-7bd91c1bb58d', -- Intermediate Scaffolding Inspector
      'b7c0866c-fe4e-4ccb-ad66-e18d3572ed3c'  -- Advanced Scaffolding Inspector
    )
    and deleted_at is null
    and certificate_template_id = v_standard_scaffold_template_id
    and certificate_generation_enabled = false;
    if v_bad_count <> 4 then
      raise exception 'postcondition_failed: Standard Scaffold BIND_BUT_DRAFT bindings changed -- expected 4 courses still bound to % with generation disabled, found %. This migration must never touch Standard Scaffold; aborting.', v_standard_scaffold_template_id, v_bad_count;
    end if;
  end if;
end $$;
