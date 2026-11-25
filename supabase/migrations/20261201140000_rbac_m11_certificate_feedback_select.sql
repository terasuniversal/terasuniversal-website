-- RBAC M-11 (F-03 final data-access hardening): staff SELECT on certificate records, the public verification log and
-- participant feedback requires a module that renders them.
-- Before: public.certificates (participant name, FULL identity number, course, dates) was readable by ANY active
-- trainer, editor or admin (app.has_min_role('trainer') only); public.certificate_verifications (query value, IP
-- address, user agent) by any editor OR any account whose role is trainer (no is_active check on that branch); and
-- public.participant_feedback (free-text comments per participant) by any editor. So Sales, Finance and Management
-- staff could read all of them through the API although no page of theirs renders them.
-- After (SELECT policies only; this migration changes no INSERT, UPDATE or DELETE policy, grant or function):
--  * certificates: trainer floor AND View on certificates, participants or companies - the three modules whose pages
--    read certificate rows (certificate list/detail/export/ZIP, participant detail, company detail). Reports is NOT in
--    the list: its "latest certificates" widget and valid-certificate tile become empty for a Reports-only holder.
--  * certificate_verifications: trainer floor (requires an ACTIVE profile) AND certificates View - only the certificate
--    detail page reads it. The policy keeps its existing roles (public on Production, authenticated on Staging).
--  * participant_feedback: editor floor AND View on feedback, feedback_responses or schedules (feedback pages and the
--    schedule detail page). feedback_issues / feedback_actions do not read this table.
-- Unchanged: public /verify uses public.verify_and_log (SECURITY DEFINER) and does not read these tables through RLS;
-- certificate issue/reissue/revoke/metadata/verification-toggle and WAH gates run inside SECURITY DEFINER functions;
-- the token feedback form uses SECURITY DEFINER RPCs; the Staging-only policy for certificate_lifecycle_executor is
-- not touched; service_role bypasses RLS. Super Admin and role-default (non-Custom) trainers/editors keep access
-- through the module catalog (certificates: trainer, participants/companies/feedback/schedules: editor).
-- Requires 20261201110000 (app.can_module / app.has_any_module_access). Approval: OWNER-CRM-RBAC-M11-20261125.

do $m11_requires$
begin
  if to_regprocedure('app.can_module(text,text)') is null or to_regprocedure('app.has_any_module_access(text[],text)') is null then
    raise exception 'm11_precondition_failed: app.can_module / app.has_any_module_access missing - apply DB B first; nothing changed' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_policies p
                 where p.schemaname = 'public' and p.tablename = 'certificate_verifications' and p.policyname = 'cert_verif_staff_read'
                   and p.cmd = 'SELECT' and p.permissive = 'PERMISSIVE' and array_to_string(p.roles, ',') in ('public', 'authenticated')
                   and p.qual = $q$(app.is_editor() OR (app."current_role"() = 'trainer'::user_role))$q$ and p.with_check is null) then
    raise exception 'm11_precondition_failed: policy certificate_verifications.cert_verif_staff_read is not the reviewed pre-state - nothing changed' using errcode = 'P0001';
  end if;
end;
$m11_requires$;

set local lock_timeout = '5s';

do $m11_pre$
declare r record;
begin
  for r in
    select * from (values
      ($q$certificates$q$, $q$certificates_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$app.has_min_role('trainer'::user_role)$q$, null),
      ($q$participant_feedback$q$, $q$participant_feedback_staff_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$( SELECT app.has_min_role('editor'::user_role) AS has_min_role)$q$, null)
    ) as t(tbl, pol, cmd, roles, qual, chk)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles and p.permissive = 'PERMISSIVE'
                     and p.qual is not distinct from r.qual and p.with_check is not distinct from r.chk) then
      raise exception 'm11_precondition_failed: policy %.% is not the reviewed pre-state - nothing changed', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
end;
$m11_pre$;

drop policy if exists certificates_select on public.certificates;
create policy certificates_select on public.certificates as permissive for select to authenticated
  using ((app.has_min_role('trainer'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['certificates'::text, 'participants'::text, 'companies'::text], 'view'::text) AS has_any_module_access)));

drop policy if exists participant_feedback_staff_select on public.participant_feedback;
create policy participant_feedback_staff_select on public.participant_feedback as permissive for select to authenticated
  using ((app.has_min_role('editor'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['feedback'::text, 'feedback_responses'::text, 'schedules'::text], 'view'::text) AS has_any_module_access)));

-- certificate_verifications: same roles as before (they differ between Production and Staging), new rule.
do $m11_cv$
declare v_roles text;
begin
  select array_to_string(p.roles, ',') into v_roles from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'certificate_verifications' and p.policyname = 'cert_verif_staff_read';
  drop policy cert_verif_staff_read on public.certificate_verifications;
  execute format('create policy cert_verif_staff_read on public.certificate_verifications as permissive for select to %s using (%s)',
                 v_roles, $q$(app.has_min_role('trainer'::public.user_role) AND ( SELECT app.has_any_module_access(ARRAY['certificates'::text], 'view'::text) AS has_any_module_access))$q$);
end;
$m11_cv$;

do $m11_post$
declare r record;
begin
  for r in
    select * from (values
      ($q$certificates$q$, $q$certificates_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$has_any_module_access$q$),
      ($q$participant_feedback$q$, $q$participant_feedback_staff_select$q$, $q$SELECT$q$, $q$authenticated$q$, $q$has_any_module_access$q$)
    ) as t(tbl, pol, cmd, roles, token)
  loop
    if not exists (select 1 from pg_policies p
                   where p.schemaname = 'public' and p.tablename = r.tbl and p.policyname = r.pol and p.cmd = r.cmd
                     and array_to_string(p.roles, ',') = r.roles
                     and position(r.token in coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')) > 0) then
      raise exception 'm11_postcondition_failed: policy %.% is not as intended', r.tbl, r.pol using errcode = 'P0001';
    end if;
  end loop;
  if not exists (select 1 from pg_policies p
                 where p.schemaname = 'public' and p.tablename = 'certificate_verifications' and p.policyname = 'cert_verif_staff_read'
                   and p.cmd = 'SELECT' and array_to_string(p.roles, ',') in ('public', 'authenticated')
                   and position('has_any_module_access' in p.qual) > 0 and position('current_role' in p.qual) = 0) then
    raise exception 'm11_postcondition_failed: policy certificate_verifications.cert_verif_staff_read is not as intended' using errcode = 'P0001';
  end if;
  -- Each table keeps RLS and exactly one SELECT-capable policy for anon/authenticated (the Staging-only policy for the
  -- certificate_lifecycle_executor role is not counted), and the certificate rule does not admit Reports.
  for r in select * from unnest(array['certificates', 'certificate_verifications', 'participant_feedback']) as u(tbl) loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || r.tbl)::regclass)
       or (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.cmd in ('SELECT', 'ALL')
             and p.roles && array['public', 'anon', 'authenticated']::name[]) <> 1
       or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.tbl and p.cmd = 'SELECT' and p.qual like '%''reports''%') then
      raise exception 'm11_postcondition_failed: % has RLS off, more than one staff SELECT policy, or a reports rule', r.tbl using errcode = 'P0001';
    end if;
  end loop;
end;
$m11_post$;
