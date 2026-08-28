-- Marketing CRM Phase 1B-D -- Marketing Contact -> Sales Lead promotion.
-- The first editor-level Marketing -> Sales trust-boundary write.
--
-- Scope: ONE new RPC (public.promote_marketing_contact_to_sales) plus the
-- minimal Sales-side compatibility fix required for its output to actually
-- display/convert correctly (public.v_sales_lead_inbox's polymorphic CASE
-- logic, widened from a binary enquiry/proposal_request switch to a
-- 3-way switch including marketing_contact). No new tables, no new
-- indexes, no RLS redesign, no lead_source constraint change (already
-- widened in Phase 1B-C), no newsletter/Attribution work.
--
-- Ordering / dependency: this migration is timestamped to run AFTER
-- 20260817004000_sales_test_demo_classification.sql, which is
-- REQUIRED — see that file's header. This view's rebuild below now
-- selects m.is_test (at production's confirmed live position, between
-- won_at and created_at -- see the "is_test" note further down), and
-- that column only exists on every environment (staging included) once
-- that migration has run first. Do not reorder this dependency.
--
-- ---------------------------------------------------------------------
-- Part 1 -- v_sales_lead_inbox compatibility (mandatory STOP-gate audit
-- finding). Live-confirmed before writing this: the view's CASE
-- expressions were a binary `when 'enquiry' then X else Y` switch, so any
-- lead_source other than 'enquiry' fell through to the proposal_requests
-- branch regardless of its actual value -- for a 'marketing_contact' row
-- (no matching proposal_requests LEFT JOIN row), every resolved column
-- (contact_name/company/email/phone) would be NULL, making a promoted
-- contact display as a blank lead everywhere this view is read --
-- including inside app.convert_lead_to_opportunity itself, which sources
-- the new opportunity's contact fields entirely from this view's output
-- and needs NO separate change once this view is correct.
--
-- Fixed to a real 3-way `case lead_source when ... when ... when ...`
-- switch plus a third LEFT JOIN to marketing_contacts, matching the exact
-- join-condition pattern the original two branches already use.
-- `subject` has no marketing_contact equivalent (no programme/category
-- field exists on that table) and is left NULL for that branch rather
-- than fabricating one -- matches this project's "never fabricate a
-- value" convention.
--
-- is_test (added in this revision, column ORDER confirmed live, not
-- inferred): a prior revision of this migration assumed is_test must be
-- the view's trailing column, reasoning from Postgres's `create or
-- replace view` rule that existing columns can't be reordered -- so
-- whatever produced it must have appended it last. That inference was
-- WRONG. A direct ordinal-position query against production's
-- information_schema.columns for public.v_sales_lead_inbox (run via
-- Supabase MCP) confirmed the live column order is:
--   1 lead_metadata_id   6 follow_up_at   11 created_at    16 phone
--   2 lead_source        7 priority       12 updated_at    17 subject
--   3 source_id          8 lost_reason    13 contact_name
--   4 status              9 won_at        14 company
--   5 assigned_to        10 is_test       15 email
-- is_test sits at position 10, between won_at and created_at -- not
-- trailing. Because `create or replace view` can only reproduce an
-- existing view's columns in their EXACT current order (and append new
-- ones after the last one), no single `create or replace view` can
-- satisfy both environments at once: production requires is_test threaded
-- in at position 10 among columns that already exist there in that order,
-- while staging's current (pre-Phase-1B-D) view has no is_test at all and
-- its existing columns (created_at, updated_at, contact_name, ...) sit
-- one position earlier than production's -- inserting is_test in the
-- middle would count as reordering staging's existing columns, which
-- `create or replace view` also forbids.
--
-- Fix: use `drop view if exists` + `create view` instead of `create or
-- replace view`. Dropping first removes the "must match existing column
-- order" constraint entirely, so the same statement can define the one
-- canonical column order (matching production's confirmed live shape)
-- and apply cleanly regardless of which of the two starting shapes (or
-- no view at all, on a fresh environment) an environment currently has.
--
-- Dependency check before relying on plain `drop view` (no CASCADE): the
-- tracked migration history has no VIEW or MATERIALIZED VIEW built via
-- `... AS SELECT ... FROM v_sales_lead_inbox` (grepped every tracked
-- migration referencing it) -- every other reference
-- (app.convert_lead_to_opportunity in 20260814150000, and its later
-- revisions in 20260814165048 and 20260814270000) is a plain `select ...
-- into v_lead from public.v_sales_lead_inbox` inside a PL/pgSQL function
-- body, which is a runtime name lookup, not a catalog-level dependency --
-- it cannot block or be broken by DROP VIEW, and continues to work
-- unchanged after this migration since it uses `select *` and every
-- existing column name is preserved. This does not rule out an
-- undocumented dependency from the same untracked drift that added
-- is_test itself -- if there is any doubt, run
-- `select * from pg_depend where refobjid = 'public.v_sales_lead_inbox'::regclass`
-- (or the equivalent `\d+` dependency listing) against production before
-- applying. Because DROP VIEW removes existing grants (unlike CREATE OR
-- REPLACE VIEW, which preserves them), the grant statements below are no
-- longer just belt-and-suspenders redundancy -- they are now the ONLY
-- thing restoring public.v_sales_lead_inbox's access grants, and must not
-- be dropped from this file.
--
-- Grants (confirmed live on production via direct query, not inferred):
--   anon          -- no privileges at all
--   authenticated -- SELECT only
--   service_role  -- SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
--   postgres      -- SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
-- All four are granted/revoked explicitly below rather than left to
-- ambient behavior, for two independent reasons: (1) Supabase's
-- schema-level default privileges are known to auto-grant `anon` and
-- `authenticated` access to newly created `public` schema objects --
-- exactly why the original (pre-drop) migration already revoked from
-- anon and cut authenticated down to SELECT-only; that hazard applies
-- identically to a freshly `create view`d object post-DROP, so those two
-- lines are unconditionally still required. (2) `service_role` and
-- `postgres`'s full access were not re-verified here as guaranteed to
-- come back automatically after a DROP+CREATE (e.g. via default
-- privileges or via ownership if the migration runner role happens to be
-- `postgres`) -- rather than trust an unverified assumption about which
-- role runs this migration or what this project's default-privilege
-- configuration grants automatically (the same category of mistake as
-- the column-order assumption earlier in this file, which turned out
-- wrong), both are granted explicitly so the outcome does not depend on
-- either.
-- ---------------------------------------------------------------------

drop view if exists public.v_sales_lead_inbox;

create view public.v_sales_lead_inbox
with (security_invoker = true) as
select
  m.id as lead_metadata_id,
  m.lead_source,
  m.source_id,
  m.status,
  m.assigned_to,
  m.follow_up_at,
  m.priority,
  m.lost_reason,
  m.won_at,
  m.is_test,
  m.created_at,
  m.updated_at,
  case m.lead_source
    when 'enquiry' then e.name
    when 'proposal_request' then p.contact_person
    when 'marketing_contact' then coalesce(mc.full_name, mc.email, mc.phone)
  end as contact_name,
  case m.lead_source
    when 'enquiry' then e.company
    when 'proposal_request' then p.company_name
    when 'marketing_contact' then mc.company
  end as company,
  case m.lead_source
    when 'enquiry' then e.email
    when 'proposal_request' then p.email
    when 'marketing_contact' then mc.email
  end as email,
  case m.lead_source
    when 'enquiry' then e.phone
    when 'proposal_request' then p.phone
    when 'marketing_contact' then mc.phone
  end as phone,
  case m.lead_source
    when 'enquiry' then e.subject
    when 'proposal_request' then coalesce(p.programme, p.category)
    else null
  end as subject
from public.sales_lead_metadata m
left join public.enquiries e on m.lead_source = 'enquiry' and e.id = m.source_id
left join public.proposal_requests p on m.lead_source = 'proposal_request' and p.id = m.source_id
left join public.marketing_contacts mc on m.lead_source = 'marketing_contact' and mc.id = m.source_id;

revoke all on public.v_sales_lead_inbox from anon;
grant select on public.v_sales_lead_inbox to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.v_sales_lead_inbox from authenticated;
grant select, insert, update, delete, truncate, references, trigger on public.v_sales_lead_inbox to service_role;
grant select, insert, update, delete, truncate, references, trigger on public.v_sales_lead_inbox to postgres;

-- ---------------------------------------------------------------------
-- Part 2 -- promotion RPC.
--
-- Modeled directly on the live public.convert_lead_to_opportunity
-- precedent: SECURITY DEFINER, explicit search_path, role-gate as the
-- function's first statement, a single plpgsql body (one implicit
-- transaction -- any exception anywhere below rolls back every write
-- already made in this call, giving "all-or-nothing" for free with no
-- explicit BEGIN/COMMIT needed).
--
-- Role gate: app.has_min_role('editor') -- NOT app.is_admin() like
-- convert_lead_to_opportunity. That function gates admin+ because
-- progressing an existing Sales pipeline stage is a Sales-side decision;
-- this one gates editor+ because promoting a nurtured Marketing Contact
-- into a fresh 'new' lead is the START of the pipeline, the same risk
-- class as enquiries/proposal_requests auto-creating 'new' leads with no
-- admin gate at all (locked decision from the Phase 1B final schema
-- report). The RPC enforces this independently -- it does not trust the
-- calling Server Action's own requireRole guard alone.
--
-- Idempotency: two independent, redundant protections. (1) explicit
-- application-level check of marketing_contacts.promoted_lead_metadata_id
-- before ever attempting an insert -- if already set, the function
-- returns that same id immediately, no new row, no error. (2) the live
-- UNIQUE (lead_source, source_id) constraint on sales_lead_metadata
-- remains the hard DB-level backstop regardless of any application-level
-- race; the function also defensively re-checks for an existing
-- ('marketing_contact', p_contact_id) row before inserting and links it
-- rather than erroring, covering the narrow window of a prior partial
-- failure (e.g. the sales_lead_metadata insert committed in an earlier
-- call but a subsequent step in THAT call failed before the
-- marketing_contacts update, which the atomic transaction should already
-- prevent -- this is pure defense in depth, not a gap being patched).
--
-- Row locking: `for update` on the marketing_contacts row serializes
-- concurrent promotion attempts on the same contact against each other.
--
-- Does not expose direct authenticated INSERT on sales_lead_metadata --
-- that table's existing INSERT-less grant/RLS posture (Phase 1A audit,
-- unchanged since) is untouched; this function's SECURITY DEFINER
-- privilege is the only path in, exactly like submit_public_enquiry's
-- existing precedent for the same table.
-- ---------------------------------------------------------------------

