-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0007 — Row Level Security Policies
-- =====================================================================
-- Model:
--   * Public website reads published content through the ANON key, but
--     only via SECURITY DEFINER RPCs / views (see note) OR narrow SELECT
--     policies limited to status = 'published' AND deleted_at IS NULL.
--   * All writes require an authenticated staff member (editor+).
--   * Deletes / user management require admin / super_admin.
--   * CRM inbound tables (enquiries, proposal_requests) accept ANON
--     INSERT (the public forms) but only staff can read them.
--   * audit_logs are append-only and staff-read-only.
--
-- Every table has RLS ENABLED. "force row level security" is set so even
-- the table owner is subject to policies (service_role bypasses RLS by
-- design and is used only by trusted server code).
-- =====================================================================

-- Convenience: enable + force RLS on a list of tables.
do $$
declare t text;
  all_tables text[] := array[
    'profiles','user_permissions','courses','trainers','venues','schedules',
    'downloads','news_categories','news_posts','gallery_categories','gallery_images',
    'faq_categories','faqs','testimonials','company_profile','site_settings',
    'media_folders','media','enquiries','enquiry_notes','proposal_requests',
    'proposal_notes','participants','certificates','audit_logs'
  ];
begin
  foreach t in array all_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('alter table public.%I force row level security;', t);
  end loop;
end$$;

-- ---------------------------------------------------------------------
-- PROFILES & PERMISSIONS
-- ---------------------------------------------------------------------
create policy profiles_self_select on public.profiles
  for select using (id = auth.uid() or app.is_admin());
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid() or app.is_super_admin())
  with check (id = auth.uid() or app.is_super_admin());
create policy profiles_admin_insert on public.profiles
  for insert with check (app.is_super_admin());
create policy profiles_admin_delete on public.profiles
  for delete using (app.is_super_admin());

create policy user_permissions_super_all on public.user_permissions
  for all using (app.is_super_admin()) with check (app.is_super_admin());
create policy user_permissions_self_read on public.user_permissions
  for select using (user_id = auth.uid() or app.is_admin());

-- ---------------------------------------------------------------------
-- REUSABLE POLICY SHAPES
-- ---------------------------------------------------------------------
-- We apply three recurring shapes via a helper DO block:
--   A) content tables  → public reads published+live; editors write; admins delete
--   B) taxonomy tables  → public reads all; editors manage
--   C) inbound CRM      → anon insert; staff read/update; admin delete
-- ---------------------------------------------------------------------

-- (A) CONTENT TABLES with status + deleted_at + (editor write / admin delete)
do $$
declare t text;
  content_tables text[] := array[
    'courses','downloads','news_posts','gallery_images','faqs','testimonials'
  ];
begin
  foreach t in array content_tables loop
    execute format($f$
      create policy %1$s_public_read on public.%1$s
        for select using (status = 'published' and deleted_at is null);
      create policy %1$s_staff_read on public.%1$s
        for select using (app.is_editor());
      create policy %1$s_editor_insert on public.%1$s
        for insert with check (app.is_editor());
      create policy %1$s_editor_update on public.%1$s
        for update using (app.is_editor()) with check (app.is_editor());
      create policy %1$s_admin_delete on public.%1$s
        for delete using (app.is_admin());
    $f$, t);
  end loop;
end$$;

-- Schedules: public reads published+live rows; staff manage.
create policy schedules_public_read on public.schedules
  for select using (is_published = true and deleted_at is null);
create policy schedules_staff_read on public.schedules
  for select using (app.is_editor());
create policy schedules_editor_write on public.schedules
  for insert with check (app.is_editor());
create policy schedules_editor_update on public.schedules
  for update using (app.is_editor()) with check (app.is_editor());
create policy schedules_admin_delete on public.schedules
  for delete using (app.is_admin());

