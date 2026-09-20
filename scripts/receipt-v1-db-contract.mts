import { execFileSync, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

// Runs the Receipt migration against an isolated disposable PostgreSQL
// database with a minimal compatibility fixture for the verified baseline
// contracts. It never connects to Supabase/STAGING/Production.
const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
const container = `teras-receipt-v1-db-${process.pid}`;
const password = "receipt_v1_disposable_only";

if (process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.SUPABASE_URL) {
  throw new Error("Refusing database test: external database environment variables are set");
}

const migrationNames = [
  "20260919230000_receipts_v1.sql",
  "20260919233000_receipts_v1_staging_compatibility_repair.sql",
];

const runDocker = (args: string[], input?: string): string => execFileSync("docker", args, {
  cwd: new URL("..", import.meta.url),
  input,
  encoding: "utf8",
  stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
});

async function waitForPostgres(): Promise<void> {
  for (let attempt = 0; attempt < 45; attempt += 1) {
    try {
      runDocker(["exec", container, "pg_isready", "-U", "postgres"]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Disposable PostgreSQL did not become ready");
}

function psql(sql: string, role = "postgres"): string {
  try {
    return runDocker(["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", role, "-d", "postgres"], sql);
  } catch (error) {
    const details = error as { stdout?: string; stderr?: string };
    throw new Error(`${details.stdout ?? ""}${details.stderr ?? ""}`);
  }
}

async function concurrentPsql(sql: string): Promise<void> {
  await Promise.all([0, 1].map(() => new Promise<void>((resolve, reject) => {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr));
    });
    child.stdin.end(sql);
  })));
}

const authSetup = `
create extension if not exists pgcrypto;
create schema app;
create type user_role as enum ('super_admin', 'admin', 'editor', 'trainer', 'client', 'participant');
create type audit_action as enum ('login', 'logout', 'create', 'update', 'delete', 'archive', 'restore', 'publish', 'upload', 'export', 'assign');
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.profiles (id uuid primary key references auth.users(id), email text not null, full_name text, role user_role not null default 'editor', is_active boolean not null default true);
create table public.sales_lead_metadata (id uuid primary key, lead_source text not null, source_id uuid, status text not null);
create table public.sales_opportunities (id uuid primary key, lead_metadata_id uuid references public.sales_lead_metadata(id), title text not null, stage text not null default 'qualified');
create table public.sales_quotations (id uuid primary key, opportunity_id uuid not null references public.sales_opportunities(id), status text not null default 'accepted', currency text not null default 'MYR', total numeric(12,2) not null default 0);
create table public.invoices (id uuid primary key, invoice_no text not null unique, quotation_id uuid not null references public.sales_quotations(id), opportunity_id uuid not null references public.sales_opportunities(id), billing_name text not null, billing_company text, billing_registration_no text, billing_email text, currency text not null default 'MYR', grand_total numeric(12,2) not null, amount_paid numeric(12,2) not null default 0, balance_due numeric(12,2) not null default 0, status text not null default 'issued', issued_at timestamptz, notes text);
create table public.invoice_payments (id uuid primary key, invoice_id uuid not null references public.invoices(id), payment_provider text not null, payment_method text, amount numeric(12,2) not null, currency text not null default 'MYR', status text not null default 'successful', payment_source text, provider_transaction_id text, provider_reference text, payment_reference text, notes text, verified_amount numeric(12,2), verified_at timestamptz, paid_at timestamptz, created_at timestamptz not null default now(), created_by uuid references public.profiles(id));
create table public.audit_logs (id bigint generated always as identity primary key, actor_id uuid, actor_email text, action audit_action not null, entity_type text, entity_id text, summary text, metadata jsonb not null default '{}'::jsonb);
create table public.sales_activity (id uuid primary key default gen_random_uuid(), lead_metadata_id uuid not null references public.sales_lead_metadata(id), opportunity_id uuid, quotation_id uuid, type text not null, note text, actor_id uuid, created_at timestamptz not null default now(), constraint sales_activity_type_check check (type in ('lead_created', 'legacy_custom_event')));
create or replace function app.current_role() returns user_role language sql stable security definer set search_path = public as $$ select role from public.profiles where id = auth.uid() $$;
create or replace function app.is_active() returns boolean language sql stable security definer set search_path = public as $$ select coalesce((select is_active from public.profiles where id = auth.uid()), false) $$;
create or replace function app.has_min_role(min_role user_role) returns boolean language sql stable security definer set search_path = public as $$ select app.is_active() and array_position(enum_range(null::user_role), app.current_role()) <= array_position(enum_range(null::user_role), min_role) $$;
create or replace function app.is_admin() returns boolean language sql stable security definer set search_path = public as $$ select app.has_min_role('admin') $$;
create or replace function public.log_event_as_service(p_actor_id uuid, p_actor_email text, p_action audit_action, p_entity_type text, p_entity_id text, p_summary text, p_metadata jsonb) returns void language sql security definer set search_path = public as $$ insert into public.audit_logs(actor_id,actor_email,action,entity_type,entity_id,summary,metadata) values(p_actor_id,p_actor_email,p_action,p_entity_type,p_entity_id,p_summary,coalesce(p_metadata,'{}'::jsonb)) $$;
grant usage on schema public, app to anon, authenticated;
grant execute on function public.log_event_as_service(uuid,text,audit_action,text,text,text,jsonb) to service_role;
`;

