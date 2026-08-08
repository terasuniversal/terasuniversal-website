# Module Fix Report — Module 5: QR Verification

## Files changed

- `app/admin/(protected)/certificates/actions.ts` — `duplicateCertificate` now stamps `verification_url` on the new certificate (matching `generateCertificate`'s existing pattern), so its QR code encodes a resolvable absolute URL instead of falling back to an unscannable relative path.
- **1 database migration applied directly to production**: `add_verify_and_log_rpc` — created `public.verify_and_log(p_query, p_method, p_ip, p_ua)`, the RPC `app/verify/page.tsx` and `app/verify/[token]/page.tsx` have been calling since before this fix phase started. It never existed. This is the single highest-impact fix of the entire fix phase so far — it's the one customer-facing feature on the whole site, and it's been silently broken for every genuine certificate the whole time.

## Why

This bug was identified and documented repeatedly across this session (`DATABASE_AUDIT.md`, `BUG_REPORT.md` BUG-04/11, every module report's cross-references) but deliberately left unfixed until now, because Module 5 in your ordering ("QR Verification") is its natural home — fixing it earlier would have meant working outside the module currently in scope.

The function is built against the schema as it exists **after** Modules 1 and 3 (participant fields, certificate columns, `certificate_verifications` table) — it couldn't have been written correctly any earlier in this fix phase. It deliberately treats live `status` values `'valid'` and `'issued'` as equivalent (rather than assuming one), consistent with this session's standing decision not to relabel existing certificate data. `training_date` returns `null` for the same reason `certData.ts` does in Module 3 — it depends on `training_schedules`, which is Module 10's job.

## What was fixed

- **Public certificate verification now actually works.** Verified against 3 real, live certificates (not just synthetic test data):
  - An **expired** real certificate (`TU-SCAF-2026-0002`) → correctly returned `status: "expired"`, `is_valid: false`.
  - A **valid** real certificate (`BE/L1/1812/25`, legacy `status='valid'`) → correctly returned `is_valid: true`.
  - A throwaway certificate created with the *designed* schema's `status='issued'` → also correctly returned `is_valid: true`, confirming the `'valid'`/`'issued'` equivalence logic works for both live data shapes.
  - A **nonexistent** certificate number → correctly returned zero rows (which `app/verify/page.tsx`'s `data.length > 0 ? data[0] : null` logic turns into the "Certificate Not Found" state, not a crash).
- **Participant ID masking verified correct** — a real participant code (`TU-000018`-style) came back masked as `TU-0•••18`, matching the exact masking rule the public result card expects (`participant_code_masked`).
- **Verification-by-token (the actual QR-scan path)** verified separately from verification-by-number — scanning a certificate's QR code resolves via `/verify/[token]` → `verify_and_log(token, 'auto', ...)`, confirmed working end-to-end against a throwaway certificate's real auto-generated token.
- **Every verification attempt is now logged** to `certificate_verifications` — confirmed both a successful and a failed lookup each produced a log row with the correct method/query/result, which is what powers the "Verification History" card on the admin certificate detail page (built in Module 3).
- **`duplicateCertificate`'s QR now resolves.** Previously it left `verification_url` unset, so the duplicate's QR encoded a bare relative path.

## How tested

All against the live database, since no browser session is available in this environment:

1. Called `verify_and_log(...)` directly with a real expired certificate number, a real valid certificate number, and a nonexistent one — confirmed each returned the correct shape and correct `is_valid`/`status` values.
2. Created one throwaway certificate (via direct insert, relying on Module 3's auto-generation trigger for its token), verified it by **token** (the QR-scan path specifically, not just certificate-number search), then deleted it.
3. Queried `certificate_verifications` directly after each test call and confirmed a log row was written each time, with the correct `status_returned` value (`expired`, `valid`, `not_found`) — then deleted the test log entries so they don't pollute the real verification-attempt history.
4. Did not independently re-test the QR **image** rendering itself (the `api.qrserver.com` external service call in `CertificateDocument.tsx`) — that was unchanged by this fix and wasn't flagged as broken; only the data the QR encodes (`verification_url`) and what happens when that URL is visited were in scope.

## Remaining issues

- **`training_date` is `null` on every verification result** until Module 10 (Schedules) exists — the public verification card simply omits that row when it's null (confirmed in `VerificationResult.tsx`'s conditional rendering), so this degrades gracefully rather than showing an error.
- **`company` is `null` for participants who don't have one on file** — correct behavior, not a bug, just noting since it's a visible field on the public result card.
- **Not tested with a real QR-code scanner or a real browser hitting `/verify`** — the RPC itself is now confirmed correct at the data layer; an actual end-to-end scan-to-browser test would be the stronger confirmation if a deployed environment becomes available.
- **The legacy `verify_certificate_by_value` RPC** (the one that *was* live and working all along, per `DATABASE_AUDIT.md`) is untouched by this fix and still exists — it's not called by any current code path, so it's now genuinely unused rather than the only working option. Not removing it without your direction, per "don't fix unrelated issues."

---

Stopping here per your instruction. Waiting for approval before the next module.
