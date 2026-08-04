# Super Admin Manual

## Daily control

1. Review **System Health** and **Automation Centre** for failed jobs and pending certificates.
2. Review **Audit Log** after bulk imports, certificate generation and user changes.
3. Maintain least-privilege roles. Give Admin only to staff who must edit operational data.
4. Keep the Supabase backup/PITR policy enabled and test recovery with a non-production dataset.

## Escalation

- Do not delete production records to solve a data issue; use the restore action where available.
- Disable a compromised staff account before resetting its password.
- Preserve the audit trail and record all recovery work.
