-- LOCAL/DISPOSABLE TEST FIXTURE ONLY.
BEGIN;
INSERT INTO public.sales_lead_metadata (id, lead_source, source_id)
VALUES ('00000000-0000-0000-0000-000000000901', 'enquiry', '10000000-0000-0000-0000-000000000901');
INSERT INTO public.sales_opportunities (id, lead_metadata_id, title, stage)
VALUES ('20000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000901', 'Concurrency fixture', 'qualified');
INSERT INTO public.sales_quotations (id, opportunity_id, quotation_no, revision_no, status, total)
VALUES
  ('30000000-0000-0000-0000-000000000901', '20000000-0000-0000-0000-000000000901', 'DBTEST-CONC-A', 0, 'sent', 100),
  ('30000000-0000-0000-0000-000000000902', '20000000-0000-0000-0000-000000000901', 'DBTEST-CONC-B', 0, 'sent', 100);
COMMIT;
