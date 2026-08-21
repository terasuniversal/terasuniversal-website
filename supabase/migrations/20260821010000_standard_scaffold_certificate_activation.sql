-- Standard Scaffold Certificate Family — activation migration. Promoted from
-- the reviewed draft at
-- supabase/post_baseline_drafts/20260821000000_standard_scaffold_certificate_activation.sql
-- (STANDARD_SCAFFOLD_ACTIVATION_MIGRATION_READY_FOR_REVIEW, approved), then
-- hardened once more after promotion (PR #64 re-review): the ACTIVATE_NOW /
-- BIND_BUT_DRAFT postconditions were combined "bad row" counts, keyed by
-- WHERE id IN (...) AND <mismatch> -- a target course that's completely
-- missing or soft-deleted contributes zero rows to that count, which reads
-- identically to "0 bad rows found" (success) even though fewer than the
-- approved 2/4 courses actually got activated. Replaced with explicit
-- expected-count assertions (exactly 2/4 live, exactly 2/4 bound, exactly
-- 2/4 with the correct generation flag) per group. Template config and the
-- binding matrix itself are unchanged from the reviewed draft; only these
-- postcondition checks were strengthened. The historical draft is left
-- unmodified -- this file is now the authoritative version.
--
-- Supersedes 20260812120000_standard_scaffold_certificate_template.sql
-- (supabase/post_baseline_drafts/), which is now stale: all 3 course_ids it
-- targeted were soft-deleted on 2026-08-14 (an unrelated course-data
-- cleanup), and it never covered the 3 Inspector programmes at all. That
-- file is left in place, untouched, as a historical record — it must not be
-- applied; this migration replaces it going forward.
--
-- Creates the one shared "Standard Scaffold Certificate" template
-- (config.design_variant = 'standard_scaffold_certificate', rendered by the
-- existing generic CertificateDocument/CertificateBackPage — see
-- components/admin/CertificateDocument.tsx and lib/certificate-html.ts).
-- Per-programme content (title, objectives, coverage, outcomes, assessment)
-- is NOT stored on this row — it's supplied at render time by
-- lib/standard-scaffold-programmes.ts, keyed by course id (see certData.ts's
-- merge, shipped inert in PR #62).
--
-- show_skills_record is explicitly FALSE. Template A's 3-column skills-record
-- table (Theory Session / Practical Training / Safety Awareness / Practical
-- Assessment / Attendance Requirement) is specific to Template A's own
-- Professional Scaffold Erection Skills Programme content; no Standard
-- Scaffold programme has a documented requirement for it. Do not flip this to
-- true without a documented Standard Scaffold requirement.
--
-- Binding, per the approved binding matrix:
--   ACTIVATE_NOW (published, certificate_template_id + certificate_generation_enabled = true):
--     Basic Scaffolding Erector        2a78decf-6997-4626-a7cc-a1a23a110cf8
--     Advanced Scaffolding Erector     b9c737b8-8a97-4c91-91ee-c65dc5982ca7
--   BIND_BUT_DRAFT (draft, certificate_template_id set, certificate_generation_enabled explicitly false):
--     Intermediate Scaffolding Erector    904293c4-8792-41d7-8744-42143887e577
--     Basic Scaffolding Inspector         b10c2e4b-f35f-478b-b450-f98323926345
--     Intermediate Scaffolding Inspector  18945a4b-8df0-4f39-bbf9-7bd91c1bb58d
--     Advanced Scaffolding Inspector      b7c0866c-fe4e-4ccb-ad66-e18d3572ed3c
--   HOLD: TERAS Scaffold Awareness Programme — no live courses row exists; not referenced below.
--   EXCLUDED: Template A (courses.id 8f8717a4-56e2-4781-bbd4-644ede64be2e, "TERAS
--     Professional Scaffold Erection Skills Programme") — not referenced below,
--     its own template row (738e929c-c9cd-47ce-b46a-a68a737457e8) is untouched.
--
-- All 6 target UUIDs re-verified live (published/draft status, deleted_at IS
-- NULL, zero certificates issued) against the connected Supabase project on
-- 2026-08-21, cross-checked against the current
-- lib/standard-scaffold-programmes.ts course_id values.
--
-- ATOMICITY: this entire file is one DO block, PL/pgSQL's implicit
-- transaction boundary. Every RAISE EXCEPTION below (ambiguous template,
-- config conflict, or a failed postcondition) aborts and rolls back
-- everything the block did up to that point, including a freshly-inserted
-- template row -- so this migration either reaches the fully-approved
-- activation state, or persists no changes at all. There is no partial-
-- success outcome.
--
-- certificate_templates schema re-verified live 2026-08-21: id, name,
-- description, orientation, paper_size (default 'A4', not set explicitly
-- here), config, is_active, is_default, created_by, updated_by, created_at,
-- updated_at, deleted_at. created_at is NOT NULL, so "ORDER BY created_at
-- ASC, id ASC" (id as the deterministic tiebreaker) is always well-defined.

do $$
declare
  v_template_id uuid;
  v_template_count int;
  v_existing record;
  v_bad_count int;
  v_template_a_binding uuid;
begin
  -- How many live (non-deleted) rows already claim this design_variant.
  -- Never picks one out of several silently -- see the branches below.
  select count(*) into v_template_count
  from public.certificate_templates
  where config->>'design_variant' = 'standard_scaffold_certificate'
    and deleted_at is null;

  if v_template_count > 1 then
    raise exception 'standard_scaffold_certificate_ambiguous: % rows already have config->>''design_variant'' = ''standard_scaffold_certificate''. Refusing to guess which is canonical -- resolve manually (merge/deactivate the extras) before re-running this migration.', v_template_count;

  elsif v_template_count = 1 then
    -- Deterministic even though there's only one row today: ORDER BY
    -- created_at ASC, id ASC (both NOT NULL columns) rather than an
    -- unordered LIMIT 1, so behavior can never depend on physical row order.
    select id, is_active, is_default, orientation, config into v_existing
    from public.certificate_templates
    where config->>'design_variant' = 'standard_scaffold_certificate'
      and deleted_at is null
    order by created_at asc, id asc
    limit 1;

    if v_existing.is_active is distinct from true
      or v_existing.is_default is distinct from false
      or v_existing.orientation is distinct from 'portrait'
      or (v_existing.config->>'show_skills_record')::boolean is distinct from false
    then
      raise exception 'standard_scaffold_certificate_conflict: existing template % does not match the approved Standard Scaffold configuration (is_active=%, is_default=%, orientation=%, show_skills_record=%). Refusing to bind courses to an unknown/stale template, and refusing to silently overwrite its config -- resolve manually before re-running this migration.',
        v_existing.id, v_existing.is_active, v_existing.is_default, v_existing.orientation, (v_existing.config->>'show_skills_record');
    end if;

    v_template_id := v_existing.id;

  else
    insert into public.certificate_templates (name, description, orientation, is_active, is_default, config)
    values (
      'TERAS Standard Scaffold Certificate',
      'Shared template for the Standard Scaffold certificate family (Basic/Intermediate/Advanced Erection & Inspection; Scaffold Awareness on HOLD). Internal key: standard_scaffold_certificate. Per-programme content lives in lib/standard-scaffold-programmes.ts, not this row — see certData.ts for the merge.',
      'portrait',
      true,
      false,
      jsonb_build_object(
        'design_variant', 'standard_scaffold_certificate',
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

  -- ACTIVATE_NOW: published courses. Only touches courses currently unbound
  -- (certificate_template_id IS NULL) and not soft-deleted, so re-running
  -- this file never clobbers a manual reassignment made later, and never
  -- reaches a course that's since been deleted.
  update public.courses
  set certificate_template_id = v_template_id,
      certificate_generation_enabled = true
  where id in (
    '2a78decf-6997-4626-a7cc-a1a23a110cf8', -- Basic Scaffolding Erector
    'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'  -- Advanced Scaffolding Erector
  )
  and certificate_template_id is null
  and deleted_at is null;

  -- BIND_BUT_DRAFT: draft courses. Template is assigned so the design is
  -- ready and reviewable, but certificate_generation_enabled is explicitly
  -- set to false (not left implicit) so issuance stays gated off until each
  -- course is published — a deliberate, auditable assertion, not a change
  -- from these courses' current state.
  update public.courses
  set certificate_template_id = v_template_id,
      certificate_generation_enabled = false
  where id in (
    '904293c4-8792-41d7-8744-42143887e577', -- Intermediate Scaffolding Erector
    'b10c2e4b-f35f-478b-b450-f98323926345', -- Basic Scaffolding Inspector
    '18945a4b-8df0-4f39-bbf9-7bd91c1bb58d', -- Intermediate Scaffolding Inspector
    'b7c0866c-fe4e-4ccb-ad66-e18d3572ed3c'  -- Advanced Scaffolding Inspector
  )
  and certificate_template_id is null
  and deleted_at is null;

  -- ── Postcondition checks ────────────────────────────────────────────────
  -- Any failure here rolls back the entire DO block (including a freshly
  -- inserted template row) via PL/pgSQL's implicit transaction -- there is
  -- no scenario where this migration reports success with a partially-
  -- applied state.

  select count(*) into v_template_count
  from public.certificate_templates
  where config->>'design_variant' = 'standard_scaffold_certificate'
    and deleted_at is null;
  if v_template_count <> 1 then
    raise exception 'postcondition_failed: expected exactly 1 live standard_scaffold_certificate template after this migration, found %', v_template_count;
  end if;

  -- The 2 ACTIVATE_NOW courses must now point at v_template_id with
  -- generation enabled. Three EXPLICIT counts, not one combined "bad row"
  -- count: a target course that's completely missing or soft-deleted
  -- contributes zero rows to a WHERE id IN (...) AND <mismatch> count, which
  -- would silently read as "0 bad rows" -- i.e. success -- even though fewer
  -- than the approved 2 courses actually got activated. Checking "exactly 2
  -- exist, exactly 2 are bound, exactly 2 have generation enabled"
  -- separately closes that gap; each is its own explicit assertion.
  select count(*) into v_bad_count
  from public.courses
  where id in (
    '2a78decf-6997-4626-a7cc-a1a23a110cf8',
    'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'
  )
  and deleted_at is null;
  if v_bad_count <> 2 then
    raise exception 'postcondition_failed: expected exactly 2 live ACTIVATE_NOW target courses, found % -- a target course is missing or soft-deleted. Refusing to report success.', v_bad_count;
  end if;

  select count(*) into v_bad_count
  from public.courses
  where id in (
    '2a78decf-6997-4626-a7cc-a1a23a110cf8',
    'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'
  )
  and deleted_at is null
  and certificate_template_id = v_template_id;
  if v_bad_count <> 2 then
    raise exception 'postcondition_failed: expected exactly 2 ACTIVATE_NOW courses bound to %, found % (likely already bound to a different template before this migration ran). Refusing to report success.', v_template_id, v_bad_count;
  end if;

  select count(*) into v_bad_count
  from public.courses
  where id in (
    '2a78decf-6997-4626-a7cc-a1a23a110cf8',
    'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'
  )
  and deleted_at is null
  and certificate_generation_enabled = true;
  if v_bad_count <> 2 then
    raise exception 'postcondition_failed: expected exactly 2 ACTIVATE_NOW courses with certificate_generation_enabled = true, found %. Refusing to report success.', v_bad_count;
  end if;

  -- Same three explicit checks for the 4 BIND_BUT_DRAFT courses (generation
  -- must be false, not merely "not true").
  select count(*) into v_bad_count
  from public.courses
  where id in (
    '904293c4-8792-41d7-8744-42143887e577',
    'b10c2e4b-f35f-478b-b450-f98323926345',
    '18945a4b-8df0-4f39-bbf9-7bd91c1bb58d',
    'b7c0866c-fe4e-4ccb-ad66-e18d3572ed3c'
  )
  and deleted_at is null;
  if v_bad_count <> 4 then
    raise exception 'postcondition_failed: expected exactly 4 live BIND_BUT_DRAFT target courses, found % -- a target course is missing or soft-deleted. Refusing to report success.', v_bad_count;
  end if;

  select count(*) into v_bad_count
  from public.courses
  where id in (
    '904293c4-8792-41d7-8744-42143887e577',
    'b10c2e4b-f35f-478b-b450-f98323926345',
    '18945a4b-8df0-4f39-bbf9-7bd91c1bb58d',
    'b7c0866c-fe4e-4ccb-ad66-e18d3572ed3c'
  )
  and deleted_at is null
  and certificate_template_id = v_template_id;
  if v_bad_count <> 4 then
    raise exception 'postcondition_failed: expected exactly 4 BIND_BUT_DRAFT courses bound to %, found % (likely already bound to a different template before this migration ran). Refusing to report success.', v_template_id, v_bad_count;
  end if;

  select count(*) into v_bad_count
  from public.courses
  where id in (
    '904293c4-8792-41d7-8744-42143887e577',
    'b10c2e4b-f35f-478b-b450-f98323926345',
    '18945a4b-8df0-4f39-bbf9-7bd91c1bb58d',
    'b7c0866c-fe4e-4ccb-ad66-e18d3572ed3c'
  )
  and deleted_at is null
  and certificate_generation_enabled = false;
  if v_bad_count <> 4 then
    raise exception 'postcondition_failed: expected exactly 4 BIND_BUT_DRAFT courses with certificate_generation_enabled = false, found %. Refusing to report success.', v_bad_count;
  end if;

  -- Template A must be completely unaffected by anything above.
  select certificate_template_id into v_template_a_binding
  from public.courses
  where id = '8f8717a4-56e2-4781-bbd4-644ede64be2e'; -- TERAS Professional Scaffold Erection Skills Programme

  if v_template_a_binding is distinct from '738e929c-c9cd-47ce-b46a-a68a737457e8'::uuid then
    raise exception 'postcondition_failed: Template A''s course (8f8717a4-...) no longer points at Template A''s template (738e929c-...) -- found % instead. This migration must never touch Template A; aborting.', v_template_a_binding;
  end if;
end $$;
