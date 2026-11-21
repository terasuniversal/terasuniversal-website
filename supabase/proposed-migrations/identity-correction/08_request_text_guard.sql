-- PROPOSED (local only, NOT applied anywhere): keep identity numbers out of the free text of a correction request.
-- One logical change: a before-insert/update guard on the plain-text fields the evidence schema stores
-- (request reason, document references, per-certificate decision reasons, cancel/reject reasons).
--
-- Why: those fields are stored as plain text and shown to Super Admins and in exports. The sealed ledger is the only
-- place an old/new IC may live; a reason such as "typo, the correct number is ..." would defeat that. The guard refuses
--   * text shaped like an IC or a typical passport number (identity_audit.text_has_identity, defined in 02);
--   * any text whose normalised form contains the participant's current IC/Passport or the requested new one
--     (6 characters or more).
-- It adds no callable surface: nothing is granted to any API role, and the workflow functions are unchanged.
--
-- Integrity (the whole file is ONE transaction):
--   * it refuses to run on a ledger or guard set that no longer matches the last anchor (IDC_GUARD_DRIFT);
--   * it refuses to install over existing request text that may contain an identity number (IDC_LEGACY_TEXT_UNSAFE) --
--     it never deletes or rewrites that evidence; the owner decides what to do, and 07 already withholds such text;
--   * the two trigger functions and two triggers are part of identity_audit.guard_components(), so altering or disabling
--     them changes the guard fingerprint and verify_ledger() reports it;
--   * after installing it proves that the ONLY audit objects it changed are those four, then records the anchor.

begin;

do $$
begin
  if to_regclass('identity_audit.requests') is null or to_regclass('identity_audit.request_certificates') is null
     or to_regprocedure('identity_audit.norm(text)') is null
     or to_regprocedure('identity_audit.text_leaks_identity(text,text[])') is null
     or to_regprocedure('identity_audit.finish_guard_transition(jsonb,text[],boolean,boolean)') is null then
    raise exception 'text-guard pre-check failed: run 01 and 02 (current versions) first';
  end if;
end $$;

select identity_audit.assert_guards_clean();
create temporary table _idc_before on commit drop as select identity_audit.guard_snapshot() as snap;

-- ---- fail closed on unsafe history ---------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  select count(*) into v_n from (
    select r.id
      from identity_audit.requests r join public.participants p on p.id = r.participant_id
     where identity_audit.text_leaks_identity(r.reason, array[r.new_identity, p.ic_passport_no, p.identity_no])
        or identity_audit.text_leaks_identity(r.cancel_reason, array[r.new_identity, p.ic_passport_no, p.identity_no])
        or exists (select 1 from pg_catalog.jsonb_array_elements(r.evidence) e
                    where identity_audit.text_leaks_identity(e.value ->> 'reference', array[r.new_identity, p.ic_passport_no, p.identity_no]))
    union
    select rc.request_id
      from identity_audit.request_certificates rc
      join identity_audit.requests r on r.id = rc.request_id join public.participants p on p.id = r.participant_id
     where identity_audit.text_leaks_identity(rc.decision_reason, array[r.new_identity, p.ic_passport_no, p.identity_no])) x;
  if v_n > 0 then
    raise exception 'IDC_LEGACY_TEXT_UNSAFE: % existing request(s) hold free text that may contain an identity number; 08 will not install over them. Nothing was changed or deleted.', v_n
      using errcode = 'P0001';
  end if;
end $$;

-- ---- the guard ----------------------------------------------------------------------------------------------------
create or replace function identity_audit.requests_text_guard() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare v_part public.participants%rowtype; v_ids text[]; v_text text;
begin
  select * into v_part from public.participants where id = new.participant_id;
  v_ids := array[coalesce(new.new_identity, case when tg_op = 'UPDATE' then old.new_identity end), v_part.ic_passport_no, v_part.identity_no];
  if tg_op = 'INSERT' then
    for v_text in select new.reason union all select e.value ->> 'reference' from pg_catalog.jsonb_array_elements(new.evidence) e loop
      if identity_audit.text_leaks_identity(v_text, v_ids) then
        raise exception 'IDC_TEXT_CONTAINS_IDENTITY: reasons and document references must not contain an IC/Passport number.' using errcode = 'P0001';
      end if;
    end loop;
  elsif new.cancel_reason is distinct from old.cancel_reason and identity_audit.text_leaks_identity(new.cancel_reason, v_ids) then
    raise exception 'IDC_TEXT_CONTAINS_IDENTITY: reasons and document references must not contain an IC/Passport number.' using errcode = 'P0001';
  end if;
  return new;
end $$;

create or replace function identity_audit.request_certificates_text_guard() returns trigger
language plpgsql set search_path = pg_catalog as $$
declare v_part public.participants%rowtype; v_new text;
begin
  select r.new_identity into v_new from identity_audit.requests r where r.id = new.request_id;
  select p.* into v_part from identity_audit.requests r join public.participants p on p.id = r.participant_id where r.id = new.request_id;
  if identity_audit.text_leaks_identity(new.decision_reason, array[v_new, v_part.ic_passport_no, v_part.identity_no]) then
    raise exception 'IDC_TEXT_CONTAINS_IDENTITY: reasons and document references must not contain an IC/Passport number.' using errcode = 'P0001';
  end if;
  return new;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'requests_text_guard' and tgrelid = 'identity_audit.requests'::regclass) then
    create trigger requests_text_guard before insert or update of cancel_reason on identity_audit.requests
      for each row execute function identity_audit.requests_text_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'request_certificates_text_guard' and tgrelid = 'identity_audit.request_certificates'::regclass) then
    create trigger request_certificates_text_guard before insert on identity_audit.request_certificates
      for each row execute function identity_audit.request_certificates_text_guard();
  end if;
end $$;

revoke all on all functions in schema identity_audit from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
               lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where n.nspname = 'identity_audit' and a.grantee <> p.proowner and a.privilege_type = 'EXECUTE') then
    raise exception 'text-guard post-check failed: a non-owner can execute an internal function';
  end if;
end $$;

-- the only audit objects this migration may change are its own two functions and two triggers
select identity_audit.finish_guard_transition((select snap from _idc_before),
  array['fn:identity_audit.requests_text_guard()', 'fn:identity_audit.request_certificates_text_guard()',
        'trg:identity_audit.requests.requests_text_guard', 'trg:identity_audit.request_certificates.request_certificates_text_guard'],
  true, true);

commit;
