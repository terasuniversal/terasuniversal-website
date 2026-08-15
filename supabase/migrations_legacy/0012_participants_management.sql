-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0012 — Participant Management (expanded)
-- =====================================================================
-- Upgrades the participants table to the full internal-admin spec:
--   * auto-generated, unique participant_id (TU-000001 …)
--   * expanded demographic / employment / emergency-contact fields
--   * IC / Passport unique among live (non-deleted) rows
--   * appropriate indexes
--   * RLS: Editor = READ-ONLY; Admin / Super Admin = write (create/update/
--     soft-delete/restore). No hard delete via the API.
--
-- Idempotent (safe to re-run). Builds on migration 0004's participants table.
-- =====================================================================

-- --- Audit action: add 'import' (enum from 0001 lacked it) -----------
alter type audit_action add value if not exists 'import';

-- --- Expanded columns ------------------------------------------------
alter table public.participants
  add column if not exists participant_id           text,
  add column if not exists ic_passport_no           text,
  add column if not exists nationality              text default 'Malaysian',
  add column if not exists position                 text,
  add column if not exists gender                   text,
  add column if not exists date_of_birth            date,
  add column if not exists address                  text,
  add column if not exists emergency_contact_name   text,
  add column if not exists emergency_contact_phone  text,
  add column if not exists registration_date        date not null default current_date;

-- Migrate legacy `ic_passport` (from 0004) into the new column name, then drop it.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='participants' and column_name='ic_passport') then
    update public.participants set ic_passport_no = coalesce(ic_passport_no, ic_passport);
    alter table public.participants drop column ic_passport;
  end if;
end$$;

-- --- Auto-generated participant_id (race-safe via sequence) ----------
create sequence if not exists public.participant_id_seq;

create or replace function app.gen_participant_id()
returns trigger
language plpgsql
as $$
begin
  if new.participant_id is null or new.participant_id = '' then
    new.participant_id := 'TU-' || lpad(nextval('public.participant_id_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_participant_id on public.participants;
create trigger trg_participant_id
  before insert on public.participants
  for each row execute function app.gen_participant_id();

-- Backfill IDs for any pre-existing rows that lack one.
update public.participants
   set participant_id = 'TU-' || lpad(nextval('public.participant_id_seq')::text, 6, '0')
 where participant_id is null;

-- --- Uniqueness & indexes -------------------------------------------
-- participant_id globally unique.
create unique index if not exists uq_participants_participant_id
  on public.participants (participant_id);

-- IC / Passport unique among LIVE rows (a soft-deleted row frees its IC).
-- Case-insensitive so 'A1234' == 'a1234'.
create unique index if not exists uq_participants_ic_live
  on public.participants (lower(ic_passport_no))
  where deleted_at is null and ic_passport_no is not null;

create index if not exists idx_participants_company on public.participants (company) where deleted_at is null;
create index if not exists idx_participants_status_live on public.participants (status) where deleted_at is null;
create index if not exists idx_participants_created on public.participants (created_at desc);
create index if not exists idx_participants_search
  on public.participants using gin (
    to_tsvector('simple',
      coalesce(participant_id,'') || ' ' || coalesce(full_name,'') || ' ' ||
      coalesce(company,'') || ' ' || coalesce(ic_passport_no,'') || ' ' || coalesce(email,''))
  );

-- --- RLS: Editor read-only, Admin write ------------------------------
-- Replace the generic policies from 0004 with participant-management ones.
drop policy if exists participants_staff_read   on public.participants;
drop policy if exists participants_editor_write  on public.participants;
drop policy if exists participants_editor_update on public.participants;
drop policy if exists participants_admin_delete  on public.participants;

-- Read: any active staff member (editor and above).
create policy participants_read on public.participants
  for select using (app.is_editor());

-- Write (create / update / soft-delete / restore): admin and above only.
create policy participants_admin_insert on public.participants
  for insert with check (app.is_admin());
create policy participants_admin_update on public.participants
  for update using (app.is_admin()) with check (app.is_admin());

-- Hard delete: super_admin only (normal flow is soft delete via UPDATE).
create policy participants_super_delete on public.participants
  for delete using (app.is_super_admin());

-- Sequence usage for authenticated (needed by the trigger under RLS inserts).
grant usage, select on sequence public.participant_id_seq to authenticated;

comment on column public.participants.participant_id is 'Auto-generated public identifier, e.g. TU-000123.';
comment on column public.participants.ic_passport_no is 'IC or passport number; unique among non-deleted participants (case-insensitive).';
