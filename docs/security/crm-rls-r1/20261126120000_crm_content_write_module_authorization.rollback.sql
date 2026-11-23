-- ROLLBACK for R1 (20261126120000_crm_content_write_module_authorization), v2. Separate Owner approval required.
-- v2 (local correction, not yet in PR #247): same 30 policy re-creations / 48 drops as v1, but
--   * ONE DO block with no explicit BEGIN/COMMIT, so it is atomic on its own and safe inside apply_migration;
--   * refuses to run while A1 (anon_content_staff_select_to_authenticated) is applied: A1 retargets four R1-created
--     *_editor_select policies and five *_editor_read policies; rolling R1 back first would recreate *_editor_all
--     TO public (re-opening the anon 42501 error) and leave a state that matches neither pinned fingerprint.
--     Roll back A1 first (docs/security/crm-anon-a1/...rollback.sql), then this file;
--   * postcondition: the 19 tables' policies must equal the pinned pre-R1 fingerprint (Staging 70dee04e..., 55
--     policies; Production 467ab029..., 54 policies), otherwise the whole block aborts and nothing changes;
--   * transaction-local lock_timeout 5s (DROP/CREATE POLICY take ACCESS EXCLUSIVE on the 19 tables).
-- Reopens the role-only write gap. Policies only: no grants, functions or data change.

do $rb$
declare
  v_fp text;
  v_n int;
