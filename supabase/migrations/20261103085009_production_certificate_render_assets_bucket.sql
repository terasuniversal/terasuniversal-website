-- DRAFT -- NOT APPLIED. Private Storage bucket for certificate render assets.
--
-- Why: the Director signature and the approved 3D Common Seal must not be served from
-- public/ (the repository and its static files are public). They will live in this bucket
-- and be read only by a server-side loader with a fixed allowlist of object keys.
--
-- Target: Production iagzkrzeuawaxvacqprk. Forward-only, additive: one bucket row, nothing
-- else. No storage policies are created, so with RLS on storage.objects the anon and
-- authenticated roles get no access to this bucket's objects; only the service role
-- (BYPASSRLS) can read or write them. Other buckets are not touched.
--
-- Idempotent: a re-run is a no-op when the bucket already has exactly this configuration,
-- and fails instead of silently accepting a bucket with any other configuration.
-- Refuses to run while any PERMISSIVE policy for anon, authenticated or public exists on
-- storage.objects or storage.buckets (Production has none). Policy expressions cannot be
-- proven not to match this bucket by inspecting their text, so any such policy is treated
-- as a possible exposure. RESTRICTIVE policies only narrow access and are allowed.
--
-- file_size_limit and allowed_mime_types are enforced by the Storage API on upload.
--
-- Rollback: SQL deletes from storage tables are blocked by storage.protect_delete(); empty
-- the bucket and delete it through the Storage API or dashboard.

begin;

do $$
declare
  v_bucket jsonb;
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'certificate-render-assets bucket requires Supabase Storage';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies p
    where p.schemaname = 'storage'
      and p.tablename in ('objects', 'buckets')
      and p.permissive = 'PERMISSIVE'
      and p.roles && array['public', 'anon', 'authenticated']::name[]
  ) then
    raise exception 'A permissive anon/authenticated/public Storage policy exists; it could expose certificate-render-assets';
  end if;

  -- jsonb, not %rowtype: Storage versions differ in which optional columns exist.
  select to_jsonb(b) into v_bucket from storage.buckets b where b.id = 'certificate-render-assets';
  if v_bucket is not null and not (
    v_bucket->>'name' = 'certificate-render-assets'
    and (v_bucket->>'public')::boolean is false
    and (v_bucket->>'file_size_limit')::bigint = 1048576
    and v_bucket->'allowed_mime_types' = '["image/png"]'::jsonb
    and coalesce(v_bucket->>'type', 'STANDARD') = 'STANDARD'
    and v_bucket->>'owner' is null
    and v_bucket->>'owner_id' is null
    and coalesce((v_bucket->>'avif_autodetection')::boolean, false) is false
    and coalesce(v_bucket->>'versioning_status', 'DISABLED') = 'DISABLED'
    and v_bucket->>'lifecycle_configuration' is null
  ) then
    raise exception 'certificate-render-assets exists with a different configuration';
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificate-render-assets', 'certificate-render-assets', false, 1048576, array['image/png'])
on conflict (id) do nothing;

commit;
