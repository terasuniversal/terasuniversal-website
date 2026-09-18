alter table public.sales_quotations
add column training_details jsonb
not null
default '{}'::jsonb;
