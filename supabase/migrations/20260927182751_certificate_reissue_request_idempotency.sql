-- Make retries of one user-submitted reissue operation safe while preserving
-- the append-only history and allowing a new event under a new request key.
begin;

-- Snapshot direct API-role ACLs before changing the public table. The temporary
-- relation is transaction-scoped and disappears at commit or rollback.
create temporary table _teras_certificate_reissue_api_acl_baseline
on commit drop
as
select 'table'::text as object_type,
       null::text as column_name,
       grantee.rolname::text as grantee,
       grantor.rolname::text as grantor,
       acl_entry.privilege_type,
       acl_entry.is_grantable
from pg_catalog.pg_class c
cross join lateral pg_catalog.aclexplode(
  coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
) acl_entry
join pg_catalog.pg_roles grantee on grantee.oid = acl_entry.grantee
join pg_catalog.pg_roles grantor on grantor.oid = acl_entry.grantor
where c.oid = 'public.certificate_reissue_events'::pg_catalog.regclass
  and grantee.rolname in ('anon', 'authenticated', 'service_role')
union all
select 'column'::text,
       a.attname::text,
       grantee.rolname::text,
       grantor.rolname::text,
       acl_entry.privilege_type,
       acl_entry.is_grantable
from pg_catalog.pg_attribute a
cross join lateral pg_catalog.aclexplode(a.attacl) acl_entry
join pg_catalog.pg_roles grantee on grantee.oid = acl_entry.grantee
join pg_catalog.pg_roles grantor on grantor.oid = acl_entry.grantor
where a.attrelid = 'public.certificate_reissue_events'::pg_catalog.regclass
  and a.attnum > 0
  and not a.attisdropped
  and a.attacl is not null
  and grantee.rolname in ('anon', 'authenticated', 'service_role');

do $api_acl_baseline_precondition$
begin
  if exists (
    select 1
    from pg_temp._teras_certificate_reissue_api_acl_baseline
    where grantee = 'anon'
      and object_type = 'table'
  ) then
    raise exception 'Unexpected direct anon table ACL on certificate reissue events';
  end if;
  if not exists (
       select 1
       from pg_temp._teras_certificate_reissue_api_acl_baseline
       where grantee = 'authenticated'
         and object_type = 'table'
         and privilege_type = 'SELECT'
     )
     or exists (
       select 1
       from pg_temp._teras_certificate_reissue_api_acl_baseline
       where grantee = 'authenticated'
         and object_type = 'table'
         and (privilege_type <> 'SELECT' or is_grantable)
     ) then
    raise exception 'Unexpected authenticated table ACL baseline on certificate reissue events';
  end if;
  if exists (
    select 1
    from pg_temp._teras_certificate_reissue_api_acl_baseline
    where grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'Unexpected anon/authenticated write ACL baseline on certificate reissue events';
  end if;
  if exists (
    select expected.privilege_type
    from (values
      ('SELECT'::text),
      ('INSERT'::text),
      ('UPDATE'::text),
      ('DELETE'::text),
      ('TRUNCATE'::text),
      ('REFERENCES'::text),
      ('TRIGGER'::text),
      ('MAINTAIN'::text)
    ) expected(privilege_type)
    except
    select distinct privilege_type
    from pg_temp._teras_certificate_reissue_api_acl_baseline
    where grantee = 'service_role'
      and object_type = 'table'
  ) then
    raise exception 'Expected pre-existing service_role table ACL baseline is incomplete';
  end if;
end;
$api_acl_baseline_precondition$;

alter table public.certificate_reissue_events
  add column if not exists idempotency_key uuid;

create unique index if not exists certificate_reissue_events_actor_idempotency_key_uidx
  on public.certificate_reissue_events (reissued_by, idempotency_key)
  where idempotency_key is not null;

comment on column public.certificate_reissue_events.idempotency_key is
  'Client-generated request identity for retry-safe reissue/reprint. Null is retained only for pre-migration events.';

-- Existing role grants are column-scoped; extend only the lifecycle executor's
-- ability to insert this new request identity. No authenticated/anon table
-- write grant or RLS policy is added.
grant insert (idempotency_key)
  on public.certificate_reissue_events to certificate_lifecycle_executor;

-- Hosted migration runners may be able to administer this role without being
-- the owner of its SECURITY DEFINER function. Temporarily enable SET ROLE and
-- schema CREATE only inside this transaction so replacement executes as the
-- established function owner; both capabilities are removed before commit.
do $migration_owner_precondition$
declare
  v_membership_count integer;
begin
  if current_user <> 'postgres' then
    raise exception 'Certificate reissue idempotency migration requires postgres';
  end if;
  select count(*) into v_membership_count
  from pg_catalog.pg_auth_members m
  join pg_catalog.pg_roles target on target.oid = m.roleid
  join pg_catalog.pg_roles member on member.oid = m.member
  join pg_catalog.pg_roles grantor on grantor.oid = m.grantor
  where target.rolname = 'certificate_lifecycle_executor'
    and member.rolname = 'postgres';
  if v_membership_count <> 2
     or not exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles target on target.oid = m.roleid
    join pg_catalog.pg_roles member on member.oid = m.member
    join pg_catalog.pg_roles grantor on grantor.oid = m.grantor
    where target.rolname = 'certificate_lifecycle_executor'
      and member.rolname = 'postgres'
      and grantor.rolname = 'supabase_admin'
      and m.admin_option
      and not m.inherit_option
      and not m.set_option
  ) or not exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles target on target.oid = m.roleid
    join pg_catalog.pg_roles member on member.oid = m.member
    join pg_catalog.pg_roles grantor on grantor.oid = m.grantor
    where target.rolname = 'certificate_lifecycle_executor'
      and member.rolname = 'postgres'
      and grantor.rolname = 'postgres'
      and not m.admin_option
      and not m.inherit_option
      and not m.set_option
  ) then
    raise exception 'Expected exact hardened dual-grantor executor membership topology';
  end if;
  if pg_catalog.has_schema_privilege('certificate_lifecycle_executor', 'app', 'CREATE') then
    raise exception 'Executor unexpectedly retains CREATE on schema app';
  end if;
