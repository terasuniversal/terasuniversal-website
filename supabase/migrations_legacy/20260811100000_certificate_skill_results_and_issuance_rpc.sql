-- New table: certificate_skill_results — an immutable, insert-once snapshot
-- of a participant's skill/attendance results taken AT CERTIFICATE ISSUANCE
-- TIME (Phase 2C). Exists so a later edit to participant_skill_results or
-- attendance never silently changes what an already-issued certificate
-- displays. Companion of the live source tables:
--   - public.participant_skill_results (Phase 2A/2B, trainer-entered)
--   - public.v_certificate_eligibility  (Phase 1, unchanged by this migration)
--
-- Also adds the two atomic issuance RPCs this snapshot requires, because
-- supabase-js has no cross-table client transaction: the only way to
-- guarantee "no certificate without its snapshot" is a single Postgres
-- function executing both inserts in one implicit transaction. Precedent
-- for SECURITY DEFINER RPCs already exists live (public.log_event,
-- public.verify_and_log).
--
-- Renderer/CertData/actions.ts wiring, per the approved plan, is included
-- in this same phase so the RPCs are not dead code — but the migration
-- itself is NOT applied here; this file is reviewed only.

-- =====================================================================
-- A/B/C — table, allowed areas, area/status combination CHECK
-- =====================================================================

create table if not exists public.certificate_skill_results (
  id                     uuid primary key default gen_random_uuid(),
  certificate_id         uuid not null references public.certificates (id) on delete cascade,
  area                   text not null,
  status                 text not null,
  score                  numeric,
  notes                  text,
  source_skill_result_id uuid references public.participant_skill_results (id) on delete set null,
  created_at             timestamptz not null default now()
);

-- Immutable issuance snapshot: deliberately no deleted_at/updated_at (see
-- Phase 2C design report §D) -- there is no "undo" or "edit" concept here.

alter table public.certificate_skill_results drop constraint if exists certificate_skill_results_area_check;
alter table public.certificate_skill_results add constraint certificate_skill_results_area_check
  check (area in ('theory_session', 'practical_training', 'safety_awareness', 'practical_assessment', 'attendance_requirement'));

-- Combination CHECK, not an independent generic status CHECK: the database
-- itself must reject e.g. attendance_requirement='passed' or
-- practical_assessment='completed', not just reject an unknown status string.
alter table public.certificate_skill_results drop constraint if exists certificate_skill_results_area_status_check;
alter table public.certificate_skill_results add constraint certificate_skill_results_area_status_check
  check (
    (area = 'theory_session'        and status in ('not_recorded', 'completed')) or
    (area = 'practical_training'    and status in ('not_recorded', 'completed')) or
    (area = 'safety_awareness'      and status in ('not_recorded', 'completed')) or
    (area = 'practical_assessment'  and status in ('not_recorded', 'passed', 'failed')) or
    (area = 'attendance_requirement' and status in ('not_recorded', 'met', 'not_met'))
  );

alter table public.certificate_skill_results drop constraint if exists certificate_skill_results_certificate_area_key;
alter table public.certificate_skill_results add constraint certificate_skill_results_certificate_area_key
  unique (certificate_id, area);

-- No extra index: UNIQUE(certificate_id, area) already covers the only
-- expected lookup shape (by certificate_id, optionally narrowed to area) as
-- a leftmost-prefix index. Not adding a redundant one (per instruction).