const seedSql = `
set session authorization postgres;
insert into auth.users(id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@test.invalid'),
  ('00000000-0000-0000-0000-000000000002', 'editor@test.invalid');
insert into public.profiles(id, email, full_name, role, is_active) values
  ('00000000-0000-0000-0000-000000000001', 'admin@test.invalid', 'Test Admin', 'admin', true),
  ('00000000-0000-0000-0000-000000000002', 'editor@test.invalid', 'Test Editor', 'editor', true);
insert into public.sales_lead_metadata(id, lead_source, source_id, status)
values ('00000000-0000-0000-0000-000000000011', 'test', '00000000-0000-0000-0000-000000000011', 'new');
insert into public.sales_opportunities(id, lead_metadata_id, title, stage)
values ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000011', 'Receipt DB Test', 'qualified');
insert into public.sales_quotations(id, opportunity_id, status, currency, total)
values ('00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000021', 'accepted', 'MYR', 5000);
insert into public.invoices(id, invoice_no, quotation_id, opportunity_id, billing_name, currency, grand_total, amount_paid, balance_due, status, issued_at)
values ('00000000-0000-0000-0000-000000000041', 'INV-DB-0001', '00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000021', 'Receipt DB Customer', 'MYR', 6000, 0, 6000, 'issued', now());
insert into public.invoice_payments(id, invoice_id, payment_provider, payment_method, amount, currency, status, payment_reference, paid_at, created_by)
values ('00000000-0000-0000-0000-000000000051', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 'Bank Transfer', 2000, 'MYR', 'successful', 'DB-A', '2026-01-01T10:00:00Z', '00000000-0000-0000-0000-000000000001');
insert into public.invoice_payments(id, invoice_id, payment_provider, payment_method, amount, currency, status, payment_reference, paid_at, created_by)
values ('00000000-0000-0000-0000-000000000052', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 'Bank Transfer', 3000, 'MYR', 'successful', 'DB-B', '2026-01-02T10:00:00Z', '00000000-0000-0000-0000-000000000001');
insert into public.invoice_payments(id, invoice_id, payment_provider, payment_method, amount, currency, status, payment_reference, paid_at, created_by)
values ('00000000-0000-0000-0000-000000000054', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 'Bank Transfer', 100, 'MYR', 'successful', 'DB-CONCURRENT', '2026-01-05T10:00:00Z', '00000000-0000-0000-0000-000000000001');
`;

