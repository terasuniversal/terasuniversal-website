-- Marketing CRM Phase 1B-A -- marketing_contacts + marketing_contact_events
-- schema + RBAC catalog integration ONLY. Additive, idempotent,
-- non-destructive. NOT applied by this migration file's presence in the
-- repo -- see the accompanying Phase 1B-A report for apply status.
--
-- Explicitly NOT part of this migration (separate, later phases per the
-- approved Phase 1B breakdown):
--   Phase 1B-B: Contacts CRUD UI, consent capture, lifecycle quick-actions.
--   Phase 1B-C: widening sales_lead_metadata.lead_source's CHECK constraint
--     to accept 'marketing_contact' -- a Sales-domain change, isolated in
--     its own migration per CLAUDE.md's "one migration, one logical
--     change" rule and because it touches a live table with real
--     production rows.
--   Phase 1B-D: promoteMarketingContactToSales RPC + UI wiring (depends on
--     1B-C being live).
-- Nothing in this migration touches sales_lead_metadata, sales_activity,
-- marketing_campaigns' own schema, or the newsletter API route.
--
-- ---------------------------------------------------------------------
-- Design decisions locked across the Phase 1B architecture audit and its
-- two follow-up decision-resolution passes (see conversation history --
-- "TERAS MARKETING PHASE 1B -- ARCHITECTURE & SCHEMA READINESS REPORT" and
-- "TERAS MARKETING PHASE 1B -- FINAL SCHEMA DECISION REPORT"):
--
--   - full_name/email/phone all nullable -- three legitimate, distinct
--     entry paths exist (newsletter mirror: email only; event capture:
--     phone only; manual add: name+email), unlike enquiries/
--     proposal_requests which each have exactly one entry path and can
--     afford NOT NULL. A DB-level reachability CHECK (below) prevents a
--     genuinely unreachable contact regardless of entry path.
--   - company stays free text, not an FK to companies.id -- companies has
--     0 live rows in both staging and production (confirmed at decision
--     time), so a forced FK would make contact creation impossible today.
--     Matches proposal_requests.company_name / enquiries.company's own
--     free-text precedent.
--   - source_campaign_id is a single nullable FK, not a first/last-touch
--     pair -- true multi-touch attribution is Phase 1C's job; a second
--     campaign touching the same contact later is logged via a
--     'campaign_linked' event instead of a second column.
--   - acquisition_channel is deliberately NOT added here -- deferred to
--     Phase 1C in full (redundant with source_campaign_id -> campaign.
--     channel when present; unpopulatable accurately when absent, since no
--     UTM capture exists anywhere yet).
--   - consent_status/consent_source/consented_at/unsubscribed_at: only
--     consent_status is NOT NULL (default 'not_set'); the three companion
--     fields are nullable and their consistency (e.g. opted_in should
--     usually carry a consented_at) is enforced by the future Server
--     Action layer, not a DB CHECK -- legitimate historical-import edge
--     cases exist (a known-opted-in contact with an unknown exact consent
--     date) that a rigid CHECK would wrongly reject.
--   - promoted_at is a real, approved addition beyond the original field
--     list -- updated_at drifts on any later edit (e.g. a phone-number
--     correction after promotion), so it can't answer "when was this
--     promoted" reliably for reporting. No DB invariant requires it be set
--     whenever status='promoted' -- same historical-import reasoning as
--     consent timestamps; the RPC (Phase 1B-D) always sets it in the
--     normal path, but nothing here blocks a legitimate backfill that
--     doesn't know the exact original moment.
--   - the promotion invariant (status='promoted' implies
--     promoted_lead_metadata_id is set) DOES get a DB CHECK, unlike the
--     consent timestamps -- this relationship has no legitimate exception
--     (a promoted contact with no target lead is always wrong), so it's
--     the same class of guarantee as marketing_campaigns' own
--     end_date>=start_date structural CHECK, not a "should usually hold"
--     rule like consent's.
--   - lifecycle CHECK lists the 5 locked values only
--     (new/nurturing/sales_ready/promoted/archived) with NO transition
--     matrix encoded in SQL -- unlike Campaign's strict single-step
--     lifecycle, Contact status is a readiness *assessment* that can
--     legitimately skip stages (an event-captured contact can go straight
--     new->sales_ready) or move backward (sales_ready->nurturing on
--     reassessment), so transitions belong in the future Server Action
--     layer (Phase 1B-B), not a DB CHECK.
--   - owner_id is nullable, matching sales_lead_metadata.assigned_to and
--     marketing_campaigns.owner_id's own live nullability exactly -- a
--     contact can exist before anyone claims it.
--   - next_follow_up_at (timestamptz, nullable) is included here instead
--     of a separate Marketing Tasks table -- mirrors
--     sales_lead_metadata.follow_up_at's exact type/shape. After
--     promotion, Sales' own follow_up_at becomes authoritative; this field
--     simply stops being surfaced by the future UI post-promotion. No
--     cross-table sync, no DB-level lock -- a UI/Server-Action concern for
--     a later phase, not a schema one.
--
-- FK delete behaviour: source_campaign_id/owner_id/created_by/updated_by/
-- promoted_lead_metadata_id all use bare `references` (default NO ACTION),
-- matching marketing_campaigns.course_id/owner_id's own established
-- convention on this exact table family -- no CASCADE on any
-- master/process reference. contact_id on marketing_contact_events is the
-- one CASCADE in this migration, matching sales_activity.lead_metadata_id's
-- identical on delete cascade (an event row has no meaning without its
-- parent contact).
--
-- Trigger strategy (Section 20 of the Phase 1B-A brief): marketing_campaigns
-- deliberately attached NO audit/stamp/updated_at triggers, relying on the
-- Server Action layer to set updated_by explicitly -- but a live check this
-- session found marketing_campaigns' own updateCampaign action never sets
-- updated_at explicitly either, meaning Campaign rows' updated_at silently
-- never changes on edit today (a real, if minor, gap -- not fixed here,
-- out of this migration's scope, flagged in the accompanying report).
-- sales_tasks -- the closer precedent by mutation-frequency/shape (status,
-- assignment, and follow-up-adjacent fields mutated routinely, same as
-- Contacts will be) -- uses the full standard three-trigger set
-- (app.audit_trigger + app.stamp_actor + app.set_updated_at), per that
-- migration's own comment: "same three functions and naming convention as
-- companies/course_schedules/schedule_participants". Given Contacts' higher
-- expected mutation frequency than Campaign and the directly-observed gap
-- in Campaign's own explicit-stamp approach, marketing_contacts attaches
-- the full standard three-trigger set here, matching sales_tasks/companies/
-- trainers/participants -- NOT marketing_campaigns' minimal approach.
-- app.stamp_actor() sets created_by (on INSERT, if null) and updated_by
-- (on INSERT and UPDATE) from auth.uid() automatically -- a later Server
-- Action does not need to pass created_by/updated_by in its payload at all.
-- marketing_contact_events gets NEITHER trigger: it has no updated_at
-- column (append-only, no updates ever occur), and audit_trigger() would
-- be redundant on a table that is itself already an audit/event trail --
-- matching sales_activity's own identical precedent (no audit_trigger,
-- no set_updated_at, append-only).
--
-- Idempotent: safe to re-run. NOT applied to staging or production by this
-- file's presence -- see the Phase 1B-A report for explicit apply status.

