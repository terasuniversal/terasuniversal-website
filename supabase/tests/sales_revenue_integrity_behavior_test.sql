-- Fixture-driven behavior suite for a disposable database.
-- Run only after the baseline migrations plus
-- 20260907034620_sales_revenue_integrity_hardening.sql.
-- The actor must be an existing admin profile in the disposable Auth fixture.
-- Every row created here is rolled back at the end of the test.

\if :{?actor_id}
\else
  \quit 3
\endif

BEGIN;
SELECT plan(30);
SELECT set_config('request.jwt.claims', json_build_object('sub', :'actor_id')::text, true);

-- Deterministic disposable fixtures: no production rows are read or reused.
INSERT INTO public.sales_lead_metadata (id, lead_source, source_id)
SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'enquiry',
       ('10000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid
FROM generate_series(101, 114) AS g(n);
INSERT INTO public.sales_lead_metadata (id, lead_source, source_id)
VALUES
  ('00000000-0000-0000-0000-000000000301', 'enquiry', '10000000-0000-0000-0000-000000000301'),
  ('00000000-0000-0000-0000-000000000302', 'enquiry', '10000000-0000-0000-0000-000000000302');

INSERT INTO public.sales_opportunities (id, lead_metadata_id, title, stage)
SELECT ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       'Disposable integrity fixture ' || n, 'qualified'
FROM generate_series(101, 114) AS g(n);

INSERT INTO public.sales_quotations (id, opportunity_id, quotation_no, revision_no, status, total)
SELECT ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       'DBTEST-' || n, 0, 'sent', 100
FROM generate_series(101, 114) AS g(n);

-- A second sent quotation targets the same Opportunity for duplicate acceptance.
INSERT INTO public.sales_quotations (id, opportunity_id, quotation_no, revision_no, status, total)
VALUES ('30000000-0000-0000-0000-000000000201', '20000000-0000-0000-0000-000000000101', 'DBTEST-201', 0, 'sent', 125);

-- Course, schedule and participant fixtures for source-link and registration checks.
INSERT INTO public.courses (id, title, slug)
VALUES ('40000000-0000-0000-0000-000000000001', 'Disposable Integrity Course', 'db-integrity-fixture');
INSERT INTO public.participants (id, full_name)
VALUES ('50000000-0000-0000-0000-000000000001', 'Disposable Integrity Participant');
INSERT INTO public.course_schedules (id, course_id, start_date, end_date, capacity, status, source_opportunity_id)
VALUES ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', current_date, current_date, 10, 'open', '20000000-0000-0000-0000-000000000110');
INSERT INTO public.course_schedules (id, course_id, start_date, end_date, capacity, status, source_quotation_id)
VALUES ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', current_date, current_date, 10, 'open', '30000000-0000-0000-0000-000000000111');
INSERT INTO public.course_schedules (id, course_id, start_date, end_date, capacity, status, source_opportunity_id)
VALUES ('60000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', current_date, current_date, 10, 'open', '20000000-0000-0000-0000-000000000112');
INSERT INTO public.schedule_participants (id, schedule_id, participant_id, registration_status)
VALUES ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000001', 'registered');

-- Create accepted/Won fixtures through the governed RPC.
SELECT public.accept_quotation(('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid)
FROM generate_series(101, 112) AS g(n);

-- Invoice dependency for Opportunity 103.
INSERT INTO public.invoices (id, quotation_id, opportunity_id, billing_name, status, grand_total, balance_due)
VALUES ('80000000-0000-0000-0000-000000000103', '30000000-0000-0000-0000-000000000103', '20000000-0000-0000-0000-000000000103', 'Disposable Invoice', 'issued', 100, 100);

-- Payment dependency fixtures: 104..109 map to the six status policies.
INSERT INTO public.invoices (id, quotation_id, opportunity_id, billing_name, status, grand_total, balance_due)
SELECT ('80000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('30000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('20000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       'Disposable Payment Invoice ' || n,
       CASE WHEN n IN (104, 105) THEN 'issued' ELSE 'cancelled' END,
       100, 100
FROM generate_series(104, 109) AS g(n);
INSERT INTO public.invoice_payments (id, invoice_id, payment_provider, amount, status)
SELECT ('90000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       ('80000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,
       'other', 10,
       CASE n WHEN 104 THEN 'pending' WHEN 105 THEN 'successful' WHEN 106 THEN 'failed'
              WHEN 107 THEN 'cancelled' WHEN 108 THEN 'refunded' ELSE 'superseded' END
FROM generate_series(104, 109) AS g(n);

-- Authenticated-admin direct writes are rejected by RLS.
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO public.sales_quotations (id, opportunity_id, quotation_no, status) VALUES ('30000000-0000-0000-0000-000000000301', '20000000-0000-0000-0000-000000000101', 'DBTEST-301', 'accepted')$$, 'P0001', 'quotation_acceptance_requires_governed_rpc', 'direct INSERT accepted quotation is rejected');
SELECT throws_ok($$INSERT INTO public.sales_quotations (id, opportunity_id, quotation_no, status) VALUES ('30000000-0000-0000-0000-000000000302', '20000000-0000-0000-0000-000000000101', 'DBTEST-302', 'cancelled')$$, 'P0001', 'quotation_cancellation_requires_governed_rpc', 'direct INSERT cancelled quotation is rejected');
SELECT throws_ok($$UPDATE public.sales_quotations SET status = 'accepted' WHERE id = '30000000-0000-0000-0000-000000000113'$$, 'P0001', 'quotation_acceptance_requires_governed_rpc', 'direct sent to accepted update is rejected');
SELECT throws_ok($$INSERT INTO public.sales_opportunities (id, lead_metadata_id, title, stage) VALUES ('20000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000301', 'Direct won', 'won')$$, 'P0001', 'opportunity_won_requires_governed_rpc', 'direct INSERT Won Opportunity is rejected');
SELECT throws_ok($$INSERT INTO public.sales_opportunities (id, lead_metadata_id, title, stage) VALUES ('20000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000302', 'Direct cancelled', 'cancelled')$$, 'P0001', 'opportunity_cancellation_requires_governed_rpc', 'direct INSERT cancelled Opportunity is rejected');
SELECT throws_ok($$UPDATE public.sales_opportunities SET stage = 'won' WHERE id = '20000000-0000-0000-0000-000000000114'$$, 'P0001', 'opportunity_won_requires_governed_rpc', 'direct update to Won is rejected');
SELECT throws_ok($$UPDATE public.sales_opportunities SET stage = 'cancelled' WHERE id = '20000000-0000-0000-0000-000000000114'$$, 'P0001', 'opportunity_cancellation_requires_governed_rpc', 'direct update to cancelled is rejected');

-- The governed happy path above made 101 Won and accepted 101. The second quote cannot win.
SELECT is((SELECT status FROM public.sales_quotations WHERE id = '30000000-0000-0000-0000-000000000101'), 'accepted', 'governed acceptance accepts the sent quotation');
SELECT is((SELECT stage FROM public.sales_opportunities WHERE id = '20000000-0000-0000-0000-000000000101'), 'won', 'governed acceptance wins the Opportunity');
SELECT throws_ok($$SELECT public.accept_quotation('30000000-0000-0000-0000-000000000201')$$, 'P0001', 'invalid_transition: opportunity is already resolved (current stage: won)', 'duplicate acceptance is rejected');
SELECT is((SELECT count(*)::int FROM public.sales_quotations WHERE opportunity_id = '20000000-0000-0000-0000-000000000101' AND status = 'accepted'), 1, 'exactly one accepted quotation remains');

RESET ROLE;
SELECT throws_ok($$UPDATE public.sales_quotations SET total = 999 WHERE id = '30000000-0000-0000-0000-000000000101'$$, 'P0001', 'accepted_quotation_immutable', 'accepted total is immutable');
SELECT throws_ok($$UPDATE public.sales_quotations SET opportunity_id = '20000000-0000-0000-0000-000000000102' WHERE id = '30000000-0000-0000-0000-000000000101'$$, 'P0001', 'accepted_quotation_immutable', 'accepted opportunity_id is immutable');
SELECT throws_ok($$UPDATE public.sales_quotations SET accepted_at = now() + interval '1 hour' WHERE id = '30000000-0000-0000-0000-000000000101'$$, 'P0001', 'accepted_quotation_immutable', 'accepted_at is immutable');
SELECT throws_ok($$UPDATE public.sales_quotations SET status = 'rejected' WHERE id = '30000000-0000-0000-0000-000000000101'$$, 'P0001', 'accepted_quotation_transition_requires_governed_rpc', 'accepted quotation cannot take arbitrary status');
SELECT throws_ok($$UPDATE public.sales_opportunities SET stage = 'qualified' WHERE id = '20000000-0000-0000-0000-000000000101'$$, 'P0001', 'won_opportunity_transition_requires_governed_rpc', 'Won Opportunity cannot be directly reopened');

-- Reversal without dependencies removes current revenue state but keeps history.
SELECT public.reverse_won_opportunity('20000000-0000-0000-0000-000000000102', 'disposable reversal');
SELECT is((SELECT stage FROM public.sales_opportunities WHERE id = '20000000-0000-0000-0000-000000000102'), 'cancelled', 'governed reversal cancels Opportunity');
SELECT is((SELECT status FROM public.sales_quotations WHERE id = '30000000-0000-0000-0000-000000000102'), 'cancelled', 'governed reversal cancels quotation');
SELECT is((SELECT count(*)::int FROM public.sales_activity WHERE opportunity_id = '20000000-0000-0000-0000-000000000102' AND type = 'opportunity_reversed'), 1, 'reversal activity remains historical');

SELECT throws_ok($$SELECT public.reverse_won_opportunity('20000000-0000-0000-0000-000000000103', 'invoice')$$, 'P0001', 'invoice_dependency_exists', 'active invoice blocks reversal');
SELECT throws_ok($$SELECT public.reverse_won_opportunity('20000000-0000-0000-0000-000000000104', 'pending')$$, 'P0001', 'payment_dependency_exists', 'pending payment blocks reversal');
SELECT throws_ok($$SELECT public.reverse_won_opportunity('20000000-0000-0000-0000-000000000105', 'successful')$$, 'P0001', 'payment_dependency_exists', 'successful payment blocks reversal');
SELECT public.reverse_won_opportunity('20000000-0000-0000-0000-000000000106', 'failed payment');
SELECT is((SELECT stage FROM public.sales_opportunities WHERE id = '20000000-0000-0000-0000-000000000106'), 'cancelled', 'failed payment does not block reversal');
SELECT public.reverse_won_opportunity('20000000-0000-0000-0000-000000000107', 'cancelled payment');
SELECT is((SELECT stage FROM public.sales_opportunities WHERE id = '20000000-0000-0000-0000-000000000107'), 'cancelled', 'cancelled payment does not block reversal');
SELECT public.reverse_won_opportunity('20000000-0000-0000-0000-000000000108', 'refunded payment');
SELECT is((SELECT stage FROM public.sales_opportunities WHERE id = '20000000-0000-0000-0000-000000000108'), 'cancelled', 'refunded payment does not block reversal');
SELECT public.reverse_won_opportunity('20000000-0000-0000-0000-000000000109', 'superseded payment');
SELECT is((SELECT stage FROM public.sales_opportunities WHERE id = '20000000-0000-0000-0000-000000000109'), 'cancelled', 'superseded payment does not block reversal');
SELECT throws_ok($$SELECT public.reverse_won_opportunity('20000000-0000-0000-0000-000000000110', 'handoff')$$, 'P0001', 'training_handoff_dependency_exists', 'source_opportunity_id handoff blocks reversal');
SELECT throws_ok($$SELECT public.reverse_won_opportunity('20000000-0000-0000-0000-000000000111', 'handoff')$$, 'P0001', 'training_handoff_dependency_exists', 'source_quotation_id handoff blocks reversal');
SELECT throws_ok($$SELECT public.reverse_won_opportunity('20000000-0000-0000-0000-000000000112', 'registration')$$, 'P0001', 'training_handoff_dependency_exists', 'active registration blocks reversal');

SELECT is((SELECT count(*)::int FROM public.sales_opportunities WHERE id = '20000000-0000-0000-0000-000000000102' AND stage = 'won'), 0, 'reversed Opportunity is excluded from current revenue state');
SELECT * FROM finish();
ROLLBACK;
