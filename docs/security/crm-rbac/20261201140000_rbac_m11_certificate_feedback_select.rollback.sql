-- ROLLBACK for 20261201140000_rbac_m11_certificate_feedback_select.sql (local design artefact; separate Owner approval required to run anywhere).
-- Re-creates the previous policies verbatim (captured from the Production-equivalent fixture, 2026-11-24).
set local lock_timeout = '5s';
drop policy if exists certificates_select on public.certificates;
create policy certificates_select on public.certificates as permissive for select to authenticated
  using (app.has_min_role('trainer'::user_role));

drop policy if exists participant_feedback_staff_select on public.participant_feedback;
create policy participant_feedback_staff_select on public.participant_feedback as permissive for select to authenticated
  using (( SELECT app.has_min_role('editor'::user_role) AS has_min_role));

do $m11_cv_rb$
declare v_roles text;
begin
  select array_to_string(p.roles, ',') into v_roles from pg_policies p
   where p.schemaname = 'public' and p.tablename = 'certificate_verifications' and p.policyname = 'cert_verif_staff_read';
  if v_roles is null or v_roles not in ('public', 'authenticated') then
    raise exception 'm11_rollback_precondition_failed: cert_verif_staff_read missing or unexpected roles - nothing changed' using errcode = 'P0001';
  end if;
  drop policy cert_verif_staff_read on public.certificate_verifications;
  execute format('create policy cert_verif_staff_read on public.certificate_verifications as permissive for select to %s using (%s)',
                 v_roles, $q$(app.is_editor() OR (app."current_role"() = 'trainer'::user_role))$q$);
end;
$m11_cv_rb$;