-- ---------------------------------------------------------------------
-- Contact numbering -- same generator pattern as
-- app.next_opportunity_number / app.next_campaign_number: dedicated
-- sequence + SECURITY DEFINER SQL function wired as the column DEFAULT, so
-- numbering is generated inside the INSERT itself (concurrency-safe, no
-- app-layer "read max, add one"). MCT- (not MC-, which is already live and
-- consumed by marketing_campaigns) -- confirmed no live migration uses
-- this prefix (checked against OPP-/QT-/MC-/TRS-P- before locking it).
-- ---------------------------------------------------------------------

create sequence if not exists app.marketing_contact_seq;

create or replace function app.next_marketing_contact_number()
returns text
language sql
security definer
set search_path to 'app'
as $function$
  select 'MCT-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.marketing_contact_seq')::text, 4, '0');
$function$;

-- ---------------------------------------------------------------------
-- public.marketing_contacts
-- ---------------------------------------------------------------------

create table if not exists public.marketing_contacts (
  id uuid primary key default gen_random_uuid(),
  contact_number text not null unique default app.next_marketing_contact_number(),
  full_name text,
  email text,
  phone text,
  company text,
  status text not null default 'new' check (status in (
    'new', 'nurturing', 'sales_ready', 'promoted', 'archived'
  )),
  source text not null check (source in (
    'manual', 'newsletter', 'event', 'referral', 'import', 'website', 'other'
  )),
  source_campaign_id uuid references public.marketing_campaigns(id),
  consent_status text not null default 'not_set' check (consent_status in (
    'not_set', 'opted_in', 'opted_out'
  )),
  consent_source text,
  consented_at timestamptz,
  unsubscribed_at timestamptz,
  owner_id uuid references public.profiles(id),
  promoted_lead_metadata_id uuid references public.sales_lead_metadata(id),
  promoted_at timestamptz,
  next_follow_up_at timestamptz,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Reachability: an unreachable "marketing" contact is a contradiction in
  -- terms. Trimmed-length check so email='' / phone='' (blank, not null)
  -- cannot satisfy this on a technicality -- same class of structural
  -- invariant as marketing_campaigns' own end_date>=start_date CHECK.
  check (
    (email is not null and char_length(trim(email)) > 0)
    or (phone is not null and char_length(trim(phone)) > 0)
  ),
  -- Promotion invariant: status='promoted' with no target lead is always
  -- wrong, no legitimate exception -- unlike the consent timestamps above,
  -- which do have legitimate historical-import exceptions and are
  -- therefore left to the Server Action layer instead.
  check (status <> 'promoted' or promoted_lead_metadata_id is not null)
);

