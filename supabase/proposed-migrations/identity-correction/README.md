# Certificate identity correction — Phase 1 (LOCAL ONLY)

**Status:** proposed, tested on a disposable PostgreSQL 17 fixture with synthetic data only.
**Not applied** to staging or Production. Not in `supabase/migrations/` on purpose, so no tool picks it up.
Owner approval for any next step (push, PR, staging, Production, real corrections) is separate and still pending.

## What it does

A restricted Super Admin workflow to correct a spelling error in an already-issued certificate's holder
name and/or IC/Passport number **without** changing the certificate number, QR token, issue date, assessment
history or eligibility records, and **without** weakening the historical immutability guards.

| File | Single logical change |
|---|---|
| `01_identity_audit_schema.sql` | Owner-only `identity_audit` schema: policy, requests, per-certificate decisions, append-only ledger, anchors, outbox. No API role has any privilege. |
| `02_identity_audit_helpers.sql` | Internal helpers, incl. `authorized()` (is *this exact* old→new change authorised by a ledger row of the *current* transaction?), collision/WAH checks, guard fingerprint, `verify_ledger()`. |
| `03_identity_correction_workflow.sql` | `assess / request / approve / apply / cancel / enable / disable` as `app.*` SECURITY DEFINER + thin `public.*` wrappers (same contract as `public.revoke_certificate`). |
| `04_guard_snapshot_identity.sql` | Snapshots become trigger-immutable (today only privileges protect them). |
| `05_guard_certificate_identity.sql` | The live historical guard, **verbatim except four conditions**; plus a new guard for legacy certificates without a snapshot. |
| `06_guard_participant_identity.sql` | Profile name/IC of a participant who holds certificates can no longer be edited directly. |
| `rollback/*.sql` | One rollback per migration; `01` refuses to drop evidence. |

Apply order `01 → 06`. Each file has pre-checks, is idempotent and refuses a half-installed state.

## Design in one paragraph

Nothing can change an identity field on a certificate, snapshot or protected profile except through
`app.identity_correction_apply()`. That function (Super Admin only) first inserts a ledger row (sealed
original/new values + salted fingerprints) and only then performs the UPDATE; the guards accept the UPDATE
only when `identity_audit.authorized()` finds a ledger row for **that exact row, field, old value and new
value written in the current transaction** for a request that is applying in this transaction. There is no GUC,
flag or role that opens a guard, and `apply` takes no values — they come from the request.

## Hard requirements from the owner and where they are enforced

| Requirement | Where |
|---|---|
| Name-only, IC-only and combined | `change_kind` in `03` |
| One Super Admin, stronger evidence/audit; optional second person | evidence rules + waiting period + `policy.require_second_approver` (default off) |
| Enumerate every certificate; no automatic change of all of a participant's certificates | `request` demands an explicit decision per active certificate; `apply` touches only `correct`/`materialize_new`/`pin_old` |
| Legacy (no snapshot) in the impact analysis, separate guarded path | `identity_class` A/B/C/none + `trg_certificate_legacy_identity_guard` |
| Class C never changed automatically | needs `accept_display_change` / `pin_old` / `materialize_new` |
| Profile edits must not silently change issued identity | `06` |
| Same-person verification is document-backed | evidence types + sha256 + ≥2 types for IC/legacy + government document + reuse refusal + enrolment anchor |
| No ownership transfer | collision checks (participants, certificates), WAH duplicate-release block, `participant_id` stays immutable |
| Atomic; failure leaves nothing | single transaction, preservation self-check, tested with an injected failure |
| Append-only ledger; hash chain is not the only protection | triggers + no privileges + externally anchored head + guard fingerprint + sealed values (public-key) |
| Bulk issuance / ZIP / reissue / regeneration stay on HOLD | untouched; nothing here regenerates a file |
| Workflow dependent on anchors / notifications / keys inert until configured | `policy_enabled_requires_controls` CHECK + `enable()` self-test |

## Behaviour changes the CRM will see (interference risks)

1. **Participant form.** After `06`, saving a participant who already holds a certificate with a changed
   Full Name / IC / Passport fails with `IDC_CORRECTION_REQUIRED`. Unchanged values, and every other field, still save.
   - `app/admin/(protected)/participants/actions.ts` maps any error whose message contains `"identity"` **or `"ic"`**
     to the *duplicate IC* message (`error.message.includes("ic")` matches almost any English word), so the guard
     message would be mis-shown as "duplicate IC". A small UI change is needed **before** `06` is applied.
   - The form posts the full payload on every save: a cosmetic re-format (trim/case) of the name counts as a change.
2. **Snapshots** can no longer be updated/deleted by `service_role` or `postgres` outside the workflow. No code in
   `app/`, `lib/`, `components/` or `scripts/` updates or deletes snapshots (searched), and no Production RPC does.
3. **Legacy certificates**: name/IC columns are now guarded for rows without a snapshot (today only privileges protect them).
4. About 74 Class C certificates (legacy, no stored IC; the renderer falls back to `participants.ic_passport_no`) already
   change display whenever an admin edits that profile column; `06` closes that. A profile that stores its identity only in
   `identity_no` does not make a certificate Class C, because the renderer never reads that column.

Checked and **not** affected: the seven RPC bodies that update `certificates` (`persist_certificate_render_contract_marker`,
`set_certificate_verification_enabled`, `issue_…`, `revoke_certificate`, `update_certificate_metadata`,
`set_certificate_deleted`, `duplicate_…`) touch none of the four columns after INSERT;
`finalize_public_registration_crm` updates only `email/phone/company/updated_at` on `participants`.

## Test results

`bash scripts/identity-correction/run.sh` (needs Docker; uses `postgres:17`): **304 passed, 0 failed**.
Covers install/re-install, privileges, unauthorised callers (anon/service_role/outsider/admin/editor/inactive/no user),
direct-update bypass for every role incl. the table owner, all 30 pre-existing protected columns, compatibility with
the existing RPC/flow updates, RLS, name/IC/combined corrections across Class A/B/C, collisions, WAH duplicate
prevention, waiting periods, second approver, stale requests, failure atomicity, repeated corrections, two-session
concurrency, invariants (no other column changed anywhere), tamper **detection**, rollback and re-apply.

## Honest limits

- The table owner / any holder of the service-role key with trigger-DDL rights can disable a guard or forge a
  ledger row inside one transaction. This is **detected, not prevented** (`verify_ledger()`: guard fingerprint,
  unanchored ledger rows, anchor mismatch), and detection only works if anchors **leave the database**.
- The sealing public key must have an **encryption-capable subkey** (a signing-only key is rejected by `enable()`);
  the owner must prove offline that the private key decrypts a test value *before* enabling.
- Anchor delivery and notifications are modelled (tables + flags) but **not implemented**; the workflow stays off until they are.
- `public_registration_attendees`, `legacy_participant_staging`, `assessors`, `trainers` also hold IC data and are out of scope.
- The fixture's WAH and audit functions are reformatted copies (behaviour identical, md5 differs); the historical guard,
  `sync_participant_last4` are md5-identical to Production.
- Wait periods 24h/72h are **provisional test defaults**, not approved policy.

## Unresolved owner decisions

See the Phase 1 report: waiting periods, evidence standard, anchor destination + notification recipient, sealing key
custody, second-approver policy (only one active Super Admin today), Class C default, strictness of the profile guard
(null→value fill-in is blocked too), soft-deleted-participant collisions (now rejected by default), UI changes (participant form, "corrected" marker).
