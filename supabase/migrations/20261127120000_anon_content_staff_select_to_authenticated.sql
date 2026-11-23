-- A1 (DRAFT, NOT APPLIED ANYWHERE): stop staff SELECT policies from breaking anonymous reads of public content.
--
-- Finding (Staging eokiaehnvzbggmacifcf, verified 2026-11-23): an anon SELECT on news_posts, faqs, gallery_images,
-- downloads, media, news_categories, faq_categories, gallery_categories or media_folders fails with
-- "42501 permission denied for function is_editor". The staff read policy on each table is TO public and calls
-- app.is_editor(); anon has no EXECUTE on that helper (and no USAGE on schema app). PostgreSQL evaluates every
-- applicable permissive policy, so the staff policy aborts the query even where *_public_read would return the row.
--
-- Change: exactly nine SELECT policies are retargeted from TO public to TO authenticated. USING is unchanged (still
-- app.is_editor()), the command is unchanged, nothing else is touched. No privilege is granted to anon.
--   Group A (published rows stay visible to anon through *_public_read):
--     downloads_editor_read, faqs_editor_read, gallery_images_editor_read, media_editor_read, news_posts_editor_read
--   Group B (no public read policy, so anon now gets 0 rows instead of an error):
--     faq_categories_editor_select, gallery_categories_editor_select, media_folders_editor_select,
--     news_categories_editor_select
-- Staff (authenticated) behaviour is identical: authenticated was already covered by TO public.
--
-- NOT changed: the five *_public_read policies, every INSERT/UPDATE/DELETE policy on the nine tables (they still
-- deny anon, fail-closed), every other table, all grants, functions and data.
--
-- Staging only as written. The preflight requires the post-R1 split *_editor_select policies; on a pre-R1 database
-- (Production today: four FOR ALL *_editor_all policies) it aborts and changes nothing. Production needs its own
-- manifest, sequenced after the Production R1 decision.
--
-- Atomicity: preflight, the nine ALTER POLICY statements and every postcondition run inside ONE DO block, so the file
-- is all-or-nothing on its own, with or without an outer transaction (no temporary table is used).
-- Locks: ALTER POLICY takes an ACCESS EXCLUSIVE lock on each of the nine tables for the duration of the block (a few
-- milliseconds; reads and writes on those tables wait). lock_timeout 5s: if a lock is not granted, the block aborts
-- and nothing changes.
-- Rollback: docs/security/crm-anon-a1/20261127120000_anon_content_staff_select_to_authenticated.rollback.sql

do $a1$
declare
  r record;
  v_count int;
  v_targets text[] := array['downloads_editor_read', 'faq_categories_editor_select', 'faqs_editor_read',
    'gallery_categories_editor_select', 'gallery_images_editor_read', 'media_editor_read', 'media_folders_editor_select',
    'news_categories_editor_select', 'news_posts_editor_read'];
  v_tables text[] := array['downloads', 'faq_categories', 'faqs', 'gallery_categories', 'gallery_images', 'media',
    'media_folders', 'news_categories', 'news_posts'];
  v_others_before text;
  v_others_after text;
  v_total_before int;
