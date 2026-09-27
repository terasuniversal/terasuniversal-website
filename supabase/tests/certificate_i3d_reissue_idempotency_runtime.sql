\set ON_ERROR_STOP on

insert into public.certificates
  (id, certificate_number, certificate_no, verification_token, issue_date, status, deleted_at)
values
  ('d3000000-0000-4000-8000-000000000001', 'I3D-SYNTH-0001', 'I3D-SYNTH-0001', 'I3D-SYNTH-TOKEN', date '2026-09-28', 'valid', null);

insert into public.certificate_issuance_snapshots
  (certificate_id, snapshot_payload)
values
  ('d3000000-0000-4000-8000-000000000001', '{"historical":"I3D synthetic immutable snapshot"}'::jsonb);

set role authenticated;
select set_config('app.actor_id', 'd3000000-0000-4000-8000-000000000010', false);
select set_config('app.active', 'true', false);
select set_config('app.admin', 'true', false);
select set_config('app.certificates_admin', 'true', false);

do $$
declare
  v_first uuid;
  v_retry uuid;
  v_second uuid;
  v_before jsonb;
  v_after jsonb;
  v_count integer;
begin
  select jsonb_build_object(
    'certificate_number', c.certificate_number,
    'certificate_no', c.certificate_no,
    'verification_token', c.verification_token,
    'issue_date', c.issue_date,
    'snapshot', s.snapshot_payload
  ) into v_before
  from public.certificates c
  join public.certificate_issuance_snapshots s on s.certificate_id = c.id
  where c.id = 'd3000000-0000-4000-8000-000000000001';

  select id into v_first from public.reissue_certificate(
    'd3000000-0000-4000-8000-000000000001', 'reissue', 'I3D same-key test',
    '{"idempotency_key":"d3000000-0000-4000-8000-000000000101"}'::jsonb
  );
  select id into v_retry from public.reissue_certificate(
    'd3000000-0000-4000-8000-000000000001', 'reissue', 'I3D same-key test',
    '{"idempotency_key":"d3000000-0000-4000-8000-000000000101"}'::jsonb
  );
  if v_first is distinct from v_retry then
    raise exception 'I3D same key must return the first event id';
  end if;
  select count(*) into v_count from public.certificate_reissue_events
  where certificate_id = 'd3000000-0000-4000-8000-000000000001'
    and idempotency_key = 'd3000000-0000-4000-8000-000000000101';
  if v_count <> 1 then raise exception 'I3D same key created % events, expected one', v_count; end if;

  select id into v_second from public.reissue_certificate(
    'd3000000-0000-4000-8000-000000000001', 'reissue', 'I3D same-key test',
    '{"idempotency_key":"d3000000-0000-4000-8000-000000000102"}'::jsonb
  );
  if v_second is not distinct from v_first then raise exception 'I3D new key must append a separate event'; end if;
  select count(*) into v_count from public.certificate_reissue_events
  where certificate_id = 'd3000000-0000-4000-8000-000000000001';
  if v_count <> 2 then raise exception 'I3D distinct key count is %, expected two', v_count; end if;

  begin
    perform * from public.reissue_certificate(
      'd3000000-0000-4000-8000-000000000001', 'reissue', 'Changed payload',
      '{"idempotency_key":"d3000000-0000-4000-8000-000000000101"}'::jsonb
    );
    raise exception 'I3D accepted one key for two different payloads';
  exception when sqlstate '23505' then null;
  end;

  perform set_config('app.admin', 'false', true);
  begin
    perform * from public.reissue_certificate(
      'd3000000-0000-4000-8000-000000000001', 'reissue', 'Unauthorized test',
      '{"idempotency_key":"d3000000-0000-4000-8000-000000000103"}'::jsonb
    );
    raise exception 'I3D unauthorized role unexpectedly reissued a certificate';
  exception when insufficient_privilege then null;
  end;
  perform set_config('app.admin', 'true', true);

  select jsonb_build_object(
    'certificate_number', c.certificate_number,
    'certificate_no', c.certificate_no,
    'verification_token', c.verification_token,
    'issue_date', c.issue_date,
    'snapshot', s.snapshot_payload
  ) into v_after
  from public.certificates c
  join public.certificate_issuance_snapshots s on s.certificate_id = c.id
  where c.id = 'd3000000-0000-4000-8000-000000000001';
  if v_after is distinct from v_before then raise exception 'I3D reissue changed certificate identity or issuance snapshot'; end if;
end;
$$;

reset role;
