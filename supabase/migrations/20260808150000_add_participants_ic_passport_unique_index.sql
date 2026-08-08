-- Additive, guarded, non-destructive: adds duplicate protection for
-- participants.ic_passport_no, the column the live admin CRUD (create/update/
-- import) actually writes to. A near-identical index already exists for the
-- separate `identity_no` column (participants_active_identity_unique,
-- populated only by the legacy /api/admin/certificates import path) — this
-- mirrors its exact expression for consistency, applied to the column the
-- current UI uses.
--
-- Verified safe before applying: zero active-row collisions under this
-- normalization (checked both a conservative trim+uppercase comparison and
-- this exact stripped-alphanumeric comparison against the live table).
--
-- Partial index: only active (deleted_at IS NULL), non-null, non-blank
-- values are constrained — soft-deleted rows and legitimately-missing
-- identity numbers are left alone, matching this table's existing
-- soft-delete and nullable-identity conventions.
create unique index if not exists participants_active_ic_passport_unique
  on public.participants (upper(regexp_replace(ic_passport_no, '[^0-9A-Za-z]', '', 'g')))
  where (deleted_at is null) and (ic_passport_no is not null) and (btrim(ic_passport_no) <> '');