create or replace function public.promote_marketing_contact_to_sales(p_contact_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_contact record;
  v_lead_id uuid;
  v_actor uuid;
begin
  if not app.has_min_role('editor'::public.user_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_actor := auth.uid();

  select id, status, promoted_lead_metadata_id, owner_id
  into v_contact
  from public.marketing_contacts
  where id = p_contact_id
  for update;

  if v_contact.id is null then
    raise exception 'contact_not_found' using errcode = 'P0001';
  end if;

  -- Idempotent short-circuit: already promoted, return the existing
  -- reference rather than erroring or creating a duplicate.
  if v_contact.promoted_lead_metadata_id is not null then
    return v_contact.promoted_lead_metadata_id;
  end if;

  if v_contact.status <> 'sales_ready' then
    raise exception 'not_sales_ready' using errcode = 'P0001';
  end if;

  -- Defensive re-check against the UNIQUE(lead_source, source_id)
  -- backstop -- see header comment.
  select id into v_lead_id
  from public.sales_lead_metadata
  where lead_source = 'marketing_contact' and source_id = p_contact_id;

  if v_lead_id is null then
    insert into public.sales_lead_metadata (lead_source, source_id, status, assigned_to)
    values ('marketing_contact', p_contact_id, 'new', v_contact.owner_id)
    returning id into v_lead_id;

    insert into public.sales_activity (lead_metadata_id, type, note)
    values (v_lead_id, 'lead_created', 'Lead captured from marketing_contact submission');
  end if;

  update public.marketing_contacts
  set status = 'promoted',
      promoted_lead_metadata_id = v_lead_id,
      promoted_at = now(),
      updated_by = v_actor
  where id = p_contact_id;

  insert into public.marketing_contact_events (contact_id, event_type, lead_metadata_id, actor_id)
  values (p_contact_id, 'promoted_to_sales', v_lead_id, v_actor);

  return v_lead_id;
end;
$function$;

-- authenticated may EXECUTE; the function's own role-gate is the real
-- authorization boundary, not this grant -- matches
-- convert_lead_to_opportunity's identical live posture (EXECUTE granted
-- to authenticated, forbidden enforced inside the function body). anon
-- explicitly cannot.
revoke all on function public.promote_marketing_contact_to_sales(uuid) from public;
grant execute on function public.promote_marketing_contact_to_sales(uuid) to authenticated;
revoke execute on function public.promote_marketing_contact_to_sales(uuid) from anon;
