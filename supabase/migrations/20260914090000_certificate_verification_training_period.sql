-- C7A DESIGN DRAFT ONLY — DO NOT APPLY WITHOUT SEPARATE APPROVAL.
-- Public verification training-period contract.
--
-- Preconditions for a future controlled apply:
--   * public.certificates.training_start_date/end_date exist.
--   * public.certificate_issuance_snapshots exists with one row per certificate
--     and training_start_date/end_date columns.
--   * The live function signature is exactly
--     public.verify_and_log(text, text, text, text).
--
-- The assertions deliberately fail closed if the live schema differs. This
-- draft does not mutate data and must be reviewed against both environments
-- before it is ever applied.

begin;

DO $$
begin
  if to_regclass('public.certificates') is null then
    raise exception 'C7A precondition failed: public.certificates is missing';
  end if;
  if to_regclass('public.certificate_issuance_snapshots') is null then
    raise exception 'C7A precondition failed: public.certificate_issuance_snapshots is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'certificates'
      and column_name = 'training_start_date' and data_type = 'date'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'certificates'
      and column_name = 'training_end_date' and data_type = 'date'
  ) then
    raise exception 'C7A precondition failed: certificate training date columns are missing or not date';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'certificate_issuance_snapshots'
      and column_name = 'training_start_date' and data_type = 'date'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'certificate_issuance_snapshots'
      and column_name = 'training_end_date' and data_type = 'date'
  ) then
    raise exception 'C7A precondition failed: snapshot training date columns are missing or not date';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.certificate_issuance_snapshots'::regclass
      and contype = 'u'
      and conkey = array[(
        select attnum from pg_attribute
        where attrelid = 'public.certificate_issuance_snapshots'::regclass
          and attname = 'certificate_id'
      )::smallint]
  ) then
    raise exception 'C7A precondition failed: snapshot cardinality is not one row per certificate';
  end if;
  if to_regprocedure('public.verify_and_log(text,text,text,text)') is null then
    raise exception 'C7A precondition failed: exact public.verify_and_log(text,text,text,text) function is missing';
  end if;
end;
$$;

-- PostgreSQL cannot change a RETURNS TABLE shape with CREATE OR REPLACE.
-- Drop only this exact four-argument overload, then recreate it in-transaction.
drop function if exists public.verify_and_log(text, text, text, text);

create function public.verify_and_log(
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
set search_path = public
as $$
declare
  v record;
  v_status text;
  v_ip inet;
  q text := trim(coalesce(p_query, ''));
begin
  if q = '' then
    return;
  end if;

  begin
    v_ip := nullif(p_ip, '')::inet;
  exception when others then
    v_ip := null;
  end;

  select
    c.id,
    c.certificate_number,
    c.holder_name,
    c.status,
    c.issue_date,
    c.expiry_date,
    c.verification_enabled,
    p.participant_id as p_code,
    p.company as p_company,
    co.title as course_title,
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
      or ((p_method in ('auto', 'number')) and upper(c.certificate_number) = upper(q))
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

  if coalesce(v.verification_enabled, true) = false then
    insert into public.certificate_verifications(
      certificate_id, certificate_number, method, query_value,
      status_returned, ip_address, user_agent
    ) values (
      v.id, v.certificate_number, p_method, q,
      'disabled', v_ip, p_ua
    );
    return;
  end if;

  if v.status in ('valid', 'issued')
     and (v.expiry_date is null or v.expiry_date >= current_date) then
    v_status := 'valid';
  elsif v.status = 'revoked' then
    v_status := 'revoked';
  elsif v.status = 'expired'
     or (v.expiry_date is not null and v.expiry_date < current_date) then
    v_status := 'expired';
  else
    v_status := v.status;
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
      when length(v.p_code) <= 6 then v.p_code
      else left(v.p_code, 4)
        || repeat('•', greatest(length(v.p_code) - 6, 1))
        || right(v.p_code, 2)
    end,
    v.p_company,
    v.course_title,
    v.training_start_date,
    v.training_start_date,
    v.training_end_date,
    v.issue_date,
    v.expiry_date,
    v.status,
    (v_status = 'valid'),
    now();
end;
$$;

alter function public.verify_and_log(text, text, text, text) owner to postgres;

comment on function public.verify_and_log(text, text, text, text) is
  'Public certificate verification + logging. Returns only publicly-safe fields; training dates come only from the immutable issuance snapshot or explicit certificate-level historical fields.';

revoke all on function public.verify_and_log(text, text, text, text) from public;
grant execute on function public.verify_and_log(text, text, text, text) to anon;
grant execute on function public.verify_and_log(text, text, text, text) to authenticated;
grant execute on function public.verify_and_log(text, text, text, text) to service_role;

commit;
