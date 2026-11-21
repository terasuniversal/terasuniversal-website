-- ROLLBACK for 04_guard_snapshot_identity.sql (local only). Snapshots return to being protected by
-- privileges/RLS only.
drop trigger if exists trg_snapshot_identity_guard on public.certificate_issuance_snapshots;
drop function if exists app.snapshot_identity_guard();