-- Trainers & venues: public may read active rows (names shown on site); staff manage.
do $$
declare t text;
begin
  foreach t in array array['trainers','venues'] loop
    execute format($f$
      create policy %1$s_public_read on public.%1$s
        for select using (is_active = true and deleted_at is null);
      create policy %1$s_staff_read on public.%1$s
        for select using (app.is_editor());
      create policy %1$s_editor_write on public.%1$s
        for insert with check (app.is_editor());
      create policy %1$s_editor_update on public.%1$s
        for update using (app.is_editor()) with check (app.is_editor());
      create policy %1$s_admin_delete on public.%1$s
        for delete using (app.is_admin());
    $f$, t);
  end loop;
end$$;

-- (B) TAXONOMY TABLES: public read all, editors manage.
do $$
declare t text;
  taxonomy_tables text[] := array['news_categories','gallery_categories','faq_categories'];
begin
  foreach t in array taxonomy_tables loop
    execute format($f$
      create policy %1$s_public_read on public.%1$s for select using (true);
      create policy %1$s_editor_write on public.%1$s
        for all using (app.is_editor()) with check (app.is_editor());
    $f$, t);
  end loop;
end$$;

-- Company profile & settings: public reads (settings only where is_public), staff/admin write.
create policy company_public_read on public.company_profile for select using (true);
create policy company_editor_update on public.company_profile
  for update using (app.is_editor()) with check (app.is_editor());
create policy company_admin_insert on public.company_profile
  for insert with check (app.is_admin());

create policy settings_public_read on public.site_settings
  for select using (is_public = true or app.is_editor());
create policy settings_admin_write on public.site_settings
  for all using (app.is_admin()) with check (app.is_admin());

-- Media library: public reads live rows (URLs are on the site); staff manage.
create policy media_public_read on public.media
  for select using (deleted_at is null);
create policy media_editor_write on public.media
  for insert with check (app.is_editor());
create policy media_editor_update on public.media
  for update using (app.is_editor()) with check (app.is_editor());
create policy media_admin_delete on public.media
  for delete using (app.is_admin());

create policy media_folders_staff_read on public.media_folders
  for select using (app.is_editor());
create policy media_folders_editor_write on public.media_folders
  for all using (app.is_editor()) with check (app.is_editor());

-- (C) INBOUND CRM: anon can INSERT (public forms); only staff read/update; admin deletes.
do $$
declare t text;
  crm_tables text[] := array['enquiries','proposal_requests'];
begin
  foreach t in array crm_tables loop
    execute format($f$
      create policy %1$s_anon_insert on public.%1$s
        for insert to anon with check (true);
      create policy %1$s_auth_insert on public.%1$s
        for insert to authenticated with check (true);
      create policy %1$s_staff_read on public.%1$s
        for select using (app.is_editor());
      create policy %1$s_staff_update on public.%1$s
        for update using (app.is_editor()) with check (app.is_editor());
      create policy %1$s_admin_delete on public.%1$s
        for delete using (app.is_admin());
    $f$, t);
  end loop;
end$$;

-- CRM notes: staff only.
do $$
declare t text;
begin
  foreach t in array array['enquiry_notes','proposal_notes'] loop
    execute format($f$
      create policy %1$s_staff_read on public.%1$s for select using (app.is_editor());
      create policy %1$s_staff_write on public.%1$s
        for insert with check (app.is_editor());
      create policy %1$s_author_delete on public.%1$s
        for delete using (author_id = auth.uid() or app.is_admin());
    $f$, t);
  end loop;
end$$;

-- Participants & certificates: staff read/write, admin delete. Not public.
do $$
declare t text;
begin
  foreach t in array array['participants','certificates'] loop
    execute format($f$
      create policy %1$s_staff_read on public.%1$s for select using (app.is_editor());
      create policy %1$s_editor_write on public.%1$s
        for insert with check (app.is_editor());
      create policy %1$s_editor_update on public.%1$s
        for update using (app.is_editor()) with check (app.is_editor());
      create policy %1$s_admin_delete on public.%1$s
        for delete using (app.is_admin());
    $f$, t);
  end loop;
end$$;

-- AUDIT LOGS: append-only. Staff may read; nobody may update/delete via API.
create policy audit_staff_read on public.audit_logs
  for select using (app.is_admin());
create policy audit_insert on public.audit_logs
  for insert with check (auth.uid() is not null);
-- (No UPDATE or DELETE policies → those operations are denied for all API roles.)
