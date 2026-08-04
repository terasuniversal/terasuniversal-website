# Public Certificate Verification System — Deliverable

A secure public verification portal for employers, clients and participants to
verify certificates issued by TERAS UNIVERSAL. Extends the Certificate Engine.
Public website design untouched (the portal is a standalone `/verify` route).

> **Security guarantee:** verification returns ONLY publicly-safe fields.
> IC/passport, phone, email, internal IDs, assessment scores, attendance and
> admin notes are **never** exposed. The participant's public ID is masked
> (e.g. `TU-0•••23`). Enforced inside a single `SECURITY DEFINER` RPC.

---

## 1. Database Migration — `0017_certificate_verification.sql`

Validated on PostgreSQL 16 (full set 0001–0017 applies clean).

- `certificates.verification_enabled` (boolean, default true) — per-certificate
  switch to disable verification without revoking.
- **`certificate_verifications`** log table: `certificate_id`,
  `certificate_number` (snapshot), `method`, `query_value`, `status_returned`,
  `ip_address` (inet), `user_agent`, `verified_at`. Indexed by cert + time.
- **`verify_and_log(p_query, p_method, p_ip, p_ua)`** — `SECURITY DEFINER`,
  granted to `anon`:
  - looks up by `token`, `number`, `code`, or `auto` (tries all three);
  - honours `verification_enabled` (disabled → treated as not found publicly);
  - **logs** every attempt (time, IP, UA, status);
  - returns only safe fields incl. masked participant ID + a `verified_at`
    timestamp; computes `is_valid` (issued and not expired).

**Verified with live queries:** verify by token / number / code all succeed and
return masked ID + company (never IC); not-found and disabled both return no
public data but are logged; the log captured method/IP/status for every attempt.

## 2. Verification Routes

| Route | Indexed? | Purpose |
|---|---|---|
| `/verify` | ✅ landing indexable | Search box (certificate number **or** verification token); results shown inline |
| `/verify?q=…` | ❌ noindex | Result view (dynamic `robots` via `generateMetadata`) |
| `/verify/[token]` | ❌ noindex | QR target — verifies by token, logs, shows result |

SEO handled exactly per spec: only the landing (no query) is indexable; every
result view is `noindex, nofollow`.

## 3. API Endpoints

- **RPC `verify_and_log`** (public) — the single verification + logging entry
  point, called by both pages via `supabase.rpc(...)`. No REST endpoint is
  exposed (keeps the surface minimal); anon access is limited to this one
  definer function.

## 4. Verification Components

- `VerificationResult.tsx` — safe result card (valid / revoked / expired /
  not-found), masked participant ID, contact info for invalid results.
- `VerifyShell` — shared branded, mobile-friendly, accessible layout.
- `firstIp()` — extracts the client IP from `x-forwarded-for` for the log.

## 5. QR Integration

The Certificate Engine already embeds a QR pointing at
`/verify/{verification_token}` (see `CertificateDocument.tsx` + the stored
`verification_url`). Scanning the certificate QR opens `/verify/[token]`, which
verifies and logs automatically. Regenerating a token (admin) updates both the
token and `verification_url`, invalidating old QR codes.

## 6. Audit Log

Two layers:
- **`certificate_verifications`** — every public verification attempt (valid,
  not-found, revoked, expired, disabled) with time, IP and user-agent.
- Admin **Verification History** on the certificate detail page shows the most
  recent attempts. Admin actions (regenerate token, enable/disable, revoke) are
  also captured by the global `audit_logs` triggers.

## 7. Admin Features (added)

On the certificate detail page (Admin+):
- **Verification History** table (time / method / result / IP).
- **Regenerate token** — new token + verification URL (invalidates old QR/links).
- **Disable / Enable verification** — toggles `verification_enabled`.
- **Revoke** — existing (revoked certificates verify as "Certificate Revoked").

## 8. Files Modified / Added

**Added**
```
supabase/migrations/0017_certificate_verification.sql
app/verify/VerificationResult.tsx
```
**Rewritten**
```
app/verify/page.tsx          (landing + inline result, dynamic SEO, logging)
app/verify/[token]/page.tsx  (token result, noindex, logging)
```
**Modified**
```
app/admin/(protected)/certificates/actions.ts   (+ regenerateVerificationToken, setVerificationEnabled)
app/admin/(protected)/certificates/[id]/page.tsx (verification history + regenerate + disable)
```
No public-site, Resend or deployment config touched.

## Build Result

⚠️ **This sandbox firewalls the npm registry (`registry.npmjs.org` → 403)**, so
`npm install` / `npm run build` can't run here. Verification performed:

- ✅ **SQL** applied to PostgreSQL 16 — 0 errors; verify-by-token/number/code,
  logging, participant-ID masking, and disabled-state all proven with live
  queries; no IC/phone/email ever returned.
- ✅ **TypeScript** — all 88 `.ts/.tsx` files parse with 0 syntax errors.
- ✅ **Imports** — 235/236 resolve; the 1 remaining is the intentional
  `../globals.css` reference to your existing public stylesheet.

**Run to complete the required build:**
```bash
npm install
npm run lint
npm run build
```
The repo's Vercel connection runs the real `next build` on push to `main`.
