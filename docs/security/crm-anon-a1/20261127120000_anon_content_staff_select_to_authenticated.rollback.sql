-- A1 rollback (DRAFT, NOT APPLIED; separate approval). Exact inverse of
-- supabase/migrations/20261127120000_anon_content_staff_select_to_authenticated.sql: the nine SELECT policies go back
-- to TO public. Re-opens the anon 42501 behaviour.
-- One DO block (no explicit BEGIN/COMMIT, so it is safe inside apply_migration's own transaction): requires the exact
-- post-A1 state, changes the nine policies, then requires the exact pinned pre-A1 state; any failure changes nothing.
-- Locks: ACCESS EXCLUSIVE on each of the nine tables for the duration of the block; lock_timeout 5s.

do $a1r$
declare
  r record;
  v_targets text[] := array['downloads_editor_read', 'faq_categories_editor_select', 'faqs_editor_read',
    'gallery_categories_editor_select', 'gallery_images_editor_read', 'media_editor_read', 'media_folders_editor_select',
    'news_categories_editor_select', 'news_posts_editor_read'];
  v_tables text[] := array['downloads', 'faq_categories', 'faqs', 'gallery_categories', 'gallery_images', 'media',
    'media_folders', 'news_categories', 'news_posts'];
  v_others_before text;
begin
  perform set_config('lock_timeout', '5s', true);  -- transaction-local

  if (
    select md5(string_agg(concat_ws('|', tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n'
               order by tablename, policyname))
    from pg_policies where schemaname = 'public' and tablename = any (v_tables)
  ) is distinct from '69894c508ffe74d13084a0b84b66add9' then
    raise exception 'a1_rollback_precondition_failed: nine-table policies are not the post-A1 state - nothing changed'
      using errcode = 'P0001';
  end if;

  select md5(string_agg(concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check),
             E'\n' order by schemaname, tablename, policyname))
    into v_others_before
  from pg_policies where not (schemaname = 'public' and policyname = any (v_targets));

  for r in select * from unnest(v_tables, v_targets) t(tbl, pol) loop
    execute format('alter policy %I on public.%I to public', r.pol, r.tbl);
  end loop;

  if (
    select md5(string_agg(concat_ws('|', tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n'
               order by tablename, policyname))
    from pg_policies where schemaname = 'public' and tablename = any (v_tables)
  ) is distinct from '40ff9b48273f92d22b00d8fb48f5a3b2'
     or (
    select md5(string_agg(concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check),
               E'\n' order by schemaname, tablename, policyname))
    from pg_policies where not (schemaname = 'public' and policyname = any (v_targets))
  ) is distinct from v_others_before then
    raise exception 'a1_rollback_postcondition_failed: state is not the pinned pre-A1 state' using errcode = 'P0001';
  end if;
end;
$a1r$;
