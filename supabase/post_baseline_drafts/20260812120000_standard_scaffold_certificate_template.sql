-- PROPOSED — NOT YET APPLIED. Prepared for review per Phase 6 of the Standard
-- Scaffold certificate family task; do not run against the live project
-- without explicit sign-off (this changes what certificate design 3 real,
-- live courses issue).
--
-- Creates the one shared "Standard Scaffold Certificate" template
-- (config.design_variant = 'standard_scaffold_certificate', rendered by the
-- existing generic CertificateDocument/CertificateBackPage — see
-- components/admin/CertificateDocument.tsx and lib/certificate-html.ts).
-- Per-programme content (title, level, objectives, coverage, outcomes,
-- assessment) is NOT stored on this row — it's supplied at render time by
-- lib/standard-scaffold-programmes.ts, keyed by course id, because one
-- template row is shared across seven different programmes.
--
-- Binds the template to only the 3 live courses confirmed by this task's
-- audit (2026-08-12): BASIC/INTERMEDIATE/ADVANCED ERECTOR SCAFFOLDING
-- COURSE. The other 4 target programmes (Basic/Intermediate/Advanced
-- Scaffold Inspection, Scaffold Awareness) have no live courses row yet —
-- see the audit report — so nothing is bound for them here; re-run this
-- file (idempotent) once those course rows exist.
--
-- Template A (courses.id 8f8717a4-56e2-4781-bbd4-644ede64be2e, "TERAS
-- Professional Scaffold Erection Skills Programme") is untouched — this
-- migration only ever inserts a new template row and updates courses whose
-- certificate_template_id is currently null.

do $$
declare
  v_template_id uuid;
begin
  select id into v_template_id
  from public.certificate_templates
  where config->>'design_variant' = 'standard_scaffold_certificate'
  limit 1;

  if v_template_id is null then
    insert into public.certificate_templates (name, description, orientation, is_active, is_default, config)
    values (
      'TERAS Standard Scaffold Certificate',
      'Shared template for the Standard Scaffold certificate family (Basic/Intermediate/Advanced Erection & Inspection, Scaffold Awareness). Internal key: standard_scaffold_certificate. Per-programme content lives in lib/standard-scaffold-programmes.ts, not this row — see certData.ts for the merge.',
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
        'show_skills_record', true,
        'contact_phone', '019-519 3834',
        'contact_email', 'admin@terasuniversal.com.my',
        'contact_website', 'www.terasuniversal.com.my'
      )
    )
    returning id into v_template_id;
  end if;

  -- Only touches courses currently unbound (certificate_template_id is null)
  -- so re-running this file never clobbers a manual reassignment made later.
  update public.courses
  set certificate_template_id = v_template_id,
      certificate_generation_enabled = true
  where id in (
    '3a73c860-f4ac-4dc7-9358-b2f653a487fc', -- BASIC ERECTOR SCAFFOLDING COURSE
    'ecd31e73-a21e-4320-a063-cce9e10f6599', -- INTERMEDIATE ERECTOR SCAFFOLDING COURSE
    'b014f14e-1cc4-408d-a3f2-293e258bb1b7'  -- ADVANCED ERECTOR SCAFFOLDING COURSE
  )
  and certificate_template_id is null;
end $$;
