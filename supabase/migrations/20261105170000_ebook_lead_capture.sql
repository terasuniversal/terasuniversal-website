-- /ebook lead capture: Marketing Contact capture RPC, source/event values, event metadata.
--
-- STATUS: LOCAL ONLY. Written and tested against a disposable local PostgreSQL.
-- NOT applied to Staging or Production. Applying it anywhere else needs separate
-- Owner approval (launch plan gates G2 to G4).
--
-- What this adds (and nothing else):
--   1. marketing_contacts.source accepts 'free_ebook'; marketing_contact_events.event_type
--      accepts 'ebook_requested', 'ebook_downloaded' and 'ebook_course_enquiry'.
--      (Only 'ebook_requested' is written today: no download or course-enquiry
--      flow exists yet, so recording those would state something that did not happen.)
--   2. marketing_contact_events.metadata (jsonb object): the per-submission evidence
--      record: eBook identifier, request id, privacy-notice acknowledgement with notice
--      version and time, marketing-consent choice with consent-text version, and the five
--      UTM fields.
--   3. A non-unique lookup index on lower(btrim(email)) and a unique index that makes a
--      retried submission (same contact and request id) impossible to record twice.
--   4. public.submit_public_ebook_lead(): the ONLY capture write path, a narrowly scoped
--      SECURITY DEFINER function with a fixed search_path. EXECUTE is granted to service_role
--      ONLY: anon and authenticated (anyone holding the public API key) cannot call it, so the
--      origin, honeypot, timing and shared rate-limit checks in /api/ebook cannot be skipped.
--      The route is the sole caller, through the server-only service client. No table is
--      opened to anyone.
--
-- Consent rules (explicit and conservative):
--   * The privacy-notice acknowledgement is REQUIRED and is recorded separately. It is
--     never treated as marketing consent.
--   * Marketing consent is OPTIONAL. Ticked: a NEW contact becomes opted_in; an existing
--     contact that is 'not_set' becomes opted_in. Not ticked: a new contact is 'not_set';
--     an existing contact's choice is never changed.
--   * An existing 'opted_out' or 'opted_in' contact is NEVER changed by this function, even
--     if the box is ticked. A re-opt-in request on an opted_out contact is only recorded in
--     the event metadata for staff to action. (The launch plan allowed re-opt-in on an
--     explicit tick; the more conservative rule is used until the Owner reconciles it.)
--   * The email address is not verified (no double opt-in), so a marketing opt-in is
--     recorded as unverified in the event metadata.
--
-- Duplicates: contacts are matched on lower(btrim(email)) inside one transaction guarded by
-- a per-email advisory lock, so concurrent submissions through this function cannot create two
-- contacts and a retried request id cannot create a second event. If duplicates already exist
-- (the staff form deliberately allows "create anyway"), the OLDEST contact is always the match,
-- so this function never adds to them. No unique index is added: it would fail on existing
-- duplicates and would break that deliberate staff behaviour. A matching contact only has BLANK
-- name / phone / source campaign filled in; status, owner and source are never overwritten.
-- Phone numbers are never used to merge contacts (phones can be shared).
--
-- Idempotent: constraints are dropped and re-added by name, columns and indexes use
-- IF NOT EXISTS, the function is CREATE OR REPLACE.

-- 1. Allow the new source and event types.
alter table public.marketing_contacts drop constraint if exists marketing_contacts_source_check;
alter table public.marketing_contacts add constraint marketing_contacts_source_check
  check (source = any (array['manual', 'newsletter', 'event', 'referral', 'import', 'website', 'other', 'free_ebook']::text[]));

alter table public.marketing_contact_events drop constraint if exists marketing_contact_events_event_type_check;
alter table public.marketing_contact_events add constraint marketing_contact_events_event_type_check
  check (event_type = any (array[
    'created', 'status_changed', 'note_added', 'campaign_linked', 'consent_changed', 'unsubscribed',
    'promoted_to_sales', 'ebook_requested', 'ebook_downloaded', 'ebook_course_enquiry'
  ]::text[]));

