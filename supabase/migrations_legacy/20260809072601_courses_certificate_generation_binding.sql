-- Explicit generation-enablement + template binding, so certificate
-- generation for a course requires deliberate staff configuration rather
-- than relying on the eligibility-config defaults from the prior migration
-- (certificate_type='completion', attendance_min_percent=100, etc.), which
-- could otherwise make a course look "configured" without anyone having
-- actually decided it should issue certificates or with which design.
alter table public.courses
  add column if not exists certificate_generation_enabled boolean not null default false,
  add column if not exists certificate_template_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'courses_certificate_template_id_fkey'
  ) then
    alter table public.courses
      add constraint courses_certificate_template_id_fkey
      foreign key (certificate_template_id) references public.certificate_templates(id) on delete set null;
  end if;
end $$;

create index if not exists courses_certificate_template_id_idx
  on public.courses (certificate_template_id)
  where certificate_template_id is not null;

comment on column public.courses.certificate_generation_enabled is 'Explicit opt-in: certificate generation for schedules of this course is only permitted once staff have deliberately enabled it (and bound a template). Never inferred from other config defaults.';
comment on column public.courses.certificate_template_id is 'Which certificate_templates row generateCertificate must bind new certificates to for this course. NULL blocks generation even if certificate_generation_enabled=true (see v_certificate_eligibility).';
