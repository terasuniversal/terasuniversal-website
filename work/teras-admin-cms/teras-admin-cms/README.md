# TERAS UNIVERSAL Admin CMS — Setup

This package adds a secure admin CMS to the **existing** TERAS UNIVERSAL
Next.js site without changing the public frontend. Read `DELIVERABLE.md` for the
full architecture; this file is the quick-start.

## What's inside
- `supabase/` — 11 SQL migrations + seed (schema, RLS, functions, storage).
  Applied and tested against PostgreSQL 16.
- `lib/`, `components/admin/`, `app/admin/`, `app/verify/`, `middleware.ts` —
  the TypeScript admin app.
- `package.additions.json`, `.env.admin.example`, `tsconfig.json` — glue.

## Quick start
1. **Supabase project** → run migrations `0001`→`0011`, then `seed.sql`.
2. Create your first user in Auth, then run the elevation `UPDATE` at the end of
   `seed.sql` to make them `super_admin`.
3. **Install deps:**
   ```bash
   npm install @supabase/supabase-js @supabase/ssr zod
   npm install -D typescript @types/node @types/react @types/react-dom
   ```
4. **Copy files** into your repo (keep the same paths).
5. **Env vars** — add the values in `.env.admin.example` to `.env.local` and
   Vercel. `SUPABASE_SERVICE_ROLE_KEY` is server-only.
6. `npm run dev` → open `/admin/login`.

## What works today
- Login + role-gated access (super_admin / admin / editor; trainer/client/
  participant reserved).
- Dashboard with live widgets.
- **Courses** — full create / edit / preview / soft-delete (reference module).
- **Attendance & Assessment** — pick a schedule, mark attendance, record results.
- **Public certificate verification** at `/verify` (no login; safe fields only).
- **Audit log**, **global search**, responsive layout (desktop/tablet/mobile).

## Making the public site dynamic (no redesign)
Import from `lib/public-content.ts` in a server component and map over the
result exactly like the current hard-coded arrays — e.g. replace the
`programmes` array in `app/page.js` with `await getPublishedCourses()`.

See `DELIVERABLE.md` §8 for the module-by-module completion guide.

## Security notes
- Every table has RLS **enabled and forced**. Public reads see only published,
  non-deleted rows; writes require ≥ editor; deletes require ≥ admin.
- The service-role key bypasses RLS and is used only in trusted server code.
- The audit log is append-only (no update/delete policies exist).
