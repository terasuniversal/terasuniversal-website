# MC-1: marketing contact number EXECUTE gap (LOCAL PROPOSAL, NOT APPLIED) - 2026-11-23

## Evidence (read-only)
| | Staging eokiaehn | Production iagzkrzeu |
|---|---|---|
| app.next_marketing_contact_number() | SECURITY DEFINER, owner postgres, search_path=app, src md5 e510ba76 | identical |
| ACL | {postgres=X/postgres} (authenticated no EXECUTE) | identical |
| anon | no USAGE on schema app | same |
| marketing_contacts rows | 13 (8 free_ebook via SECURITY DEFINER submit_public_ebook_lead, 5 other) | 0 |
Other number generators: next_campaign_number and next_quotation_number grant authenticated (direct staff inserts work);
next_invoice_number, next_opportunity_number, next_receipt_number have no authenticated EXECUTE on Staging but are only
used inside SECURITY DEFINER RPCs (create_invoice_from_quotation, convert_lead_to_opportunity, generate_receipt_for_payment),
so they work. Production drift: next_opportunity_number ACL is NULL (PUBLIC EXECUTE; harmless for anon, which has no app USAGE).
Origin: create_marketing_contacts_v1 (Staging 20260828090000 file / Production 20260827103955) grants table privileges
explicitly but never EXECUTE on the function. Predates R1 by ~3 months. Not caused by R1 or A1.

## Impact
createContact (actions.ts:145) inserts directly with the RLS-bound client -> fails for every staff role, including
super_admin, on Staging and Production (INFERRED from the privilege state; not exercised through the UI). The raw
PostgreSQL message is returned to the form (`return { message: error.message }`), leaking the internal function name.

## Options
| Option | Change | Pros | Cons |
|---|---|---|---|
| **A (recommended)** | `GRANT EXECUTE ON FUNCTION app.next_marketing_contact_number() TO authenticated` | One privilege; mirrors next_campaign_number/next_quotation_number; RLS still gates the INSERT | authenticated could burn sequence numbers if it could call the function directly - but schema app is not exposed through PostgREST, so only possible via defaults/SQL it can already run |
| B | SECURITY DEFINER RPC `create_marketing_contact(...)` with role + module checks; app calls the RPC | No new function grant | New write path duplicating RLS; app change + RPC + tests; larger blast radius |
| C | Replace the default with a BEFORE INSERT trigger (trigger functions need no EXECUTE) | No grant | Schema change on a shared table; changes provenance of contact_number; more risk than A |
| D | Make the function INVOKER + grant sequence USAGE | - | Widens to sequence privileges; worse than A |

Risk review for A: function is SECURITY DEFINER with a fixed search_path=app and a constant body (no inputs) -> no
injection or privilege escalation; it only returns `MCT-YYYY-nnnn` and advances app.marketing_contact_seq. Concurrency:
nextval is atomic; gaps on rolled-back inserts are expected (same as today for other sequences). Cross-role: RLS INSERT
policy (editor + marketing_contacts:edit) is unchanged, so trainers/clients/participants/view-only staff still cannot create
contacts; anon has no app USAGE.

## Proposed SQL (A)
`20261128120000_marketing_contact_number_execute_grant.sql` (this folder): one DO block, fail-closed precondition on the
exact function body/owner/secdef/search_path/ACL, the single GRANT, postcondition on the exact new ACL and anon still denied.
Rollback: `revoke execute on function app.next_marketing_contact_number() from authenticated;`

Recommended app follow-up (separate, CRM code): map the DB error in createContact to a generic message instead of
returning `error.message` (CLAUDE.md section 15).

## Staging test plan (after separate approval)
1. Website ACK + baseline (70 migrations, 213 policies, fingerprints, data_fp).
2. Apply MC-1 once; postflight: ACL exact, history +1, no other change.
3. Re-run Tier B v4 from block 1 (unchanged matrix, all six personas): super_admin I:marketing_contacts must be ALLOW;
   every other persona keeps its expected DENY class on marketing_contacts (custom staff DENY_RLS, no_profile DENY_RLS,
   anon DENY_PRIV_TABLE). No expected result is relaxed.
4. Negative checks inside Tier B: view-only editors still DENY_RLS on INSERT; anon still cannot execute (no app USAGE).

## Production compatibility
Same ACL and body on Production; the same file applies unchanged (precondition matches). Production has 0 contacts, which
is consistent with the broken create path. Production apply only after the Production R1 decision and separate approval.
