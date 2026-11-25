-- Synthetic stand-in for the Production WAH course/template binding that 20261102030425 checks for (no real data).
insert into public.certificate_templates (id, name, orientation, paper_size, config, is_active, is_default)
values ('00000000-0000-4000-8000-00000000c0de', 'synthetic WAH template', 'landscape', 'A4',
        '{"design_variant":"working_at_height_certificate"}'::jsonb, true, false) on conflict do nothing;
insert into public.courses (id, title, certificate_template_id)
values ('963b1f6b-4c15-4833-90da-21aa0af0f544', 'synthetic WAH course', '00000000-0000-4000-8000-00000000c0de') on conflict do nothing;
