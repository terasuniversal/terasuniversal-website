-- I2 C5 security drift hardening. Additive after the frozen C5B1 sequence.
-- Do not edit/collapse 20260924120000, 20260924130000, or 20260924140000.
-- Apply only after explicit environment approval; never to Production by default.

begin;

-- The later filename preserves the frozen sequence. Match 140000's
-- history-independent approach by validating the C5 final objects below.
do $$
begin
  if to_regclass('public.certificate_verifications') is null
    or to_regclass('public.certificate_verifications_id_seq') is null
    or to_regprocedure('public.verify_and_log(text,text,text,text)') is null
    or to_regprocedure('public.import_legacy_certificate(uuid,uuid,jsonb)') is null
    or to_regprocedure('app.import_legacy_certificate(uuid,uuid,jsonb)') is null then
    raise exception 'I2 precondition failed: required C5B1 objects are missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'certificate_issuance_snapshots'
      and column_name = 'holder_name' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'certificate_issuance_snapshots'
      and column_name = 'issue_date' and data_type = 'date'
  ) then
    raise exception 'I2 precondition failed: immutable snapshot holder/issue-date fields are missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid = 'public.certificate_issuance_snapshots'::regclass
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'I2 precondition failed: immutable snapshot RLS/FORCE RLS is not active';
  end if;
  if not has_schema_privilege('authenticated', 'app', 'USAGE') then
    raise exception 'I2 precondition failed: authenticated role cannot resolve the guarded app import implementation';
  end if;
end;
$$;

-- Verification logs are written only by the SECURITY DEFINER verifier or a
-- trusted backend role. Authenticated staff retain SELECT under RLS; anon and
-- authenticated callers receive no direct write or sequence privileges.
alter table public.certificate_verifications enable row level security;
alter table public.certificate_verifications force row level security;
revoke all privileges on table public.certificate_verifications from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.certificate_verifications from authenticated;
grant select on table public.certificate_verifications to authenticated;
revoke all privileges on sequence public.certificate_verifications_id_seq
  from public, anon, authenticated;

drop policy if exists cert_verif_staff_read on public.certificate_verifications;
create policy cert_verif_staff_read
  on public.certificate_verifications
  for select to authenticated
  using (app.is_editor() or app.current_role() = 'trainer'::public.user_role);

-- FORCE RLS also applies to a SECURITY DEFINER owner without BYPASSRLS.
-- Permit only the trusted postgres function owner to append verifier logs;
-- anon/authenticated remain denied by both ACLs and policy scope.
drop policy if exists cert_verif_definer_insert on public.certificate_verifications;
create policy cert_verif_definer_insert
  on public.certificate_verifications
  for insert to postgres
  with check (true);

-- Modern public verification reads immutable snapshots inside the same
-- SECURITY DEFINER function. FORCE RLS on the snapshot table requires an
-- explicit trusted-owner read policy when postgres lacks BYPASSRLS.
drop policy if exists cert_issuance_snapshot_definer_read on public.certificate_issuance_snapshots;
create policy cert_issuance_snapshot_definer_read
  on public.certificate_issuance_snapshots
  for select to postgres
  using (true);

-- Do not depend on app-schema USAGE to block the public legacy-import wrapper.
-- Its SECURITY INVOKER boundary remains; the called implementation still
-- checks active admin identity and certificates-module admin access.
revoke all privileges on function public.import_legacy_certificate(uuid, uuid, jsonb)
  from public, anon, service_role;
grant execute on function public.import_legacy_certificate(uuid, uuid, jsonb)
  to authenticated;
revoke all privileges on function app.import_legacy_certificate(uuid, uuid, jsonb)
  from public, anon, service_role;
grant execute on function app.import_legacy_certificate(uuid, uuid, jsonb)
  to authenticated;