begin
  perform set_config('lock_timeout', '5s', true);  -- transaction-local

  -- ---- Preflight ------------------------------------------------------------------------------------------------
  for r in select * from unnest(v_tables, v_targets) t(tbl, pol) loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = 'SELECT'
        and p.permissive = 'PERMISSIVE' and p.roles = array['public']::name[]
        and p.qual = 'app.is_editor()' and p.with_check is null
    ) then
      raise exception 'a1_precondition_failed: policy %.% is not the expected pre-A1 definition - nothing changed', r.tbl, r.pol
        using errcode = 'P0001';
    end if;
  end loop;

  -- Pinned pre-state of every policy on the nine tables (41 policies, Staging post-R1).
  select count(*) into v_count from pg_policies where schemaname = 'public' and tablename = any (v_tables);
  if v_count <> 41 or (
    select md5(string_agg(concat_ws('|', tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n'
               order by tablename, policyname))
    from pg_policies where schemaname = 'public' and tablename = any (v_tables)
  ) <> '40ff9b48273f92d22b00d8fb48f5a3b2' then
    raise exception 'a1_precondition_failed: policies on the nine tables differ from the pinned manifest - nothing changed'
      using errcode = 'P0001';
  end if;

  -- anon must not already hold the helper or the schema (A1 must not depend on, or hide, such a grant).
  if has_schema_privilege('anon', 'app', 'USAGE') or has_function_privilege('anon', 'app.is_editor()', 'EXECUTE') then
    raise exception 'a1_precondition_failed: anon unexpectedly has app USAGE or app.is_editor EXECUTE' using errcode = 'P0001';
  end if;

  -- Fingerprint of every non-target policy in the database, for the negative postcondition.
  select md5(string_agg(concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check),
             E'\n' order by schemaname, tablename, policyname)), count(*)
    into v_others_before, v_total_before
  from pg_policies where not (schemaname = 'public' and policyname = any (v_targets));

  -- ---- Change ---------------------------------------------------------------------------------------------------
  for r in select * from unnest(v_tables, v_targets) t(tbl, pol) loop
    execute format('alter policy %I on public.%I to authenticated', r.pol, r.tbl);
  end loop;

  -- ---- Postconditions (any failure aborts the whole block: nothing changes) -------------------------------------
  if (
    select md5(string_agg(concat_ws('|', tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n'
               order by tablename, policyname))
    from pg_policies where schemaname = 'public' and policyname = any (v_targets)
  ) is distinct from 'c1d42de950da4cee926597b2fae49bb8' then
    raise exception 'a1_postcondition_failed: target policies are not the expected post-A1 definition' using errcode = 'P0001';
  end if;

  -- Negative postcondition: every other policy (including *_public_read and all write policies on the nine tables)
  -- is byte-for-byte unchanged, and none was added or removed.
  select md5(string_agg(concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check),
             E'\n' order by schemaname, tablename, policyname))
    into v_others_after
  from pg_policies where not (schemaname = 'public' and policyname = any (v_targets));
  if v_others_after is distinct from v_others_before
     or (select count(*) from pg_policies) <> v_total_before + 9 then
    raise exception 'a1_postcondition_failed: a non-target policy changed or the policy count changed' using errcode = 'P0001';
  end if;

  -- No SELECT/ALL policy on the nine tables is still TO public/anon while calling a privileged helper.
  select count(*) into v_count from pg_policies
  where schemaname = 'public' and cmd in ('SELECT', 'ALL') and roles && array['public', 'anon']::name[]
    and tablename = any (v_tables)
    and coalesce(qual, '') || ' ' || coalesce(with_check, '') ~ '(app\.|has_module_access|has_min_role)';
  if v_count <> 0 then
    raise exception 'a1_postcondition_failed: % helper SELECT policy(ies) still apply to anon', v_count using errcode = 'P0001';
  end if;

  -- The nine tables as a whole match the pinned expected post-A1 fingerprint (41 policies).
  if (
    select md5(string_agg(concat_ws('|', tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n'
               order by tablename, policyname))
    from pg_policies where schemaname = 'public' and tablename = any (v_tables)
  ) is distinct from '69894c508ffe74d13084a0b84b66add9' then
    raise exception 'a1_postcondition_failed: nine-table policy set is not the expected post-A1 state' using errcode = 'P0001';
  end if;

  -- No privilege was granted to anon.
  if has_schema_privilege('anon', 'app', 'USAGE') or has_function_privilege('anon', 'app.is_editor()', 'EXECUTE') then
    raise exception 'a1_postcondition_failed: anon gained app USAGE or app.is_editor EXECUTE' using errcode = 'P0001';
  end if;
end;
$a1$;
