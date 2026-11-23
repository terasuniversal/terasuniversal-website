-- R1 (DRAFT, NOT APPLIED ANYWHERE): module authorization for role-only content/CMS/marketing/feedback writes.
--
-- Finding (read-only review, Staging eokiaehnvzbggmacifcf and Production iagzkrzeuawaxvacqprk, 2026-11-22): 30 write
-- policies on 19 tables check the role only (app.is_editor() / app.has_min_role('editor')). Any active editor or admin,
-- including Custom staff whose module grants are View-only or None, can therefore write these tables directly through
-- PostgREST, bypassing the module model that the Server Actions and the Sales RLS (M-S4) enforce. The 30 targeted
-- policies are identical on Staging and Production.
--
-- Rule applied (same as M-S4): each new write expression is the previous expression AND a module "edit" condition.
-- Nothing is widened. super_admin keeps full access and staff with access_control_enabled = false keep their
-- role-default access, both through public.has_module_access_level. Only Custom staff without the module's Edit
-- grant lose direct write access.
--
-- Table -> module (the module the writing Server Action already guards):
--   company_profile -> company            courses -> courses              downloads -> downloads
--   faqs, faq_categories -> faq           gallery_images, gallery_categories -> gallery
--   media, media_folders -> media         news_posts, news_categories -> news
--   marketing_campaigns -> marketing_campaigns
--   marketing_contacts, marketing_contact_events -> marketing_contacts
--   feedback_issues -> feedback_issues    feedback_improvement_actions -> feedback_actions
--   proposal_requests (UPDATE) -> sales_leads (no application writer; Sales lead inbox owns these rows)
--   cms_content, cms_media -> super_admin only for writes (no application reader or writer; conservative)
--
-- The six FOR ALL policies (cms_content, cms_media, faq_categories, gallery_categories, media_folders,
-- news_categories) are split into SELECT + INSERT + UPDATE + DELETE so that their read rule stays byte-for-byte
-- identical while only the write commands gain the module condition. Category DELETE stays at editor level (as
-- before) plus the module condition; it is not escalated to admin.
--
-- NOT changed: every other SELECT policy, *_admin_delete / courses_delete (admin, R2 scope), public published-content
-- read policies, courses.i3e_certificate_executor_read (Staging only), table grants, triggers, functions, trainer
-- authorization. SECURITY DEFINER RPCs owned by postgres and service_role (BYPASSRLS) do not evaluate these policies.
--
-- Fail-closed: the first block aborts unless all 30 targeted policies have exactly the expected command, roles,
-- USING and WITH CHECK text, and every module key exists and is active. Re-running after success aborts the same way
-- (nothing changes). The last block re-checks the post-state and that no non-targeted policy changed.
--
-- Rollback: docs/security/crm-rls-r1/20261126120000_crm_content_write_module_authorization.rollback.sql (re-creates
-- the 30 previous policies verbatim and drops the replacements). Separate approval required.

do $r1$
declare
  r record;
  v_count int;
