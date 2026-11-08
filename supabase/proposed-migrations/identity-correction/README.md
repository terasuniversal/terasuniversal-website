# Certificate identity correction (PROPOSED, DRAFT PR #221): NOT applied, workflow must stay disabled

**Status:** proposed, tested on a disposable PostgreSQL 17 fixture with synthetic data only.
**Not applied** to staging or Production. Not in `supabase/migrations/` on purpose, so no tool picks it up.
Owner approval for any next step (staging, Production, activation, real corrections) is separate and still pending.

## Activation prerequisites (owner policy, 8 Nov 2026) -- read before anything else

The **External Audit Anchor** is a mandatory prerequisite before the workflow may be activated. It is **not** a prerequisite for
this Draft PR, and it is **not implemented yet**:

- External anchor **delivery** and **independent storage** are NOT implemented. `identity_audit.anchors` and `identity_audit.outbox`
  only model them inside the database; nothing leaves the database.
- External fingerprint **verification is NOT operational**. `scripts/identity-correction/external-verify.sql` exists and is tested,
  but there is no trusted off-database copy of the fingerprint to compare it with and no scheduled/independent process that runs it.
- The workflow **must remain disabled**: `identity_audit.policy.enabled_at` stays NULL (the `policy_enabled_requires_controls`
  constraint and `enable()` enforce this until a sealing key, an anchor sink and a notification sink are configured and verified).
- **No Production-readiness or security-completion claim is permitted** until these controls are implemented and tested.
- **No bypass** of these prerequisites is authorized.

Other gates before any real use: browser QA and Staging rehearsal with synthetic identities (separate approval), the participant-form
error-mapping fix (before migration 06), the eight owner policy decisions, syncing the CRM branch, `MODULE_ACCESS` / sidebar wiring.

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
| `07_identity_correction_read_and_reject.sql` | (Phase 2C) Read-only RPCs for the Super Admin screen (policy, certificate search, request list/detail, per-certificate history) and a `reject` action with status `rejected`. Never returns sealed values, fingerprints, full IC numbers or full document hashes. |
| `08_request_text_guard.sql` | (Phase 2C-fix) Refuses IC/Passport-shaped text, and the participant's current or requested identity, in the free text a request stores (reason, document references, decision reasons, cancel/reject reasons). No callable surface. |
| `09_external_evidence.sql` | (Phase 3A PROTOTYPE) least-privilege read-only evidence snapshot, two minimal acknowledgement writes by a separate role, and a fail-closed gate on new requests and apply. See `EXTERNAL_ANCHOR_DESIGN.md`. Needs the two NOLOGIN roles created first. |
| `rollback/*.sql` | One rollback per migration; `01` refuses to drop evidence. |

Apply order `01 → 09`. Each file has pre-checks, is idempotent and refuses a half-installed state.

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

`bash scripts/identity-correction/run.sh` (needs Docker; uses `postgres:17`): **see the Phase 2C-fix R2 section below**.
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

## Phase 2C: UI skeleton (new files only, not wired in)

Everything below is a new file, so nothing here can conflict with the CRM branch. Nothing is linked from the sidebar
and nothing is applied to staging or Production.

- `app/admin/(protected)/certificates/identity-correction/` list, `new/` (search then form), `[requestId]/` (detail and actions), `actions.ts`.
- `lib/identity-correction/api.ts` (typed RPC readers), `errors.ts` (IDC_* code to safe message), `lib/validation/identity-correction.ts` (Zod).
- `components/admin/identity-correction/CorrectionHistoryCard.tsx` (not yet imported by `certificates/[id]/page.tsx`).
- Super Admin only: `requireRole("super_admin")` on every page and action, and every RPC re-checks it. Only certificate numbers and participant UUIDs appear in URLs.
- Still to do after the CRM branch syncs with main: a `MODULE_ACCESS` entry (`identity_correction: "super_admin"`, rbac.ts), the sidebar link, the history card on the certificate page, the participant-form error mapping (before 06), and folding the Zod file into `schemas.ts`.
- Verified: `tsc --noEmit` clean across the project. Not verified: rendering in a browser, and any behaviour against a real database.

## Phase 2C-fix (after the Phase 2C review)

