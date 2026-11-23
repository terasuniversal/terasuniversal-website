# F-PAY-1 P2: where and when it was applied

Migration file: `supabase/migrations/20261123100000_fpay1_p2_cancel_finalize_guards.sql` (sha256 `421532f23ab3fcaecaec62be34cbb32f501d890c27e02d1c0c2dcc94953d9004`).
Rollback: `20261123100000_fpay1_p2_cancel_finalize_guards.rollback.sql` in this folder (not used).

| Environment | Ledger version | Applied (UTC) | Approval | Function md5 after (cancel / finalize) |
|---|---|---|---|---|
| Staging `eokiaehnvzbggmacifcf` | `20261123100405` | 2026-11-23 | OWNER-FPAY1-P2-STAGING-20261123 | `684c58040334c45a4ad481e394d078a2` / `d6eafe17977f6af099636e0801e36d8e` |
| Production `iagzkrzeuawaxvacqprk` | `20261123111548` | 2026-11-23 | OWNER-FPAY1-P2-PROD-20261123 | `684c58040334c45a4ad481e394d078a2` / `d6eafe17977f6af099636e0801e36d8e` |

- Both ledgers store the statement with md5 `7b0f86ad1cf00c249ad1515e83c2c4e8`, which is the md5 of the file content.
- The migration file is not edited to record these versions: it is present in `schema_migrations`, and editing it would break that equality (see `docs/database-baseline-audit/MIGRATION_POLICY.md`).
- The mapping is also listed under "Post-baseline VERSION-DRIFT" in `docs/database-baseline-audit/REPOSITORY_MIGRATION_INVENTORY.md`.

Before-state on both databases (prosrc md5): `cancel_invoice_unguarded` `d08eaad240c614f658e1cb68c2e73e8f`, `finalize_toyyibpay_payment_from_callback` `78c36cd603dfa7c4f3d8d45a2d6d07a7`.
After apply, ACLs, owner, SECURITY DEFINER, search_path, RLS policies and every other function fingerprint were unchanged.

Release: PR #256 merged as `c3c4647831b33ef2b8c5903cb194fb3fb6dce5dc`, Production deployment `dpl_9kbBhWzgEn9vXxDQewpWsRkNbwNS`.
Evidence: Docker suite `supabase/tests/fpay1_p2/run.sh` 24/24; Staging transaction probes A/B/C passed (nothing persisted); Production postflight read-only (no write probes, by Owner decision).