-- 2. Per-submission evidence record.
alter table public.marketing_contact_events add column if not exists metadata jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'marketing_contact_events_metadata_object_check' and conrelid = 'public.marketing_contact_events'::regclass) then
    alter table public.marketing_contact_events add constraint marketing_contact_events_metadata_object_check
      check (metadata is null or jsonb_typeof(metadata) = 'object');
  end if;
end
$$;

-- 3. Lookup and retry-safety indexes.
create index if not exists marketing_contacts_email_lower_idx
  on public.marketing_contacts (lower(btrim(email))) where email is not null;

create unique index if not exists marketing_contact_events_ebook_request_uidx
  on public.marketing_contact_events (contact_id, (metadata ->> 'request_id'))
  where event_type = 'ebook_requested' and metadata ? 'request_id';

-- 4. The public capture function.
create or replace function public.submit_public_ebook_lead(
  p_email text,
  p_full_name text,
  p_phone text,
  p_ebook_id text,
  p_privacy_acknowledged boolean,
  p_privacy_notice_version text,
  p_marketing_opt_in boolean,
  p_consent_text_version text,
  p_utm jsonb,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_ebook text := btrim(coalesce(p_ebook_id, ''));
  v_notice_version text := btrim(coalesce(p_privacy_notice_version, ''));
  v_consent_version text := btrim(coalesce(p_consent_text_version, ''));
  v_opt_in boolean := coalesce(p_marketing_opt_in, false);
  v_utm jsonb := '{}'::jsonb;
  v_key text;
  v_val text;
  v_campaign_id uuid;
  v_contact public.marketing_contacts%rowtype;
  v_contact_id uuid;
  v_created boolean := false;
  v_consent_applied boolean := false;
  v_consent_before text;
  v_meta jsonb;
begin
  -- Validation. Error codes are stable strings the server route maps to a generic message.
  if v_email = '' or char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  if v_name is not null and char_length(v_name) > 200 then
    raise exception 'invalid_name' using errcode = 'P0001';
  end if;
  if v_phone is not null and (char_length(v_phone) > 40 or v_phone !~ '^[0-9+()./ -]+$') then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if v_ebook !~ '^[a-z0-9][a-z0-9-]{0,63}$' then
    raise exception 'invalid_ebook' using errcode = 'P0001';
  end if;
  if p_privacy_acknowledged is distinct from true then
    raise exception 'privacy_acknowledgement_required' using errcode = 'P0001';
  end if;
  if char_length(v_notice_version) not between 1 and 100 or char_length(v_consent_version) not between 1 and 100 then
    raise exception 'invalid_version' using errcode = 'P0001';
  end if;
  if p_request_id is null then
    raise exception 'invalid_request_id' using errcode = 'P0001';
  end if;

  -- UTM: keep only the five known keys, string values, control characters removed, 200 chars max.
  if p_utm is not null and jsonb_typeof(p_utm) = 'object' then
    foreach v_key in array array['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] loop
      if jsonb_typeof(p_utm -> v_key) = 'string' then
        v_val := left(btrim(regexp_replace(p_utm ->> v_key, '[[:cntrl:]]', '', 'g')), 200);
        if v_val <> '' then
          v_utm := v_utm || jsonb_build_object(v_key, v_val);
        end if;
      end if;
    end loop;
  end if;

  -- Serialise every submission for this email, then match.
  perform pg_advisory_xact_lock(hashtextextended('free_ebook:' || v_email, 0));

  if v_utm ? 'utm_campaign' then
    select c.id into v_campaign_id
    from public.marketing_campaigns c
    where lower(c.utm_campaign) = lower(v_utm ->> 'utm_campaign') and c.status <> 'archived'
    order by c.created_at desc, c.id
    limit 1;
  end if;

  select * into v_contact
  from public.marketing_contacts
  where lower(btrim(email)) = v_email
  order by created_at, id
  limit 1
  for update;

  if not found then
    insert into public.marketing_contacts (
      full_name, email, phone, status, source, source_campaign_id,
      consent_status, consent_source, consented_at
    ) values (
      v_name, v_email, v_phone, 'new', 'free_ebook', v_campaign_id,
      case when v_opt_in then 'opted_in' else 'not_set' end,
      case when v_opt_in then 'free_ebook:' || v_consent_version end,
      case when v_opt_in then now() end
    ) returning id into v_contact_id;
    v_created := true;
    v_consent_applied := v_opt_in;
    v_consent_before := 'new_contact';

    insert into public.marketing_contact_events (contact_id, event_type, note)
    values (v_contact_id, 'created', 'Contact created from the /ebook form');
    if v_campaign_id is not null then
      insert into public.marketing_contact_events (contact_id, event_type, campaign_id)
      values (v_contact_id, 'campaign_linked', v_campaign_id);
    end if;
  else
    v_contact_id := v_contact.id;
    v_consent_before := v_contact.consent_status;

    -- A retried request must not create a second event.
    if exists (
      select 1 from public.marketing_contact_events e
      where e.contact_id = v_contact_id and e.event_type = 'ebook_requested' and e.metadata ->> 'request_id' = p_request_id::text
    ) then
      return jsonb_build_object('outcome', 'duplicate_request');
    end if;

    -- Fill blanks only. Never overwrite status, owner, source or an existing value.
    update public.marketing_contacts
    set full_name = coalesce(full_name, v_name),
        phone = coalesce(phone, v_phone),
        source_campaign_id = coalesce(source_campaign_id, v_campaign_id)
    where id = v_contact_id
      and ((full_name is null and v_name is not null)
        or (phone is null and v_phone is not null)
        or (source_campaign_id is null and v_campaign_id is not null));

    if v_contact.source_campaign_id is null and v_campaign_id is not null then
      insert into public.marketing_contact_events (contact_id, event_type, campaign_id)
      values (v_contact_id, 'campaign_linked', v_campaign_id);
    end if;

    -- Consent: only a contact with no recorded choice can be opted in. opted_out and opted_in are left alone.
    if v_opt_in and v_contact.consent_status = 'not_set' then
      update public.marketing_contacts
      set consent_status = 'opted_in', consent_source = 'free_ebook:' || v_consent_version, consented_at = now()
      where id = v_contact_id;
      v_consent_applied := true;
      insert into public.marketing_contact_events (contact_id, event_type, note)
      values (v_contact_id, 'consent_changed', 'Marketing opt-in recorded from the /ebook form');
    end if;
  end if;

  v_meta := jsonb_build_object(
    'request_id', p_request_id,
    'ebook_id', v_ebook,
    'email_verified', false,
    'privacy_notice', jsonb_build_object('acknowledged', true, 'version', v_notice_version, 'acknowledged_at', now()),
    'marketing_consent', jsonb_build_object(
      'requested', v_opt_in,
      'text_version', v_consent_version,
      'applied', v_consent_applied,
      'contact_consent_before', v_consent_before
    ),
    'utm', v_utm
  );

  insert into public.marketing_contact_events (contact_id, event_type, note, metadata)
  values (v_contact_id, 'ebook_requested', 'eBook requested: ' || v_ebook, v_meta);

  return jsonb_build_object('outcome', case when v_created then 'created' else 'matched' end);
end;
$$;

revoke all on function public.submit_public_ebook_lead(text, text, text, text, boolean, text, boolean, text, jsonb, uuid) from public;
revoke all on function public.submit_public_ebook_lead(text, text, text, text, boolean, text, boolean, text, jsonb, uuid) from anon, authenticated;
grant execute on function public.submit_public_ebook_lead(text, text, text, text, boolean, text, boolean, text, jsonb, uuid) to service_role;
