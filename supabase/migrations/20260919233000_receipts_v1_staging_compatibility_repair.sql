-- TERAS Receipt V1 staging compatibility and privilege repair
-- Additive repair for the already-applied Receipt V1 migration.
-- DO NOT rewrite or rerun 20260919230000_receipts_v1.sql.

-- Preserve every event literal currently present in the live constraint, then
-- add the known historical values and Receipt V1's receipt_issued event.
do $$
declare
  v_definition text;
  v_current_values text[];
  v_required_values constant text[] := array[
    'lead_created', 'status_changed', 'assigned', 'followup_scheduled', 'note_added',
    'proposal_sent', 'won', 'lost', 'opportunity_created', 'quotation_created',
    'quotation_sent', 'quotation_revised', 'quotation_accepted', 'quotation_rejected',
    'opportunity_won', 'opportunity_lost', 'training_handoff_created', 'company_linked',
    'company_created', 'task_created', 'task_completed', 'task_reopened', 'task_cancelled',
    'registration_completed', 'invoice_created', 'invoice_issued', 'invoice_partially_paid',
    'invoice_paid', 'invoice_cancelled', 'payment_recorded', 'quotation_cancelled',
    'opportunity_reversed', 'qualification_changed', 'temperature_changed',
    'priority_changed', 'receipt_issued'
  ];
  v_values text[];
begin
  select pg_get_constraintdef(oid)
    into v_definition
  from pg_constraint
  where conrelid = 'public.sales_activity'::regclass
    and conname = 'sales_activity_type_check';

  if v_definition is null then
    raise exception 'sales_activity_type_check_missing';
  end if;

  -- PostgreSQL may emit the live CHECK with or without an explicit ::text
  -- cast depending on how the original constraint was created. Collect all
  -- quoted literals and exclude only the formatter's type-cast marker.
  select coalesce(array_agg(match[1] order by match[1]), array[]::text[])
    into v_current_values
  from regexp_matches(
    v_definition,
    chr(39) || '([^' || chr(39) || ']+)' || chr(39),
    'g'
  ) as match
  where match[1] <> 'text';

  select array_agg(value order by value)
    into v_values
  from (
    select distinct value
    from unnest(v_current_values || v_required_values) as values(value)
  ) as distinct_values;

  alter table public.sales_activity drop constraint sales_activity_type_check;
  execute format(
    'alter table public.sales_activity add constraint sales_activity_type_check check (type = any (%L::text[]))',
    v_values
  );
end;
$$;

-- Keep the controlled admin RPC reachable by authenticated callers while
-- explicitly removing browser-anonymous execution.
revoke all on function public.generate_receipt_for_payment(uuid) from public, anon;
grant execute on function public.generate_receipt_for_payment(uuid) to authenticated;

-- Receipts are readable by authenticated staff through RLS only. No browser
-- role receives write, truncate, trigger, reference, or sequence privileges.
revoke all on table public.receipts from public, anon, authenticated;
grant select on table public.receipts to authenticated;

revoke all on sequence app.sales_receipt_seq from public, anon, authenticated;

-- Keep the allocator helper unavailable to browser roles; this is repeated
-- defensively so the repair remains correct if default privileges drift.
revoke all on function app.next_receipt_number() from public, anon, authenticated;
