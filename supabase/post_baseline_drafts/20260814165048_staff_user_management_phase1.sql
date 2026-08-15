-- TERAS UNIVERSAL Staff User Management, Phase 1
-- Additive department + explicit module access control.
-- No Auth users are created by this migration.

-- ---------------------------------------------------------------------
-- Controlled department and module metadata
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'staff_department') then
    create type public.staff_department as enum (
      'sales', 'marketing', 'training', 'finance', 'administration', 'management'
    );
  end if;
end$$;

do $$
declare
  _value text;
begin
  foreach _value in array array['staff_invited', 'staff_activated', 'staff_deactivated', 'staff_role_changed', 'staff_department_changed', 'staff_module_access_changed'] loop
    begin
      execute format('alter type public.audit_action add value if not exists %L', _value);
    exception when undefined_object then
      -- The base audit migration must exist before this Phase 1 migration.
      raise;
    end;
  end loop;
end$$;

alter table public.profiles
  add column if not exists department public.staff_department,
  add column if not exists access_control_enabled boolean not null default false;

create table if not exists public.staff_module_catalog (
  module_key text primary key,
  label text not null,
  group_key text not null,
  min_role public.user_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.staff_module_catalog is
  'Controlled CMS module keys. Role threshold and explicit staff access are separate decisions.';

insert into public.staff_module_catalog (module_key, label, group_key, min_role)
values
  ('dashboard', 'Dashboard', 'overview', 'editor'),
  ('reports', 'Reports & Analytics', 'overview', 'editor'),
  ('courses', 'Courses', 'training', 'editor'),
  ('trainers', 'Trainers', 'training', 'editor'),
  ('schedules', 'Training Schedule', 'training', 'editor'),
  ('participants', 'Participants', 'training', 'editor'),
  ('companies', 'Companies', 'training', 'editor'),
  ('attendance', 'Attendance', 'training', 'trainer'),
  ('assessment', 'Assessment', 'training', 'trainer'),
  ('certificates', 'Certificates', 'certification', 'trainer'),
  ('certificate_templates', 'Certificate Templates', 'certification', 'admin'),
  ('sales', 'Sales Dashboard', 'sales', 'editor'),
  ('sales_leads', 'Leads', 'sales', 'editor'),
  ('sales_opportunities', 'Opportunities', 'sales', 'editor'),
  ('sales_quotations', 'Quotations', 'sales', 'editor'),
  ('sales_followups', 'Follow-ups', 'sales', 'editor'),
  ('sales_tasks', 'Tasks', 'sales', 'editor'),
  ('sales_reports', 'Sales Reports', 'sales', 'editor'),
  ('news', 'News', 'website', 'editor'),
  ('gallery', 'Gallery', 'website', 'editor'),
  ('faq', 'FAQ', 'website', 'editor'),
  ('downloads', 'Downloads', 'website', 'editor'),
  ('company', 'Company Profile', 'website', 'editor'),
  ('media', 'Media Library', 'website', 'editor'),
  ('automation', 'Automation Centre', 'administration', 'admin'),
  ('system', 'System Health', 'administration', 'admin'),
  ('backups', 'Backup Manager', 'administration', 'admin'),
  ('audit', 'Audit Log', 'administration', 'admin'),
  ('users', 'Staff Users', 'administration', 'super_admin'),
  ('feedback', 'Feedback Dashboard', 'feedback', 'editor'),
  ('feedback_responses', 'Feedback Responses', 'feedback', 'editor'),
  ('feedback_issues', 'Feedback Issues', 'feedback', 'editor'),
  ('feedback_actions', 'Feedback Actions', 'feedback', 'editor')
on conflict (module_key) do update set
  label = excluded.label,
  group_key = excluded.group_key,
  min_role = excluded.min_role,
  is_active = true;

create table if not exists public.staff_module_access (
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_key text not null references public.staff_module_catalog(module_key),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  primary key (user_id, module_key)
);

comment on table public.staff_module_access is
  'Explicit module allow-list for staff profiles with access_control_enabled=true.';

create index if not exists staff_module_access_module_idx
  on public.staff_module_access (module_key);

alter table public.staff_module_catalog enable row level security;
alter table public.staff_module_catalog force row level security;
alter table public.staff_module_access enable row level security;
alter table public.staff_module_access force row level security;

drop policy if exists staff_module_catalog_staff_read on public.staff_module_catalog;
create policy staff_module_catalog_staff_read on public.staff_module_catalog
  for select to authenticated
  using (app.is_active() and is_active);

drop policy if exists staff_module_access_self_read on public.staff_module_access;
create policy staff_module_access_self_read on public.staff_module_access
  for select to authenticated
  using (user_id = auth.uid() or app.is_super_admin());

drop policy if exists staff_module_access_super_all on public.staff_module_access;
create policy staff_module_access_super_all on public.staff_module_access
  for all to authenticated
  using (app.is_super_admin())
  with check (app.is_super_admin());

revoke all on public.staff_module_catalog from anon;
revoke all on public.staff_module_access from anon;
grant select on public.staff_module_catalog to authenticated;
grant select on public.staff_module_access to authenticated;

-- Existing staff keep their role-based behavior until a Super Admin enables
-- explicit access control for that profile. New invitations enable it.
create or replace function app.has_module_access(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not app.is_active() then false
    when app.current_role() = 'super_admin' then true
    when not coalesce((select access_control_enabled from public.profiles where id = auth.uid()), false)
      then exists (
        select 1 from public.staff_module_catalog c
        where c.module_key = p_module_key
          and c.is_active
          and app.has_min_role(c.min_role)
      )
    else exists (
      select 1
      from public.staff_module_access a
      join public.staff_module_catalog c on c.module_key = a.module_key
      where a.user_id = auth.uid()
        and a.module_key = p_module_key
        and c.is_active
        and app.has_min_role(c.min_role)
    )
  end;
$$;

revoke all on function app.has_module_access(text) from public;
grant execute on function app.has_module_access(text) to authenticated;

-- Prevent self-service privilege changes through the profile update path.
-- The server-side service client performs sensitive profile changes after a
-- Super Admin check; normal authenticated clients may only edit safe fields.
revoke update on public.profiles from authenticated;
grant update (full_name, phone, avatar_url, job_title, last_login_at) on public.profiles to authenticated;

-- Keep the last active Super Admin from being deactivated or demoted, even
-- if an administrative operation is accidentally issued through a trusted
-- server path. Service-role operations remain subject to this invariant.
create or replace function app.protect_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.role = 'super_admin' and old.is_active
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not exists (
       select 1 from public.profiles p
       where p.id <> old.id and p.role = 'super_admin' and p.is_active
     ) then
    raise exception 'cannot remove the last active super admin' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_last_super_admin on public.profiles;
create trigger trg_profiles_protect_last_super_admin
before update on public.profiles
for each row execute function app.protect_last_super_admin();

-- ---------------------------------------------------------------------
-- Sensitive module RLS alignment
-- ---------------------------------------------------------------------

-- Sales CRM tables: role threshold AND explicit module access. Existing
-- profiles without explicit access control continue through role fallback.
drop policy if exists sales_lead_metadata_select on public.sales_lead_metadata;
create policy sales_lead_metadata_select on public.sales_lead_metadata
  for select to authenticated using (app.has_module_access('sales_leads'));
drop policy if exists sales_lead_metadata_update on public.sales_lead_metadata;
create policy sales_lead_metadata_update on public.sales_lead_metadata
  for update to authenticated using (app.has_module_access('sales_leads') and app.is_admin())
  with check (app.has_module_access('sales_leads') and app.is_admin());

drop policy if exists sales_activity_select on public.sales_activity;
create policy sales_activity_select on public.sales_activity
  for select to authenticated using (app.has_module_access('sales_leads'));
drop policy if exists sales_activity_insert on public.sales_activity;
create policy sales_activity_insert on public.sales_activity
  for insert to authenticated with check (app.has_module_access('sales_leads') and app.is_editor());

drop policy if exists sales_opportunities_select on public.sales_opportunities;
create policy sales_opportunities_select on public.sales_opportunities
  for select to authenticated using (app.has_module_access('sales_opportunities'));
drop policy if exists sales_opportunities_insert on public.sales_opportunities;
create policy sales_opportunities_insert on public.sales_opportunities
  for insert to authenticated with check (app.has_module_access('sales_opportunities') and app.is_admin());
drop policy if exists sales_opportunities_update on public.sales_opportunities;
create policy sales_opportunities_update on public.sales_opportunities
  for update to authenticated using (app.has_module_access('sales_opportunities') and app.is_admin())
  with check (app.has_module_access('sales_opportunities') and app.is_admin());

drop policy if exists sales_quotations_select on public.sales_quotations;
create policy sales_quotations_select on public.sales_quotations
  for select to authenticated using (app.has_module_access('sales_quotations'));
drop policy if exists sales_quotations_insert on public.sales_quotations;
create policy sales_quotations_insert on public.sales_quotations
  for insert to authenticated with check (app.has_module_access('sales_quotations') and app.is_admin());
drop policy if exists sales_quotations_update on public.sales_quotations;
create policy sales_quotations_update on public.sales_quotations
  for update to authenticated using (app.has_module_access('sales_quotations') and app.is_admin())
  with check (app.has_module_access('sales_quotations') and app.is_admin());

drop policy if exists sales_quotation_items_select on public.sales_quotation_items;
create policy sales_quotation_items_select on public.sales_quotation_items
  for select to authenticated using (app.has_module_access('sales_quotations'));
drop policy if exists sales_quotation_items_insert on public.sales_quotation_items;
create policy sales_quotation_items_insert on public.sales_quotation_items
  for insert to authenticated with check (app.has_module_access('sales_quotations') and app.is_admin());
drop policy if exists sales_quotation_items_update on public.sales_quotation_items;
create policy sales_quotation_items_update on public.sales_quotation_items
  for update to authenticated using (app.has_module_access('sales_quotations') and app.is_admin())
  with check (app.has_module_access('sales_quotations') and app.is_admin());
drop policy if exists sales_quotation_items_delete on public.sales_quotation_items;
create policy sales_quotation_items_delete on public.sales_quotation_items
  for delete to authenticated using (app.has_module_access('sales_quotations') and app.is_admin());

drop policy if exists sales_tasks_select on public.sales_tasks;
create policy sales_tasks_select on public.sales_tasks
  for select to authenticated using (app.has_module_access('sales_tasks'));
drop policy if exists sales_tasks_insert on public.sales_tasks;
create policy sales_tasks_insert on public.sales_tasks
  for insert to authenticated with check (app.has_module_access('sales_tasks') and app.is_editor());
drop policy if exists sales_tasks_update on public.sales_tasks;
create policy sales_tasks_update on public.sales_tasks
  for update to authenticated
  using (app.has_module_access('sales_tasks') and (app.is_admin() or assigned_to = auth.uid() or created_by = auth.uid()))
  with check (app.has_module_access('sales_tasks') and (app.is_admin() or assigned_to = auth.uid() or created_by = auth.uid()));
drop policy if exists sales_tasks_delete on public.sales_tasks;
create policy sales_tasks_delete on public.sales_tasks
  for delete to authenticated using (app.has_module_access('sales_tasks') and app.is_admin());

-- Sensitive training/certification tables are explicitly denied to a
-- restricted Sales profile at the database boundary too.
create or replace function app.can_view_attendance()
returns boolean language sql stable security definer set search_path = public
as $$ select app.is_active() and app.has_module_access('attendance')
  and (app.has_min_role('editor') or app.current_role() = 'trainer'); $$;
create or replace function app.can_manage_attendance()
returns boolean language sql stable security definer set search_path = public
as $$ select app.is_active() and app.has_module_access('attendance')
  and (app.has_min_role('admin') or app.current_role() = 'trainer'); $$;
create or replace function app.can_view_assessment()
returns boolean language sql stable security definer set search_path = public
as $$ select app.is_active() and app.has_module_access('assessment')
  and (app.has_min_role('editor') or app.current_role() = 'trainer'); $$;
create or replace function app.can_manage_assessment()
returns boolean language sql stable security definer set search_path = public
as $$ select app.is_active() and app.has_module_access('assessment')
  and (app.has_min_role('admin') or app.current_role() = 'trainer'); $$;

drop policy if exists certificates_select on public.certificates;
drop policy if exists certificates_view on public.certificates;
create policy certificates_view on public.certificates
  for select to authenticated using (app.has_module_access('certificates') and (app.is_editor() or app.current_role() = 'trainer'));
drop policy if exists certificates_insert on public.certificates;
drop policy if exists certificates_admin_insert on public.certificates;
create policy certificates_admin_insert on public.certificates
  for insert to authenticated with check (app.has_module_access('certificates') and app.is_admin());
drop policy if exists certificates_update on public.certificates;
drop policy if exists certificates_admin_update on public.certificates;
create policy certificates_admin_update on public.certificates
  for update to authenticated using (app.has_module_access('certificates') and app.is_admin())
  with check (app.has_module_access('certificates') and app.is_admin());
drop policy if exists certificates_delete on public.certificates;
drop policy if exists certificates_admin_delete on public.certificates;
create policy certificates_admin_delete on public.certificates
  for delete to authenticated using (app.has_module_access('certificates') and app.is_admin());

drop policy if exists cert_templates_view on public.certificate_templates;
create policy cert_templates_view on public.certificate_templates
  for select to authenticated using (app.has_module_access('certificate_templates') and (app.is_editor() or app.current_role() = 'trainer'));
drop policy if exists cert_templates_admin_write on public.certificate_templates;
create policy cert_templates_admin_write on public.certificate_templates
  for all to authenticated using (app.has_module_access('certificate_templates') and app.is_admin())
  with check (app.has_module_access('certificate_templates') and app.is_admin());

-- Cascade RPCs must enforce module access inside SECURITY DEFINER bodies.
-- The four functions are defined in prior migrations; these guarded versions
-- preserve their business logic while closing forged-RPC bypasses.
-- The application Server Actions also check the same module keys.

-- Remove older permissive policy names before recreating the selected
-- sensitive-module policies. PostgreSQL combines permissive policies with OR.
drop policy if exists attendance_view on public.attendance;
drop policy if exists attendance_manage_insert on public.attendance;
drop policy if exists attendance_manage_update on public.attendance;
drop policy if exists attendance_admin_delete on public.attendance;
drop policy if exists attendance_select on public.attendance;
drop policy if exists attendance_insert on public.attendance;
drop policy if exists attendance_update on public.attendance;
drop policy if exists attendance_delete on public.attendance;
create policy attendance_select on public.attendance
  for select to authenticated using (app.can_view_attendance());
create policy attendance_insert on public.attendance
  for insert to authenticated with check (app.can_manage_attendance());
create policy attendance_update on public.attendance
  for update to authenticated using (app.can_manage_attendance()) with check (app.can_manage_attendance());
create policy attendance_delete on public.attendance
  for delete to authenticated using (app.has_module_access('attendance') and app.is_admin());

drop policy if exists assessments_view on public.assessments;
drop policy if exists assessments_manage_insert on public.assessments;
drop policy if exists assessments_manage_update on public.assessments;
drop policy if exists assessments_super_update on public.assessments;
drop policy if exists assessments_admin_delete on public.assessments;
drop policy if exists assessments_select on public.assessments;
drop policy if exists assessments_insert on public.assessments;
drop policy if exists assessments_update on public.assessments;
drop policy if exists assessments_delete on public.assessments;
create policy assessments_select on public.assessments
  for select to authenticated using (app.can_view_assessment());
create policy assessments_insert on public.assessments
  for insert to authenticated with check (app.can_manage_assessment());
create policy assessments_update on public.assessments
  for update to authenticated using (app.can_manage_assessment() and locked = false)
  with check (app.can_manage_assessment());
create policy assessments_super_update on public.assessments
  for update to authenticated using (app.has_module_access('assessment') and app.is_super_admin())
  with check (app.has_module_access('assessment') and app.is_super_admin());
create policy assessments_delete on public.assessments
  for delete to authenticated using (app.has_module_access('assessment') and app.is_admin());

-- The lead source tables feed the Sales Inbox. Public form inserts remain
-- available; staff reads/updates now require the lead module.
drop policy if exists enquiries_staff_read on public.enquiries;
create policy enquiries_staff_read on public.enquiries
  for select to authenticated using (app.has_module_access('sales_leads'));
drop policy if exists enquiries_staff_update on public.enquiries;
create policy enquiries_staff_update on public.enquiries
  for update to authenticated using (app.has_module_access('sales_leads') and app.is_editor())
  with check (app.has_module_access('sales_leads') and app.is_editor());
drop policy if exists proposal_requests_staff_read on public.proposal_requests;
create policy proposal_requests_staff_read on public.proposal_requests
  for select to authenticated using (app.has_module_access('sales_leads'));
drop policy if exists proposal_requests_staff_update on public.proposal_requests;
create policy proposal_requests_staff_update on public.proposal_requests
  for update to authenticated using (app.has_module_access('sales_leads') and app.is_editor())
  with check (app.has_module_access('sales_leads') and app.is_editor());

-- ---------------------------------------------------------------------
-- SECURITY DEFINER Sales RPC guards
-- ---------------------------------------------------------------------

create or replace function public.convert_lead_to_opportunity(
  p_lead_metadata_id uuid,
  p_title text,
  p_expected_close_date date,
  p_estimated_value numeric
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_opportunity_id uuid;
  v_lead record;
begin
  if not app.has_module_access('sales_leads') or not app.has_module_access('sales_opportunities') or not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_lead from public.v_sales_lead_inbox where lead_metadata_id = p_lead_metadata_id;
  if v_lead is null then raise exception 'lead_not_found' using errcode = 'P0001'; end if;
  if exists (select 1 from public.sales_opportunities where lead_metadata_id = p_lead_metadata_id) then
    raise exception 'opportunity_already_exists' using errcode = 'P0001';
  end if;
  insert into public.sales_opportunities (
    lead_metadata_id, company_name, contact_person, contact_email, contact_phone,
    title, programme, stage, created_by
  )
  values (
    p_lead_metadata_id, v_lead.company, v_lead.contact_name, v_lead.email, v_lead.phone,
    trim(p_title), v_lead.subject, 'qualified', auth.uid()
  ) returning id into v_opportunity_id;
  update public.sales_opportunities
  set expected_close_date = p_expected_close_date, estimated_value = p_estimated_value, updated_at = now()
  where id = v_opportunity_id;
  insert into public.sales_activity (lead_metadata_id, opportunity_id, type, note, actor_id)
  values (p_lead_metadata_id, v_opportunity_id, 'opportunity_created', 'Converted to opportunity', auth.uid());
  return v_opportunity_id;
end;
$$;

create or replace function public.accept_quotation(p_quotation_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_opportunity_id uuid;
  v_lead_metadata_id uuid;
  v_status text;
  v_opportunity_stage text;
  v_now timestamptz := now();
begin
  if not app.has_module_access('sales_quotations') or not app.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select opportunity_id, status into v_opportunity_id, v_status from public.sales_quotations where id = p_quotation_id;
  if v_opportunity_id is null then raise exception 'quotation_not_found' using errcode = 'P0001'; end if;
  if v_status is distinct from 'sent' then raise exception 'invalid_transition: only a sent quotation can be accepted (current status: %)', v_status using errcode = 'P0001'; end if;
  select lead_metadata_id, stage into v_lead_metadata_id, v_opportunity_stage from public.sales_opportunities where id = v_opportunity_id;
  if v_opportunity_stage in ('won', 'lost') then raise exception 'invalid_transition: opportunity is already resolved (current stage: %)', v_opportunity_stage using errcode = 'P0001'; end if;
  update public.sales_quotations set status = 'accepted', accepted_at = v_now, updated_at = v_now where id = p_quotation_id;
  update public.sales_opportunities set stage = 'won', won_at = v_now, updated_at = v_now where id = v_opportunity_id;
  update public.sales_lead_metadata set status = 'won', won_at = v_now, updated_at = v_now where id = v_lead_metadata_id;
  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id) values
    (v_lead_metadata_id, v_opportunity_id, p_quotation_id, 'quotation_accepted', 'Quotation accepted', auth.uid()),
    (v_lead_metadata_id, v_opportunity_id, null, 'opportunity_won', 'Opportunity won', auth.uid()),
    (v_lead_metadata_id, null, null, 'won', 'Lead won (quotation accepted)', auth.uid());
end;
$$;

create or replace function public.reject_quotation(p_quotation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_opportunity_id uuid;
  v_lead_metadata_id uuid;
  v_status text;
begin
  if not app.has_module_access('sales_quotations') or not app.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  select opportunity_id, status into v_opportunity_id, v_status from public.sales_quotations where id = p_quotation_id;
  if v_opportunity_id is null then raise exception 'quotation_not_found' using errcode = 'P0001'; end if;
  if v_status is distinct from 'sent' then raise exception 'invalid_transition: only a sent quotation can be rejected (current status: %)', v_status using errcode = 'P0001'; end if;
  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_opportunity_id;
  update public.sales_quotations set status = 'rejected', rejected_at = now(), rejection_reason = trim(p_reason), updated_at = now() where id = p_quotation_id;
  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_opportunity_id, p_quotation_id, 'quotation_rejected', 'Rejected — ' || trim(p_reason), auth.uid());
end;
$$;

create or replace function public.mark_opportunity_lost(p_opportunity_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_lead_metadata_id uuid;
  v_stage text;
  v_now timestamptz := now();
begin
  if not app.has_module_access('sales_opportunities') or not app.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_reason is null or p_reason not in ('price', 'no_budget', 'no_response', 'timing', 'competitor', 'requirement_changed', 'duplicate', 'other') then raise exception 'invalid_reason' using errcode = 'P0001'; end if;
  select lead_metadata_id, stage into v_lead_metadata_id, v_stage from public.sales_opportunities where id = p_opportunity_id;
  if v_lead_metadata_id is null then raise exception 'opportunity_not_found' using errcode = 'P0001'; end if;
  if v_stage in ('won', 'lost') then raise exception 'invalid_transition: opportunity is already resolved (current stage: %)', v_stage using errcode = 'P0001'; end if;
  update public.sales_opportunities set stage = 'lost', lost_at = v_now, lost_reason = p_reason, updated_at = v_now where id = p_opportunity_id;
  update public.sales_lead_metadata set status = 'lost', lost_reason = p_reason, updated_at = v_now where id = v_lead_metadata_id;
  insert into public.sales_activity (lead_metadata_id, opportunity_id, type, note, actor_id) values
    (v_lead_metadata_id, p_opportunity_id, 'opportunity_lost', 'Opportunity lost — ' || p_reason, auth.uid()),
    (v_lead_metadata_id, null, 'lost', 'Lead lost (opportunity lost)', auth.uid());
end;
$$;
