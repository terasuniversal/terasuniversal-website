-- Reproduce the Production Supabase platform state that the migrations rely on (read-only evidence 2026-11-24):
-- default privileges of role postgres grant nothing to anon/authenticated, and PUBLIC has no default EXECUTE.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
