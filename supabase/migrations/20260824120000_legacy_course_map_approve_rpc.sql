-- Atomic, admin-guarded course-mapping approval. Replaces the Server
-- Action's previous two-step best-effort write (update legacy_course_map,
-- then a separate cascade update to legacy_participant_staging that could
-- silently fail and leave the mapping "mapped" with staging rows still
-- unmapped). A single plpgsql function body is one implicit transaction --
-- any unhandled exception rolls back every write the function made, so
-- there is no window where the mapping is updated but the cascade isn't.
--
-- Also enforces, server-side (never UI-only):
--   * the mapping must belong to the batch's own source_label (a mapping
--     from a different source/batch fails closed);
--   * a mapping already at status = 'mapped' is immutable in Phase 2 --
--     remapping is rejected outright, not silently re-applied. A future
--     phase can add an explicit correction workflow; this function does not;
--   * the canonical course must exist and have deleted_at is null -- a
--     crafted request naming a deleted or nonexistent course id fails.
create or replace function public.legacy_course_map_approve(
  p_batch_id uuid,
  p_course_map_id uuid,
  p_course_id uuid
) returns integer
language plpgsql
security definer
set search_path = public, app
as $$
declare
  v_batch_source text;
  v_map_source text;
  v_map_status text;
  v_normalized_name text;
  v_course_deleted_at timestamptz;
  v_updated integer;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select source_label into v_batch_source
  from public.legacy_import_batches
  where id = p_batch_id;
  if v_batch_source is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;

  select source_label, status, normalized_course_name
    into v_map_source, v_map_status, v_normalized_name
  from public.legacy_course_map
  where id = p_course_map_id;
  if v_map_source is null then
    raise exception 'mapping_not_found' using errcode = 'P0001';
  end if;
  if v_map_source <> v_batch_source then
    raise exception 'mapping_source_mismatch' using errcode = 'P0001';
  end if;
  if v_map_status = 'mapped' then
    raise exception 'mapping_already_mapped' using errcode = 'P0001';
  end if;

  select deleted_at into v_course_deleted_at
  from public.courses
  where id = p_course_id;
  if not found then
    raise exception 'course_not_found' using errcode = 'P0001';
  end if;
  if v_course_deleted_at is not null then
    raise exception 'course_deleted' using errcode = 'P0001';
  end if;

  update public.legacy_course_map
  set course_id = p_course_id, status = 'mapped'
  where id = p_course_map_id;

  -- Cascades to every staging row sharing this source + normalized course
  -- name across any batch from the same source, not just p_batch_id --
  -- the mapping is source-level. Only rows still unmapped are touched.
  with updated as (
    update public.legacy_participant_staging s
    set mapped_course_id = p_course_id
    from public.legacy_import_batches b
    where s.batch_id = b.id
      and b.source_label = v_batch_source
      and s.normalized_course_name = v_normalized_name
      and s.mapped_course_id is null
    returning 1
  )
  select count(*) into v_updated from updated;

  return v_updated;
end;
$$;

revoke all on function public.legacy_course_map_approve(uuid, uuid, uuid) from public;
grant execute on function public.legacy_course_map_approve(uuid, uuid, uuid) to authenticated;