- **Search is a POST Server Action**, so nothing typed reaches the URL, history or access logs; IC/Passport-shaped input is refused.
- **Free text cannot carry an identity**: Zod (`looksLikeIdentity`) and migration 08 refuse it in reasons and document references.
- **Class C and certificate binding are re-checked on the server** from the participant's real certificates; the submit button stays disabled until every decision and reason is complete; a stale decision is cleared when "update the profile" changes.
- **01 now owns the `rejected` status and the final `requests_guard()`**, so re-running 01 after 07 cannot downgrade it; 07 keeps an upgrade path for an earlier 01 install (tested). The 07 rollback no longer touches the status or the guard, so it never changes the guard fingerprint.
- Still open: `MODULE_ACCESS`, sidebar, history card on the certificate page, participant-form error mapping (before 06), folding the Zod file into `schemas.ts`, syncing with main (dry-run: the only conflict is `.ai/PROJECT_STATUS.md`) and with the CRM branch.

## Phase 2C-fix R2 (independent review findings)

- **Audit-anchor integrity (07 and 08).** Each migration is one transaction. It first runs `identity_audit.assert_guards_clean()`
  (refuses with `IDC_GUARD_DRIFT` if the ledger or any guard no longer matches the last anchor), then, after its changes,
  `identity_audit.finish_guard_transition()` proves that the only audit objects it changed are the ones it is allowed to change
  (07: `requests_guard()` on an older install; 08: its two functions and two triggers) before recording the anchor. Anything else
  raises and rolls the migration back. A rollback is never blocked, but it anchors only a verified expected reverse transition on
  a state that was clean beforehand; otherwise it warns and records nothing, so drift stays visible.
- **Fingerprint coverage.** `guard_components()` (02) now includes the free-text helpers and the two 08 functions and triggers, so
  altering, dropping or disabling the free-text protection changes the fingerprint and `verify_ledger()` reports it.
- **Existing sensitive text.** 08 refuses to install over request text that may contain an identity number
  (`IDC_LEGACY_TEXT_UNSAFE`, count only, nothing deleted or rewritten). 07's `get_request` withholds such text
  (`identity_audit.safe_text`) whenever it is read, whatever the install order.
- **Pattern protection.** `identity_audit.text_has_identity()` (02) and `lib/validation/identity-text.ts` implement the same five
  patterns (slash/dot/space/any-separator IC, digit-by-digit IC, 3-3-3-3 groups, two passport shapes); both are tested against the
  same 36 synthetic vectors in `scripts/identity-correction/identity-text-vectors.json`. Rejected text is never echoed or logged.
- Known strictness: an IP-shaped `000.000.000.000` is treated as an identity number by design.

### Round-2 review follow-ups (same phase, still local)

- **Unicode evasion.** Text is folded before matching (NFKC, invisible/format characters removed, Arabic-Indic, Extended Arabic-Indic,
  Devanagari, Bengali, Tamil and Thai digits mapped to 0-9) in both `identity_audit.fold_text()` and `foldText()`; the shared
  vectors now include full-width, Arabic-Indic, Thai, Tamil, circled, zero-width and soft-hyphen cases plus accented/ordinary
  negatives. Digits of other scripts are not recognised (documented limit). `norm()`-based containment of the participant's own
  identity also runs on folded text.
- **The enumerator cannot vouch for itself.** `guard_components()`, `guard_fingerprint()`, `guard_snapshot()`, `verify_ledger()`,
  `record_anchor()` and the transition helpers are now components of the fingerprint, which catches careless edits. A migration owner
  who replaces the enumerator so that it reports a stale answer can still fool every check that runs inside the database -- that is
  the accepted design limit (detected only if evidence leaves the database). `scripts/identity-correction/external-verify.sql` is the
  mitigation: it recomputes the fingerprint from `pg_proc` / `pg_trigger` WITHOUT calling any `identity_audit` function, to be run
  from outside the application and compared with the fingerprint stored off the database at install time. `run.sh` proves it agrees
  with the internal value on a clean install and exposes a lying enumerator that `verify_ledger()` cannot see. Wiring the stored
  copy (the external anchor sink) remains an open dependency.

## Phase 3A: External Audit Anchor prototype (LOCAL ONLY)

Design: `EXTERNAL_ANCHOR_DESIGN.md`. Code: `scripts/identity-correction/evidence-worker/` (zero-dependency Node worker, separate
acknowledgement program, owner tool, mocks) and the test suite `scripts/identity-correction/run-evidence.sh`
(`bash scripts/identity-correction/run-evidence.sh`; Docker + local bare git repository; test-only keys; all external services mocked).
**It is a prototype: no real evidence repository, timestamp authority, e-mail channel, secret or account exists, and the workflow
must stay disabled.** The External Audit Anchor remains a mandatory prerequisite for activation.