comment on table public.marketing_contacts is
  'Marketing CRM Phase 1B-A -- pre-sales nurture contact. Upstream of and independent from sales_lead_metadata/enquiries/proposal_requests -- promotion (Phase 1B-D) creates a NEW sales_lead_metadata row via RPC, it does not repurpose this one.';

create index if not exists marketing_contacts_status_idx on public.marketing_contacts (status);
create index if not exists marketing_contacts_source_idx on public.marketing_contacts (source);
create index if not exists marketing_contacts_owner_id_idx on public.marketing_contacts (owner_id);
create index if not exists marketing_contacts_source_campaign_id_idx on public.marketing_contacts (source_campaign_id);
create index if not exists marketing_contacts_next_follow_up_at_idx on public.marketing_contacts (next_follow_up_at);
create index if not exists marketing_contacts_created_at_idx on public.marketing_contacts (created_at desc);
-- Plain (not lower(email)) index: the established live precedent
-- (submit_public_enquiry / submit_proposal_request) normalizes email to
-- lower(trim(...)) AT WRITE TIME, so a plain equality index on the
-- already-normalized column is sufficient -- no expression index needed,
-- matching the one precedent found rather than inventing a new pattern.
-- No phone index: no phone-normalization helper exists anywhere in this
-- codebase (confirmed before this decision), phone dedup is explicitly
-- secondary/lower-priority, and an ad hoc digit-stripped comparison
-- wouldn't benefit from a plain index anyway -- avoided per the brief's
-- own caution against speculative expression indexes.
create index if not exists marketing_contacts_email_idx on public.marketing_contacts (email);

alter table public.marketing_contacts enable row level security;

-- Role floor is editor for select/insert/update, matching
-- marketing_campaigns' now-proven-correct pattern exactly (not the
-- Sales admin-gated-write model) -- Marketing Contacts is a routine,
-- same-department operation with no evidence anywhere requiring a
-- stricter floor.
drop policy if exists marketing_contacts_select on public.marketing_contacts;
create policy marketing_contacts_select on public.marketing_contacts
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

drop policy if exists marketing_contacts_insert on public.marketing_contacts;
create policy marketing_contacts_insert on public.marketing_contacts
  for insert to authenticated
  with check (app.has_min_role('editor'::public.user_role));

drop policy if exists marketing_contacts_update on public.marketing_contacts;
create policy marketing_contacts_update on public.marketing_contacts
  for update to authenticated
  using (app.has_min_role('editor'::public.user_role))
  with check (app.has_min_role('editor'::public.user_role));

-- No delete policy -- archive via status='archived', never hard-delete.
-- Matches marketing_campaigns' identical "No DELETE" precedent.

-- Explicit grants IN THIS migration, not a follow-up fix -- this project
-- has two competing pg_default_acl entries for new public-schema tables
-- (one set by supabase_admin granting anon/authenticated broadly, one set
-- by postgres granting only postgres/service_role); which applies depends
-- on which role's session actually runs CREATE TABLE. marketing_campaigns
-- was created under the narrower default and needed a separate follow-up
-- GRANT migration to fix a live authenticated-privilege gap -- this
-- migration states the intended privilege explicitly up front instead of
-- repeating that discovery.
grant select, insert, update on public.marketing_contacts to authenticated;
revoke all on public.marketing_contacts from anon;
revoke delete, truncate, references, trigger on public.marketing_contacts from authenticated;

