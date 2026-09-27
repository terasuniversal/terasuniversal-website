-- Make retries of one user-submitted reissue operation safe while preserving
-- the append-only history and allowing a new event under a new request key.
begin;

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

commit;