begin
  perform set_config('lock_timeout', '5s', true);  -- transaction-local

  -- Only roll back the exact R1 post-state.
  if (select count(*) from pg_policies where schemaname = 'public' and policyname = any (array[
        'cms_content_staff_select', 'cms_media_staff_select', 'faq_categories_editor_select', 'gallery_categories_editor_select',
        'media_folders_editor_select', 'news_categories_editor_select'])) <> 6
     or not exists (select 1 from pg_policies where schemaname = 'public' and policyname = 'news_posts_editor_insert'
                    and with_check like '%has_module_access_level(''news''::text, ''edit''::text)%') then
    raise exception 'r1_rollback_precondition_failed: database is not in the R1 post-state - nothing changed' using errcode = 'P0001';
  end if;

  -- A1 must be rolled back first (all nine A1 targets back on TO public).
  if exists (select 1 from pg_policies where schemaname = 'public' and roles <> array['public']::name[] and policyname = any (array[
        'downloads_editor_read', 'faq_categories_editor_select', 'faqs_editor_read', 'gallery_categories_editor_select',
        'gallery_images_editor_read', 'media_editor_read', 'media_folders_editor_select', 'news_categories_editor_select',
        'news_posts_editor_read'])) then
    raise exception 'r1_rollback_precondition_failed: A1 is applied - roll back A1 first, nothing changed' using errcode = 'P0001';
  end if;

  -- Split policies -> original FOR ALL policies
  drop policy if exists cms_content_staff_select on public.cms_content;
  drop policy if exists cms_content_staff_insert on public.cms_content;
  drop policy if exists cms_content_staff_update on public.cms_content;
  drop policy if exists cms_content_staff_delete on public.cms_content;
  create policy cms_content_staff_all on public.cms_content for all to authenticated
    using (( SELECT app.is_editor() AS is_editor)) with check (( SELECT app.is_editor() AS is_editor));

  drop policy if exists cms_media_staff_select on public.cms_media;
  drop policy if exists cms_media_staff_insert on public.cms_media;
  drop policy if exists cms_media_staff_update on public.cms_media;
  drop policy if exists cms_media_staff_delete on public.cms_media;
  create policy cms_media_staff_all on public.cms_media for all to authenticated
    using (( SELECT app.is_editor() AS is_editor)) with check (( SELECT app.is_editor() AS is_editor));

  drop policy if exists faq_categories_editor_select on public.faq_categories;
  drop policy if exists faq_categories_editor_insert on public.faq_categories;
  drop policy if exists faq_categories_editor_update on public.faq_categories;
  drop policy if exists faq_categories_editor_delete on public.faq_categories;
  create policy faq_categories_editor_all on public.faq_categories for all to public
    using (app.is_editor()) with check (app.is_editor());

  drop policy if exists gallery_categories_editor_select on public.gallery_categories;
  drop policy if exists gallery_categories_editor_insert on public.gallery_categories;
  drop policy if exists gallery_categories_editor_update on public.gallery_categories;
  drop policy if exists gallery_categories_editor_delete on public.gallery_categories;
  create policy gallery_categories_editor_all on public.gallery_categories for all to public
    using (app.is_editor()) with check (app.is_editor());

  drop policy if exists media_folders_editor_select on public.media_folders;
  drop policy if exists media_folders_editor_insert on public.media_folders;
  drop policy if exists media_folders_editor_update on public.media_folders;
  drop policy if exists media_folders_editor_delete on public.media_folders;
  create policy media_folders_editor_all on public.media_folders for all to public
    using (app.is_editor()) with check (app.is_editor());

  drop policy if exists news_categories_editor_select on public.news_categories;
  drop policy if exists news_categories_editor_insert on public.news_categories;
  drop policy if exists news_categories_editor_update on public.news_categories;
  drop policy if exists news_categories_editor_delete on public.news_categories;
  create policy news_categories_editor_all on public.news_categories for all to public
    using (app.is_editor()) with check (app.is_editor());

  -- INSERT / UPDATE policies -> original role-only expressions
  drop policy if exists company_profile_editor_insert on public.company_profile;
  create policy company_profile_editor_insert on public.company_profile for insert to public with check (app.is_editor());
  drop policy if exists company_profile_editor_update on public.company_profile;
  create policy company_profile_editor_update on public.company_profile for update to public using (app.is_editor()) with check (app.is_editor());

  drop policy if exists courses_insert on public.courses;
  create policy courses_insert on public.courses for insert to authenticated with check (app.has_min_role('editor'::user_role));
  drop policy if exists courses_update on public.courses;
  create policy courses_update on public.courses for update to authenticated
    using (app.has_min_role('editor'::user_role)) with check (app.has_min_role('editor'::user_role));

  drop policy if exists downloads_editor_insert on public.downloads;
  create policy downloads_editor_insert on public.downloads for insert to public with check (app.is_editor());
  drop policy if exists downloads_editor_update on public.downloads;
  create policy downloads_editor_update on public.downloads for update to public using (app.is_editor()) with check (app.is_editor());

  drop policy if exists faqs_editor_insert on public.faqs;
  create policy faqs_editor_insert on public.faqs for insert to public with check (app.is_editor());
  drop policy if exists faqs_editor_update on public.faqs;
  create policy faqs_editor_update on public.faqs for update to public using (app.is_editor()) with check (app.is_editor());

  drop policy if exists feedback_improvement_actions_staff_insert on public.feedback_improvement_actions;
  create policy feedback_improvement_actions_staff_insert on public.feedback_improvement_actions for insert to authenticated
    with check (( SELECT app.has_min_role('editor'::user_role) AS has_min_role));
  drop policy if exists feedback_improvement_actions_staff_update on public.feedback_improvement_actions;
  create policy feedback_improvement_actions_staff_update on public.feedback_improvement_actions for update to authenticated
    using (( SELECT app.has_min_role('editor'::user_role) AS has_min_role)) with check (( SELECT app.has_min_role('editor'::user_role) AS has_min_role));

  drop policy if exists feedback_issues_staff_insert on public.feedback_issues;
  create policy feedback_issues_staff_insert on public.feedback_issues for insert to authenticated
    with check (( SELECT app.has_min_role('editor'::user_role) AS has_min_role));
  drop policy if exists feedback_issues_staff_update on public.feedback_issues;
  create policy feedback_issues_staff_update on public.feedback_issues for update to authenticated
    using (( SELECT app.has_min_role('editor'::user_role) AS has_min_role)) with check (( SELECT app.has_min_role('editor'::user_role) AS has_min_role));

  drop policy if exists gallery_images_editor_insert on public.gallery_images;
  create policy gallery_images_editor_insert on public.gallery_images for insert to public with check (app.is_editor());
  drop policy if exists gallery_images_editor_update on public.gallery_images;
  create policy gallery_images_editor_update on public.gallery_images for update to public using (app.is_editor()) with check (app.is_editor());

  drop policy if exists marketing_campaigns_insert on public.marketing_campaigns;
  create policy marketing_campaigns_insert on public.marketing_campaigns for insert to authenticated with check (app.has_min_role('editor'::user_role));
  drop policy if exists marketing_campaigns_update on public.marketing_campaigns;
  create policy marketing_campaigns_update on public.marketing_campaigns for update to authenticated
    using (app.has_min_role('editor'::user_role)) with check (app.has_min_role('editor'::user_role));

  drop policy if exists marketing_contact_events_insert on public.marketing_contact_events;
  create policy marketing_contact_events_insert on public.marketing_contact_events for insert to authenticated with check (app.has_min_role('editor'::user_role));

  drop policy if exists marketing_contacts_insert on public.marketing_contacts;
  create policy marketing_contacts_insert on public.marketing_contacts for insert to authenticated with check (app.has_min_role('editor'::user_role));
  drop policy if exists marketing_contacts_update on public.marketing_contacts;
  create policy marketing_contacts_update on public.marketing_contacts for update to authenticated
    using (app.has_min_role('editor'::user_role)) with check (app.has_min_role('editor'::user_role));

  drop policy if exists media_editor_insert on public.media;
  create policy media_editor_insert on public.media for insert to public with check (app.is_editor());
  drop policy if exists media_editor_update on public.media;
  create policy media_editor_update on public.media for update to public using (app.is_editor()) with check (app.is_editor());

  drop policy if exists news_posts_editor_insert on public.news_posts;
  create policy news_posts_editor_insert on public.news_posts for insert to public with check (app.is_editor());
  drop policy if exists news_posts_editor_update on public.news_posts;
  create policy news_posts_editor_update on public.news_posts for update to public using (app.is_editor()) with check (app.is_editor());

  drop policy if exists proposal_requests_update on public.proposal_requests;
  create policy proposal_requests_update on public.proposal_requests for update to authenticated
    using (app.has_min_role('editor'::user_role)) with check (app.has_min_role('editor'::user_role));

  -- Postcondition: exact pinned pre-R1 state of the 19 tables.
  select md5(string_agg(concat_ws('|', tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\n'
             order by tablename, policyname)), count(*)
    into v_fp, v_n
  from pg_policies
  where schemaname = 'public' and tablename = any (array['cms_content', 'cms_media', 'company_profile', 'courses', 'downloads',
    'faq_categories', 'faqs', 'feedback_improvement_actions', 'feedback_issues', 'gallery_categories', 'gallery_images',
    'marketing_campaigns', 'marketing_contact_events', 'marketing_contacts', 'media', 'media_folders', 'news_categories',
    'news_posts', 'proposal_requests']);
  if not ((v_fp = '70dee04e71b051820e1984be5751c671' and v_n = 55) or (v_fp = '467ab0297e33269186c359e69bbbbdb5' and v_n = 54)) then
    raise exception 'r1_rollback_postcondition_failed: 19-table policies (%, %) are not the pinned pre-R1 state - nothing changed', v_fp, v_n
      using errcode = 'P0001';
  end if;
end;
$rb$;

-- Rollback verification (read-only). Expected fingerprint of the 19 tables' policies after rollback:
--   Staging    70dee04e71b051820e1984be5751c671 (55 policies)
--   Production 467ab0297e33269186c359e69bbbbdb5 (54 policies; no courses.i3e_certificate_executor_read)
-- with t as (select unnest(array['cms_content','cms_media','company_profile','courses','downloads','faq_categories','faqs',
--   'feedback_improvement_actions','feedback_issues','gallery_categories','gallery_images','marketing_campaigns',
--   'marketing_contact_events','marketing_contacts','media','media_folders','news_categories','news_posts','proposal_requests']) n)
-- select md5(string_agg(concat_ws('|',tablename,policyname,permissive,roles::text,cmd,qual,with_check), E'\n'
--   order by tablename,policyname)), count(*) from pg_policies p join t on t.n = p.tablename where p.schemaname = 'public';
