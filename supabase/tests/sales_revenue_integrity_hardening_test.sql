BEGIN;

SELECT plan(17);

SELECT has_index('public', 'sales_quotations', 'sales_quotations_one_accepted_per_opportunity_uidx', 'one canonical accepted quotation index exists');
SELECT has_trigger('public', 'sales_quotations', 'trg_guard_sales_quotation_revenue_mutation', 'accepted quotation guard trigger exists');
SELECT has_trigger('public', 'sales_opportunities', 'trg_guard_sales_opportunity_revenue_mutation', 'won opportunity guard trigger exists');

SELECT ok((SELECT (tgtype & 4) = 4 AND (tgtype & 16) = 16
  FROM pg_trigger
  WHERE tgname = 'trg_guard_sales_quotation_revenue_mutation'),
  'quotation guard covers INSERT and UPDATE');
SELECT ok((SELECT (tgtype & 4) = 4 AND (tgtype & 16) = 16
  FROM pg_trigger
  WHERE tgname = 'trg_guard_sales_opportunity_revenue_mutation'),
  'opportunity guard covers INSERT and UPDATE');
SELECT has_function('public', 'accept_quotation', ARRAY['uuid'::text], 'acceptance RPC exists');
SELECT has_function('public', 'reverse_won_opportunity', ARRAY['uuid'::text, 'text'::text], 'reversal RPC exists');

SELECT is((SELECT count(*)::int FROM (
  SELECT opportunity_id FROM public.sales_quotations
  WHERE status = 'accepted' GROUP BY opportunity_id HAVING count(*) > 1
) duplicates), 0, 'no opportunity currently has multiple accepted quotations');

SELECT is((SELECT count(*)::int FROM public.sales_quotations
  WHERE status = 'accepted' AND superseded_at IS NOT NULL), 0,
  'accepted quotations are not marked superseded');

SELECT is((SELECT count(*)::int FROM public.sales_opportunities o
  WHERE o.stage = 'won' AND NOT EXISTS (
    SELECT 1 FROM public.sales_quotations q
    WHERE q.opportunity_id = o.id AND q.status = 'accepted'
  )), 0, 'every Won Opportunity has an accepted quotation');

SELECT is((SELECT count(*)::int FROM public.sales_quotations q
  JOIN public.sales_opportunities o ON o.id = q.opportunity_id
  WHERE q.status = 'accepted' AND o.stage <> 'won'), 0,
  'every accepted quotation belongs to a Won Opportunity');

SELECT is((SELECT count(*)::int FROM pg_constraint
  WHERE conrelid = 'public.sales_quotations'::regclass
    AND conname = 'sales_quotations_status_check'), 1,
  'quotation cancellation status is constrained');

SELECT is((SELECT count(*)::int FROM pg_constraint
  WHERE conrelid = 'public.sales_opportunities'::regclass
    AND conname = 'sales_opportunities_stage_check'), 1,
  'opportunity cancellation stage is constrained');

SELECT is((SELECT count(*)::int FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'accept_quotation'), 1,
  'only one acceptance RPC overload is present');

SELECT ok((SELECT pg_get_constraintdef(oid)::text LIKE ALL (ARRAY[
  '%lead_created%', '%status_changed%', '%assigned%', '%followup_scheduled%', '%note_added%',
  '%proposal_sent%', '%won%', '%lost%', '%opportunity_created%', '%quotation_created%',
  '%quotation_sent%', '%quotation_revised%', '%quotation_accepted%', '%quotation_rejected%',
  '%opportunity_won%', '%opportunity_lost%', '%training_handoff_created%', '%company_linked%',
  '%company_created%', '%task_created%', '%task_completed%', '%task_reopened%', '%task_cancelled%',
  '%registration_completed%', '%invoice_created%', '%invoice_issued%', '%invoice_partially_paid%',
  '%invoice_paid%', '%invoice_cancelled%', '%payment_recorded%', '%quotation_cancelled%',
  '%opportunity_reversed%'
  ]) FROM pg_constraint
  WHERE conrelid = 'public.sales_activity'::regclass
    AND conname = 'sales_activity_type_check'),
  'full legacy sales activity union plus the two reversal events is preserved');

SELECT ok(EXISTS (SELECT 1 FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'sales_quotations'
    AND policyname = 'sales_quotations_insert'
    AND with_check::text LIKE '%accepted%'
    AND with_check::text LIKE '%cancelled%'),
  'quotation INSERT policy excludes terminal states');

SELECT ok(EXISTS (SELECT 1 FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'sales_opportunities'
    AND policyname = 'sales_opportunities_update'
    AND qual::text LIKE '%won%'
    AND qual::text LIKE '%cancelled%'),
  'opportunity UPDATE policy excludes terminal states');

-- Required integration scenarios, to run in an isolated local DB with fixtures:
-- 1. Start two sessions and call accept_quotation() for two sent quotations
--    on one Opportunity; exactly one must commit and the other must fail after
--    waiting on the Opportunity row lock.
-- 2. Attempt direct updates of accepted total/opportunity_id/accepted_at and
--    status; each must fail with the immutable/governed-transition error.
-- 3. Create a sent -> superseded -> revision chain; the revision remains
--    accept-able and the superseded row remains historical.
-- 4. Accept, then call reverse_won_opportunity(); quotation and Opportunity
--    become cancelled and the ROI join yields zero revenue.
-- 5. Run Marketing performance cases with lost/archived/cancelled Opportunity
--    stages; none may be counted as sales-ready.
-- 6. Direct terminal writes, immutable-field writes, governed accept/reverse,
--    dependency blocks, and cancelled-terminal behavior are executable
--    integration scenarios in the isolated fixture harness. They require an
--    authenticated admin fixture and are intentionally not run here without
--    an isolated PostgreSQL database.
-- 7. Two-session procedure: Session A and Session B call accept_quotation()
--    for two sent quotations on one Opportunity. Session A must win the
--    Opportunity lock; Session B waits, then fails on stage='won'. A final
--    query must show exactly one accepted quotation.

SELECT * FROM finish();
ROLLBACK;
