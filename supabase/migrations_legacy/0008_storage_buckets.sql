-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0008 — Storage Buckets & Policies
-- =====================================================================
-- Three buckets:
--   media       (public)  → images/pdf shown on the website
--   downloads   (public)  → brochures, forms, calendars for public download
--   private     (private) → certificates, participant docs, internal files
--
-- Public buckets allow anon SELECT but only staff (editor+) may write.
-- Private bucket is staff-only for both read and write.
-- =====================================================================

insert into storage.buckets (id, name, public)
values
  ('media', 'media', true),
  ('downloads', 'downloads', true),
  ('private', 'private', false)
on conflict (id) do nothing;

-- --- PUBLIC BUCKETS: anyone reads, staff writes -----------------------
create policy "public buckets are readable"
  on storage.objects for select
  using (bucket_id in ('media', 'downloads'));

create policy "staff upload to public buckets"
  on storage.objects for insert to authenticated
  with check (bucket_id in ('media', 'downloads') and app.is_editor());

create policy "staff update public buckets"
  on storage.objects for update to authenticated
  using (bucket_id in ('media', 'downloads') and app.is_editor())
  with check (bucket_id in ('media', 'downloads') and app.is_editor());

create policy "admin delete public buckets"
  on storage.objects for delete to authenticated
  using (bucket_id in ('media', 'downloads') and app.is_admin());

-- --- PRIVATE BUCKET: staff only for everything ------------------------
create policy "staff read private bucket"
  on storage.objects for select to authenticated
  using (bucket_id = 'private' and app.is_editor());

create policy "staff write private bucket"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'private' and app.is_editor());

create policy "staff update private bucket"
  on storage.objects for update to authenticated
  using (bucket_id = 'private' and app.is_editor())
  with check (bucket_id = 'private' and app.is_editor());

create policy "admin delete private bucket"
  on storage.objects for delete to authenticated
  using (bucket_id = 'private' and app.is_admin());