begin
  for r in
    select * from (values
      ('cms_content', 'cms_content_staff_all', 'ALL', 'authenticated', $q$( SELECT app.is_editor() AS is_editor)$q$, $q$( SELECT app.is_editor() AS is_editor)$q$),
      ('cms_media', 'cms_media_staff_all', 'ALL', 'authenticated', $q$( SELECT app.is_editor() AS is_editor)$q$, $q$( SELECT app.is_editor() AS is_editor)$q$),
      ('company_profile', 'company_profile_editor_insert', 'INSERT', 'public', null::text, $q$app.is_editor()$q$),
      ('company_profile', 'company_profile_editor_update', 'UPDATE', 'public', $q$app.is_editor()$q$, $q$app.is_editor()$q$),
      ('courses', 'courses_insert', 'INSERT', 'authenticated', null, $q$app.has_min_role('editor'::user_role)$q$),
      ('courses', 'courses_update', 'UPDATE', 'authenticated', $q$app.has_min_role('editor'::user_role)$q$, $q$app.has_min_role('editor'::user_role)$q$),
      ('downloads', 'downloads_editor_insert', 'INSERT', 'public', null, $q$app.is_editor()$q$),
      ('downloads', 'downloads_editor_update', 'UPDATE', 'public', $q$app.is_editor()$q$, $q$app.is_editor()$q$),
      ('faq_categories', 'faq_categories_editor_all', 'ALL', 'public', $q$app.is_editor()$q$, $q$app.is_editor()$q$),
      ('faqs', 'faqs_editor_insert', 'INSERT', 'public', null, $q$app.is_editor()$q$),
      ('faqs', 'faqs_editor_update', 'UPDATE', 'public', $q$app.is_editor()$q$, $q$app.is_editor()$q$),
      ('feedback_improvement_actions', 'feedback_improvement_actions_staff_insert', 'INSERT', 'authenticated', null, $q$( SELECT app.has_min_role('editor'::user_role) AS has_min_role)$q$),
      ('feedback_improvement_actions', 'feedback_improvement_actions_staff_update', 'UPDATE', 'authenticated', $q$( SELECT app.has_min_role('editor'::user_role) AS has_min_role)$q$, $q$( SELECT app.has_min_role('editor'::user_role) AS has_min_role)$q$),
      ('feedback_issues', 'feedback_issues_staff_insert', 'INSERT', 'authenticated', null, $q$( SELECT app.has_min_role('editor'::user_role) AS has_min_role)$q$),
      ('feedback_issues', 'feedback_issues_staff_update', 'UPDATE', 'authenticated', $q$( SELECT app.has_min_role('editor'::user_role) AS has_min_role)$q$, $q$( SELECT app.has_min_role('editor'::user_role) AS has_min_role)$q$),
      ('gallery_categories', 'gallery_categories_editor_all', 'ALL', 'public', $q$app.is_editor()$q$, $q$app.is_editor()$q$),
      ('gallery_images', 'gallery_images_editor_insert', 'INSERT', 'public', null, $q$app.is_editor()$q$),
      ('gallery_images', 'gallery_images_editor_update', 'UPDATE', 'public', $q$app.is_editor()$q$, $q$app.is_editor()$q$),
      ('marketing_campaigns', 'marketing_campaigns_insert', 'INSERT', 'authenticated', null, $q$app.has_min_role('editor'::user_role)$q$),
      ('marketing_campaigns', 'marketing_campaigns_update', 'UPDATE', 'authenticated', $q$app.has_min_role('editor'::user_role)$q$, $q$app.has_min_role('editor'::user_role)$q$),
      ('marketing_contact_events', 'marketing_contact_events_insert', 'INSERT', 'authenticated', null, $q$app.has_min_role('editor'::user_role)$q$),
      ('marketing_contacts', 'marketing_contacts_insert', 'INSERT', 'authenticated', null, $q$app.has_min_role('editor'::user_role)$q$),
      ('marketing_contacts', 'marketing_contacts_update', 'UPDATE', 'authenticated', $q$app.has_min_role('editor'::user_role)$q$, $q$app.has_min_role('editor'::user_role)$q$),
      ('media', 'media_editor_insert', 'INSERT', 'public', null, $q$app.is_editor()$q$),
      ('media', 'media_editor_update', 'UPDATE', 'public', $q$app.is_editor()$q$, $q$app.is_editor()$q$),
      ('media_folders', 'media_folders_editor_all', 'ALL', 'public', $q$app.is_editor()$q$, $q$app.is_editor()$q$),
      ('news_categories', 'news_categories_editor_all', 'ALL', 'public', $q$app.is_editor()$q$, $q$app.is_editor()$q$),
      ('news_posts', 'news_posts_editor_insert', 'INSERT', 'public', null, $q$app.is_editor()$q$),
      ('news_posts', 'news_posts_editor_update', 'UPDATE', 'public', $q$app.is_editor()$q$, $q$app.is_editor()$q$),
      ('proposal_requests', 'proposal_requests_update', 'UPDATE', 'authenticated', $q$app.has_min_role('editor'::user_role)$q$, $q$app.has_min_role('editor'::user_role)$q$)
    ) t(tbl, pol, cmd, role_name, qual, chk)
  loop
    if not exists (
      select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
        and p.permissive = 'PERMISSIVE' and p.roles = array[r.role_name]::name[]
        and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk
    ) then
      raise exception 'r1_precondition_failed: policy %.% is not the expected pre-R1 definition - nothing changed', r.tbl, r.pol
        using errcode = 'P0001';
    end if;
  end loop;

  -- None of the replacement names may exist yet.
  select count(*) into v_count from pg_policies
  where schemaname = 'public' and policyname = any (array[
    'cms_content_staff_select', 'cms_content_staff_insert', 'cms_content_staff_update', 'cms_content_staff_delete',
    'cms_media_staff_select', 'cms_media_staff_insert', 'cms_media_staff_update', 'cms_media_staff_delete',
    'faq_categories_editor_select', 'faq_categories_editor_insert', 'faq_categories_editor_update', 'faq_categories_editor_delete',
    'gallery_categories_editor_select', 'gallery_categories_editor_insert', 'gallery_categories_editor_update', 'gallery_categories_editor_delete',
    'media_folders_editor_select', 'media_folders_editor_insert', 'media_folders_editor_update', 'media_folders_editor_delete',
    'news_categories_editor_select', 'news_categories_editor_insert', 'news_categories_editor_update', 'news_categories_editor_delete']);
  if v_count <> 0 then
    raise exception 'r1_precondition_failed: % replacement policy name(s) already exist - nothing changed', v_count using errcode = 'P0001';
  end if;

  select count(*) into v_count
  from unnest(array['company', 'courses', 'downloads', 'faq', 'gallery', 'media', 'news', 'marketing_campaigns',
                    'marketing_contacts', 'feedback_issues', 'feedback_actions', 'sales_leads']) k
  where not exists (select 1 from public.staff_module_catalog c where c.module_key = k and c.is_active);
  if v_count <> 0 then
    raise exception 'r1_precondition_failed: % module key(s) missing or inactive in staff_module_catalog', v_count
      using errcode = 'P0001';
  end if;

  if to_regprocedure('public.has_module_access_level(text,text)') is null
     or to_regprocedure('app.is_editor()') is null
     or to_regprocedure('app.is_super_admin()') is null
     or to_regprocedure('app.has_min_role(public.user_role)') is null then
    raise exception 'r1_precondition_failed: a required function is missing' using errcode = 'P0001';
  end if;

  -- Snapshot every policy on the 19 tables that R1 must NOT touch, for the postcondition block.
  create temporary table r1_untouched_before on commit drop as
  select tablename, policyname, cmd, permissive, roles::text as roles, qual, with_check
  from pg_policies
  where schemaname = 'public'
    and tablename = any (array['cms_content', 'cms_media', 'company_profile', 'courses', 'downloads', 'faq_categories', 'faqs',
      'feedback_improvement_actions', 'feedback_issues', 'gallery_categories', 'gallery_images', 'marketing_campaigns',
      'marketing_contact_events', 'marketing_contacts', 'media', 'media_folders', 'news_categories', 'news_posts', 'proposal_requests'])
    and policyname <> all (array['cms_content_staff_all', 'cms_media_staff_all', 'company_profile_editor_insert',
      'company_profile_editor_update', 'courses_insert', 'courses_update', 'downloads_editor_insert', 'downloads_editor_update',
      'faq_categories_editor_all', 'faqs_editor_insert', 'faqs_editor_update', 'feedback_improvement_actions_staff_insert',
      'feedback_improvement_actions_staff_update', 'feedback_issues_staff_insert', 'feedback_issues_staff_update',
      'gallery_categories_editor_all', 'gallery_images_editor_insert', 'gallery_images_editor_update', 'marketing_campaigns_insert',
      'marketing_campaigns_update', 'marketing_contact_events_insert', 'marketing_contacts_insert', 'marketing_contacts_update',
      'media_editor_insert', 'media_editor_update', 'media_folders_editor_all', 'news_categories_editor_all',
      'news_posts_editor_insert', 'news_posts_editor_update', 'proposal_requests_update']);