const behavioralSql = `
set session authorization postgres;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.sales_activity'::regclass and conname = 'sales_activity_type_check' and position('legacy_custom_event' in pg_get_constraintdef(oid)) > 0 and position('receipt_issued' in pg_get_constraintdef(oid)) > 0) then raise exception 'repair did not preserve current sales activity values'; end if;
  if has_function_privilege('anon', 'public.generate_receipt_for_payment(uuid)', 'execute') then raise exception 'anon can execute generation RPC'; end if;
  if not has_function_privilege('authenticated', 'public.generate_receipt_for_payment(uuid)', 'execute') then raise exception 'authenticated cannot execute generation RPC'; end if;
  if has_table_privilege('anon', 'public.receipts', 'select') or has_table_privilege('anon', 'public.receipts', 'insert') or has_table_privilege('anon', 'public.receipts', 'update') or has_table_privilege('anon', 'public.receipts', 'delete') then raise exception 'anon has Receipt table privilege'; end if;
  if not has_table_privilege('authenticated', 'public.receipts', 'select') or has_table_privilege('authenticated', 'public.receipts', 'insert') or has_table_privilege('authenticated', 'public.receipts', 'update') or has_table_privilege('authenticated', 'public.receipts', 'delete') then raise exception 'authenticated Receipt privileges are not SELECT only'; end if;
  if has_sequence_privilege('anon', 'app.sales_receipt_seq', 'usage') or has_sequence_privilege('authenticated', 'app.sales_receipt_seq', 'usage') then raise exception 'browser role can use Receipt sequence'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
select case when (select count(*) from public.receipts where invoice_payment_id = '00000000-0000-0000-0000-000000000054') = 1 then 1 else current_setting('receipt_assertion_failure')::int end;
select case when (select count(*) from public.audit_logs where entity_type = 'receipts' and entity_id = (select id::text from public.receipts where invoice_payment_id = '00000000-0000-0000-0000-000000000054')) = 1 then 1 else current_setting('receipt_assertion_failure')::int end;
select jsonb_object_field(public.generate_receipt_for_payment('00000000-0000-0000-0000-000000000052'), 'existing');
select amount_paid_after_snapshot, balance_after_snapshot from public.receipts where invoice_payment_id = '00000000-0000-0000-0000-000000000052';
select case when (select amount_paid_after_snapshot from public.receipts where invoice_payment_id = '00000000-0000-0000-0000-000000000052') = 5000 then 1 else current_setting('receipt_assertion_failure')::int end;
select case when (select count(*) from public.receipts where invoice_payment_id = '00000000-0000-0000-0000-000000000052') = 1 then 1 else current_setting('receipt_assertion_failure')::int end;
select case when (select count(*) from public.audit_logs where entity_type = 'receipts' and metadata->>'event' = 'receipt_issued') = 2 then 1 else current_setting('receipt_assertion_failure')::int end;
select case when (select count(*) from public.sales_activity where type = 'receipt_issued') = 2 then 1 else current_setting('receipt_assertion_failure')::int end;
select jsonb_object_field(public.generate_receipt_for_payment('00000000-0000-0000-0000-000000000051'), 'existing');
select case when (select amount_paid_after_snapshot from public.receipts where invoice_payment_id = '00000000-0000-0000-0000-000000000051') = 2000 then 1 else current_setting('receipt_assertion_failure')::int end;
select case when (select count(*) from public.receipts where invoice_payment_id = '00000000-0000-0000-0000-000000000051') = 1 then 1 else current_setting('receipt_assertion_failure')::int end;
select case when (select count(*) from public.audit_logs where entity_type = 'receipts' and metadata->>'event' = 'receipt_issued') = 3 then 1 else current_setting('receipt_assertion_failure')::int end;
-- A missing lead context is constructed only in this disposable database by
-- temporarily relaxing the legacy opportunity FK invariant.
alter table public.invoices drop constraint invoices_opportunity_id_fkey;
alter table public.invoices alter column opportunity_id drop not null;
update public.invoices set opportunity_id = null where id = '00000000-0000-0000-0000-000000000041';
insert into public.invoice_payments(id, invoice_id, payment_provider, payment_method, amount, currency, status, payment_reference, paid_at, created_by)
values ('00000000-0000-0000-0000-000000000056', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 'Bank Transfer', 1, 'MYR', 'successful', 'DB-NO-CRM', '2026-01-04T10:00:00Z', '00000000-0000-0000-0000-000000000001');
select case when (public.generate_receipt_for_payment('00000000-0000-0000-0000-000000000056')->>'existing') = 'false' then 1 else current_setting('receipt_assertion_failure')::int end;
select case when (select count(*) from public.sales_activity where type = 'receipt_issued') = 3 then 1 else current_setting('receipt_assertion_failure')::int end;
update public.invoices set opportunity_id = '00000000-0000-0000-0000-000000000021' where id = '00000000-0000-0000-0000-000000000041';
alter table public.invoices alter column opportunity_id set not null;
alter table public.invoices add constraint invoices_opportunity_id_fkey foreign key (opportunity_id) references public.sales_opportunities(id);
-- Defensive refund trigger: create a fresh payment/receipt, then transition.
update public.invoices set grand_total = 6000 where id = '00000000-0000-0000-0000-000000000041';
insert into public.invoice_payments(id, invoice_id, payment_provider, payment_method, amount, currency, status, payment_reference, paid_at, created_by)
values ('00000000-0000-0000-0000-000000000053', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 'Bank Transfer', 1, 'MYR', 'successful', 'DB-C', '2026-01-03T10:00:00Z', '00000000-0000-0000-0000-000000000001');
select public.generate_receipt_for_payment('00000000-0000-0000-0000-000000000053');
update public.invoice_payments set status = 'refunded' where id = '00000000-0000-0000-0000-000000000053';
select case when (select status from public.receipts where invoice_payment_id = '00000000-0000-0000-0000-000000000053') = 'refunded' and (select refunded_at is not null from public.receipts where invoice_payment_id = '00000000-0000-0000-0000-000000000053') then 1 else current_setting('receipt_assertion_failure')::int end;
-- Eligibility and controlled rejection matrix.
insert into public.invoice_payments(id, invoice_id, payment_provider, amount, currency, status, paid_at, payment_reference, created_by) values
  ('00000000-0000-0000-0000-000000000057', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 1, 'MYR', 'pending', now(), 'DB-PENDING', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000058', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 1, 'MYR', 'failed', now(), 'DB-FAILED', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000059', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 1, 'MYR', 'cancelled', now(), 'DB-CANCELLED', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000060', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 1, 'MYR', 'refunded', now(), 'DB-REFUNDED', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000061', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 1, 'MYR', 'superseded', now(), 'DB-SUPERSEDED', '00000000-0000-0000-0000-000000000001');
do $$ declare v_id uuid; v_error text; begin
  foreach v_id in array array['00000000-0000-0000-0000-000000000057'::uuid, '00000000-0000-0000-0000-000000000058'::uuid, '00000000-0000-0000-0000-000000000059'::uuid, '00000000-0000-0000-0000-000000000060'::uuid, '00000000-0000-0000-0000-000000000061'::uuid] loop
    begin perform public.generate_receipt_for_payment(v_id); raise exception 'eligible status unexpectedly accepted'; exception when others then v_error := sqlerrm; if v_error <> 'payment_not_successful' then raise; end if; end;
  end loop;
end $$;
insert into public.invoice_payments(id, invoice_id, payment_provider, amount, currency, status, paid_at, payment_source, payment_reference, created_by) values ('00000000-0000-0000-0000-000000000062', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 1, 'MYR', 'successful', now(), 'hrdf', 'DB-HRDF', '00000000-0000-0000-0000-000000000001');
do $$ begin perform public.generate_receipt_for_payment('00000000-0000-0000-0000-000000000062'); raise exception 'HRDF unexpectedly accepted'; exception when others then if sqlerrm <> 'hrdf_receipt_unavailable' then raise; end if; end $$;
insert into public.invoice_payments(id, invoice_id, payment_provider, amount, currency, status, paid_at, payment_reference, created_by) values ('00000000-0000-0000-0000-000000000063', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 1, 'USD', 'successful', now(), 'DB-USD', '00000000-0000-0000-0000-000000000001');
do $$ begin perform public.generate_receipt_for_payment('00000000-0000-0000-0000-000000000063'); raise exception 'currency mismatch unexpectedly accepted'; exception when others then if sqlerrm <> 'receipt_currency_mismatch' then raise; end if; end $$;
insert into public.invoice_payments(id, invoice_id, payment_provider, amount, currency, status, paid_at, payment_reference, created_by) values ('00000000-0000-0000-0000-000000000064', '00000000-0000-0000-0000-000000000041', 'toyyibpay', 1, 'MYR', 'successful', '2030-01-01T00:00:00Z', 'DB-MALFORMED', '00000000-0000-0000-0000-000000000001');
do $$ begin perform public.generate_receipt_for_payment('00000000-0000-0000-0000-000000000064'); raise exception 'malformed ToyyPay unexpectedly accepted'; exception when others then if sqlerrm <> 'toyyibpay_payment_not_verified' then raise; end if; end $$;
insert into public.invoice_payments(id, invoice_id, payment_provider, amount, verified_amount, currency, status, provider_transaction_id, verified_at, paid_at, payment_reference, created_by) values ('00000000-0000-0000-0000-000000000066', '00000000-0000-0000-0000-000000000041', 'toyyibpay', 100, 100, 'MYR', 'successful', 'DB-TOYYIB-OK', now(), now(), 'DB-TOYYIB-OK', '00000000-0000-0000-0000-000000000001');
select public.generate_receipt_for_payment('00000000-0000-0000-0000-000000000066');
do $$ begin
  if (select count(*) from public.receipts) <> (select count(*) from public.receipts) then raise exception 'unreachable'; end if;
end $$;
-- Mandatory audit failure must roll back the Receipt insert.
insert into public.invoice_payments(id, invoice_id, payment_provider, amount, currency, status, paid_at, payment_reference, created_by)
values ('00000000-0000-0000-0000-000000000065', '00000000-0000-0000-0000-000000000041', 'bank_transfer', 1, 'MYR', 'successful', now(), 'DB-AUDIT-FAIL', '00000000-0000-0000-0000-000000000001');
select count(*) as receipts_before_audit_failure from public.receipts;
drop function public.log_event_as_service(uuid,text,audit_action,text,text,text,jsonb);
do $$ begin
  perform public.generate_receipt_for_payment('00000000-0000-0000-0000-000000000065');
  raise exception 'audit failure did not abort Receipt generation';
exception when others then null;
end $$;
select case when (select count(*) from public.receipts where invoice_payment_id = '00000000-0000-0000-0000-000000000065') = 0 then 1 else current_setting('receipt_assertion_failure')::int end;
-- Restrictive foreign keys prevent deletion of financial history.
do $$ begin delete from public.invoice_payments where id = '00000000-0000-0000-0000-000000000053'; raise exception 'payment delete unexpectedly succeeded'; exception when foreign_key_violation then null; end $$;
do $$ begin delete from public.invoices where id = '00000000-0000-0000-0000-000000000041'; raise exception 'invoice delete unexpectedly succeeded'; exception when foreign_key_violation then null; end $$;
-- Direct privilege/RLS checks as an editor.
set session authorization anon;
do $$ begin perform count(*) from public.receipts; raise exception 'anonymous Receipt select unexpectedly succeeded'; exception when insufficient_privilege then null; end $$;
set session authorization postgres;
set session authorization authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select case when (select count(*) from public.receipts) >= 1 then 1 else current_setting('receipt_assertion_failure')::int end;
do $$ begin insert into public.receipts(invoice_id, invoice_payment_id, receipt_date, currency, amount_received, invoice_number_snapshot, invoice_grand_total_snapshot, amount_paid_after_snapshot, balance_after_snapshot) values ('00000000-0000-0000-0000-000000000041', '00000000-0000-0000-0000-000000000065', now(), 'MYR', 1, 'X', 6000, 1, 5999); raise exception 'direct Receipt insert unexpectedly succeeded'; exception when insufficient_privilege then null; end $$;
do $$ begin update public.receipts set notes = 'tamper' where invoice_payment_id = '00000000-0000-0000-0000-000000000053'; raise exception 'direct Receipt update unexpectedly succeeded'; exception when insufficient_privilege then null; end $$;
do $$ begin delete from public.receipts where invoice_payment_id = '00000000-0000-0000-0000-000000000053'; raise exception 'direct Receipt delete unexpectedly succeeded'; exception when insufficient_privilege then null; end $$;
-- Direct generation remains rejected for editor even though RPC EXECUTE is granted.
do $$
begin
  perform public.generate_receipt_for_payment('00000000-0000-0000-0000-000000000053');
  raise exception 'editor unexpectedly generated receipt';
exception when others then
  if sqlerrm <> 'not_authorized' then raise; end if;
end $$;
do $$
begin
  perform app.next_receipt_number();
  raise exception 'authenticated role unexpectedly consumed receipt number';
exception when insufficient_privilege then null;
end $$;
`;

