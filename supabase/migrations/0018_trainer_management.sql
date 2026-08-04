-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0018 — Trainer Management
-- =====================================================================
-- Extends the basic trainers table (0003) to the full spec: auto trainer_id,
-- employment fields, competencies/qualifications, photo + signature, and a
-- status lifecycle. Wires training_schedules to a proper trainer FK so the
-- schedule / assessment / certificate modules can integrate.
--
--   Manage = Admin+. View = Editor+ (read-only). Public reads active trainers.
-- Idempotent. Builds on trainers (0003) + training_schedules (0013).
-- =====================================================================

-- --- Status enum -----------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'trainer_status') then
    create type trainer_status as enum ('active', 'inactive', 'retired', 'on_leave');
  end if;
end$$;

-- --- Extend trainers -------------------------------------------------
alter table public.trainers
  add column if not exists trainer_id      text,
  add column if not exists ic_passport_no  text,
  add column if not exists staff_no        text,
  add column if not exists position        text,
  add column if not exists department      text,
  add column if not exists employment_type text,
  add column if not exists specialisation  text,
  add column if not exists qualifications  jsonb not null default '[]'::jsonb,
  add column if not exists competencies    jsonb not null default '[]'::jsonb,
  add column if not exists signature_image text,
  add column if not exists status          trainer_status not null default 'active',
  add column if not exists joining_date    date;

-- Rename legacy photo_url → trainer_photo (fresh DB safe).
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='trainers' and column_name='photo_url')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='trainers' and column_name='trainer_photo') then
    alter table public.trainers rename column photo_url to trainer_photo;
  end if;
end$$;
alter table public.trainers add column if not exists trainer_photo text;

-- Backfill status from the legacy is_active flag.
update public.trainers set status = case when is_active then 'active'::trainer_status else 'inactive'::trainer_status end
where status is null;

-- --- Auto trainer_id (TR-000001) -------------------------------------
create sequence if not exists public.trainer_id_seq;
create or replace function app.gen_trainer_id()
returns trigger language plpgsql as $$
begin
  if new.trainer_id is null or new.trainer_id = '' then
    new.trainer_id := 'TR-' || lpad(nextval('public.trainer_id_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;
drop trigger if exists trg_trainer_id on public.trainers;
create trigger trg_trainer_id before insert on public.trainers
  for each row execute function app.gen_trainer_id();

-- Backfill ids for any existing rows.
update public.trainers
  set trainer_id = 'TR-' || lpad(nextval('public.trainer_id_seq')::text, 6, '0')
where trainer_id is null;

-- --- Uniqueness & indexes -------------------------------------------
create unique index if not exists uq_trainers_trainer_id on public.trainers (trainer_id);
create unique index if not exists uq_trainers_ic_live on public.trainers (lower(ic_passport_no)) where deleted_at is null and ic_passport_no is not null;
create unique index if not exists uq_trainers_staff_live on public.trainers (lower(staff_no)) where deleted_at is null and staff_no is not null;
create index if not exists idx_trainers_status on public.trainers (status) where deleted_at is null;
create index if not exists idx_trainers_department on public.trainers (department) where deleted_at is null;
create index if not exists idx_trainers_search on public.trainers using gin (
  to_tsvector('simple', coalesce(trainer_id,'') || ' ' || coalesce(full_name,'') || ' ' || coalesce(department,'') || ' ' || coalesce(specialisation,''))
);

-- --- RLS: Admin write, Editor read, public reads active --------------
drop policy if exists trainers_public_read on public.trainers;
drop policy if exists trainers_staff_read  on public.trainers;
drop policy if exists trainers_editor_write on public.trainers;
drop policy if exists trainers_editor_update on public.trainers;
drop policy if exists trainers_admin_delete on public.trainers;

create policy trainers_public_read on public.trainers
  for select using (status = 'active' and deleted_at is null);
create policy trainers_staff_read on public.trainers
  for select using (app.is_editor());
create policy trainers_admin_insert on public.trainers
  for insert with check (app.is_admin());
create policy trainers_admin_update on public.trainers
  for update using (app.is_admin()) with check (app.is_admin());
create policy trainers_admin_delete on public.trainers
  for delete using (app.is_admin());

-- --- Integrate with training_schedules ------------------------------
alter table public.training_schedules
  add column if not exists trainer_id uuid references public.trainers (id) on delete set null;
create index if not exists idx_ts_trainer_id on public.training_schedules (trainer_id) where deleted_at is null;

-- --- Grants ----------------------------------------------------------
grant usage, select on sequence public.trainer_id_seq to authenticated;

comment on table public.trainers is 'Trainers / assessors / instructors. Auto trainer_id TR-000001. Manage = Admin+, view = Editor+, public reads active. Linked to training_schedules.trainer_id.';