end;
$r1$;

-- ---- Split FOR ALL policies: read rule kept verbatim, writes gain the module condition ------------------------------

drop policy if exists cms_content_staff_all on public.cms_content;
create policy cms_content_staff_select on public.cms_content
  for select to authenticated
  using ((select app.is_editor()));
create policy cms_content_staff_insert on public.cms_content
  for insert to authenticated
  with check ((select app.is_editor()) and (select app.is_super_admin()));
create policy cms_content_staff_update on public.cms_content
  for update to authenticated
  using ((select app.is_editor()) and (select app.is_super_admin()))
  with check ((select app.is_editor()) and (select app.is_super_admin()));
create policy cms_content_staff_delete on public.cms_content
  for delete to authenticated
  using ((select app.is_editor()) and (select app.is_super_admin()));

drop policy if exists cms_media_staff_all on public.cms_media;
create policy cms_media_staff_select on public.cms_media
  for select to authenticated
  using ((select app.is_editor()));
create policy cms_media_staff_insert on public.cms_media
  for insert to authenticated
  with check ((select app.is_editor()) and (select app.is_super_admin()));
create policy cms_media_staff_update on public.cms_media
  for update to authenticated
  using ((select app.is_editor()) and (select app.is_super_admin()))
  with check ((select app.is_editor()) and (select app.is_super_admin()));
