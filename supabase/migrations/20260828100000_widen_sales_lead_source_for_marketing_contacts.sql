-- Marketing CRM Phase 1B-C -- Sales lead_source compatibility widening
-- ONLY. Prepares (does not itself perform) the eventual promotion of a
-- Marketing Contact into a Sales Lead (Phase 1B-D's job -- no RPC, no
-- Marketing/Sales UI change, no data mutation happens in this migration).
--
-- Scope, verified live on both staging (pzgtyskhyhuxhzvyzzhe) and
-- production (iagzkrzeuawaxvacqprk) before writing this file:
--   - Both environments have the IDENTICAL live constraint today:
--     sales_lead_metadata_lead_source_check ::
--       CHECK ((lead_source = ANY (ARRAY['enquiry'::text, 'proposal_request'::text])))
--   - Every existing row on both environments uses only 'enquiry' or
--     'proposal_request' -- no unexpected third value exists anywhere to
--     be broken by narrowing the ARRAY literal's order or widening it.
--   - sales_lead_metadata.source_id and marketing_contacts.id are both
--     uuid -- structurally compatible for the future
--     ('marketing_contact', <marketing_contacts.id>) pair.
--   - UNIQUE (lead_source, source_id) -- sales_lead_metadata_lead_source_source_id_key
--     -- already generalizes to a third lead_source value with no
--     structural change needed; not touched here.
--
-- Why NO foreign key is added on source_id -> marketing_contacts(id): this
-- project's polymorphic-source design (source_id + a sibling lead_source
-- discriminator column) has NEVER had a real FK on source_id, for either
-- of the two existing values -- confirmed live: no FK constraint targets
-- source_id today, only the UNIQUE pair above. A real FK can only ever
-- point at one target table; source_id's target table depends on the
-- VALUE of lead_source, which a plain FK cannot express. Emulating this
-- with a per-value trigger would itself be a new trigger, explicitly out
-- of this migration's additive-constraint-only scope. This migration
-- preserves that exact precedent for the new third value rather than
-- inventing a new referential-integrity mechanism for it alone.
--
-- Safety: this migration is a single CHECK constraint DROP + re-ADD.
-- No UPDATE/DELETE/INSERT/TRUNCATE, no DROP TABLE/COLUMN, no type or
-- default change, no RLS/GRANT change, no RPC, no trigger change. Every
-- other column, index, policy, grant, trigger, and function on
-- sales_lead_metadata is left exactly as-is.
--
-- Idempotent: `drop constraint if exists` + unconditional re-`add
-- constraint` is safe to re-run (re-running simply drops and re-adds the
-- same definition again).
--
-- NOT applied to staging or production by this file's presence -- see the
-- accompanying Phase 1B-C preparation report for explicit apply status
-- (this task is prepare + verify only).

alter table public.sales_lead_metadata
  drop constraint if exists sales_lead_metadata_lead_source_check;

alter table public.sales_lead_metadata
  add constraint sales_lead_metadata_lead_source_check
  check (lead_source in ('enquiry', 'proposal_request', 'marketing_contact'));
