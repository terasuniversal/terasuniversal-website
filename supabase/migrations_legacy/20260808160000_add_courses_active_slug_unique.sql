-- Additive, guarded, non-destructive: adds duplicate-slug protection for
-- courses.slug, after a controlled, approved consolidation of 117 duplicate
-- course rows (all confirmed true duplicates of 4 course titles — see
-- COURSE_DATA_CLEANUP_PLAN.md / the corresponding audit conversation) that
-- otherwise blocked this index from being created at all.
--
-- Verified safe before applying: zero conflicting active, non-archived
-- slugs after consolidation (126 active courses -> 9, all distinct slugs).
--
-- Partial index: only active (deleted_at IS NULL), non-archived, non-null,
-- non-blank slugs are constrained. Archived courses may freely reuse a
-- slug a newer active course now uses — nothing currently routes courses
-- by slug live (the public /training/[slug] page reads a static data file,
-- not this table), so this predicate carries no live routing ambiguity
-- today.
create unique index if not exists courses_active_slug_unique
  on public.courses (lower(trim(slug)))
  where (deleted_at is null) and (status <> 'archived') and (slug is not null) and (btrim(slug) <> '');