-- =====================================================================
-- D — RLS / privileges (app.* RBAC model, NOT certificates' admin_users model)
-- =====================================================================

alter table public.certificate_skill_results enable row level security;
grant select, insert on public.certificate_skill_results to authenticated;
revoke all on public.certificate_skill_results from anon;

drop policy if exists certificate_skill_results_select on public.certificate_skill_results;
create policy certificate_skill_results_select on public.certificate_skill_results
  for select to authenticated using (app.has_min_role('trainer'::public.user_role));

drop policy if exists certificate_skill_results_insert on public.certificate_skill_results;
create policy certificate_skill_results_insert on public.certificate_skill_results
  for insert to authenticated with check (app.is_admin());

-- No UPDATE or DELETE policy at all -- RLS default-denies both for every
-- role with no matching policy. Immutable, full stop.

drop trigger if exists trg_certificate_skill_results_audit on public.certificate_skill_results;
create trigger trg_certificate_skill_results_audit
  after insert on public.certificate_skill_results
  for each row execute function app.audit_trigger();
-- AFTER INSERT only -- UPDATE/DELETE can never occur on this table, so
-- there is nothing for those trigger events to audit.

comment on table public.certificate_skill_results is
  'Immutable snapshot of a participant''s skill/attendance results, taken once at certificate issuance (Phase 2C). Never updated or deleted by normal staff action -- see app.issue_certificate_with_skill_snapshot / app.duplicate_certificate_with_skill_snapshot.';

-- =====================================================================
-- E/F/G/I — atomic new-certificate issuance RPC
-- =====================================================================

-- SECURITY DEFINER safety: search_path is explicitly pinned (immune to a
-- malicious search_path set by the calling session), every table/function
-- reference below is schema-qualified, EXECUTE is revoked from PUBLIC and
-- granted only to authenticated, and the function independently re-checks
-- app.is_admin() rather than trusting elevated privilege alone. `extensions`
-- is included in the pinned path (not just public/app) because the existing
-- app.certificates_before_insert() trigger -- fired by the INSERT below --
-- calls pgcrypto's gen_random_bytes() to mint verification_token, and that
-- trigger has no search_path of its own; it inherits whatever is active at
-- the moment it fires, i.e. this function's. Without `extensions` here, the
-- trigger fails with "function gen_random_bytes(integer) does not exist"
-- (caught during pre-apply testing, not assumed).
--
-- Race safety (per your §G instruction): this function is the SOLE
-- authoritative eligibility check for the write itself. It re-reads
-- public.v_certificate_eligibility fresh, inside its own transaction,
-- immediately before the certificate INSERT -- it never trusts a
-- previously-fetched TS-side eligibility row for anything that matters to
-- correctness. v_certificate_eligibility itself is untouched; no new
-- eligibility rule is introduced -- `eligible`/`ineligibility_reason` are
-- read as-is from the existing view. If the calling TS code's own earlier
-- eligibility read was stale (e.g. two admins racing, or attendance edited
-- in between), this function's fresh check will simply reject with the
-- current, correct reason -- an improvement over today's code, which never
-- re-validates eligibility between the TS read and the INSERT. The
-- remaining, unavoidable inter-transaction race (two concurrent calls to
-- this same function for the same participant) is still caught by the
-- existing certificates_active_schedule_participant_uniq unique index,
-- exactly as it is today -- surfaced as a normal 23505 to the caller.
create or replace function app.issue_certificate_with_skill_snapshot(
  p_schedule_id uuid,
  p_participant_id uuid,
  p_certificate_number text default null
)
returns table (id uuid, verification_token text)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_elig public.v_certificate_eligibility%rowtype;
  v_cert_id uuid;
  v_token text;
  v_area text;
  v_status text;
  v_score numeric;
  v_notes text;
  v_src_id uuid;
begin
  if not app.is_admin() then
    raise exception 'Not authorized to issue certificates.' using errcode = '42501';
  end if;

  -- Fresh eligibility read -- captured BEFORE the certificate insert (your
  -- correction #1) and used as the single source of truth for both the
  -- issuance gate and the Attendance Requirement snapshot value below.
  select * into v_elig
  from public.v_certificate_eligibility
  where schedule_id = p_schedule_id and participant_id = p_participant_id;

  if not found or not v_elig.eligible then
    raise exception 'Not eligible: %', coalesce(v_elig.ineligibility_reason, 'no_eligibility_row') using errcode = 'P0001';
  end if;

  insert into public.certificates (
    participant_id, schedule_id, course_id, template_id,
    certificate_number, holder_name, participant_name, course_name,
    training_start_date, training_end_date, venue, trainer_name,
    status, issue_date, issued_by
  ) values (
    p_participant_id, p_schedule_id, v_elig.course_id, v_elig.certificate_template_id,
    p_certificate_number, v_elig.holder_name, v_elig.holder_name, v_elig.course_name,
    v_elig.schedule_start_date, v_elig.schedule_end_date, v_elig.venue, v_elig.trainer_name,
    'valid', current_date, auth.uid()
  )
  returning certificates.id, certificates.verification_token into v_cert_id, v_token;

  -- Four skill areas: snapshot whatever's on file today; a missing row
  -- (never assessed) becomes not_recorded, never inferred/guessed.
  foreach v_area in array array['theory_session', 'practical_training', 'safety_awareness', 'practical_assessment']
  loop
    select psr.status, psr.score, psr.notes, psr.id
      into v_status, v_score, v_notes, v_src_id
    from public.participant_skill_results psr
    where psr.schedule_id = p_schedule_id
      and psr.participant_id = p_participant_id
      and psr.area = v_area
      and psr.deleted_at is null;

    insert into public.certificate_skill_results (certificate_id, area, status, score, notes, source_skill_result_id)
    values (v_cert_id, v_area, coalesce(v_status, 'not_recorded'), v_score, v_notes, v_src_id);

    v_status := null; v_score := null; v_notes := null; v_src_id := null;
  end loop;

  -- Attendance Requirement -- from the SAME v_elig row read above, not a
  -- second query, so it is guaranteed consistent with the eligibility gate
  -- that just permitted this insert. (In practice, because `eligible`
  -- itself requires attendance_satisfied = true, this RPC can only ever
  -- snapshot 'met' here -- 'not_met'/'not_recorded' are unreachable via
  -- this eligibility-gated path today. The full mapping is still
  -- implemented for correctness and because the CHECK constraint and any
  -- future non-eligibility-gated issuance path depend on it.)
  insert into public.certificate_skill_results (certificate_id, area, status)
  values (
    v_cert_id, 'attendance_requirement',
    case
      when v_elig.attendance_satisfied is null then 'not_recorded'
      when v_elig.attendance_satisfied then 'met'
      else 'not_met'
    end
  );

  return query select v_cert_id, v_token;
end;
$$;

revoke all on function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) from public;
grant execute on function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) to authenticated;