-- Preserve the public RPC boundary while sourcing modern display values from
-- captured immutable fields. Live participant/course joins are legacy-only.
create or replace function public.verify_and_log(
  p_query text,
  p_method text default 'auto',
  p_ip text default null,
  p_ua text default null
)
returns table (
  found boolean,
  certificate_number text,
  holder_name text,
  participant_code_masked text,
  company text,
  course_title text,
  training_date date,
  training_start_date date,
  training_end_date date,
  issue_date date,
  expiry_date date,
  status text,
  is_valid boolean,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v record;
  v_status text;
  v_ip inet;
  q text := pg_catalog.btrim(coalesce(p_query, ''));
begin
  if q = '' then
    return;
  end if;

  begin
    v_ip := nullif(p_ip, '')::pg_catalog.inet;
  exception when others then
    v_ip := null;
  end;

  select
    c.id,
    c.certificate_number,
    case
      when s.certificate_id is not null then coalesce(s.holder_name, c.holder_name)
      else c.holder_name
    end as holder_name,
    c.status,
    coalesce(s.issue_date, c.issue_date) as issue_date,
    c.expiry_date,
    c.verification_enabled,
    c.public_verification_enabled,
    case
      when s.certificate_id is not null then s.participant_code_snapshot
      else p.participant_id
    end as p_code,
    case
      when s.certificate_id is not null then s.company_snapshot
      else p.company
    end as p_company,
    case
      when s.certificate_id is not null then s.course_name
      else coalesce(co.title, co.course_name)
    end as course_title,
    coalesce(s.training_start_date, c.training_start_date) as training_start_date,
    coalesce(s.training_end_date, c.training_end_date) as training_end_date
  into v
  from public.certificates c
  left join public.participants p on p.id = c.participant_id
  left join public.courses co on co.id = c.course_id
  left join public.certificate_issuance_snapshots s on s.certificate_id = c.id
  where c.deleted_at is null
    and (
      ((p_method in ('auto', 'token')) and c.verification_token = q)
      or ((p_method in ('auto', 'number')) and pg_catalog.upper(c.certificate_number) = pg_catalog.upper(q))
    )
  limit 1;

  if not found then
    insert into public.certificate_verifications(
      method, query_value, status_returned, ip_address, user_agent
    ) values (
      p_method, q, 'not_found', v_ip, p_ua
    );
    return;
  end if;

  -- Both controls are deny-only: neither flag can enable a disabled certificate.
  if v.verification_enabled is false
    or coalesce(v.public_verification_enabled, true) is false then
    insert into public.certificate_verifications(
      certificate_id, certificate_number, method, query_value,
      status_returned, ip_address, user_agent
    ) values (
      v.id, v.certificate_number, p_method, q,
      'disabled', v_ip, p_ua
    );
    return;
  end if;

  -- Draft, archived, deleted, NULL, and future statuses are never public.
  if v.status is null or v.status not in ('valid', 'issued', 'expired', 'revoked') then
    insert into public.certificate_verifications(
      certificate_id, certificate_number, method, query_value,
      status_returned, ip_address, user_agent
    ) values (
      v.id, v.certificate_number, p_method, q,
      'not_found', v_ip, p_ua
    );
    return;
  end if;

  if v.status in ('valid', 'issued') then
    if v.expiry_date is null or v.expiry_date >= current_date then
      v_status := 'valid';
    else
      v_status := 'expired';
    end if;
  elsif v.status = 'revoked' then
    v_status := 'revoked';
  else
    v_status := 'expired';
  end if;

  insert into public.certificate_verifications(
    certificate_id, certificate_number, method, query_value,
    status_returned, ip_address, user_agent
  ) values (
    v.id, v.certificate_number, p_method, q,
    v_status, v_ip, p_ua
  );

  return query select
    true,
    v.certificate_number,
    v.holder_name,
    case
      when v.p_code is null then null
      when pg_catalog.length(v.p_code) <= 2 then pg_catalog.repeat('•', pg_catalog.length(v.p_code))
      when pg_catalog.length(v.p_code) <= 6 then
        pg_catalog.repeat('•', pg_catalog.length(v.p_code) - 2) || pg_catalog.right(v.p_code, 2)
      else pg_catalog.left(v.p_code, 4)
        || pg_catalog.repeat('•', greatest(pg_catalog.length(v.p_code) - 6, 1))
        || pg_catalog.right(v.p_code, 2)
    end,
    v.p_company,
    v.course_title,
    v.training_start_date,
    v.training_start_date,
    v.training_end_date,
    v.issue_date,
    v.expiry_date,
    v_status,
    (v_status = 'valid'),
    pg_catalog.now();
end;
$$;

alter function public.verify_and_log(text, text, text, text) owner to postgres;
comment on function public.verify_and_log(text, text, text, text) is
  'Public verification uses immutable snapshot values when captured, immutable certificate-row fallbacks where safe, and current participant/course values only for legacy records without snapshots. Identity numbers are never returned; participant codes are masked.';
revoke all on function public.verify_and_log(text, text, text, text) from public;
grant execute on function public.verify_and_log(text, text, text, text)
  to anon, authenticated, service_role;

-- Fail the transaction if the installed SQL state does not match the intended
-- final boundary. These checks also guard against accidental PUBLIC inheritance.
do $$
declare
  v_log oid := 'public.certificate_verifications'::regclass;
  v_seq oid := 'public.certificate_verifications_id_seq'::regclass;
  v_verify oid := 'public.verify_and_log(text,text,text,text)'::regprocedure;
  v_public_import oid := 'public.import_legacy_certificate(uuid,uuid,jsonb)'::regprocedure;
  v_app_import oid := 'app.import_legacy_certificate(uuid,uuid,jsonb)'::regprocedure;
  v_toggle oid := 'app.set_certificate_verification_enabled(uuid,boolean)'::regprocedure;
  v_owner name;
  v_definer boolean;
  v_config text[];
  v_rls boolean;
  v_force_rls boolean;
begin
  select c.relrowsecurity, c.relforcerowsecurity
    into v_rls, v_force_rls from pg_catalog.pg_class c where c.oid = v_log;
  if not v_rls or not v_force_rls then
    raise exception 'I2 postcondition failed: verification-log RLS/FORCE RLS is not active';
  end if;
  if pg_catalog.has_table_privilege('anon', v_log, 'SELECT')
    or pg_catalog.has_table_privilege('anon', v_log, 'INSERT')
    or pg_catalog.has_table_privilege('anon', v_log, 'UPDATE')
    or pg_catalog.has_table_privilege('anon', v_log, 'DELETE')
    or pg_catalog.has_sequence_privilege('anon', v_seq, 'USAGE')
    or pg_catalog.has_sequence_privilege('anon', v_seq, 'SELECT')
    or pg_catalog.has_sequence_privilege('anon', v_seq, 'UPDATE')
    or pg_catalog.has_sequence_privilege('authenticated', v_seq, 'USAGE')
    or pg_catalog.has_sequence_privilege('authenticated', v_seq, 'SELECT')
    or pg_catalog.has_sequence_privilege('authenticated', v_seq, 'UPDATE') then
    raise exception 'I2 postcondition failed: direct log/sequence access remains';
  end if;
  if not pg_catalog.has_table_privilege('authenticated', v_log, 'SELECT')
    or pg_catalog.has_table_privilege('authenticated', v_log, 'INSERT')
    or pg_catalog.has_table_privilege('authenticated', v_log, 'UPDATE')
    or pg_catalog.has_table_privilege('authenticated', v_log, 'DELETE') then
    raise exception 'I2 postcondition failed: authenticated staff log access is not read-only';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_verifications'
      and p.policyname = 'cert_verif_staff_read' and p.cmd = 'SELECT'
      and p.roles = array['authenticated']::name[]
  ) or exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_verifications'
      and p.cmd in ('SELECT', 'ALL')
      and (p.roles @> array['public']::name[] or p.roles @> array['anon']::name[])
  ) then
    raise exception 'I2 postcondition failed: verification-log policy boundary is incorrect';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_verifications'
      and p.policyname = 'cert_verif_definer_insert' and p.cmd = 'INSERT'
      and p.roles = array['postgres']::name[]
  ) or exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_verifications'
      and p.cmd in ('INSERT', 'ALL')
      and (p.roles @> array['public']::name[]
        or p.roles @> array['anon']::name[]
        or p.roles @> array['authenticated']::name[])
  ) then
    raise exception 'I2 postcondition failed: verifier insert policy is not restricted to the trusted owner';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_issuance_snapshots'
      and p.policyname = 'cert_issuance_snapshot_definer_read' and p.cmd = 'SELECT'
      and p.roles = array['postgres']::name[] and p.qual = 'true'
  ) or exists (
    select 1 from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = 'certificate_issuance_snapshots'
      and p.cmd in ('SELECT', 'ALL')
      and (p.roles @> array['public']::name[] or p.roles @> array['anon']::name[])
  ) then
    raise exception 'I2 postcondition failed: snapshot read policy is not restricted to the trusted owner';
  end if;

  if pg_catalog.has_function_privilege('anon', v_public_import, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_public_import, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_public_import, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', v_app_import, 'EXECUTE')
    or pg_catalog.has_function_privilege('service_role', v_app_import, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_app_import, 'EXECUTE') then
    raise exception 'I2 postcondition failed: legacy import EXECUTE boundary is incorrect';
  end if;
  if (select prosecdef from pg_catalog.pg_proc where oid = v_public_import) then
    raise exception 'I2 postcondition failed: public legacy-import wrapper must remain SECURITY INVOKER';
  end if;
  if not pg_catalog.has_schema_privilege('authenticated', 'app', 'USAGE') then
    raise exception 'I2 postcondition failed: authenticated caller cannot resolve the guarded app implementation';
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    into v_owner, v_definer, v_config from pg_catalog.pg_proc p where p.oid = v_app_import;
  if v_owner <> 'postgres' or not v_definer
    or v_config is distinct from array['search_path=public, app, extensions']::text[] then
    raise exception 'I2 postcondition failed: guarded app import SECURITY DEFINER context changed';
  end if;
  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    into v_owner, v_definer, v_config from pg_catalog.pg_proc p where p.oid = v_toggle;
  if v_owner <> 'postgres' or not v_definer
    or v_config is distinct from array['search_path=public, app, extensions']::text[] then
    raise exception 'I2 postcondition failed: certificate-toggle SECURITY DEFINER context changed';
  end if;

  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    into v_owner, v_definer, v_config from pg_catalog.pg_proc p where p.oid = v_verify;
  if v_owner <> 'postgres' or not v_definer
    or v_config is distinct from array['search_path=pg_catalog']::text[]
    or not pg_catalog.has_function_privilege('anon', v_verify, 'EXECUTE')
    or not pg_catalog.has_function_privilege('authenticated', v_verify, 'EXECUTE') then
    raise exception 'I2 postcondition failed: canonical public verifier execution boundary changed';
  end if;
end;
$$;

commit;
