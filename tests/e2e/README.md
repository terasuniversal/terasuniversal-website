# TERAS smoke and visual QA

These tests are staging-oriented and read-only. They never submit public forms, create CRM records, mutate Supabase, or use a personal browser profile.

## Environment

Copy `.env.e2e.example` to a local ignored file or set variables in the process environment:

- `PLAYWRIGHT_BASE_URL`: staging Preview URL or local URL; defaults to `http://127.0.0.1:3000`.
- `PLAYWRIGHT_START_SERVER=1`: optional local Next server startup.
- `CRM_STORAGE_STATE`: optional path to a user-created staging-only Playwright storage state. Do not commit it.

Authenticated CRM and CRM visual suites skip when `CRM_STORAGE_STATE` is absent. This is intentional: a successful public response or login-page render is not staff readiness evidence.

Run `npx playwright install chromium` once on the QA machine, then use the package scripts from the repository root. Screenshot baselines are created only with an explicit `--update-snapshots` approval.
