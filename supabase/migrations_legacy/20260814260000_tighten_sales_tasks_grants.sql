-- Belt-and-suspenders, found immediately after creating sales_tasks: this
-- project's default privileges auto-grant new tables broad authenticated
-- access (delete/truncate/references/trigger) regardless of the explicit
-- `grant select, insert, update, delete` in 20260814250000. The app only
-- ever soft-deletes sales_tasks (deleteTask() sets deleted_at via UPDATE,
-- never a real DELETE), so tighten to match the exact pattern already used
-- for sales_opportunities (20260814150000): revoke
-- delete/truncate/references/trigger from authenticated. RLS's
-- sales_tasks_delete policy stays defined (a harmless, unreachable safety
-- net via this role) rather than being dropped, matching precedent.
--
-- Applied as a new follow-up migration, not a rewrite of the already-applied
-- 20260814250000 migration, per migration discipline.
--
-- Idempotent: safe to re-run.

revoke delete, truncate, references, trigger on public.sales_tasks from authenticated;
