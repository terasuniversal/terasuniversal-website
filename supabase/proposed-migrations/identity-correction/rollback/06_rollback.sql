-- ROLLBACK for 06_guard_participant_identity.sql (local only). Removes the participant profile guard;
-- afterwards ordinary admins can again edit name/identity of participants who hold certificates.
drop trigger if exists trg_participant_identity_guard on public.participants;
drop function if exists app.participant_identity_guard();