comment on function app.issue_certificate_with_skill_snapshot(uuid, uuid, text) is
  'Atomically issues one certificate and its 5-row certificate_skill_results snapshot in a single transaction. Re-validates v_certificate_eligibility itself; never trusts a caller-supplied eligibility result.';

-- =====================================================================
-- H — atomic duplicate RPC
-- =====================================================================

-- Same SECURITY DEFINER hardening as above (pinned search_path including
-- extensions for the same certificates_before_insert/gen_random_bytes
-- reason, schema-qualified references, EXECUTE revoked from PUBLIC,
-- internal app.is_admin() check).
create or replace function app.duplicate_certificate_with_skill_snapshot(
  p_source_certificate_id uuid
)
returns table (id uuid, verification_token text)
language plpgsql
security definer
set search_path = public, app, extensions
as $$
declare
  v_src public.certificates%rowtype;
  v_new_id uuid;
  v_token text;
  r record;
begin
  if not app.is_admin() then
    raise exception 'Not authorized to duplicate certificates.' using errcode = '42501';
  end if;

  -- Table-qualified `cert.id` deliberately, not bare `id`: this function's
  -- own RETURNS TABLE(id uuid, ...) declares an implicit OUT-parameter
  -- variable also named `id`, which a bare `id` reference here resolves to
  -- instead of the certificates column, raising "column reference id is
  -- ambiguous" (caught during pre-apply testing, not assumed).
  select * into v_src from public.certificates cert where cert.id = p_source_certificate_id;
  if not found then
    raise exception 'Source certificate not found.' using errcode = 'P0002';
  end if;

  -- Same fields/semantics as the existing duplicateCertificate() action:
  -- a fresh 'draft' certificate, new number/token (via the existing
  -- certificates_before_insert trigger), issued today.
  insert into public.certificates (
    participant_id, schedule_id, course_id, template_id, holder_name, status,
    issue_date, issued_by, expiry_date, remarks
  ) values (
    v_src.participant_id, v_src.schedule_id, v_src.course_id, v_src.template_id, v_src.holder_name, 'draft',
    current_date, auth.uid(), v_src.expiry_date, v_src.remarks
  )
  returning certificates.id, certificates.verification_token into v_new_id, v_token;

  -- Copy the SOURCE certificate's own snapshot rows verbatim -- never
  -- re-query current participant_skill_results. Zero source rows (a
  -- pre-Phase-2C or legacy certificate) means zero copied rows; nothing is
  -- fabricated. New id/certificate_id/created_at per row (id/created_at via
  -- column defaults), status/score/notes/source_skill_result_id preserved.
  for r in
    select area, status, score, notes, source_skill_result_id
    from public.certificate_skill_results
    where certificate_id = p_source_certificate_id
  loop
    insert into public.certificate_skill_results (certificate_id, area, status, score, notes, source_skill_result_id)
    values (v_new_id, r.area, r.status, r.score, r.notes, r.source_skill_result_id);
  end loop;

  return query select v_new_id, v_token;
end;
$$;

revoke all on function app.duplicate_certificate_with_skill_snapshot(uuid) from public;
grant execute on function app.duplicate_certificate_with_skill_snapshot(uuid) to authenticated;

comment on function app.duplicate_certificate_with_skill_snapshot(uuid) is
  'Atomically duplicates a certificate and copies its certificate_skill_results snapshot rows verbatim (never re-derived from current participant_skill_results) in a single transaction.';
