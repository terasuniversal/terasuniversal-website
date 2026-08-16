-- One opaque, revocable public entry link per course schedule. Individual
-- participant_feedback tokens remain the only credentials that can open or
-- submit a feedback form.
create table public.feedback_schedule_links (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.course_schedules(id) on delete cascade,
  public_token text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  disabled_at timestamptz,
  constraint feedback_schedule_links_schedule_unique unique (schedule_id),
  constraint feedback_schedule_links_public_token_unique unique (public_token),
  constraint feedback_schedule_links_public_token_format check (public_token ~ '^[A-Za-z0-9_-]{32,128}$'),
  constraint feedback_schedule_links_disabled_state check (
    (is_active and disabled_at is null) or (not is_active and disabled_at is not null)
  )
);

comment on table public.feedback_schedule_links is
  'One opaque public class-feedback entry token per schedule. It never replaces individual participant feedback tokens.';

-- Privacy-preserving request limiter. The application supplies a one-way,
-- server-generated request fingerprint; no IC/passport or participant data is
-- stored here. Rows are pruned by the resolver after 24 hours.
create table public.feedback_schedule_lookup_attempts (
  schedule_link_id uuid not null references public.feedback_schedule_links(id) on delete cascade,
  request_fingerprint_hash text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count between 1 and 5),
  last_attempt_at timestamptz not null default now(),
  primary key (schedule_link_id, request_fingerprint_hash, window_started_at),
  constraint feedback_schedule_lookup_attempts_fingerprint_format
    check (request_fingerprint_hash ~ '^[0-9a-f]{64}$')
);

create index feedback_schedule_lookup_attempts_retention_idx
  on public.feedback_schedule_lookup_attempts (last_attempt_at);

comment on table public.feedback_schedule_lookup_attempts is
  'Short-lived schedule-feedback lookup throttle. Stores only a server HMAC request fingerprint, never identity data.';

alter table public.feedback_schedule_links enable row level security;
alter table public.feedback_schedule_lookup_attempts enable row level security;

revoke all on table public.feedback_schedule_links from public, anon, authenticated;
revoke all on table public.feedback_schedule_lookup_attempts from public, anon, authenticated;
grant all on table public.feedback_schedule_links to service_role;
grant all on table public.feedback_schedule_lookup_attempts to service_role;

-- Called only by the trusted Next.js route using the service role. It returns
-- no row for an invalid token, throttled request, non-match, cancelled
-- enrollment, missing feedback link, or already-inactive participant. This
-- keeps all public failures indistinguishable.
create or replace function public.resolve_schedule_feedback_participant(
  p_public_token text,
  p_identity_number text,
  p_request_fingerprint_hash text
)
returns table (feedback_token text, already_submitted boolean)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_schedule_link_id uuid;
  v_schedule_id uuid;
  v_normalized_identity text;
  v_window_started_at timestamptz;
begin
  if p_public_token is null
    or p_public_token !~ '^[A-Za-z0-9_-]{32,128}$'
    or p_request_fingerprint_hash is null
    or p_request_fingerprint_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select fsl.id, fsl.schedule_id
    into v_schedule_link_id, v_schedule_id
  from public.feedback_schedule_links as fsl
  where fsl.public_token = p_public_token
    and fsl.is_active
    and fsl.disabled_at is null;

  if not found then
    return;
  end if;

  -- Bounded retention without retaining raw identity data.
  delete from public.feedback_schedule_lookup_attempts
  where last_attempt_at < pg_catalog.now() - interval '24 hours';

  v_window_started_at := pg_catalog.date_trunc('minute', pg_catalog.now());

  insert into public.feedback_schedule_lookup_attempts (
    schedule_link_id,
    request_fingerprint_hash,
    window_started_at,
    attempt_count,
    last_attempt_at
  )
  values (v_schedule_link_id, p_request_fingerprint_hash, v_window_started_at, 1, pg_catalog.now())
  on conflict (schedule_link_id, request_fingerprint_hash, window_started_at)
  do update set
    attempt_count = public.feedback_schedule_lookup_attempts.attempt_count + 1,
    last_attempt_at = excluded.last_attempt_at
  where public.feedback_schedule_lookup_attempts.attempt_count < 5;

  if not found then
    return;
  end if;

  v_normalized_identity := pg_catalog.upper(
    pg_catalog.regexp_replace(coalesce(p_identity_number, ''), '[^0-9A-Za-z]', '', 'g')
  );

  if pg_catalog.char_length(v_normalized_identity) < 3
    or pg_catalog.char_length(v_normalized_identity) > 80 then
    return;
  end if;

  return query
  select pf.token, pf.status = 'submitted'
  from public.participant_feedback as pf
  join public.schedule_participants as sp
    on sp.schedule_id = pf.schedule_id
   and sp.participant_id = pf.participant_id
   and sp.deleted_at is null
   and sp.registration_status <> 'cancelled'
  join public.participants as p
    on p.id = pf.participant_id
   and p.deleted_at is null
  where pf.schedule_id = v_schedule_id
    and pg_catalog.upper(pg_catalog.regexp_replace(p.ic_passport_no, '[^0-9A-Za-z]', '', 'g')) = v_normalized_identity
  limit 1;
end;
$$;

alter function public.resolve_schedule_feedback_participant(text, text, text) owner to postgres;
comment on function public.resolve_schedule_feedback_participant(text, text, text) is
  'Service-role-only class-feedback resolver. Returns only a matched individual feedback token and submitted state.';

revoke all on function public.resolve_schedule_feedback_participant(text, text, text) from public, anon, authenticated;
grant execute on function public.resolve_schedule_feedback_participant(text, text, text) to service_role;
