-- C2A structural contract checks. Read-only: no fixture creation or backfill.
-- Run against a database where the C2A migration has already been applied.

do $$
declare
  v_count bigint;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'certificate_issuance_snapshots'
      and c.relrowsecurity
  ) then raise exception 'issuance snapshot table/RLS contract failed'; end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'certificate_reissue_events'
      and c.relrowsecurity
  ) then raise exception 'reissue event table/RLS contract failed'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.certificate_issuance_snapshots'::regclass
      and conname = 'certificate_issuance_snapshots_certificate_key'
  ) then raise exception 'one snapshot per certificate constraint missing'; end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.certificate_reissue_events'::regclass
      and conname = 'certificate_reissue_events_type_check'
  ) then raise exception 'reissue event type constraint missing'; end if;

  select count(*) into v_count from public.certificate_issuance_snapshots;
  if v_count <> 0 then raise exception 'C2A migration backfilled % issuance snapshots', v_count; end if;

  select count(*) into v_count from public.certificate_reissue_events;
  if v_count <> 0 then raise exception 'C2A migration created % reissue events', v_count; end if;
end;
$$;

select 'certificate_historical_integrity_contract' as test, true as passed;
