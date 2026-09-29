\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema app;

create table public.certificate_branches (
  id uuid primary key,
  branch_code text not null,
  branch_name text not null,
  display_address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certificate_branches_code_key unique (branch_code)
);

create table public.course_schedules (
  id uuid primary key,
  branch_id uuid references public.certificate_branches(id) on delete set null,
  deleted_at timestamptz,
  notes text
);

-- Minimal prerequisite double used only to prove the branch-binding migration
-- refuses a database without the issuer's branch guard. It is not a copy of
-- the real issuance RPC and its execution is not issuance behavioral evidence.
create function app.issue_certificate_with_skill_snapshot(uuid, uuid, text)
returns table(id uuid, verification_token text)
language plpgsql
security definer
set search_path = public, app, extensions
as $issuer$
declare
  v_branch_id uuid;
begin
  select s.branch_id into v_branch_id
  from public.course_schedules s
  where s.id = $1;
  if v_branch_id is null then
    raise exception 'Certificate issuing branch is not configured.' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.certificate_branches b
    where b.id = v_branch_id and b.is_active
  ) then
    raise exception 'Certificate issuing branch is inactive or missing.' using errcode = 'P0001';
  end if;
  return query select $2, 'test-token'::text;
end;
$issuer$;

grant usage on schema app, public to anon, authenticated, service_role;
grant insert, select, update on public.course_schedules to authenticated, service_role;
grant select on public.certificate_branches to authenticated, service_role;
grant execute on function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) to authenticated;

insert into public.certificate_branches (id, branch_code, branch_name, is_active)
values
  ('a0000000-0000-4000-8000-000000000001', 'HQ', 'TERAS UNIVERSAL SDN. BHD.', true),
  ('a0000000-0000-4000-8000-000000000002', 'REGIONAL', 'Existing Regional Branch', true),
  ('a0000000-0000-4000-8000-000000000003', 'INACTIVE', 'Inactive Branch', false);

insert into public.course_schedules (id, branch_id, deleted_at, notes)
values
  ('b0000000-0000-4000-8000-000000000001', null, null, 'legacy live null'),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', null, 'existing valid assignment'),
  ('b0000000-0000-4000-8000-000000000003', null, now(), 'soft deleted null');
