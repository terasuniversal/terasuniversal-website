-- ROLLBACK for 03_identity_correction_workflow.sql (local only). Removes the callable workflow. Evidence
-- tables are NOT touched; open requests (if any) simply stop being actionable.
drop function if exists public.identity_correction_assess(uuid);
drop function if exists public.identity_correction_request(uuid, text, text, text, boolean, text, jsonb, jsonb);
drop function if exists public.identity_correction_approve(uuid);
drop function if exists public.identity_correction_cancel(uuid, text);
drop function if exists public.identity_correction_apply(uuid);
drop function if exists public.identity_correction_enable();
drop function if exists public.identity_correction_disable();
drop function if exists app.identity_correction_assess(uuid);
drop function if exists app.identity_correction_request(uuid, text, text, text, boolean, text, jsonb, jsonb);
drop function if exists app.identity_correction_approve(uuid);
drop function if exists app.identity_correction_cancel(uuid, text);
drop function if exists app.identity_correction_apply(uuid);
drop function if exists app.identity_correction_enable();
drop function if exists app.identity_correction_disable();
drop function if exists identity_audit.audit(text, text, text, jsonb);
drop function if exists identity_audit.baseline(uuid);
drop function if exists identity_audit.identity_class(uuid);
drop function if exists identity_audit.sha(text);
