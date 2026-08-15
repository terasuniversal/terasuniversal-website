-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0017 — Public Certificate Verification System
-- =====================================================================
-- Adds the verification log, a per-certificate verification toggle, and a
-- single public RPC (verify_and_log) that:
--   * looks up a certificate by verification token, certificate number, or
--     legacy code (method = 'auto' tries all three);
--   * records the verification attempt (time, IP, user-agent, status);
--   * returns ONLY the fields safe to show publicly (masked participant ID;
--     never IC/phone/email/scores/attendance/notes/internal IDs).
-- Idempotent. Builds on certificates (0016).
-- =====================================================================

-- Per-certificate switch to disable public verification without revoking.
alter table public.certificates
  add column if not exists verification_enabled boolean not null default true;

-- --- Verification log ------------------------------------------------
create table if not exists public.certificate_verifications (
  id                 bigint generated always as identity primary key,
  certificate_id     uuid references public.certificates (id) on delete set null,
  certificate_number text,                 -- snapshot (survives cert deletion)
  method             text,                 -- token | number | code | auto
  query_value        text,                 -- what was searched
  status_returned    text,                 -- valid | not_found | revoked | expired | disabled | <status>
  ip_address         inet,
  user_agent         text,
  verified_at        timestamptz not null default now()
);
create index if not exists idx_cert_verif_cert on public.certificate_verifications (certificate_id);
create index if not exists idx_cert_verif_time on public.certificate_verifications (verified_at desc);

alter table public.certificate_verifications enable row level security;
alter table public.certificate_verifications force row level security;
-- Staff may read the history; nobody reads it anonymously. Inserts happen only
-- through the SECURITY DEFINER function below (which bypasses RLS as owner).
create policy cert_verif_staff_read on public.certificate_verifications
  for select using (app.is_editor() or app.current_role() = 'trainer');

-- --- Public verify + log (single entry point) ------------------------
create or replace function public.verify_and_log(
  p_query  text,
  p_method text default 'auto',
  p_ip     text default null,
  p_ua     text default null
)
returns table (
  found                   boolean,
  certificate_number      text,
  holder_name             text,
  participant_code_masked text,
  company                 text,
  course_title            text,
  training_date           date,
  issue_date              date,
  expiry_date             date,
  status                  certificate_status,
  is_valid                boolean,
  verified_at             timestamptz
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
    return;  -- no rows
  end if;

  begin v_ip := nullif(p_ip, '')::inet; exception when others then v_ip := null; end;

  select
    c.id, c.certificate_number, c.holder_name, c.status, c.issue_date, c.expiry_date,
    c.verification_enabled,
    p.participant_id as p_code, p.company as p_company,
    co.title as course_title, ts.start_date as training_date
  into v
  from public.certificates c
  left join public.participants p on p.id = c.participant_id
  left join public.courses co on co.id = c.course_id
  left join public.training_schedules ts on ts.id = c.schedule_id
  where c.deleted_at is null
    and (
      ((p_method in ('auto','token'))  and c.verification_token  = q)
      or ((p_method in ('auto','number')) and upper(c.certificate_number) = upper(q))
      or ((p_method in ('auto','code'))   and c.verification_code   = upper(q))
    )
  limit 1;

  if not found then
    insert into public.certificate_verifications(method, query_value, status_returned, ip_address, user_agent)
    values (p_method, q, 'not_found', v_ip, p_ua);
    return;
  end if;

  -- Respect the per-certificate verification switch.
  if v.verification_enabled = false then
    insert into public.certificate_verifications(certificate_id, certificate_number, method, query_value, status_returned, ip_address, user_agent)
    values (v.id, v.certificate_number, p_method, q, 'disabled', v_ip, p_ua);
    return;  -- treat as not found publicly
  end if;

  if v.status = 'issued' and (v.expiry_date is null or v.expiry_date >= current_date) then
    v_status := 'valid';
  elsif v.status = 'revoked' then
    v_status := 'revoked';
  elsif v.status = 'expired' or (v.expiry_date is not null and v.expiry_date < current_date) then
    v_status := 'expired';
  else
    v_status := v.status::text;
  end if;

  insert into public.certificate_verifications(certificate_id, certificate_number, method, query_value, status_returned, ip_address, user_agent)
  values (v.id, v.certificate_number, p_method, q, v_status, v_ip, p_ua);

  return query select
    true,
    v.certificate_number,
    v.holder_name,
    case
      when v.p_code is null then null
      when length(v.p_code) <= 6 then v.p_code
      else left(v.p_code, 4) || repeat('•', greatest(length(v.p_code) - 6, 1)) || right(v.p_code, 2)
    end,
    v.p_company,
    v.course_title,
    v.training_date,
    v.issue_date,
    v.expiry_date,
    v.status,
    (v_status = 'valid'),
    now();
end;
$$;

grant execute on function public.verify_and_log(text, text, text, text) to anon, authenticated;
grant select on public.certificate_verifications to authenticated;

comment on function public.verify_and_log is 'Public certificate verification + logging. Returns only publicly-safe fields (masked participant ID; no IC/phone/email/scores/attendance/notes).';
