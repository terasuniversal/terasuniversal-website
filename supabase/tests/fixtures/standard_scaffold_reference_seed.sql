-- LOCAL/DISPOSABLE TEST FIXTURE ONLY.
-- This is not a production migration and must never be applied to a linked
-- or shared environment. It supplies the operational course rows expected by
-- certificate activation migrations while preserving deterministic IDs.

BEGIN;

DO $$
DECLARE
  v record;
  v_existing record;
BEGIN
  -- The certificate activation migration protects this pre-existing Template
  -- A binding. Its exact UUID and design variant are the only values exposed
  -- by repository source; the display name below is a disposable fixture
  -- label and is never used by the production migration.
  SELECT id, name, config, is_active, is_default, orientation, deleted_at
    INTO v_existing
  FROM public.certificate_templates
  WHERE id = '738e929c-c9cd-47ce-b46a-a68a737457e8'::uuid;

  IF FOUND THEN
    IF v_existing.deleted_at IS NOT NULL
       OR v_existing.is_active IS DISTINCT FROM true
       OR v_existing.is_default IS DISTINCT FROM false
       OR v_existing.orientation IS DISTINCT FROM 'portrait'
       OR v_existing.config->>'design_variant' IS DISTINCT FROM 'professional_scaffold_erection_skills'
    THEN
      RAISE EXCEPTION 'incompatible disposable Template A fixture already exists: 738e929c-c9cd-47ce-b46a-a68a737457e8';
    END IF;
  ELSE
    INSERT INTO public.certificate_templates (id, name, orientation, is_active, is_default, config)
    VALUES (
      '738e929c-c9cd-47ce-b46a-a68a737457e8',
      'TERAS Professional Scaffold Erection Skills Programme',
      'portrait', true, false,
      jsonb_build_object('design_variant', 'professional_scaffold_erection_skills')
    );
  END IF;

  FOR v IN
    SELECT * FROM (VALUES
      ('2a78decf-6997-4626-a7cc-a1a23a110cf8'::uuid, 'Basic Scaffolding Erector', 'db-fixture-basic-scaffolding-erector', 'published'::text, 'published'::public.content_status, false),
      ('b9c737b8-8a97-4c91-91ee-c65dc5982ca7'::uuid, 'Advanced Scaffolding Erector', 'db-fixture-advanced-scaffolding-erector', 'published'::text, 'published'::public.content_status, false),
      ('904293c4-8792-41d7-8744-42143887e577'::uuid, 'Intermediate Scaffolding Erector', 'db-fixture-intermediate-scaffolding-erector', 'draft'::text, 'draft'::public.content_status, false),
      ('b10c2e4b-f35f-478b-b450-f98323926345'::uuid, 'Basic Scaffolding Inspector', 'db-fixture-basic-scaffolding-inspector', 'draft'::text, 'draft'::public.content_status, false),
      ('18945a4b-8df0-4f39-bbf9-7bd91c1bb58d'::uuid, 'Intermediate Scaffolding Inspector', 'db-fixture-intermediate-scaffolding-inspector', 'draft'::text, 'draft'::public.content_status, false),
      ('b7c0866c-fe4e-4ccb-ad66-e18d3572ed3c'::uuid, 'Advanced Scaffolding Inspector', 'db-fixture-advanced-scaffolding-inspector', 'draft'::text, 'draft'::public.content_status, false),
      ('8f8717a4-56e2-4781-bbd4-644ede64be2e'::uuid, 'TERAS Professional Scaffold Erection Skills Programme', 'db-fixture-professional-scaffold-erection', 'published'::text, 'published'::public.content_status, false),
      ('963b1f6b-4c15-4833-90da-21aa0af0f544'::uuid, 'Working at Height', 'db-fixture-working-at-height', 'published'::text, 'published'::public.content_status, false)
    ) AS x(id, title, slug, status, cms_status, generation_enabled)
  LOOP
    SELECT id, title, slug, status, cms_status, deleted_at, certificate_template_id,
           certificate_generation_enabled
      INTO v_existing
    FROM public.courses WHERE id = v.id;

    IF FOUND THEN
      IF v_existing.title IS DISTINCT FROM v.title
         OR v_existing.slug IS DISTINCT FROM v.slug
         OR v_existing.status IS DISTINCT FROM v.status
         OR v_existing.cms_status IS DISTINCT FROM v.cms_status
         OR v_existing.deleted_at IS NOT NULL
         OR (v.id = '8f8717a4-56e2-4781-bbd4-644ede64be2e'::uuid
             AND v_existing.certificate_template_id IS DISTINCT FROM '738e929c-c9cd-47ce-b46a-a68a737457e8'::uuid)
         OR (v.id <> '8f8717a4-56e2-4781-bbd4-644ede64be2e'::uuid
             AND v_existing.certificate_template_id IS NOT NULL)
         OR v_existing.certificate_generation_enabled IS DISTINCT FROM v.generation_enabled
      THEN
        RAISE EXCEPTION 'incompatible disposable course fixture already exists: %', v.id;
      END IF;
    ELSE
      INSERT INTO public.courses (
        id, title, slug, status, cms_status, deleted_at,
        certificate_template_id, certificate_generation_enabled
      ) VALUES (
        v.id, v.title, v.slug, v.status, v.cms_status, NULL,
        CASE WHEN v.id = '8f8717a4-56e2-4781-bbd4-644ede64be2e'::uuid
             THEN '738e929c-c9cd-47ce-b46a-a68a737457e8'::uuid ELSE NULL END,
        v.generation_enabled
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
