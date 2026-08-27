-- Repair the existing Working at Height template family marker. The original
-- activation migration is already applied in production, but the live WAH
-- template was subsequently persisted with the Standard Scaffold variant.
-- That makes both generic renderers correctly-but-wrongly choose a scaffold
-- watermark. This migration touches only the named WAH template and its
-- already-bound WAH course; Standard Scaffold is asserted unchanged.

do $$
declare
  v_wah_template_id uuid;
  v_standard_scaffold_template_id uuid;
  v_count int;
begin
  select id into v_wah_template_id
  from public.certificate_templates
  where name = 'TERAS Working at Height Certificate'
    and deleted_at is null
  order by created_at asc, id asc
  limit 1;

  if v_wah_template_id is null then
    raise exception 'working_at_height_template_missing: expected one live template named TERAS Working at Height Certificate';
  end if;

  select count(*) into v_count
  from public.certificate_templates
  where name = 'TERAS Working at Height Certificate'
    and deleted_at is null;
  if v_count <> 1 then
    raise exception 'working_at_height_template_ambiguous: expected exactly one live WAH template, found %', v_count;
  end if;

  select id into v_standard_scaffold_template_id
  from public.certificate_templates
  where config->>'design_variant' = 'standard_scaffold_certificate'
    and deleted_at is null
  order by created_at asc, id asc
  limit 1;

  update public.certificate_templates
  set config = (config - 'watermark_level' - 'inspector_watermark_level' - 'background_url')
    || jsonb_build_object(
      'design_variant', 'working_at_height_certificate',
      'show_skills_record', false
    )
  where id = v_wah_template_id
    and deleted_at is null;

  -- The course binding is intentionally not reassigned. It is checked below
  -- to ensure this repair cannot silently affect any other programme.
  select count(*) into v_count
  from public.courses
  where id = '963b1f6b-4c15-4833-90da-21aa0af0f544'
    and deleted_at is null
    and certificate_template_id = v_wah_template_id
    and certificate_generation_enabled = true;
  if v_count <> 1 then
    raise exception 'working_at_height_binding_invalid: expected the live WAH course to remain bound to % with generation enabled, found % rows', v_wah_template_id, v_count;
  end if;

  select count(*) into v_count
  from public.certificate_templates
  where id = v_wah_template_id
    and deleted_at is null
    and config->>'design_variant' = 'working_at_height_certificate'
    and coalesce(config->>'background_url', '') = ''
    and coalesce(config->>'watermark_level', '') = ''
    and coalesce(config->>'inspector_watermark_level', '') = '';
  if v_count <> 1 then
    raise exception 'working_at_height_template_repair_failed: WAH template still contains a non-WAH watermark configuration';
  end if;

  if v_standard_scaffold_template_id is not null and v_standard_scaffold_template_id = v_wah_template_id then
    raise exception 'standard_scaffold_protection_failed: WAH repair target unexpectedly matches the Standard Scaffold template';
  end if;
end $$;
