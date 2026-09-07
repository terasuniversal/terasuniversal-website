-- Public-safe schedule context for Phase 3 registration.

create or replace function public.get_public_registration_schedule(p_schedule_id uuid)
returns table (
  schedule_id uuid,
  schedule_code text,
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
  fee numeric,
  capacity integer,
  available_seats integer,
  registration_available boolean
)
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select
    cs.id,
    cs.schedule_code,
    c.id,
    coalesce(c.title, c.course_name),
    c.slug,
    cs.start_date,
    cs.end_date,
    cs.start_time,
    cs.end_time,
    cs.venue,
    cs.training_mode,
    cs.status::text,
    cs.fee,
    cs.capacity,
    greatest(cs.capacity - cs.seats_taken - coalesce((
      select sum(pr.attendee_count)
      from public.public_registrations pr
      where pr.schedule_id = cs.id
        and pr.registration_status in ('pending_payment', 'payment_pending')
        and pr.hold_expires_at > now()
    ), 0)::integer, 0),
    (
      cs.is_published
      and cs.deleted_at is null
      and c.deleted_at is null
      and c.status = 'published'
      and cs.status = 'open'::public.schedule_status
      and cs.start_date >= current_date
      and cs.fee is not null
      and cs.capacity > 0
      and cs.capacity > cs.seats_taken + coalesce((
        select sum(pr2.attendee_count)
        from public.public_registrations pr2
        where pr2.schedule_id = cs.id
          and pr2.registration_status in ('pending_payment', 'payment_pending')
          and pr2.hold_expires_at > now()
      ), 0)
    )
  from public.course_schedules cs
  join public.courses c on c.id = cs.course_id
  where cs.id = p_schedule_id
    and cs.is_published
    and cs.deleted_at is null
    and c.deleted_at is null
    and c.status = 'published';
$$;

revoke all on function public.get_public_registration_schedule(uuid) from public;
grant execute on function public.get_public_registration_schedule(uuid) to anon, authenticated;
