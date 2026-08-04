# Backup and Restore Guide

The application reports backup status, but Supabase manages database recovery.

1. Confirm backup/PITR coverage in the Supabase project before go-live.
2. Keep a controlled export of critical business reports according to the retention policy.
3. Record every restore request, scope, approver and result in the Audit Log.
4. Test a restore only in a non-production environment first.

The browser **Manual backup** control remains a deliberate placeholder until a protected server-side backup process and retention policy are approved.
