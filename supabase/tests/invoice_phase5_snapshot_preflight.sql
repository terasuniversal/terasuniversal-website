-- Read-only preflight for Invoice Phase 5 staging validation.
-- Run after the migration is applied in an isolated staging environment.

-- The migration must add the invoice-level provenance/customer/address fields.
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'invoices'
  and column_name in (
    'quotation_no', 'customer_company_name', 'customer_contact_name',
    'customer_registration_no', 'customer_email', 'customer_phone',
    'training_service_address'
  )
order by column_name;

-- The migration must add the item-level course/HRDF/package snapshots.
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'invoice_items'
  and column_name in (
    'course_id', 'course_name_snapshot', 'hrdf_claim', 'package_includes_snapshot'
  )
order by column_name;

-- Duplicate guard remains DB-enforced for all quotations, while the RPC
-- separately rejects every status other than accepted.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.invoices'::regclass
  and conname = 'invoices_quotation_id_key';

select p.oid::regprocedure, p.prosecdef
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'create_invoice_from_quotation';
