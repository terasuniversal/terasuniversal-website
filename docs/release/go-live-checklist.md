# Production Go-Live Checklist — v1.2.0

## Release gate

- [x] Local dependency install, lint and production build pass.
- [x] Preview runtime and responsive dashboard verification complete.
- [x] UAT fixes documented in `docs/uat/11-uat-test-report.md`.
- [ ] Apply and verify all Supabase migrations in production.
- [ ] Confirm RLS, storage policies, indexes and foreign keys through the Supabase project.
- [ ] Complete destructive smoke tests only with labelled UAT records, then remove those records.
- [ ] Confirm recovery email redirect URL and custom SMTP configuration.

## Configuration checklist

Required in Vercel Production:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `RESEND_API_KEY` and `RESEND_FROM_EMAIL` if email is used
- `GOOGLE_SHEETS_WEB_APP_URL` if proposal leads use Sheets

Optional: analytics tags, `RESEND_AUDIENCE_ID` for newsletter subscriptions, and `NEXT_PUBLIC_SITE_URL` as a fallback for certificate links.

## Backup and rollback

1. Record the active Vercel deployment URL and Git tag.
2. Verify Supabase database/PITR and Storage backup before release.
3. If rollback is needed, promote or roll back Vercel to the last Ready deployment.
4. Restore the database/storage backup only after scope approval; validate certificate numbers and verification results after recovery.
5. Reapply prior environment-variable values if configuration caused the regression.

## First 14 days

Each day review login failures, API/database errors, failed imports, certificate/verification errors, storage usage, duplicate records and role-permission feedback. Record owner, time, impact and resolution in the release issue log.
