-- M-S5b companion (CRM release candidate): narrow invoice/payment summary for Quotation screens.
--
-- Owner decision 2026-11-21 (Option B): Quotation users must receive only the invoice and payment summaries needed
-- for the quotations they are authorized to see, never full finance rows. After M-S5b (20261122092000) only the
-- Invoices module can read invoices/invoice_payments/receipts directly; this function returns, for the requested
-- quotation ids only:
--   quotation_id, invoice_id (only for callers with Invoices view, otherwise null), invoice_no, status, grand_total, amount_paid, balance_due, invoice_date, due_date,
--   payment_states (array of {status, payment_provider} only - no amounts, references, URLs or payer details).
-- No billing name/address/email/phone, notes, payment references, receipts or invoice UUID lookup.
--
-- Authorization (inside the SECURITY DEFINER body, by auth.uid()):
--   * active staff at editor level or above, AND Quotations view or Invoices view (same as the quotation pages);
--   * the gate (Quotations or Invoices view) is a subset of sales_quotations_select's module set, so every caller
--     that passes it can already read those quotations; the precondition below fails closed if that policy ever
--     stops including both modules, so this function can never show more than the quotation pages may;
--   * input is quotation ids, never invoice ids, so invoice UUIDs cannot be enumerated; at most 200 ids per call.
-- Not authorized -> SQLSTATE 42501 'forbidden'. EXECUTE: authenticated only (revoked from public and anon).
-- Fail-closed: requires the M-S4 helper and a module-only quotation read policy; idempotent (create or replace); forward-only.
-- Rollback: drop function public.get_quotation_invoice_summaries(uuid[]).

do $ms5q$
begin
  if to_regprocedure('app.has_any_module_access(text[],text)') is null then
    raise exception 'ms5q: app.has_any_module_access (M-S4) is missing - nothing changed';
  end if;
  if not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = 'sales_quotations' and p.policyname = 'sales_quotations_select'
      and p.cmd = 'SELECT' and p.qual like '%has_min_role(''editor''%'
      and p.qual like '%''sales_quotations''%' and p.qual like '%''invoices''%'
      and p.qual not like '%auth.uid()%'
  ) then
    raise exception 'ms5q: sales_quotations_select is not the expected M-S4 definition - nothing changed';
  end if;
  -- Per-quotation equivalence: quotation visibility is module-based only (no row predicate), so the gate in the
  -- function is the effective authorization for every requested quotation. Refuse to install if another SELECT
  -- policy could widen it or a RESTRICTIVE policy could narrow it; a row-level quotation rule needs a revised function.
  if (select count(*) from pg_policies p
      where p.schemaname = 'public' and p.tablename = 'sales_quotations' and p.cmd in ('SELECT', 'ALL')) <> 1
     or exists (select 1 from pg_policies p
                where p.schemaname = 'public' and p.tablename = 'sales_quotations' and p.permissive = 'RESTRICTIVE') then
    raise exception 'ms5q: sales_quotations has an unexpected SELECT or RESTRICTIVE policy - nothing changed';
  end if;
end;
$ms5q$;

create or replace function public.get_quotation_invoice_summaries(p_quotation_ids uuid[])
returns table (
  quotation_id uuid,
  invoice_id uuid,
  invoice_no text,
  status text,
  grand_total numeric,
  amount_paid numeric,
  balance_due numeric,
  invoice_date date,
  due_date date,
  payment_states jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_can_open_invoice boolean;
begin
  if auth.uid() is null
     or not app.has_min_role('editor'::public.user_role)
     or not app.has_any_module_access(array['sales_quotations', 'invoices']::text[], 'view') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  -- The invoice UUID is only a link target; users who cannot open Invoices do not receive it.
  v_can_open_invoice := app.has_any_module_access(array['invoices']::text[], 'view');
  if p_quotation_ids is null or cardinality(p_quotation_ids) = 0 then
    return;
  end if;
  if cardinality(p_quotation_ids) > 200 then
    raise exception 'too_many_quotations' using errcode = '22023';
  end if;

  return query
  select i.quotation_id, case when v_can_open_invoice then i.id end, i.invoice_no, i.status, i.grand_total, i.amount_paid, i.balance_due, i.invoice_date, i.due_date,
         coalesce((
           select jsonb_agg(jsonb_build_object('status', p.status, 'payment_provider', p.payment_provider) order by p.created_at)
           from public.invoice_payments p
           where p.invoice_id = i.id
         ), '[]'::jsonb)
  from public.invoices i
  join public.sales_quotations q on q.id = i.quotation_id
  where i.quotation_id = any (p_quotation_ids);
end;
$fn$;

revoke all on function public.get_quotation_invoice_summaries(uuid[]) from public;
revoke all on function public.get_quotation_invoice_summaries(uuid[]) from anon;
grant execute on function public.get_quotation_invoice_summaries(uuid[]) to authenticated;

comment on function public.get_quotation_invoice_summaries(uuid[]) is
  'Quotation-screen invoice summary (Option B, M-S5b). Editor+ with Quotations or Invoices view; returns summary columns only for the given quotation ids (max 200).';