async function main(): Promise<void> {
  runDocker(["rm", "-f", container]);
  runDocker(["run", "-d", "--name", container, "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=postgres", "postgres:17"]);
  try {
    await waitForPostgres();
    psql(authSetup);
    for (const name of migrationNames) {
      if (name === "20260814090000_create_proposal_requests_and_submit_rpc.sql") {
        psql("alter table public.proposal_requests add column if not exists email_sent boolean not null default false; alter table public.proposal_requests add column if not exists sheets_synced boolean not null default false;");
      }
      const sql = await readFile(new URL(name, migrationsDir), "utf8");
      psql(sql);
    }
    // Simulate an event type introduced by a live migration after Receipt V1
    // was applied; the repair must preserve it while adding its required set.
    psql("alter table public.sales_activity drop constraint sales_activity_type_check; alter table public.sales_activity add constraint sales_activity_type_check check (type in ('lead_created', 'legacy_custom_event', 'receipt_issued'));");
    psql(seedSql);
    await concurrentPsql("set request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001'; select public.generate_receipt_for_payment('00000000-0000-0000-0000-000000000054');");
    psql(behavioralSql);
    console.log("Receipt V1 DB contract: PASS");
  } finally {
    runDocker(["rm", "-f", container]);
  }
}

main().catch((error) => {
  console.error(`Receipt V1 DB contract: FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