create policy cms_media_staff_delete on public.cms_media
  for delete to authenticated
  using ((select app.is_editor()) and (select app.is_super_admin()));

drop policy if exists faq_categories_editor_all on public.faq_categories;
create policy faq_categories_editor_select on public.faq_categories
  for select to public
  using (app.is_editor());
create policy faq_categories_editor_insert on public.faq_categories
  for insert to public
  with check (app.is_editor() and (select public.has_module_access_level('faq', 'edit')));
create policy faq_categories_editor_update on public.faq_categories
  for update to public
  using (app.is_editor() and (select public.has_module_access_level('faq', 'edit')))
  with check (app.is_editor() and (select public.has_module_access_level('faq', 'edit')));
create policy faq_categories_editor_delete on public.faq_categories
  for delete to public
  using (app.is_editor() and (select public.has_module_access_level('faq', 'edit')));

drop policy if exists gallery_categories_editor_all on public.gallery_categories;
create policy gallery_categories_editor_select on public.gallery_categories
  for select to public
  using (app.is_editor());
create policy gallery_categories_editor_insert on public.gallery_categories
  for insert to public
  with check (app.is_editor() and (select public.has_module_access_level('gallery', 'edit')));
create policy gallery_categories_editor_update on public.gallery_categories
  for update to public
  using (app.is_editor() and (select public.has_module_access_level('gallery', 'edit')))
  with check (app.is_editor() and (select public.has_module_access_level('gallery', 'edit')));
create policy gallery_categories_editor_delete on public.gallery_categories
  for delete to public
  using (app.is_editor() and (select public.has_module_access_level('gallery', 'edit')));

drop policy if exists media_folders_editor_all on public.media_folders;
create policy media_folders_editor_select on public.media_folders
  for select to public
  using (app.is_editor());
create policy media_folders_editor_insert on public.media_folders
  for insert to public
  with check (app.is_editor() and (select public.has_module_access_level('media', 'edit')));
create policy media_folders_editor_update on public.media_folders
  for update to public
  using (app.is_editor() and (select public.has_module_access_level('media', 'edit')))
  with check (app.is_editor() and (select public.has_module_access_level('media', 'edit')));
create policy media_folders_editor_delete on public.media_folders
  for delete to public
  using (app.is_editor() and (select public.has_module_access_level('media', 'edit')));

drop policy if exists news_categories_editor_all on public.news_categories;
create policy news_categories_editor_select on public.news_categories
  for select to public
  using (app.is_editor());
create policy news_categories_editor_insert on public.news_categories
  for insert to public
  with check (app.is_editor() and (select public.has_module_access_level('news', 'edit')));
create policy news_categories_editor_update on public.news_categories
  for update to public
  using (app.is_editor() and (select public.has_module_access_level('news', 'edit')))
  with check (app.is_editor() and (select public.has_module_access_level('news', 'edit')));
create policy news_categories_editor_delete on public.news_categories
  for delete to public
  using (app.is_editor() and (select public.has_module_access_level('news', 'edit')));

-- ---- INSERT / UPDATE policies: previous expression AND module edit ---------------------------------------------------

drop policy if exists company_profile_editor_insert on public.company_profile;
create policy company_profile_editor_insert on public.company_profile
  for insert to public
  with check (app.is_editor() and (select public.has_module_access_level('company', 'edit')));
drop policy if exists company_profile_editor_update on public.company_profile;
create policy company_profile_editor_update on public.company_profile
  for update to public
  using (app.is_editor() and (select public.has_module_access_level('company', 'edit')))
  with check (app.is_editor() and (select public.has_module_access_level('company', 'edit')));

