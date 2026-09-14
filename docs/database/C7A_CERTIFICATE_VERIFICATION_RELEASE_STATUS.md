# C7A Certificate Verification Release Status

Status record for the immutable C7A Production database migration and its
approved Certificate Verification release candidate.

- Migration version: `20260914090000`
- `APPLIED_RAW_ARTIFACT_SHA256`: `4ea1bb66717f9d88c7a0bf1392f067f9e05c114c134c928b1ced64fee8367abc`
- `CANONICAL_GIT_BLOB_SHA256`: `4ea1bb66717f9d88c7a0bf1392f067f9e05c114c134c928b1ced64fee8367abc`
- `WINDOWS_AUTOCRLF_CHECKOUT_SHA256`: `2e16d52d7df3a1d132fa3b9401f2bef66c5d4d53e8bde2a16dca98e65e9088fc`
- Preview runtime: approved (`C7A.8E`)
- Production migration: applied successfully to `iagzkrzeuawaxvacqprk`
- Production migration ledger: version present exactly once
- Historical wording: the migration's `DESIGN DRAFT ONLY` wording is authoring history and no longer represents operational status
- Immutability: the applied migration body is immutable after apply; this record does not alter database behavior
- EOL reconciliation: raw authoritative bytes and the exact Git blob are byte-identical; the clean checkout differs only because Git checked out LF bytes as CRLF (`211` line endings). CRLF-to-LF normalization produces an exact byte match with the Git blob, with zero non-EOL content differences.
- Reapply policy: Production must never reapply this migration because of the checkout EOL representation; future release/deploy identity checks should use the canonical Git blob SHA or an LF-preserving checkout.
- Company registration sign-off: `OWNER_COMPANY_REGISTRATION_SIGNOFF=APPROVED`
- Approved TERAS registration: `201201003207 (976732-P)`

## C7A Production Closeout

- C7A production status: `C7A_PRODUCTION_APPLICATION_RELEASE_APPROVED`
- Production release deployment: `dpl_9pUmn338CeoiHUzqz4giCB1gxHe6`
- Production Certificate source: `d83cb035ee9fc612fd69ede622a038b7d9c1b1fe`
- Production Supabase: `iagzkrzeuawaxvacqprk`
- Migration `20260914090000`: applied exactly once
- Migration SHA: `4ea1bb66717f9d88c7a0bf1392f067f9e05c114c134c928b1ced64fee8367abc`
- Valid verification: `PASS`
- Training Period: `PASS`
- Privacy: `PASS`
- Mobile verification: `PASS`
- Sticky CTA: `PASS`
- Legacy compatibility: `PASS`
- Error-state separation: `PASS`
- DB/security contract: `PASS`
- Known accepted risk: `P2 Certificate Verification Gateway Reliability`
- Automatic retry: not implemented until idempotent verification logging is designed
- Non-blocking cleanup: duplicate `/verify` warning
- `C7_OPERATIONAL_SCOPE_COMPLETE=YES`

## C7A.12B Main Promotion

- Approved release branch: `release/certificate-c7a-production-approved`
- Main promotion: one normal two-parent merge; no squash or individual cherry-picks
- Git-triggered Production reconciliation: expected from `main` branch update
- No manual Vercel Production deployment performed
