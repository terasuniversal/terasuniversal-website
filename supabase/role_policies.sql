-- Applied migration: replace broad deny_direct_client_access policies.
-- Direct public table access remains denied. Public verification uses a
-- narrowly scoped RPC that returns only certificate confirmation fields.

drop policy if exists "deny_direct_client_access" on public.certificates;
drop policy if exists "deny_direct_client_access" on public.participants;
drop policy if exists "deny_direct_client_access" on public.courses;
drop policy if exists "Public can verify certificates" on public.certificates;

create policy "Deny anonymous direct certificate access" on public.certificates
as restrictive for all to anon using (false) with check (false);
create policy "Deny anonymous direct participant access" on public.participants
as restrictive for all to anon using (false) with check (false);
create policy "Deny anonymous direct course access" on public.courses
as restrictive for all to anon using (false) with check (false);

revoke all on public.admin_users from anon;
revoke all on public.certificates from anon;
revoke all on public.participants from anon;
revoke all on public.courses from anon;

create or replace function public.verify_certificate_by_value(search_value text)
returns table (
  participant_name text, course_name text, certificate_no text,
  training_start_date date, training_end_date date, issue_date date,
  expiry_date date, status text, trainer_name text, venue text,
  instructor text, certificate_file_url text
)
language sql security definer set search_path = public
as $$
  select c.participant_name, c.course_name, c.certificate_no,
         c.training_start_date, c.training_end_date, c.issue_date,
         c.expiry_date, c.status, c.trainer_name, c.venue,
         c.instructor, c.certificate_file_url
  from public.certificates c
  where c.public_verification_enabled = true
    and upper(trim(c.certificate_no)) = upper(trim(search_value))
  order by c.created_at desc limit 1;
$$;

revoke all on function public.verify_certificate(text) from anon, authenticated;
revoke all on function public.verify_certificate_by_value(text) from public;
grant execute on function public.verify_certificate_by_value(text) to anon, authenticated;