end;
$migration_owner_precondition$;

grant create on schema app to certificate_lifecycle_executor;
grant certificate_lifecycle_executor to postgres
  with admin false, inherit false, set true
  granted by postgres;
do $temporary_set_postcondition$
begin
  if not pg_catalog.pg_has_role('postgres', 'certificate_lifecycle_executor', 'SET')
     or not exists (
       select 1
       from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles target on target.oid = m.roleid
       join pg_catalog.pg_roles member on member.oid = m.member
       join pg_catalog.pg_roles grantor on grantor.oid = m.grantor
       where target.rolname = 'certificate_lifecycle_executor'
         and member.rolname = 'postgres'
         and grantor.rolname = 'supabase_admin'
         and m.admin_option
         and not m.inherit_option
         and not m.set_option
     )
     or not exists (
       select 1
       from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles target on target.oid = m.roleid
       join pg_catalog.pg_roles member on member.oid = m.member
       join pg_catalog.pg_roles grantor on grantor.oid = m.grantor
       where target.rolname = 'certificate_lifecycle_executor'
         and member.rolname = 'postgres'
         and grantor.rolname = 'postgres'
         and not m.admin_option
         and not m.inherit_option
         and m.set_option
     )
     or (select count(*)
         from pg_catalog.pg_auth_members m
         join pg_catalog.pg_roles target on target.oid = m.roleid
         join pg_catalog.pg_roles member on member.oid = m.member
         where target.rolname = 'certificate_lifecycle_executor'
           and member.rolname = 'postgres') <> 2 then
    raise exception 'Temporary self-granted SET membership postcondition failed';
  end if;
end;
$temporary_set_postcondition$;
set local role certificate_lifecycle_executor;