drop trigger if exists trg_marketing_contacts_audit on public.marketing_contacts;
create trigger trg_marketing_contacts_audit after insert or update or delete on public.marketing_contacts
  for each row execute function app.audit_trigger();

drop trigger if exists trg_marketing_contacts_stamp on public.marketing_contacts;
create trigger trg_marketing_contacts_stamp before insert or update on public.marketing_contacts
  for each row execute function app.stamp_actor();

drop trigger if exists trg_marketing_contacts_updated_at on public.marketing_contacts;
create trigger trg_marketing_contacts_updated_at before update on public.marketing_contacts
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------
-- public.marketing_contact_events -- append-only nurture timeline.
-- Matches sales_activity's exact shape: a few nullable typed FK columns
-- for the event types that need one, not a generic jsonb metadata blob.
-- ---------------------------------------------------------------------

create table if not exists public.marketing_contact_events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.marketing_contacts(id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'status_changed', 'note_added', 'campaign_linked',
    'consent_changed', 'unsubscribed', 'promoted_to_sales'
  )),
  -- 3000-char cap matches sales_activity.note's own established limit --
  -- reused, not invented.
  note text check (note is null or char_length(note) <= 3000),
  -- Populated only for campaign_linked events.
  campaign_id uuid references public.marketing_campaigns(id),
  -- Populated only for promoted_to_sales events -- redundant with
  -- marketing_contacts.promoted_lead_metadata_id by design, matching
  -- sales_activity's own redundant-FK-on-activity-row pattern (it carries
  -- lead_metadata_id AND opportunity_id AND quotation_id simultaneously)
  -- so the timeline is queryable without a join back to the parent row.
  lead_metadata_id uuid references public.sales_lead_metadata(id),
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  -- Structural, always-true invariants -- never forces an unrelated event
  -- row (created/status_changed/note_added/consent_changed/unsubscribed)
  -- to populate either FK; the OR short-circuits true for every event_type
  -- other than the one each check names.
  check (event_type <> 'campaign_linked' or campaign_id is not null),
  check (event_type <> 'promoted_to_sales' or lead_metadata_id is not null)
);

comment on table public.marketing_contact_events is
  'Marketing CRM Phase 1B-A -- append-only nurture timeline for marketing_contacts, same architecture as public.sales_activity. No UPDATE/DELETE policy for anyone.';

-- Single composite index, matching sales_activity's own single index
-- exactly (lead_metadata_id, created_at desc) -- no separate event_type
-- index: sales_activity, the closest live precedent, has no such index
-- either, and no concrete query pattern justifying one was identified.
create index if not exists marketing_contact_events_contact_id_idx on public.marketing_contact_events (contact_id, created_at desc);

alter table public.marketing_contact_events enable row level security;

drop policy if exists marketing_contact_events_select on public.marketing_contact_events;
create policy marketing_contact_events_select on public.marketing_contact_events
  for select to authenticated
  using (app.has_min_role('editor'::public.user_role));

drop policy if exists marketing_contact_events_insert on public.marketing_contact_events;
create policy marketing_contact_events_insert on public.marketing_contact_events
  for insert to authenticated
  with check (app.has_min_role('editor'::public.user_role));

-- Append-only: no update/delete policy for anyone, matching sales_activity.

grant select, insert on public.marketing_contact_events to authenticated;
revoke all on public.marketing_contact_events from anon;
revoke update, delete, truncate, references, trigger on public.marketing_contact_events from authenticated;

-- No triggers on marketing_contact_events -- see header rationale (no
-- updated_at column exists; audit_trigger would be redundant on an
-- already-append-only audit trail, matching sales_activity's own lack of
-- either trigger).

-- ---------------------------------------------------------------------
-- RBAC catalog integration -- Phase 1B-A only. marketing_reports is
-- deliberately NOT added yet, matching this project's own module-catalog
-- seeding precedent of only introducing a key alongside the feature that
-- uses it.
-- ---------------------------------------------------------------------

insert into public.staff_module_catalog (module_key, label, group_key, min_role)
values ('marketing_contacts', 'Marketing Contacts', 'marketing', 'editor')
on conflict (module_key) do nothing;
