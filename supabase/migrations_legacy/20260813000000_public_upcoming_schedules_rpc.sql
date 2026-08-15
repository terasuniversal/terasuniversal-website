-- Public-safe training schedule interface.
--
-- Anonymous visitors cannot read course_schedules or courses directly (all
-- grants to anon revoked; restrictive DENY policies apply). This function is
-- the ONLY public path to published training dates.
--
-- Returns a fixed, explicit column list of public website fields only:
--   * schedule/course identity and dates for display
--   * venue and training mode
--   * a public status label (open/full/in_progress/completed/cancelled)
--   * capacity + computed available seats (capacity - seats_taken), only when
--     capacity is set by staff
-- It never exposes: internal notes, trainer details, audit metadata,
-- created_by/updated_by, participant/registration records, or staff-only
-- columns. Deleted, unpublished, cancelled and archived rows are excluded.
--
-- Filtering rules:
--   * course_schedules.deleted_at IS NULL
--   * course_schedules.is_published = true
--   * status <> 'cancelled'
--   * the linked course is active: courses.deleted_at IS NULL AND
--     courses.status = 'published' (the staff-managed publish flag -- the
--     parallel cms_status column is legacy backfill that drifts out of sync;
--     see DATABASE_AUDIT.md §5)
--   * default (p_include_past = false): future start_date AND status in
--     (open, full) -- the homepage Upcoming Training contract
--   * p_include_past = true: every valid published row regardless of date, so
--     the /calendar page can render its Upcoming/Completed/All filters
--   * chronological ascending order
--
-- Style mirrors the existing live public RPC verify_certificate_by_value
-- (supabase/role_policies.sql): LANGUAGE sql, SECURITY DEFINER with a fixed
-- search_path, fully-qualified table names, explicit column list, EXECUTE
-- granted to anon/authenticated only.

create or replace function public.get_public_upcoming_schedules(
  p_include_past boolean default false
)
returns table (
  schedule_id uuid,
  course_id uuid,
  course_title text,
  course_slug text,
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  venue text,
  delivery_mode text,
  status text,
  capacity integer,
  available_seats integer
)
language sql stable security definer set search_path = public
as $$
  select
    cs.id as schedule_id,
    c.id as course_id,
    c.title as course_title,
    c.slug as course_slug,
    cs.start_date,
    cs.end_date,
    cs.start_time,
    cs.end_time,
    cs.venue,
    cs.training_mode as delivery_mode,
    cs.status::text as status,
    cs.capacity,
    greatest(cs.capacity - cs.seats_taken, 0) as available_seats
  from public.course_schedules cs
  join public.courses c on c.id = cs.course_id
  where cs.deleted_at is null
    and cs.is_published = true
    and cs.status <> 'cancelled'::public.schedule_status
    and c.deleted_at is null
    and c.status = 'published'
    and (
      (not p_include_past and cs.start_date >= current_date and cs.status in ('open'::public.schedule_status, 'full'::public.schedule_status))
      or p_include_past
    )
  order by cs.start_date asc, cs.end_date asc, cs.id asc;
$$;

comment on function public.get_public_upcoming_schedules(boolean) is
  'Public-safe published training schedules. Only website fields are returned; '
  'staff/registration data is never exposed. anon may EXECUTE but has no direct '
  'table access.';

-- Postgres grants EXECUTE to PUBLIC by default; restrict to the roles the
-- public website actually runs as. Staff/registration access to the tables
-- themselves is unchanged (existing RLS policies + grants preserved).
revoke all on function public.get_public_upcoming_schedules(boolean) from public;
grant execute on function public.get_public_upcoming_schedules(boolean) to anon, authenticated;