drop policy if exists courses_insert on public.courses;
create policy courses_insert on public.courses
  for insert to authenticated
  with check (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('courses', 'edit')));
drop policy if exists courses_update on public.courses;
create policy courses_update on public.courses
  for update to authenticated
  using (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('courses', 'edit')))
  with check (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('courses', 'edit')));

drop policy if exists downloads_editor_insert on public.downloads;
create policy downloads_editor_insert on public.downloads
  for insert to public
  with check (app.is_editor() and (select public.has_module_access_level('downloads', 'edit')));
drop policy if exists downloads_editor_update on public.downloads;
create policy downloads_editor_update on public.downloads
  for update to public
  using (app.is_editor() and (select public.has_module_access_level('downloads', 'edit')))
  with check (app.is_editor() and (select public.has_module_access_level('downloads', 'edit')));

drop policy if exists faqs_editor_insert on public.faqs;
create policy faqs_editor_insert on public.faqs
  for insert to public
  with check (app.is_editor() and (select public.has_module_access_level('faq', 'edit')));
drop policy if exists faqs_editor_update on public.faqs;
create policy faqs_editor_update on public.faqs
  for update to public
  using (app.is_editor() and (select public.has_module_access_level('faq', 'edit')))
  with check (app.is_editor() and (select public.has_module_access_level('faq', 'edit')));

drop policy if exists feedback_improvement_actions_staff_insert on public.feedback_improvement_actions;
create policy feedback_improvement_actions_staff_insert on public.feedback_improvement_actions
  for insert to authenticated
  with check ((select app.has_min_role('editor'::public.user_role)) and (select public.has_module_access_level('feedback_actions', 'edit')));
drop policy if exists feedback_improvement_actions_staff_update on public.feedback_improvement_actions;
create policy feedback_improvement_actions_staff_update on public.feedback_improvement_actions
  for update to authenticated
  using ((select app.has_min_role('editor'::public.user_role)) and (select public.has_module_access_level('feedback_actions', 'edit')))
  with check ((select app.has_min_role('editor'::public.user_role)) and (select public.has_module_access_level('feedback_actions', 'edit')));

drop policy if exists feedback_issues_staff_insert on public.feedback_issues;
create policy feedback_issues_staff_insert on public.feedback_issues
  for insert to authenticated
  with check ((select app.has_min_role('editor'::public.user_role)) and (select public.has_module_access_level('feedback_issues', 'edit')));
drop policy if exists feedback_issues_staff_update on public.feedback_issues;
create policy feedback_issues_staff_update on public.feedback_issues
  for update to authenticated
  using ((select app.has_min_role('editor'::public.user_role)) and (select public.has_module_access_level('feedback_issues', 'edit')))
  with check ((select app.has_min_role('editor'::public.user_role)) and (select public.has_module_access_level('feedback_issues', 'edit')));

drop policy if exists gallery_images_editor_insert on public.gallery_images;
create policy gallery_images_editor_insert on public.gallery_images
  for insert to public
  with check (app.is_editor() and (select public.has_module_access_level('gallery', 'edit')));
drop policy if exists gallery_images_editor_update on public.gallery_images;
create policy gallery_images_editor_update on public.gallery_images
  for update to public
  using (app.is_editor() and (select public.has_module_access_level('gallery', 'edit')))
  with check (app.is_editor() and (select public.has_module_access_level('gallery', 'edit')));

drop policy if exists marketing_campaigns_insert on public.marketing_campaigns;
create policy marketing_campaigns_insert on public.marketing_campaigns
  for insert to authenticated
  with check (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('marketing_campaigns', 'edit')));
drop policy if exists marketing_campaigns_update on public.marketing_campaigns;
create policy marketing_campaigns_update on public.marketing_campaigns
  for update to authenticated
  using (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('marketing_campaigns', 'edit')))
  with check (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('marketing_campaigns', 'edit')));

drop policy if exists marketing_contact_events_insert on public.marketing_contact_events;
create policy marketing_contact_events_insert on public.marketing_contact_events
  for insert to authenticated
  with check (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('marketing_contacts', 'edit')));

drop policy if exists marketing_contacts_insert on public.marketing_contacts;
create policy marketing_contacts_insert on public.marketing_contacts
  for insert to authenticated
  with check (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('marketing_contacts', 'edit')));
