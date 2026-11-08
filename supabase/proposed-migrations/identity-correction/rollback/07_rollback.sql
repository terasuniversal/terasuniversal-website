-- ROLLBACK for 07_identity_correction_read_and_reject.sql (local only). Removes the read RPCs, `reject` and the mask helper.
-- It deliberately does NOT touch the `rejected` status or requests_guard(): 01 owns both now, so a rejected request
-- already on file stays valid and the guard fingerprint (and therefore every anchor) is unchanged by this rollback.
drop function if exists public.identity_correction_reject(uuid, text);
drop function if exists public.identity_correction_policy();
drop function if exists public.identity_correction_search_certificates(text);
drop function if exists public.identity_correction_list_requests(text, integer);
drop function if exists public.identity_correction_get_request(uuid);
drop function if exists public.identity_correction_history(uuid);
drop function if exists app.identity_correction_reject(uuid, text);
drop function if exists app.identity_correction_policy();
drop function if exists app.identity_correction_search_certificates(text);
drop function if exists app.identity_correction_list_requests(text, integer);
drop function if exists app.identity_correction_get_request(uuid);
drop function if exists app.identity_correction_history(uuid);
drop function if exists identity_audit.mask(text);