create or replace function app.reissue_certificate(
  p_certificate_id uuid,
  p_event_type text default 'reissue',
  p_reason text default null,
  p_notes jsonb default '{}'::jsonb
)
returns table (id uuid, certificate_id uuid, certificate_number text, event_type text, reissued_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_cert public.certificates%rowtype;
  v_event public.certificate_reissue_events%rowtype;
  v_actor uuid;
  v_idempotency_key uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_notes jsonb := coalesce(p_notes, '{}'::jsonb);
begin
  if not app.is_active() or not app.is_admin() or not public.has_module_access_level('certificates', 'admin') then
    raise exception 'Not authorized to reissue certificates.' using errcode = '42501';
  end if;
  v_actor := app.request_actor_id();
  if p_event_type not in ('reprint', 'reissue') then
    raise exception 'Invalid reissue event type.' using errcode = 'P0001';
  end if;
  if nullif(btrim(v_notes->>'idempotency_key'), '') is null then
    raise exception 'A reissue request key is required.' using errcode = '22023';
  end if;
  begin
    v_idempotency_key := (v_notes->>'idempotency_key')::uuid;
  exception when invalid_text_representation then
    raise exception 'Invalid reissue request key.' using errcode = '22023';
  end;

  select * into v_cert
  from public.certificates c
  where c.id = p_certificate_id
  for update;

  if not found or v_cert.deleted_at is not null then
    raise exception 'Certificate not found.' using errcode = 'P0002';
  end if;
  if v_cert.status not in ('valid', 'expired', 'issued', 'archived') then
    raise exception 'Certificate status does not permit reissue.' using errcode = 'P0001';
  end if;

  insert into public.certificate_reissue_events
    (certificate_id, reissued_by, reason, event_type, notes, idempotency_key)
  values
    (v_cert.id, v_actor, v_reason, p_event_type, v_notes, v_idempotency_key)
  on conflict (reissued_by, idempotency_key) where idempotency_key is not null
  do nothing
  returning * into v_event;

  if not found then
    select * into v_event
    from public.certificate_reissue_events e
    where e.reissued_by = v_actor
      and e.idempotency_key = v_idempotency_key;

    if not found
       or v_event.certificate_id is distinct from v_cert.id
       or v_event.event_type is distinct from p_event_type
       or v_event.reason is distinct from v_reason
       or v_event.notes is distinct from v_notes then
      raise exception 'Reissue request key was already used for a different operation.' using errcode = '23505';
    end if;
  end if;

  return query select v_event.id, v_cert.id, coalesce(v_cert.certificate_number, v_cert.certificate_no), v_event.event_type, v_event.reissued_at;
end;
$$;

-- Keep the lifecycle RPC under its existing least-privilege execution role.
alter function app.reissue_certificate(uuid, text, text, jsonb)
  owner to certificate_lifecycle_executor;

comment on function app.reissue_certificate(uuid, text, text, jsonb) is
  'Creates an append-only reprint/reissue event for an existing certificate identity. Retries with the same actor/request key and payload return the original event; a new request key creates a new event. Never changes issue_date, number, token, or issuance snapshot.';

reset role;
revoke create on schema app from certificate_lifecycle_executor;
revoke set option for certificate_lifecycle_executor
  from postgres granted by postgres;

do $migration_owner_postcondition$
declare
  v_role record;
  v_function oid := pg_catalog.to_regprocedure('app.reissue_certificate(uuid,text,text,jsonb)');
  v_membership_count integer;
  v_api_acl_before jsonb;
  v_api_acl_after jsonb;
begin
  select * into v_role
  from pg_catalog.pg_roles
  where rolname = 'certificate_lifecycle_executor';
  if not found
     or v_role.rolcanlogin
     or v_role.rolsuper
     or v_role.rolcreatedb
     or v_role.rolcreaterole
     or v_role.rolbypassrls
     or v_role.rolinherit then
    raise exception 'Certificate lifecycle executor role attributes are unsafe';
  end if;
  if pg_catalog.has_schema_privilege('certificate_lifecycle_executor', 'app', 'CREATE') then
    raise exception 'Certificate lifecycle executor retained CREATE on schema app';
  end if;
  select count(*) into v_membership_count
  from pg_catalog.pg_auth_members m
  join pg_catalog.pg_roles target on target.oid = m.roleid
  join pg_catalog.pg_roles member on member.oid = m.member
  where target.rolname = 'certificate_lifecycle_executor'
    and member.rolname = 'postgres';
  if v_membership_count <> 2
     or pg_catalog.pg_has_role('postgres', 'certificate_lifecycle_executor', 'SET')
     or not exists (
       select 1
       from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles target on target.oid = m.roleid
       join pg_catalog.pg_roles member on member.oid = m.member
       join pg_catalog.pg_roles grantor on grantor.oid = m.grantor
       where target.rolname = 'certificate_lifecycle_executor'
         and member.rolname = 'postgres'
         and grantor.rolname = 'supabase_admin'
         and m.admin_option
         and not m.inherit_option
         and not m.set_option
     )
     or not exists (
       select 1
       from pg_catalog.pg_auth_members m
       join pg_catalog.pg_roles target on target.oid = m.roleid
       join pg_catalog.pg_roles member on member.oid = m.member
       join pg_catalog.pg_roles grantor on grantor.oid = m.grantor
       where target.rolname = 'certificate_lifecycle_executor'
         and member.rolname = 'postgres'
         and grantor.rolname = 'postgres'
         and not m.admin_option
         and not m.inherit_option
         and not m.set_option
     ) then
    raise exception 'Final executor membership paths differ from the hosted baseline';
  end if;
  if exists (
    select 1
    from pg_catalog.pg_auth_members m
    join pg_catalog.pg_roles target on target.oid = m.roleid
    join pg_catalog.pg_roles member on member.oid = m.member
    where target.rolname = 'certificate_lifecycle_executor'
      and member.rolname in ('anon', 'authenticated', 'service_role')
  ) then
    raise exception 'Executor role is directly granted to an API role';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid = 'public.certificate_reissue_events'::pg_catalog.regclass
      and c.relrowsecurity
      and c.relforcerowsecurity
  ) then
    raise exception 'Certificate reissue event RLS/FORCE RLS postcondition failed';
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(object_type, column_name, grantee, grantor, privilege_type, is_grantable)
      order by object_type, column_name, grantee, grantor, privilege_type, is_grantable
    ),
    '[]'::jsonb
  ) into v_api_acl_before
  from pg_temp._teras_certificate_reissue_api_acl_baseline;
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(object_type, column_name, grantee, grantor, privilege_type, is_grantable)
      order by object_type, column_name, grantee, grantor, privilege_type, is_grantable
    ),
    '[]'::jsonb
  ) into v_api_acl_after
  from (
    select 'table'::text as object_type,
           null::text as column_name,
           grantee.rolname::text as grantee,
           grantor.rolname::text as grantor,
           acl_entry.privilege_type,
           acl_entry.is_grantable
    from pg_catalog.pg_class c
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl_entry
    join pg_catalog.pg_roles grantee on grantee.oid = acl_entry.grantee
    join pg_catalog.pg_roles grantor on grantor.oid = acl_entry.grantor
    where c.oid = 'public.certificate_reissue_events'::pg_catalog.regclass
      and grantee.rolname in ('anon', 'authenticated', 'service_role')
    union all
    select 'column'::text,
           a.attname::text,
           grantee.rolname::text,
           grantor.rolname::text,
           acl_entry.privilege_type,
           acl_entry.is_grantable
    from pg_catalog.pg_attribute a
    cross join lateral pg_catalog.aclexplode(a.attacl) acl_entry
    join pg_catalog.pg_roles grantee on grantee.oid = acl_entry.grantee
    join pg_catalog.pg_roles grantor on grantor.oid = acl_entry.grantor
    where a.attrelid = 'public.certificate_reissue_events'::pg_catalog.regclass
      and a.attnum > 0
      and not a.attisdropped
      and a.attacl is not null
      and grantee.rolname in ('anon', 'authenticated', 'service_role')
  ) api_acl;
  if v_api_acl_after is distinct from v_api_acl_before then
    raise exception 'API table/column ACLs on certificate reissue events changed from their pre-migration baseline';
  end if;
  if v_function is null
     or (select r.rolname from pg_catalog.pg_roles r where r.oid = (select p.proowner from pg_catalog.pg_proc p where p.oid = v_function)) <> 'certificate_lifecycle_executor'
     or not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = v_function)
     or not exists (
       select 1
       from pg_catalog.pg_proc p,
            pg_catalog.unnest(p.proconfig) setting
       where p.oid = v_function
         and setting = 'search_path=pg_catalog'
     ) then
    raise exception 'Reissue function owner or SECURITY DEFINER hardening postcondition failed';
  end if;
end;
$migration_owner_postcondition$;

commit;