drop policy if exists marketing_contacts_update on public.marketing_contacts;
create policy marketing_contacts_update on public.marketing_contacts
  for update to authenticated
  using (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('marketing_contacts', 'edit')))
  with check (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('marketing_contacts', 'edit')));

drop policy if exists media_editor_insert on public.media;
create policy media_editor_insert on public.media
  for insert to public
  with check (app.is_editor() and (select public.has_module_access_level('media', 'edit')));
drop policy if exists media_editor_update on public.media;
create policy media_editor_update on public.media
  for update to public
  using (app.is_editor() and (select public.has_module_access_level('media', 'edit')))
  with check (app.is_editor() and (select public.has_module_access_level('media', 'edit')));

drop policy if exists news_posts_editor_insert on public.news_posts;
create policy news_posts_editor_insert on public.news_posts
  for insert to public
  with check (app.is_editor() and (select public.has_module_access_level('news', 'edit')));
drop policy if exists news_posts_editor_update on public.news_posts;
create policy news_posts_editor_update on public.news_posts
  for update to public
  using (app.is_editor() and (select public.has_module_access_level('news', 'edit')))
  with check (app.is_editor() and (select public.has_module_access_level('news', 'edit')));

drop policy if exists proposal_requests_update on public.proposal_requests;
create policy proposal_requests_update on public.proposal_requests
  for update to authenticated
  using (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('sales_leads', 'edit')))
  with check (app.has_min_role('editor'::public.user_role) and (select public.has_module_access_level('sales_leads', 'edit')));

-- ---- Postconditions -------------------------------------------------------------------------------------------------
do $r1p$
declare
  v_count int;
begin
  -- Every policy R1 did not target is byte-for-byte unchanged.
  select count(*) into v_count from (
    (select * from r1_untouched_before)
    except
    (select tablename, policyname, cmd, permissive, roles::text, qual, with_check from pg_policies where schemaname = 'public')
  ) missing;
  if v_count <> 0 then
    raise exception 'r1_postcondition_failed: % non-targeted policy(ies) changed', v_count using errcode = 'P0001';
  end if;

  -- No FOR ALL policy remains on the 19 tables.
  select count(*) into v_count from pg_policies
  where schemaname = 'public' and cmd = 'ALL'
    and tablename = any (array['cms_content', 'cms_media', 'faq_categories', 'gallery_categories', 'media_folders', 'news_categories']);
  if v_count <> 0 then
    raise exception 'r1_postcondition_failed: % FOR ALL policy(ies) remain', v_count using errcode = 'P0001';
  end if;

  -- Every INSERT/UPDATE/DELETE policy on the 19 tables is either module-aware, super_admin-only, or one of the
  -- admin-only DELETE policies left for R2.
  select count(*) into v_count from pg_policies
  where schemaname = 'public' and cmd in ('INSERT', 'UPDATE', 'DELETE')
    and tablename = any (array['cms_content', 'cms_media', 'company_profile', 'courses', 'downloads', 'faq_categories', 'faqs',
      'feedback_improvement_actions', 'feedback_issues', 'gallery_categories', 'gallery_images', 'marketing_campaigns',
      'marketing_contact_events', 'marketing_contacts', 'media', 'media_folders', 'news_categories', 'news_posts', 'proposal_requests'])
    and coalesce(qual, '') || ' ' || coalesce(with_check, '') !~ '(has_module_access_level|is_super_admin)'
    and policyname <> all (array['courses_delete', 'downloads_admin_delete', 'faqs_admin_delete', 'gallery_images_admin_delete',
      'media_admin_delete', 'news_posts_admin_delete']);
  if v_count <> 0 then
    raise exception 'r1_postcondition_failed: % role-only write policy(ies) remain', v_count using errcode = 'P0001';
  end if;

  select count(*) into v_count from pg_policies
  where schemaname = 'public' and policyname = any (array[
    'cms_content_staff_select', 'cms_media_staff_select', 'faq_categories_editor_select', 'gallery_categories_editor_select',
    'media_folders_editor_select', 'news_categories_editor_select']) and cmd = 'SELECT';
  if v_count <> 6 then
    raise exception 'r1_postcondition_failed: expected 6 split SELECT policies, found %', v_count using errcode = 'P0001';
  end if;
end;
$r1p$;
