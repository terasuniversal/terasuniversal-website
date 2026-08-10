-- Prevent duplicate active certificates for the same schedule+participant.
-- Safety proven live before applying (2026-08-09): all 108 existing
-- certificates have schedule_id IS NULL (100% legacy, non-schedule-driven),
-- so this index is vacuously satisfied by every existing row and cannot
-- fail on creation. Revoked certificates are excluded so a revoke+reissue
-- workflow keeps working; expired certificates are NOT excluded (approved
-- business rule §7/Phase 6: expired stays historical/issued and should
-- still block an accidental duplicate generation).
create unique index if not exists certificates_active_schedule_participant_uniq
  on public.certificates (schedule_id, participant_id)
  where deleted_at is null and status <> 'revoked' and schedule_id is not null;
