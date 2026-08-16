--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
-- SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Application extension dependency. The profiles.email column uses
-- extensions.citext below, so this must exist before application tables are
-- created. The extensions schema itself is platform-provided by Supabase but
-- is idempotently ensured for a blank local/fresh environment.
--

CREATE SCHEMA IF NOT EXISTS "extensions";

CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA "extensions";

-- Application search features and the public schema install pg_trgm in
-- production; ensure it idempotently on fresh environments (no app DDL
-- depends on it, so this is purely for parity with the platform default).
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";


--
-- Name: app; Type: SCHEMA; Schema: -; Owner: postgres
--

CREATE SCHEMA IF NOT EXISTS "app";


ALTER SCHEMA "app" OWNER TO "postgres";

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";

--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: audit_action; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."audit_action" AS ENUM (
    'login',
    'logout',
    'create',
    'update',
    'delete',
    'archive',
    'restore',
    'publish',
    'upload',
    'export',
    'assign',
    'import'
);


ALTER TYPE "public"."audit_action" OWNER TO "postgres";

--
-- Name: company_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."company_status" AS ENUM (
    'active',
    'inactive',
    'prospect',
    'archived'
);


ALTER TYPE "public"."company_status" OWNER TO "postgres";

--
-- Name: content_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."content_status" AS ENUM (
    'draft',
    'published',
    'archived'
);


ALTER TYPE "public"."content_status" OWNER TO "postgres";

--
-- Name: media_kind; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."media_kind" AS ENUM (
    'image',
    'pdf',
    'document',
    'video',
    'other'
);


ALTER TYPE "public"."media_kind" OWNER TO "postgres";

--
-- Name: schedule_status; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."schedule_status" AS ENUM (
    'open',
    'full',
    'in_progress',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."schedule_status" OWNER TO "postgres";

--
-- Name: user_role; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE "public"."user_role" AS ENUM (
    'super_admin',
    'admin',
    'editor',
    'trainer',
    'client',
    'participant'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";

--
-- Name: audit_trigger(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."audit_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_action audit_action;
  v_id text;
  v_email text;
begin
  select email into v_email from public.profiles where id = auth.uid();
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'key');
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) ? 'deleted_at' and (to_jsonb(old)->>'deleted_at') is null and (to_jsonb(new)->>'deleted_at') is not null then
      v_action := 'delete';
    elsif to_jsonb(new) ? 'deleted_at' and (to_jsonb(old)->>'deleted_at') is not null and (to_jsonb(new)->>'deleted_at') is null then
      v_action := 'restore';
    else
      v_action := 'update';
    end if;
    v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'key');
  else
    v_action := 'delete';
    v_id := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'key');
  end if;
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary)
  values (auth.uid(), v_email, v_action, tg_table_name, v_id, tg_table_name || ' ' || v_action);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."audit_trigger"() OWNER TO "postgres";

--
-- Name: certificates_before_insert(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."certificates_before_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.certificate_number is null and new.certificate_no is not null then
    new.certificate_number := new.certificate_no;
  end if;
  if new.certificate_number is null or new.certificate_number = '' then
    new.certificate_number := 'CERT-' || to_char(coalesce(new.issue_date, current_date), 'YYYY')
      || '-' || lpad(nextval('public.certificate_number_seq')::text, 6, '0');
  end if;
  if new.certificate_no is null then
    new.certificate_no := new.certificate_number;
  end if;
  if new.verification_token is null or new.verification_token = '' then
    new.verification_token := encode(gen_random_bytes(16), 'hex');
  end if;
  if new.holder_name is null and new.participant_name is not null then new.holder_name := new.participant_name; end if;
  if new.participant_name is null and new.holder_name is not null then new.participant_name := new.holder_name; end if;
  if new.course_name is null and new.course_id is not null then
    select title into new.course_name from public.courses where id = new.course_id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."certificates_before_insert"() OWNER TO "postgres";

--
-- Name: create_sales_lead_metadata(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."create_sales_lead_metadata"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_source text;
  v_metadata_id uuid;
begin
  v_source := case TG_TABLE_NAME
    when 'enquiries' then 'enquiry'
    when 'proposal_requests' then 'proposal_request'
  end;

  insert into public.sales_lead_metadata (lead_source, source_id, status)
  values (v_source, NEW.id, 'new')
  on conflict (lead_source, source_id) do nothing
  returning id into v_metadata_id;

  if v_metadata_id is not null then
    insert into public.sales_activity (lead_metadata_id, type, note)
    values (v_metadata_id, 'lead_created', 'Lead captured from ' || v_source || ' submission');
  end if;

  return NEW;
end;
$$;


ALTER FUNCTION "app"."create_sales_lead_metadata"() OWNER TO "postgres";

--
-- Name: current_role(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."current_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.profiles where id = (select auth.uid());
$$;


ALTER FUNCTION "app"."current_role"() OWNER TO "postgres";

--
-- Name: duplicate_certificate_with_skill_snapshot("uuid"); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."duplicate_certificate_with_skill_snapshot"("p_source_certificate_id" "uuid") RETURNS TABLE("id" "uuid", "verification_token" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app', 'extensions'
    AS $$
declare
  v_src public.certificates%rowtype;
  v_new_id uuid;
  v_token text;
  r record;
begin
  if not app.is_admin() then
    raise exception 'Not authorized to duplicate certificates.' using errcode = '42501';
  end if;

  select * into v_src from public.certificates cert where cert.id = p_source_certificate_id;
  if not found then
    raise exception 'Source certificate not found.' using errcode = 'P0002';
  end if;

  insert into public.certificates (
    participant_id, schedule_id, course_id, template_id, holder_name, status,
    issue_date, issued_by, expiry_date, remarks
  ) values (
    v_src.participant_id, v_src.schedule_id, v_src.course_id, v_src.template_id, v_src.holder_name, 'draft',
    current_date, auth.uid(), v_src.expiry_date, v_src.remarks
  )
  returning certificates.id, certificates.verification_token into v_new_id, v_token;

  for r in
    select area, status, score, notes, source_skill_result_id
    from public.certificate_skill_results
    where certificate_id = p_source_certificate_id
  loop
    insert into public.certificate_skill_results (certificate_id, area, status, score, notes, source_skill_result_id)
    values (v_new_id, r.area, r.status, r.score, r.notes, r.source_skill_result_id);
  end loop;

  return query select v_new_id, v_token;
end;
$$;


ALTER FUNCTION "app"."duplicate_certificate_with_skill_snapshot"("p_source_certificate_id" "uuid") OWNER TO "postgres";

--
-- Name: FUNCTION "duplicate_certificate_with_skill_snapshot"("p_source_certificate_id" "uuid"); Type: COMMENT; Schema: app; Owner: postgres
--

COMMENT ON FUNCTION "app"."duplicate_certificate_with_skill_snapshot"("p_source_certificate_id" "uuid") IS 'Atomically duplicates a certificate and copies its certificate_skill_results snapshot rows verbatim (never re-derived from current participant_skill_results) in a single transaction.';


--
-- Name: feedback_action_transition_guard(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."feedback_action_transition_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if not (
      (old.status = 'open' and new.status = 'assigned')
      or (old.status = 'assigned' and new.status = 'in_progress')
      or (old.status = 'in_progress' and new.status = 'resolved')
      or (old.status = 'resolved' and new.status = 'verified')
      or (old.status = 'verified' and new.status = 'closed')
    ) then
      raise exception 'Invalid improvement action transition: % -> % (RESOLVED must be VERIFIED before CLOSED)', old.status, new.status;
    end if;
    new.resolved_at := case when new.status = 'resolved' then coalesce(new.resolved_at, now()) else new.resolved_at end;
    new.verified_at := case when new.status = 'verified' then coalesce(new.verified_at, now()) else new.verified_at end;
    new.closed_at   := case when new.status = 'closed'   then coalesce(new.closed_at,   now()) else new.closed_at   end;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."feedback_action_transition_guard"() OWNER TO "postgres";

--
-- Name: feedback_issue_transition_guard(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."feedback_issue_transition_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if not (
      (old.status = 'open' and new.status = 'in_progress')
      or (old.status = 'in_progress' and new.status = 'resolved')
      or (old.status = 'resolved' and new.status = 'closed')
    ) then
      raise exception 'Invalid feedback issue transition: % -> %', old.status, new.status;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."feedback_issue_transition_guard"() OWNER TO "postgres";

--
-- Name: gen_company_id(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."gen_company_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.company_id is null or new.company_id = '' then
    new.company_id := 'CO-' || lpad(nextval('public.company_id_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."gen_company_id"() OWNER TO "postgres";

--
-- Name: gen_participant_id(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."gen_participant_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.participant_id is null or new.participant_id = '' then
    new.participant_id := 'TU-' || lpad(nextval('public.participant_id_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."gen_participant_id"() OWNER TO "postgres";

--
-- Name: gen_schedule_code(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."gen_schedule_code"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'app'
    AS $$
begin
  if new.schedule_code is null or new.schedule_code = '' then
    new.schedule_code := 'SCH-' || lpad(nextval('public.schedule_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."gen_schedule_code"() OWNER TO "postgres";

--
-- Name: handle_new_user(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 'editor')
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "app"."handle_new_user"() OWNER TO "postgres";

--
-- Name: has_min_role("public"."user_role"); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."has_min_role"("min_role" "public"."user_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select app.is_active() and array_position(enum_range(null::public.user_role), app.current_role())
    <= array_position(enum_range(null::public.user_role), min_role);
$$;


ALTER FUNCTION "app"."has_min_role"("min_role" "public"."user_role") OWNER TO "postgres";

--
-- Name: is_active(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."is_active"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select is_active from public.profiles where id = (select auth.uid())), false);
$$;


ALTER FUNCTION "app"."is_active"() OWNER TO "postgres";

--
-- Name: is_admin(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select app.has_min_role('admin'::public.user_role); $$;


ALTER FUNCTION "app"."is_admin"() OWNER TO "postgres";

--
-- Name: is_admin_or_trainer(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."is_admin_or_trainer"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select app.is_active() and (app.is_admin() or app.current_role() = 'trainer'::public.user_role);
$$;


ALTER FUNCTION "app"."is_admin_or_trainer"() OWNER TO "postgres";

--
-- Name: is_editor(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."is_editor"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select app.has_min_role('editor'::public.user_role); $$;


ALTER FUNCTION "app"."is_editor"() OWNER TO "postgres";

--
-- Name: is_super_admin(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select app.current_role() = 'super_admin' and app.is_active(); $$;


ALTER FUNCTION "app"."is_super_admin"() OWNER TO "postgres";

--
-- Name: issue_certificate_with_skill_snapshot("uuid", "uuid", "text"); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "verification_token" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app', 'extensions'
    AS $$
declare
  v_elig public.v_certificate_eligibility%rowtype;
  v_cert_id uuid;
  v_token text;
  v_area text;
  v_status text;
  v_score numeric;
  v_notes text;
  v_src_id uuid;
begin
  if not app.is_admin() then
    raise exception 'Not authorized to issue certificates.' using errcode = '42501';
  end if;

  select * into v_elig
  from public.v_certificate_eligibility
  where schedule_id = p_schedule_id and participant_id = p_participant_id;

  if not found or not v_elig.eligible then
    raise exception 'Not eligible: %', coalesce(v_elig.ineligibility_reason, 'no_eligibility_row') using errcode = 'P0001';
  end if;

  insert into public.certificates (
    participant_id, schedule_id, course_id, template_id,
    certificate_number, holder_name, participant_name, course_name,
    training_start_date, training_end_date, venue, trainer_name,
    status, issue_date, issued_by
  ) values (
    p_participant_id, p_schedule_id, v_elig.course_id, v_elig.certificate_template_id,
    p_certificate_number, v_elig.holder_name, v_elig.holder_name, v_elig.course_name,
    v_elig.schedule_start_date, v_elig.schedule_end_date, v_elig.venue, v_elig.trainer_name,
    'valid', current_date, auth.uid()
  )
  returning certificates.id, certificates.verification_token into v_cert_id, v_token;

  foreach v_area in array array['theory_session', 'practical_training', 'safety_awareness', 'practical_assessment']
  loop
    select psr.status, psr.score, psr.notes, psr.id
      into v_status, v_score, v_notes, v_src_id
    from public.participant_skill_results psr
    where psr.schedule_id = p_schedule_id
      and psr.participant_id = p_participant_id
      and psr.area = v_area
      and psr.deleted_at is null;

    insert into public.certificate_skill_results (certificate_id, area, status, score, notes, source_skill_result_id)
    values (v_cert_id, v_area, coalesce(v_status, 'not_recorded'), v_score, v_notes, v_src_id);

    v_status := null; v_score := null; v_notes := null; v_src_id := null;
  end loop;

  insert into public.certificate_skill_results (certificate_id, area, status)
  values (
    v_cert_id, 'attendance_requirement',
    case
      when v_elig.attendance_satisfied is null then 'not_recorded'
      when v_elig.attendance_satisfied then 'met'
      else 'not_met'
    end
  );

  return query select v_cert_id, v_token;
end;
$$;


ALTER FUNCTION "app"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text"); Type: COMMENT; Schema: app; Owner: postgres
--

COMMENT ON FUNCTION "app"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text") IS 'Atomically issues one certificate and its 5-row certificate_skill_results snapshot in a single transaction. Re-validates v_certificate_eligibility itself; never trusts a caller-supplied eligibility result.';


--
-- Name: log_event("public"."audit_action", "text", "text", "text", "jsonb"); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text" DEFAULT NULL::"text", "p_entity_id" "text" DEFAULT NULL::"text", "p_summary" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_email text;
begin
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), v_email, p_action, p_entity_type, p_entity_id, p_summary, coalesce(p_metadata, '{}'::jsonb));
end;
$$;


ALTER FUNCTION "app"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") OWNER TO "postgres";

--
-- Name: next_opportunity_number(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."next_opportunity_number"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'app'
    AS $$
  select 'OPP-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.sales_opportunity_seq')::text, 4, '0');
$$;


ALTER FUNCTION "app"."next_opportunity_number"() OWNER TO "postgres";

--
-- Name: next_quotation_number(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."next_quotation_number"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'app'
    AS $$
  select 'QT-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.sales_quotation_seq')::text, 4, '0');
$$;


ALTER FUNCTION "app"."next_quotation_number"() OWNER TO "postgres";

--
-- Name: set_updated_at(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "app"."set_updated_at"() OWNER TO "postgres";

--
-- Name: stamp_actor(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."stamp_actor"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'INSERT' then
    if new.created_by is null then new.created_by = auth.uid(); end if;
    begin new.updated_by = auth.uid(); exception when undefined_column then null; end;
  elsif tg_op = 'UPDATE' then
    begin new.updated_by = auth.uid(); exception when undefined_column then null; end;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."stamp_actor"() OWNER TO "postgres";

--
-- Name: sync_attendance_present(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."sync_attendance_present"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'app'
    AS $$
begin
  new.present := (new.attendance_status = 'present');
  return new;
end;
$$;


ALTER FUNCTION "app"."sync_attendance_present"() OWNER TO "postgres";

--
-- Name: sync_schedule_seats(); Type: FUNCTION; Schema: app; Owner: postgres
--

CREATE OR REPLACE FUNCTION "app"."sync_schedule_seats"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'app'
    AS $$
begin
  if tg_op = 'DELETE' then
    update public.course_schedules set seats_taken = (
      select count(*) from public.schedule_participants
      where schedule_id = old.schedule_id and deleted_at is null and registration_status <> 'cancelled'
    ) where id = old.schedule_id;
    return old;
  end if;

  update public.course_schedules set seats_taken = (
    select count(*) from public.schedule_participants
    where schedule_id = new.schedule_id and deleted_at is null and registration_status <> 'cancelled'
  ) where id = new.schedule_id;

  if tg_op = 'UPDATE' and old.schedule_id is distinct from new.schedule_id then
    update public.course_schedules set seats_taken = (
      select count(*) from public.schedule_participants
      where schedule_id = old.schedule_id and deleted_at is null and registration_status <> 'cancelled'
    ) where id = old.schedule_id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "app"."sync_schedule_seats"() OWNER TO "postgres";

--
-- Name: accept_quotation("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."accept_quotation"("p_quotation_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_opportunity_id uuid;
  v_lead_metadata_id uuid;
  v_status text;
  v_opportunity_stage text;
  v_now timestamptz := now();
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select opportunity_id, status into v_opportunity_id, v_status
  from public.sales_quotations
  where id = p_quotation_id;
  if v_opportunity_id is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;
  if v_status is distinct from 'sent' then
    raise exception 'invalid_transition: only a sent quotation can be accepted (current status: %)', v_status using errcode = 'P0001';
  end if;

  select lead_metadata_id, stage into v_lead_metadata_id, v_opportunity_stage
  from public.sales_opportunities
  where id = v_opportunity_id;
  if v_opportunity_stage in ('won', 'lost') then
    raise exception 'invalid_transition: opportunity is already resolved (current stage: %)', v_opportunity_stage using errcode = 'P0001';
  end if;

  update public.sales_quotations
  set status = 'accepted', accepted_at = v_now, updated_at = v_now
  where id = p_quotation_id;
  update public.sales_opportunities
  set stage = 'won', won_at = v_now, updated_at = v_now
  where id = v_opportunity_id;
  update public.sales_lead_metadata
  set status = 'won', won_at = v_now, follow_up_at = null, updated_at = v_now
  where id = v_lead_metadata_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id) values
    (v_lead_metadata_id, v_opportunity_id, p_quotation_id, 'quotation_accepted', 'Quotation accepted', auth.uid()),
    (v_lead_metadata_id, v_opportunity_id, null, 'opportunity_won', 'Opportunity won', auth.uid()),
    (v_lead_metadata_id, null, null, 'won', 'Lead won (quotation accepted); pending sales follow-up cleared', auth.uid());
end;
$$;


ALTER FUNCTION "public"."accept_quotation"("p_quotation_id" "uuid") OWNER TO "postgres";

--
-- Name: convert_lead_to_opportunity("uuid", "text", "date", numeric); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."convert_lead_to_opportunity"("p_lead_metadata_id" "uuid", "p_title" "text", "p_expected_close_date" "date", "p_estimated_value" numeric) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_opportunity_id uuid;
  v_lead record;
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_lead from public.v_sales_lead_inbox where lead_metadata_id = p_lead_metadata_id;
  if v_lead is null then
    raise exception 'lead_not_found' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.sales_opportunities where lead_metadata_id = p_lead_metadata_id) then
    raise exception 'opportunity_already_exists' using errcode = 'P0001';
  end if;

  insert into public.sales_opportunities (
    lead_metadata_id, company_name, contact_person, contact_email, contact_phone,
    title, programme, stage, created_by
  )
  values (
    p_lead_metadata_id, v_lead.company, v_lead.contact_name, v_lead.email, v_lead.phone,
    trim(p_title), v_lead.subject, 'qualified', auth.uid()
  )
  returning id into v_opportunity_id;

  update public.sales_opportunities
  set expected_close_date = p_expected_close_date,
      estimated_value = p_estimated_value
  where id = v_opportunity_id;

  update public.sales_lead_metadata
  set status = 'qualified', updated_at = now()
  where id = p_lead_metadata_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, type, note, actor_id)
  values (p_lead_metadata_id, v_opportunity_id, 'opportunity_created', 'Converted to opportunity', auth.uid());

  return v_opportunity_id;
end;
$$;


ALTER FUNCTION "public"."convert_lead_to_opportunity"("p_lead_metadata_id" "uuid", "p_title" "text", "p_expected_close_date" "date", "p_estimated_value" numeric) OWNER TO "postgres";

--
-- Name: feedback_anonymous_stats("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("total_eligible" bigint, "responses" bigint, "response_rate" numeric, "avg_overall" numeric, "nps_promoters" numeric, "nps_passives" numeric, "nps_detractors" numeric, "nps" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with eligible as (
    select sp.schedule_id, sp.participant_id
    from public.schedule_participants sp
    join public.participants p on p.id = sp.participant_id
    where (p_schedule_id is null or sp.schedule_id = p_schedule_id)
      and sp.deleted_at is null
      and sp.registration_status <> 'cancelled'
      and p.deleted_at is null
  ),
  submitted as (
    select f.*
    from public.participant_feedback f
    join eligible e on e.schedule_id = f.schedule_id and e.participant_id = f.participant_id
    where f.status = 'submitted'
  ),
  agg as (
    select
      (select count(*) from eligible) as total_eligible,
      (select count(*) from submitted) as responses,
      (select round(100.0 * count(*) / nullif((select count(*) from eligible), 0), 1)
       from submitted) as response_rate,
      (select round(avg((q1_score + q2_score + q3_score + q4_score + q5_score
                        + q6_score + q7_score + q8_score + q9_score + q10_score) / 10.0), 2)
       from submitted) as avg_overall,
      (select round(100.0 * count(*) filter (where nps between 9 and 10) / nullif(count(*), 0), 1)
       from submitted) as nps_promoters,
      (select round(100.0 * count(*) filter (where nps between 7 and 8) / nullif(count(*), 0), 1)
       from submitted) as nps_passives,
      (select round(100.0 * count(*) filter (where nps between 0 and 6) / nullif(count(*), 0), 1)
       from submitted) as nps_detractors
  )
  select agg.total_eligible, agg.responses, agg.response_rate,
         case when agg.responses >= 3 then agg.avg_overall end,
         case when agg.responses >= 3 then agg.nps_promoters end,
         case when agg.responses >= 3 then agg.nps_passives end,
         case when agg.responses >= 3 then agg.nps_detractors end,
         case when agg.responses >= 3
              then round(agg.nps_promoters - agg.nps_detractors, 1)
         end as nps
  from agg
  where (select app.has_min_role('trainer'::public.user_role));
$$;


ALTER FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid") OWNER TO "postgres";

--
-- Name: FUNCTION "feedback_anonymous_stats"("p_schedule_id" "uuid"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid") IS 'Trainer-safe anonymised feedback aggregates. No participant identity is ever returned; the base tables are not readable by trainers at all.';


--
-- Name: feedback_generate_links("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."feedback_generate_links"("p_schedule_id" "uuid") RETURNS TABLE("created_count" bigint)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_count bigint := 0;
begin
  if not (select app.has_min_role('editor'::public.user_role)) then return; end if;

  with new_links as (
    insert into public.participant_feedback (schedule_id, participant_id, token, status)
    select sp.schedule_id, sp.participant_id,
           'FB-' || replace(gen_random_uuid()::text, '-', ''),
           'pending'
    from public.schedule_participants sp
    join public.participants p on p.id = sp.participant_id
    where sp.schedule_id = p_schedule_id
      and sp.deleted_at is null
      and sp.registration_status <> 'cancelled'
      and p.deleted_at is null
      and not exists (
        select 1 from public.participant_feedback f
        where f.schedule_id = sp.schedule_id and f.participant_id = sp.participant_id
      )
    on conflict (schedule_id, participant_id) do nothing
    returning 1
  )
  select count(*) into v_count from new_links;

  return query select v_count;
end;
$$;


ALTER FUNCTION "public"."feedback_generate_links"("p_schedule_id" "uuid") OWNER TO "postgres";

--
-- Name: feedback_get_by_token("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."feedback_get_by_token"("p_token" "text") RETURNS TABLE("valid" boolean, "already_submitted" boolean, "course_title" "text", "schedule_code" "text", "schedule_start" "date", "schedule_end" "date", "venue" "text", "trainer_name" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v record;
begin
  select
    true as valid,
    pf.status = 'submitted' as already_submitted,
    coalesce(c.title, c.course_name) as course_title,
    cs.schedule_code,
    cs.start_date as schedule_start,
    cs.end_date as schedule_end,
    cs.venue,
    cs.trainer_name
  into v
  from public.participant_feedback pf
  join public.course_schedules cs on cs.id = pf.schedule_id
  join public.courses c on c.id = cs.course_id
  where pf.token = trim(p_token)
    and cs.deleted_at is null
  limit 1;

  if not found then return; end if;
  return query select v.valid, v.already_submitted, v.course_title, v.schedule_code,
                      v.schedule_start, v.schedule_end, v.venue, v.trainer_name;
end;
$$;


ALTER FUNCTION "public"."feedback_get_by_token"("p_token" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "feedback_get_by_token"("p_token" "text"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."feedback_get_by_token"("p_token" "text") IS 'Resolve a public feedback token to the schedule/course the participant is being asked about. Never returns participant identity.';


--
-- Name: feedback_reopen("uuid"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."feedback_reopen"("p_feedback_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_id uuid;
  v_email text;
begin
  if not (select app.has_min_role('editor'::public.user_role)) then
    raise exception 'Editor role required' using errcode = '42501';
  end if;

  update public.participant_feedback
  set status = 'pending', submitted_at = null
  where id = p_feedback_id and status = 'submitted'
  returning id into v_id;

  if v_id is null then return false; end if;

  select email into v_email from public.profiles where id = (select auth.uid());
  insert into public.audit_logs
    (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values
    ((select auth.uid()), v_email, 'update', 'participant_feedback', v_id::text,
     'Reopened feedback for resubmission',
     jsonb_build_object('previous_status', 'submitted', 'new_status', 'pending', 'answers_retained', true));

  return true;
end;
$$;


ALTER FUNCTION "public"."feedback_reopen"("p_feedback_id" "uuid") OWNER TO "postgres";

--
-- Name: feedback_submit("text", "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") RETURNS TABLE("ok" boolean, "code" "text", "message" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_id uuid;
  v_q int;
  v_nps int;
  v_vals jsonb := coalesce(p_data, '{}'::jsonb);
  v_liked text;
  v_improve text;
  v_had_problem boolean;
  v_category text;
  v_description text;
begin
  if trim(coalesce(p_token, '')) = '' then
    return query select false, 'invalid', 'Invalid feedback link.';
    return;
  end if;

  -- Validate ratings 1..5 for all ten questions.
  for v_q in 1..10 loop
    if (v_vals ->> ('q' || v_q)) is null
       or not (v_vals ->> ('q' || v_q)) ~ '^[1-5]$' then
      return query select false, 'invalid_rating', 'Please provide a rating of 1 to 5 for every question.';
      return;
    end if;
  end loop;

  -- Validate NPS 0..10 (string check first so a malformed value is rejected
  -- cleanly instead of throwing a cast exception).
  if (v_vals ->> 'nps') is null or not (v_vals ->> 'nps') ~ '^(10|[0-9])$' then
    return query select false, 'invalid_nps', 'Please provide a 0 to 10 recommendation score.';
    return;
  end if;
  v_nps := (v_vals ->> 'nps')::int;
  if v_nps < 0 or v_nps > 10 then
    return query select false, 'invalid_nps', 'Please provide a 0 to 10 recommendation score.';
    return;
  end if;

  v_liked   := left(coalesce(v_vals ->> 'liked_most', ''), 2000);
  v_improve := left(coalesce(v_vals ->> 'improve', ''), 2000);
  v_had_problem := coalesce((v_vals ->> 'had_problem')::boolean, false);
  v_category := nullif(trim(coalesce(v_vals ->> 'problem_category', '')), '');
  v_description := left(coalesce(v_vals ->> 'problem_description', ''), 2000);

  if v_had_problem and v_category is null then
    return query select false, 'invalid_category', 'Please select a problem category.';
    return;
  end if;
  if v_category is not null and v_category not in (
    'registration','trainer','training_material','practical_equipment','venue',
    'food_refreshment','schedule','assessment_examination','certificate',
    'staff_service','others'
  ) then
    return query select false, 'invalid_category', 'Invalid problem category.';
    return;
  end if;

  update public.participant_feedback
  set status = 'submitted',
      q1_score = (v_vals ->> 'q1')::smallint,
      q2_score = (v_vals ->> 'q2')::smallint,
      q3_score = (v_vals ->> 'q3')::smallint,
      q4_score = (v_vals ->> 'q4')::smallint,
      q5_score = (v_vals ->> 'q5')::smallint,
      q6_score = (v_vals ->> 'q6')::smallint,
      q7_score = (v_vals ->> 'q7')::smallint,
      q8_score = (v_vals ->> 'q8')::smallint,
      q9_score = (v_vals ->> 'q9')::smallint,
      q10_score = (v_vals ->> 'q10')::smallint,
      nps = v_nps,
      liked_most = v_liked,
      improve = v_improve,
      had_problem = v_had_problem,
      problem_category = case when v_had_problem then v_category else null end,
      problem_description = case when v_had_problem then v_description else null end,
      submitted_at = now()
  where token = trim(p_token)
    and status = 'pending'
  returning id into v_id;

  if v_id is null then
    if exists (select 1 from public.participant_feedback where token = trim(p_token)) then
      return query select false, 'duplicate', 'This feedback has already been submitted. Thank you.';
      return;
    end if;
    return query select false, 'invalid', 'Invalid feedback link.';
    return;
  end if;

  return query select true, 'submitted', 'Thank you — your feedback has been recorded.';
end;
$_$;


ALTER FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") OWNER TO "postgres";

--
-- Name: FUNCTION "feedback_submit"("p_token" "text", "p_data" "jsonb"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") IS 'Public feedback submission. Validates ratings/NPS/category, rejects duplicates (only a pending row can be submitted), never exposes identity.';


--
-- Name: get_public_upcoming_schedules(boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."get_public_upcoming_schedules"("p_include_past" boolean DEFAULT false) RETURNS TABLE("schedule_id" "uuid", "course_id" "uuid", "course_title" "text", "course_slug" "text", "start_date" "date", "end_date" "date", "start_time" time without time zone, "end_time" time without time zone, "venue" "text", "delivery_mode" "text", "status" "text", "capacity" integer, "available_seats" integer)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    cs.id as schedule_id,
    cs.course_id,
    coalesce(c.title, c.course_name) as course_title,
    c.slug as course_slug,
    cs.start_date,
    cs.end_date,
    cs.start_time,
    cs.end_time,
    cs.venue,
    cs.training_mode as delivery_mode,
    cs.status::text as status,
    cs.capacity,
    greatest(cs.capacity - cs.seats_taken, 0) as available_seats
  from public.course_schedules cs
  join public.courses c on c.id = cs.course_id
  where cs.deleted_at is null
    and cs.is_published = true
    and cs.status <> 'cancelled'::public.schedule_status
    and c.deleted_at is null
    and c.status = 'published'
    and (
      p_include_past
      or (
        cs.start_date >= current_date
        and cs.status in ('open'::public.schedule_status, 'full'::public.schedule_status)
      )
    )
  order by cs.start_date asc, cs.end_date asc, cs.id asc;
$$;


ALTER FUNCTION "public"."get_public_upcoming_schedules"("p_include_past" boolean) OWNER TO "postgres";

--
-- Name: log_event("public"."audit_action", "text", "text", "text", "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text" DEFAULT NULL::"text", "p_entity_id" "text" DEFAULT NULL::"text", "p_summary" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select app.log_event(p_action, p_entity_type, p_entity_id, p_summary, p_metadata);
$$;


ALTER FUNCTION "public"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") OWNER TO "postgres";

--
-- Name: log_event_as_service("uuid", "text", "public"."audit_action", "text", "text", "text", "jsonb"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."log_event_as_service"("p_actor_id" "uuid", "p_actor_email" "text", "p_action" "public"."audit_action", "p_entity_type" "text" DEFAULT NULL::"text", "p_entity_id" "text" DEFAULT NULL::"text", "p_summary" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF p_actor_id IS NULL THEN
    RAISE EXCEPTION 'audit_actor_required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.audit_logs
    (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  VALUES
    (p_actor_id, p_actor_email, p_action, p_entity_type, p_entity_id,
     p_summary, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;


ALTER FUNCTION "public"."log_event_as_service"("p_actor_id" "uuid", "p_actor_email" "text", "p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") OWNER TO "postgres";

--
-- Name: mark_opportunity_lost("uuid", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."mark_opportunity_lost"("p_opportunity_id" "uuid", "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_lead_metadata_id uuid;
  v_stage text;
  v_now timestamptz := now();
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('price', 'no_budget', 'no_response', 'timing', 'competitor', 'requirement_changed', 'duplicate', 'other') then
    raise exception 'invalid_reason' using errcode = 'P0001';
  end if;

  select lead_metadata_id, stage into v_lead_metadata_id, v_stage from public.sales_opportunities where id = p_opportunity_id;
  if v_lead_metadata_id is null then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;
  if v_stage in ('won', 'lost') then
    raise exception 'invalid_transition: opportunity is already resolved (current stage: %)', v_stage using errcode = 'P0001';
  end if;

  update public.sales_opportunities
  set stage = 'lost', lost_at = v_now, lost_reason = p_reason, updated_at = v_now
  where id = p_opportunity_id;

  update public.sales_lead_metadata
  set status = 'lost', lost_reason = p_reason, updated_at = v_now
  where id = v_lead_metadata_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, type, note, actor_id) values
    (v_lead_metadata_id, p_opportunity_id, 'opportunity_lost', 'Opportunity lost — ' || p_reason, auth.uid()),
    (v_lead_metadata_id, null, 'lost', 'Lead lost (opportunity lost)', auth.uid());
end;
$$;


ALTER FUNCTION "public"."mark_opportunity_lost"("p_opportunity_id" "uuid", "p_reason" "text") OWNER TO "postgres";

--
-- Name: mark_proposal_delivery_status("uuid", boolean, boolean); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."mark_proposal_delivery_status"("p_id" "uuid", "p_email_sent" boolean, "p_sheets_synced" boolean) RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  UPDATE public.proposal_requests
  SET email_sent = p_email_sent,
      sheets_synced = p_sheets_synced,
      updated_at = now()
  WHERE id = p_id
    AND created_at > now() - interval '10 minutes';
$$;


ALTER FUNCTION "public"."mark_proposal_delivery_status"("p_id" "uuid", "p_email_sent" boolean, "p_sheets_synced" boolean) OWNER TO "postgres";

--
-- Name: reject_quotation("uuid", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."reject_quotation"("p_quotation_id" "uuid", "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_opportunity_id uuid;
  v_lead_metadata_id uuid;
  v_status text;
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select opportunity_id, status into v_opportunity_id, v_status from public.sales_quotations where id = p_quotation_id;
  if v_opportunity_id is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;
  if v_status is distinct from 'sent' then
    raise exception 'invalid_transition: only a sent quotation can be rejected (current status: %)', v_status using errcode = 'P0001';
  end if;

  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_opportunity_id;

  update public.sales_quotations
  set status = 'rejected', rejected_at = now(), rejection_reason = trim(p_reason), updated_at = now()
  where id = p_quotation_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_opportunity_id, p_quotation_id, 'quotation_rejected', 'Rejected — ' || trim(p_reason), auth.uid());
end;
$$;


ALTER FUNCTION "public"."reject_quotation"("p_quotation_id" "uuid", "p_reason" "text") OWNER TO "postgres";

--
-- Name: resolve_schedule_feedback_participant("text", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."resolve_schedule_feedback_participant"("p_public_token" "text", "p_identity_number" "text", "p_request_fingerprint_hash" "text") RETURNS TABLE("feedback_token" "text", "already_submitted" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $_$
declare
  v_schedule_link_id uuid;
  v_schedule_id uuid;
  v_normalized_identity text;
  v_window_started_at timestamptz;
begin
  if p_public_token is null
    or p_public_token !~ '^[A-Za-z0-9_-]{32,128}$'
    or p_request_fingerprint_hash is null
    or p_request_fingerprint_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  select fsl.id, fsl.schedule_id
    into v_schedule_link_id, v_schedule_id
  from public.feedback_schedule_links as fsl
  where fsl.public_token = p_public_token
    and fsl.is_active
    and fsl.disabled_at is null;

  if not found then
    return;
  end if;

  -- Bounded retention without retaining raw identity data.
  delete from public.feedback_schedule_lookup_attempts
  where last_attempt_at < pg_catalog.now() - interval '24 hours';

  v_window_started_at := pg_catalog.date_trunc('minute', pg_catalog.now());

  insert into public.feedback_schedule_lookup_attempts (
    schedule_link_id,
    request_fingerprint_hash,
    window_started_at,
    attempt_count,
    last_attempt_at
  )
  values (v_schedule_link_id, p_request_fingerprint_hash, v_window_started_at, 1, pg_catalog.now())
  on conflict (schedule_link_id, request_fingerprint_hash, window_started_at)
  do update set
    attempt_count = public.feedback_schedule_lookup_attempts.attempt_count + 1,
    last_attempt_at = excluded.last_attempt_at
  where public.feedback_schedule_lookup_attempts.attempt_count < 5;

  if not found then
    return;
  end if;

  v_normalized_identity := pg_catalog.upper(
    pg_catalog.regexp_replace(coalesce(p_identity_number, ''), '[^0-9A-Za-z]', '', 'g')
  );

  if pg_catalog.char_length(v_normalized_identity) < 3
    or pg_catalog.char_length(v_normalized_identity) > 80 then
    return;
  end if;

  return query
  select pf.token, pf.status = 'submitted'
  from public.participant_feedback as pf
  join public.schedule_participants as sp
    on sp.schedule_id = pf.schedule_id
   and sp.participant_id = pf.participant_id
   and sp.deleted_at is null
   and sp.registration_status <> 'cancelled'
  join public.participants as p
    on p.id = pf.participant_id
   and p.deleted_at is null
  where pf.schedule_id = v_schedule_id
    and pg_catalog.upper(pg_catalog.regexp_replace(p.ic_passport_no, '[^0-9A-Za-z]', '', 'g')) = v_normalized_identity
  limit 1;
end;
$_$;


ALTER FUNCTION "public"."resolve_schedule_feedback_participant"("p_public_token" "text", "p_identity_number" "text", "p_request_fingerprint_hash" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "resolve_schedule_feedback_participant"("p_public_token" "text", "p_identity_number" "text", "p_request_fingerprint_hash" "text"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."resolve_schedule_feedback_participant"("p_public_token" "text", "p_identity_number" "text", "p_request_fingerprint_hash" "text") IS 'Service-role-only class-feedback resolver. Returns only a matched individual feedback token and submitted state.';


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";

--
-- Name: submit_proposal_request("text", "text", "text", "text", "text", "text", "text", "text", integer, "text", "text", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."submit_proposal_request"("p_company_name" "text", "p_contact_person" "text", "p_job_title" "text", "p_email" "text", "p_phone" "text", "p_industry" "text", "p_category" "text", "p_programme" "text", "p_participants" integer, "p_location" "text", "p_preferred_month" "text", "p_budget" "text", "p_objectives" "text", "p_notes" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_id uuid;
begin
  if p_email is null or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  if p_industry not in ('Oil & Gas', 'Petrochemical', 'Construction', 'Manufacturing', 'Marine & Offshore', 'Power & Utilities', 'Government & GLC', 'Others') then
    raise exception 'invalid_industry' using errcode = 'P0001';
  end if;
  if p_category not in ('Industrial Safety', 'Technical Competency', 'Industrial Consultancy', 'Workforce Development') then
    raise exception 'invalid_category' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.proposal_requests
    where email = lower(trim(p_email))
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.proposal_requests (
    company_name, contact_person, job_title, email, phone, industry, category,
    programme, participants, location, preferred_month, budget, objectives, notes
  )
  values (
    trim(p_company_name),
    trim(p_contact_person),
    nullif(trim(coalesce(p_job_title, '')), ''),
    lower(trim(p_email)),
    trim(p_phone),
    p_industry,
    p_category,
    nullif(trim(coalesce(p_programme, '')), ''),
    p_participants,
    nullif(trim(coalesce(p_location, '')), ''),
    nullif(trim(coalesce(p_preferred_month, '')), ''),
    nullif(trim(coalesce(p_budget, '')), ''),
    trim(p_objectives),
    nullif(trim(coalesce(p_notes, '')), '')
  )
  returning id into v_id;

  return v_id;
end;
$_$;


ALTER FUNCTION "public"."submit_proposal_request"("p_company_name" "text", "p_contact_person" "text", "p_job_title" "text", "p_email" "text", "p_phone" "text", "p_industry" "text", "p_category" "text", "p_programme" "text", "p_participants" integer, "p_location" "text", "p_preferred_month" "text", "p_budget" "text", "p_objectives" "text", "p_notes" "text") OWNER TO "postgres";

--
-- Name: submit_public_enquiry("text", "text", "text", "text", "text", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."submit_public_enquiry"("p_name" "text", "p_company" "text", "p_email" "text", "p_phone" "text", "p_enquiry_type" "text", "p_subject" "text", "p_message" "text", "p_source_page" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_id uuid;
begin
  if p_email is null or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;
  if p_enquiry_type not in ('Corporate', 'Individual', 'Government', 'Training') then
    raise exception 'invalid_enquiry_type' using errcode = 'P0001';
  end if;
  if p_source_page not in ('homepage', 'contact_page') then
    raise exception 'invalid_source_page' using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.enquiries
    where email = lower(trim(p_email))
      and created_at > now() - interval '60 seconds'
  ) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.enquiries (name, company, email, phone, enquiry_type, subject, message, source_page)
  values (
    trim(p_name),
    nullif(trim(coalesce(p_company, '')), ''),
    lower(trim(p_email)),
    trim(p_phone),
    p_enquiry_type,
    trim(p_subject),
    trim(p_message),
    p_source_page
  )
  returning id into v_id;

  return v_id;
end;
$_$;


ALTER FUNCTION "public"."submit_public_enquiry"("p_name" "text", "p_company" "text", "p_email" "text", "p_phone" "text", "p_enquiry_type" "text", "p_subject" "text", "p_message" "text", "p_source_page" "text") OWNER TO "postgres";

--
-- Name: sync_participant_last4(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."sync_participant_last4"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare cleaned text;
begin
  if new.identity_no is not null and btrim(new.identity_no) <> '' then
    cleaned := regexp_replace(new.identity_no, '[^0-9A-Za-z]', '', 'g');
    if length(cleaned) >= 4 then new.identity_last4 := upper(right(cleaned, 4)); end if;
  elsif new.identity_last4 is not null then
    new.identity_last4 := upper(right(regexp_replace(new.identity_last4, '[^0-9A-Za-z]', '', 'g'), 4));
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."sync_participant_last4"() OWNER TO "postgres";

--
-- Name: teras_photo_next_id(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."teras_photo_next_id"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_date date;
  v_value bigint;
begin
  v_date := (now() at time zone 'Asia/Kuala_Lumpur')::date;
  insert into public.photo_id_sequences (seq_date, last_value)
  values (v_date, 1)
  on conflict (seq_date)
    do update set last_value = public.photo_id_sequences.last_value + 1
  returning last_value into v_value;
  return 'TERAS-PH-' || to_char(v_date, 'YYYYMMDD') || '-' || lpad(v_value::text, 4, '0');
end;
$$;


ALTER FUNCTION "public"."teras_photo_next_id"() OWNER TO "postgres";

--
-- Name: verify_and_log("text", "text", "text", "text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text" DEFAULT 'auto'::"text", "p_ip" "text" DEFAULT NULL::"text", "p_ua" "text" DEFAULT NULL::"text") RETURNS TABLE("found" boolean, "certificate_number" "text", "holder_name" "text", "participant_code_masked" "text", "company" "text", "course_title" "text", "training_date" "date", "issue_date" "date", "expiry_date" "date", "status" "text", "is_valid" boolean, "verified_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v record;
  v_status text;
  v_ip inet;
  q text := trim(coalesce(p_query, ''));
begin
  if q = '' then
    return;
  end if;

  begin v_ip := nullif(p_ip, '')::inet; exception when others then v_ip := null; end;

  select
    c.id, c.certificate_number, c.holder_name, c.status, c.issue_date, c.expiry_date,
    c.verification_enabled,
    p.participant_id as p_code, p.company as p_company,
    co.title as course_title
  into v
  from public.certificates c
  left join public.participants p on p.id = c.participant_id
  left join public.courses co on co.id = c.course_id
  where c.deleted_at is null
    and (
      ((p_method in ('auto','token'))  and c.verification_token  = q)
      or ((p_method in ('auto','number')) and upper(c.certificate_number) = upper(q))
    )
  limit 1;

  if not found then
    insert into public.certificate_verifications(method, query_value, status_returned, ip_address, user_agent)
    values (p_method, q, 'not_found', v_ip, p_ua);
    return;
  end if;

  if coalesce(v.verification_enabled, true) = false then
    insert into public.certificate_verifications(certificate_id, certificate_number, method, query_value, status_returned, ip_address, user_agent)
    values (v.id, v.certificate_number, p_method, q, 'disabled', v_ip, p_ua);
    return;
  end if;

  if v.status in ('valid', 'issued') and (v.expiry_date is null or v.expiry_date >= current_date) then
    v_status := 'valid';
  elsif v.status = 'revoked' then
    v_status := 'revoked';
  elsif v.status = 'expired' or (v.expiry_date is not null and v.expiry_date < current_date) then
    v_status := 'expired';
  else
    v_status := v.status;
  end if;

  insert into public.certificate_verifications(certificate_id, certificate_number, method, query_value, status_returned, ip_address, user_agent)
  values (v.id, v.certificate_number, p_method, q, v_status, v_ip, p_ua);

  return query select
    true,
    v.certificate_number,
    v.holder_name,
    case
      when v.p_code is null then null
      when length(v.p_code) <= 6 then v.p_code
      else left(v.p_code, 4) || repeat('•', greatest(length(v.p_code) - 6, 1)) || right(v.p_code, 2)
    end,
    v.p_company,
    v.course_title,
    null::date, -- training_date — pending Module 10 (training_schedules)
    v.issue_date,
    v.expiry_date,
    v.status,
    (v_status = 'valid'),
    now();
end;
$$;


ALTER FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text") OWNER TO "postgres";

--
-- Name: FUNCTION "verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text"); Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text") IS 'Public certificate verification + logging (Module 5 fix). Returns only publicly-safe fields.';


--
-- Name: verify_certificate("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."verify_certificate"("input_certificate_no" "text") RETURNS TABLE("certificate_no" "text", "participant_name" "text", "course_name" "text", "course_code" "text", "training_start_date" "date", "training_end_date" "date", "issue_date" "date", "expiry_date" "date", "status" "text", "venue" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    c.certificate_no,
    c.participant_name,
    c.course_name,
    c.course_code,
    c.training_start_date,
    c.training_end_date,
    c.issue_date,
    c.expiry_date,
    c.status,
    c.venue
  from public.certificates as c
  where nullif(btrim(input_certificate_no), '') is not null
    and upper(c.certificate_no) = upper(btrim(input_certificate_no))
  limit 1
$$;


ALTER FUNCTION "public"."verify_certificate"("input_certificate_no" "text") OWNER TO "postgres";

--
-- Name: verify_certificate_by_value("text"); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE OR REPLACE FUNCTION "public"."verify_certificate_by_value"("search_value" "text") RETURNS TABLE("participant_name" "text", "course_name" "text", "certificate_no" "text", "training_start_date" "date", "training_end_date" "date", "issue_date" "date", "expiry_date" "date", "status" "text", "trainer_name" "text", "venue" "text", "instructor" "text", "certificate_file_url" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select c.participant_name, c.course_name, c.certificate_no,
         c.training_start_date, c.training_end_date, c.issue_date,
         c.expiry_date, c.status, c.trainer_name, c.venue,
         c.instructor, c.certificate_file_url
  from public.certificates c
  where c.public_verification_enabled = true
    and (upper(trim(c.certificate_no)) = upper(trim(search_value))
      or upper(trim(c.identity_no)) = upper(trim(search_value)))
  order by c.created_at desc
  limit 1;
$$;


ALTER FUNCTION "public"."verify_certificate_by_value"("search_value" "text") OWNER TO "postgres";

--
-- Name: sales_opportunity_seq; Type: SEQUENCE; Schema: app; Owner: postgres
--

CREATE SEQUENCE IF NOT EXISTS "app"."sales_opportunity_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "app"."sales_opportunity_seq" OWNER TO "postgres";

--
-- Name: sales_quotation_seq; Type: SEQUENCE; Schema: app; Owner: postgres
--

CREATE SEQUENCE IF NOT EXISTS "app"."sales_quotation_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "app"."sales_quotation_seq" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: admin_users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."admin_users" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_users" OWNER TO "postgres";

--
-- Name: assessments; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."assessments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid",
    "participant_id" "uuid" NOT NULL,
    "assessment_type" "text",
    "score" numeric(5,2),
    "max_score" numeric(5,2) DEFAULT 100,
    "result" "text" DEFAULT 'pending'::"text" NOT NULL,
    "assessed_at" "date",
    "remarks" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "theory_score" numeric(5,2),
    "practical_score" numeric(5,2),
    "competency_status" "text",
    "locked" boolean DEFAULT false NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by" "uuid",
    "assessor_id" "uuid",
    "deleted_at" timestamp with time zone,
    CONSTRAINT "assessments_competency_status_check" CHECK ((("competency_status" IS NULL) OR ("competency_status" = ANY (ARRAY['pending_review'::"text", 'competent'::"text", 'not_yet_competent'::"text"])))),
    CONSTRAINT "assessments_result_check" CHECK (("result" = ANY (ARRAY['pending'::"text", 'pass'::"text", 'fail'::"text"])))
);


ALTER TABLE "public"."assessments" OWNER TO "postgres";

--
-- Name: attendance; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "participant_id" "uuid" NOT NULL,
    "session_date" "date" NOT NULL,
    "present" boolean DEFAULT false NOT NULL,
    "remarks" "text",
    "recorded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attendance_status" "text" DEFAULT 'absent'::"text" NOT NULL,
    "check_in_time" timestamp with time zone,
    "check_out_time" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "attendance_status_check" CHECK (("attendance_status" = ANY (ARRAY['present'::"text", 'absent'::"text", 'late'::"text", 'excused'::"text"])))
);


ALTER TABLE "public"."attendance" OWNER TO "postgres";

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" bigint NOT NULL,
    "actor_id" "uuid",
    "actor_email" "text",
    "action" "public"."audit_action" NOT NULL,
    "entity_type" "text",
    "entity_id" "text",
    "summary" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";

--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE "public"."audit_logs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."audit_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: certificate_import_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."certificate_import_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_by" "uuid" NOT NULL,
    "source" "text" DEFAULT 'csv'::"text" NOT NULL,
    "source_file_count" integer DEFAULT 0 NOT NULL,
    "row_count" integer DEFAULT 0 NOT NULL,
    "imported_count" integer DEFAULT 0 NOT NULL,
    "skipped_count" integer DEFAULT 0 NOT NULL,
    "error_count" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'completed'::"text" NOT NULL,
    "error_summary" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "certificate_import_logs_source_check" CHECK (("source" = ANY (ARRAY['csv'::"text", 'pdf'::"text"]))),
    CONSTRAINT "certificate_import_logs_status_check" CHECK (("status" = ANY (ARRAY['completed'::"text", 'partial'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."certificate_import_logs" OWNER TO "postgres";

--
-- Name: certificate_number_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE IF NOT EXISTS "public"."certificate_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."certificate_number_seq" OWNER TO "postgres";

--
-- Name: certificate_skill_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."certificate_skill_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "certificate_id" "uuid" NOT NULL,
    "area" "text" NOT NULL,
    "status" "text" NOT NULL,
    "score" numeric,
    "notes" "text",
    "source_skill_result_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "certificate_skill_results_area_check" CHECK (("area" = ANY (ARRAY['theory_session'::"text", 'practical_training'::"text", 'safety_awareness'::"text", 'practical_assessment'::"text", 'attendance_requirement'::"text"]))),
    CONSTRAINT "certificate_skill_results_area_status_check" CHECK (((("area" = 'theory_session'::"text") AND ("status" = ANY (ARRAY['not_recorded'::"text", 'completed'::"text"]))) OR (("area" = 'practical_training'::"text") AND ("status" = ANY (ARRAY['not_recorded'::"text", 'completed'::"text"]))) OR (("area" = 'safety_awareness'::"text") AND ("status" = ANY (ARRAY['not_recorded'::"text", 'completed'::"text"]))) OR (("area" = 'practical_assessment'::"text") AND ("status" = ANY (ARRAY['not_recorded'::"text", 'passed'::"text", 'failed'::"text"]))) OR (("area" = 'attendance_requirement'::"text") AND ("status" = ANY (ARRAY['not_recorded'::"text", 'met'::"text", 'not_met'::"text"])))))
);


ALTER TABLE "public"."certificate_skill_results" OWNER TO "postgres";

--
-- Name: TABLE "certificate_skill_results"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."certificate_skill_results" IS 'Immutable snapshot of a participant''s skill/attendance results, taken once at certificate issuance (Phase 2C). Never updated or deleted by normal staff action -- see app.issue_certificate_with_skill_snapshot / app.duplicate_certificate_with_skill_snapshot.';


--
-- Name: certificate_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."certificate_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "orientation" "text" DEFAULT 'landscape'::"text" NOT NULL,
    "paper_size" "text" DEFAULT 'A4'::"text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."certificate_templates" OWNER TO "postgres";

--
-- Name: certificate_verifications; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."certificate_verifications" (
    "id" bigint NOT NULL,
    "certificate_id" "uuid",
    "certificate_number" "text",
    "method" "text",
    "query_value" "text",
    "status_returned" "text",
    "ip_address" "inet",
    "user_agent" "text",
    "verified_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."certificate_verifications" OWNER TO "postgres";

--
-- Name: certificate_verifications_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

ALTER TABLE "public"."certificate_verifications" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."certificate_verifications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: certificates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."certificates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "certificate_no" "text" NOT NULL,
    "participant_name" "text" NOT NULL,
    "identity_last4" "text",
    "course_name" "text" NOT NULL,
    "course_code" "text",
    "training_start_date" "date",
    "training_end_date" "date",
    "issue_date" "date" NOT NULL,
    "expiry_date" "date",
    "status" "text" DEFAULT 'valid'::"text" NOT NULL,
    "trainer_name" "text",
    "venue" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "participant_id" "uuid" NOT NULL,
    "course_id" "uuid" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "identity_no" "text",
    "instructor" "text",
    "certificate_file_url" "text",
    "public_verification_enabled" boolean DEFAULT true NOT NULL,
    "certificate_number" "text",
    "holder_name" "text",
    "template_id" "uuid",
    "verification_token" "text",
    "verification_url" "text",
    "verification_enabled" boolean DEFAULT true NOT NULL,
    "issued_by" "uuid",
    "remarks" "text",
    "schedule_id" "uuid",
    "deleted_at" timestamp with time zone,
    CONSTRAINT "certificates_status_check" CHECK (("status" = ANY (ARRAY['valid'::"text", 'expired'::"text", 'revoked'::"text", 'draft'::"text", 'issued'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."certificates" OWNER TO "postgres";

--
-- Name: cms_content; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."cms_content" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "content_type" "text" NOT NULL,
    "slug" "text",
    "title" "text",
    "body" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "public"."content_status" DEFAULT 'draft'::"public"."content_status" NOT NULL,
    "featured" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "cms_content_content_type_check" CHECK (("content_type" = ANY (ARRAY['news'::"text", 'faq'::"text", 'testimonial'::"text", 'download'::"text", 'gallery'::"text", 'company'::"text", 'setting'::"text"])))
);


ALTER TABLE "public"."cms_content" OWNER TO "postgres";

--
-- Name: cms_media; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."cms_media" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "bucket" "text" DEFAULT 'media'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "file_name" "text" NOT NULL,
    "mime_type" "text",
    "file_size" bigint,
    "public_url" "text",
    "alt_text" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."cms_media" OWNER TO "postgres";

--
-- Name: companies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."companies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_id" "text",
    "company_name" "text" NOT NULL,
    "registration_no" "text",
    "industry" "text",
    "company_type" "text",
    "address" "text",
    "postcode" "text",
    "city" "text",
    "state" "text",
    "country" "text" DEFAULT 'Malaysia'::"text",
    "phone" "text",
    "email" "text",
    "website" "text",
    "person_in_charge" "text",
    "pic_position" "text",
    "pic_phone" "text",
    "pic_email" "text",
    "billing_address" "text",
    "status" "public"."company_status" DEFAULT 'active'::"public"."company_status" NOT NULL,
    "remarks" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."companies" OWNER TO "postgres";

--
-- Name: company_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE IF NOT EXISTS "public"."company_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."company_id_seq" OWNER TO "postgres";

--
-- Name: company_profile; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."company_profile" (
    "id" integer DEFAULT 1 NOT NULL,
    "legal_name" "text",
    "tagline" "text",
    "about" "text",
    "vision" "text",
    "mission" "text",
    "services" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "phone" "text",
    "email_training" "text",
    "email_admin" "text",
    "address" "text",
    "city" "text",
    "state" "text",
    "postcode" "text",
    "country" "text" DEFAULT 'Malaysia'::"text",
    "google_map_embed" "text",
    "whatsapp" "text",
    "social_media" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "company_profile_id_check" CHECK (("id" = 1))
);


ALTER TABLE "public"."company_profile" OWNER TO "postgres";

--
-- Name: course_schedules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."course_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "trainer_name" "text",
    "venue" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "capacity" integer DEFAULT 0 NOT NULL,
    "seats_taken" integer DEFAULT 0 NOT NULL,
    "status" "public"."schedule_status" DEFAULT 'open'::"public"."schedule_status" NOT NULL,
    "notes" "text",
    "is_published" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "schedule_code" "text",
    "training_mode" "text",
    "start_time" time without time zone,
    "end_time" time without time zone,
    "source_opportunity_id" "uuid",
    "source_quotation_id" "uuid",
    "exam_date" "date",
    CONSTRAINT "course_schedules_capacity_check" CHECK (("capacity" >= 0)),
    CONSTRAINT "course_schedules_check" CHECK ((("seats_taken" >= 0) AND ("seats_taken" <= "capacity"))),
    CONSTRAINT "course_schedules_check1" CHECK (("end_date" >= "start_date"))
);


ALTER TABLE "public"."course_schedules" OWNER TO "postgres";

--
-- Name: COLUMN "course_schedules"."source_opportunity_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."course_schedules"."source_opportunity_id" IS 'Traceability only, set exclusively by the Sales -> Training Operations handoff. Null for schedules created the normal way.';


--
-- Name: COLUMN "course_schedules"."source_quotation_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."course_schedules"."source_quotation_id" IS 'The accepted quotation the handoff was created from, if any. Traceability only.';


--
-- Name: COLUMN "course_schedules"."exam_date"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."course_schedules"."exam_date" IS 'Optional exam date entered by an admin. Not fixed or derived from the training planner.';


--
-- Name: courses; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."courses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_code" "text",
    "course_name" "text",
    "description" "text",
    "validity_months" integer,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" "text",
    "slug" "text",
    "category" "text",
    "summary" "text",
    "overview" "text",
    "duration" "text",
    "objectives" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "target_audience" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "requirements" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "modules" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "faq" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "hero_image_url" "text",
    "fee" numeric(10,2),
    "cms_status" "public"."content_status" DEFAULT 'draft'::"public"."content_status" NOT NULL,
    "featured" boolean DEFAULT false NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "deleted_at" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "delivery_modes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "seo_title" "text",
    "seo_description" "text",
    "published_at" timestamp with time zone,
    "certificate_type" "text" DEFAULT 'completion'::"text" NOT NULL,
    "attendance_min_percent" numeric DEFAULT 100 NOT NULL,
    "assessment_required" boolean DEFAULT false NOT NULL,
    "competency_required" boolean DEFAULT false NOT NULL,
    "certificate_generation_enabled" boolean DEFAULT false NOT NULL,
    "certificate_template_id" "uuid",
    CONSTRAINT "courses_attendance_min_percent_check" CHECK ((("attendance_min_percent" >= (0)::numeric) AND ("attendance_min_percent" <= (100)::numeric))),
    CONSTRAINT "courses_certificate_type_check" CHECK (("certificate_type" = ANY (ARRAY['participation'::"text", 'completion'::"text", 'competency'::"text"]))),
    CONSTRAINT "courses_competency_requires_assessment_check" CHECK (((NOT "competency_required") OR "assessment_required")),
    CONSTRAINT "courses_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text"]))),
    CONSTRAINT "courses_validity_months_check" CHECK ((("validity_months" IS NULL) OR ("validity_months" >= 0)))
);


ALTER TABLE "public"."courses" OWNER TO "postgres";

--
-- Name: COLUMN "courses"."certificate_type"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."courses"."certificate_type" IS 'participation | completion | competency -- drives v_certificate_eligibility, never inferred from category/template names.';


--
-- Name: COLUMN "courses"."attendance_min_percent"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."courses"."attendance_min_percent" IS 'Minimum attendance percentage required for certificate eligibility (0-100, default 100).';


--
-- Name: COLUMN "courses"."assessment_required"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."courses"."assessment_required" IS 'Whether v_certificate_eligibility requires a passing assessments row before a certificate can be issued.';


--
-- Name: COLUMN "courses"."competency_required"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."courses"."competency_required" IS 'Whether assessments.competency_status must equal competent in addition to result=pass. Implies assessment_required.';


--
-- Name: COLUMN "courses"."certificate_generation_enabled"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."courses"."certificate_generation_enabled" IS 'Explicit opt-in: certificate generation for schedules of this course is only permitted once staff have deliberately enabled it (and bound a template). Never inferred from other config defaults.';


--
-- Name: COLUMN "courses"."certificate_template_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."courses"."certificate_template_id" IS 'Which certificate_templates row generateCertificate must bind new certificates to for this course. NULL blocks generation even if certificate_generation_enabled=true (see v_certificate_eligibility).';


--
-- Name: downloads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."downloads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "slug" "text",
    "description" "text",
    "category" "text",
    "media_id" "uuid",
    "file_url" "text",
    "file_size" bigint,
    "download_count" integer DEFAULT 0 NOT NULL,
    "status" "public"."content_status" DEFAULT 'published'::"public"."content_status" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."downloads" OWNER TO "postgres";

--
-- Name: enquiries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."enquiries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "company" "text",
    "email" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "enquiry_type" "text" NOT NULL,
    "subject" "text" NOT NULL,
    "message" "text" NOT NULL,
    "source_page" "text" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "enquiries_company_check" CHECK ((("company" IS NULL) OR ("char_length"("company") <= 160))),
    CONSTRAINT "enquiries_email_check" CHECK ((("char_length"("email") >= 3) AND ("char_length"("email") <= 254))),
    CONSTRAINT "enquiries_enquiry_type_check" CHECK (("enquiry_type" = ANY (ARRAY['Corporate'::"text", 'Individual'::"text", 'Government'::"text", 'Training'::"text"]))),
    CONSTRAINT "enquiries_message_check" CHECK ((("char_length"("message") >= 1) AND ("char_length"("message") <= 3000))),
    CONSTRAINT "enquiries_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 120))),
    CONSTRAINT "enquiries_phone_check" CHECK ((("char_length"("phone") >= 1) AND ("char_length"("phone") <= 40))),
    CONSTRAINT "enquiries_source_page_check" CHECK (("source_page" = ANY (ARRAY['homepage'::"text", 'contact_page'::"text"]))),
    CONSTRAINT "enquiries_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'contacted'::"text", 'closed'::"text"]))),
    CONSTRAINT "enquiries_subject_check" CHECK ((("char_length"("subject") >= 1) AND ("char_length"("subject") <= 160)))
);


ALTER TABLE "public"."enquiries" OWNER TO "postgres";

--
-- Name: faq_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."faq_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."faq_categories" OWNER TO "postgres";

--
-- Name: faqs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."faqs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question" "text" NOT NULL,
    "answer" "text" NOT NULL,
    "category_id" "uuid",
    "status" "public"."content_status" DEFAULT 'published'::"public"."content_status" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."faqs" OWNER TO "postgres";

--
-- Name: feedback_improvement_actions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."feedback_improvement_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "issue_id" "uuid" NOT NULL,
    "schedule_id" "uuid",
    "category" "text",
    "department" "text",
    "title" "text" NOT NULL,
    "description" "text",
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "assigned_to" "uuid",
    "due_date" "date",
    "corrective_action" "text",
    "verification_note" "text",
    "resolved_at" timestamp with time zone,
    "verified_at" timestamp with time zone,
    "closed_at" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "feedback_improvement_actions_category_check" CHECK (("char_length"("category") <= 120)),
    CONSTRAINT "feedback_improvement_actions_corrective_action_check" CHECK (("char_length"("corrective_action") <= 4000)),
    CONSTRAINT "feedback_improvement_actions_department_check" CHECK (("char_length"("department") <= 160)),
    CONSTRAINT "feedback_improvement_actions_description_check" CHECK (("char_length"("description") <= 4000)),
    CONSTRAINT "feedback_improvement_actions_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "feedback_improvement_actions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'assigned'::"text", 'in_progress'::"text", 'resolved'::"text", 'verified'::"text", 'closed'::"text"]))),
    CONSTRAINT "feedback_improvement_actions_title_check" CHECK ((("char_length"("title") >= 3) AND ("char_length"("title") <= 240))),
    CONSTRAINT "feedback_improvement_actions_verification_note_check" CHECK (("char_length"("verification_note") <= 4000))
);


ALTER TABLE "public"."feedback_improvement_actions" OWNER TO "postgres";

--
-- Name: feedback_issues; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."feedback_issues" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_feedback_id" "uuid",
    "schedule_id" "uuid",
    "category" "text",
    "department" "text",
    "title" "text" NOT NULL,
    "description" "text",
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "feedback_issues_category_check" CHECK (("char_length"("category") <= 120)),
    CONSTRAINT "feedback_issues_department_check" CHECK (("char_length"("department") <= 160)),
    CONSTRAINT "feedback_issues_description_check" CHECK (("char_length"("description") <= 4000)),
    CONSTRAINT "feedback_issues_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text", 'critical'::"text"]))),
    CONSTRAINT "feedback_issues_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'resolved'::"text", 'closed'::"text"]))),
    CONSTRAINT "feedback_issues_title_check" CHECK ((("char_length"("title") >= 3) AND ("char_length"("title") <= 240)))
);


ALTER TABLE "public"."feedback_issues" OWNER TO "postgres";

--
-- Name: feedback_schedule_links; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."feedback_schedule_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "public_token" "text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "disabled_at" timestamp with time zone,
    CONSTRAINT "feedback_schedule_links_disabled_state" CHECK ((("is_active" AND ("disabled_at" IS NULL)) OR ((NOT "is_active") AND ("disabled_at" IS NOT NULL)))),
    CONSTRAINT "feedback_schedule_links_public_token_format" CHECK (("public_token" ~ '^[A-Za-z0-9_-]{32,128}$'::"text"))
);


ALTER TABLE "public"."feedback_schedule_links" OWNER TO "postgres";

--
-- Name: TABLE "feedback_schedule_links"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."feedback_schedule_links" IS 'One opaque public class-feedback entry token per schedule. It never replaces individual participant feedback tokens.';


--
-- Name: feedback_schedule_lookup_attempts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."feedback_schedule_lookup_attempts" (
    "schedule_link_id" "uuid" NOT NULL,
    "request_fingerprint_hash" "text" NOT NULL,
    "window_started_at" timestamp with time zone NOT NULL,
    "attempt_count" integer DEFAULT 1 NOT NULL,
    "last_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "feedback_schedule_lookup_attempts_attempt_count_check" CHECK ((("attempt_count" >= 1) AND ("attempt_count" <= 5))),
    CONSTRAINT "feedback_schedule_lookup_attempts_fingerprint_format" CHECK (("request_fingerprint_hash" ~ '^[0-9a-f]{64}$'::"text"))
);


ALTER TABLE "public"."feedback_schedule_lookup_attempts" OWNER TO "postgres";

--
-- Name: TABLE "feedback_schedule_lookup_attempts"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."feedback_schedule_lookup_attempts" IS 'Short-lived schedule-feedback lookup throttle. Stores only a server HMAC request fingerprint, never identity data.';


--
-- Name: gallery_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."gallery_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."gallery_categories" OWNER TO "postgres";

--
-- Name: gallery_images; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."gallery_images" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text",
    "alt_text" "text" DEFAULT ''::"text" NOT NULL,
    "media_id" "uuid",
    "image_url" "text" NOT NULL,
    "category_id" "uuid",
    "featured" boolean DEFAULT false NOT NULL,
    "status" "public"."content_status" DEFAULT 'published'::"public"."content_status" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."gallery_images" OWNER TO "postgres";

--
-- Name: media; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."media" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "folder_id" "uuid",
    "kind" "public"."media_kind" DEFAULT 'image'::"public"."media_kind" NOT NULL,
    "bucket" "text" DEFAULT 'media'::"text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "public_url" "text",
    "file_name" "text" NOT NULL,
    "mime_type" "text",
    "file_size" bigint,
    "width" integer,
    "height" integer,
    "alt_text" "text",
    "title" "text",
    "status" "public"."content_status" DEFAULT 'published'::"public"."content_status" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."media" OWNER TO "postgres";

--
-- Name: media_folders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."media_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "parent_id" "uuid",
    "path" "text" DEFAULT '/'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."media_folders" OWNER TO "postgres";

--
-- Name: news_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."news_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."news_categories" OWNER TO "postgres";

--
-- Name: news_posts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."news_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "excerpt" "text",
    "body" "text",
    "category_id" "uuid",
    "featured_image_url" "text",
    "featured" boolean DEFAULT false NOT NULL,
    "status" "public"."content_status" DEFAULT 'draft'::"public"."content_status" NOT NULL,
    "scheduled_for" timestamp with time zone,
    "published_at" timestamp with time zone,
    "seo_title" "text",
    "seo_description" "text",
    "author_id" "uuid",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone
);


ALTER TABLE "public"."news_posts" OWNER TO "postgres";

--
-- Name: participant_feedback; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."participant_feedback" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "participant_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "q1_score" smallint,
    "q2_score" smallint,
    "q3_score" smallint,
    "q4_score" smallint,
    "q5_score" smallint,
    "q6_score" smallint,
    "q7_score" smallint,
    "q8_score" smallint,
    "q9_score" smallint,
    "q10_score" smallint,
    "nps" smallint,
    "liked_most" "text",
    "improve" "text",
    "had_problem" boolean DEFAULT false NOT NULL,
    "problem_category" "text",
    "problem_description" "text",
    "submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "participant_feedback_improve_check" CHECK (("char_length"("improve") <= 2000)),
    CONSTRAINT "participant_feedback_liked_most_check" CHECK (("char_length"("liked_most") <= 2000)),
    CONSTRAINT "participant_feedback_nps_check" CHECK ((("nps" >= 0) AND ("nps" <= 10))),
    CONSTRAINT "participant_feedback_problem_category_check" CHECK ((("problem_category" = ANY (ARRAY['registration'::"text", 'trainer'::"text", 'training_material'::"text", 'practical_equipment'::"text", 'venue'::"text", 'food_refreshment'::"text", 'schedule'::"text", 'assessment_examination'::"text", 'certificate'::"text", 'staff_service'::"text", 'others'::"text"])) OR ("problem_category" IS NULL))),
    CONSTRAINT "participant_feedback_problem_description_check" CHECK (("char_length"("problem_description") <= 2000)),
    CONSTRAINT "participant_feedback_q10_score_check" CHECK ((("q10_score" >= 1) AND ("q10_score" <= 5))),
    CONSTRAINT "participant_feedback_q1_score_check" CHECK ((("q1_score" >= 1) AND ("q1_score" <= 5))),
    CONSTRAINT "participant_feedback_q2_score_check" CHECK ((("q2_score" >= 1) AND ("q2_score" <= 5))),
    CONSTRAINT "participant_feedback_q3_score_check" CHECK ((("q3_score" >= 1) AND ("q3_score" <= 5))),
    CONSTRAINT "participant_feedback_q4_score_check" CHECK ((("q4_score" >= 1) AND ("q4_score" <= 5))),
    CONSTRAINT "participant_feedback_q5_score_check" CHECK ((("q5_score" >= 1) AND ("q5_score" <= 5))),
    CONSTRAINT "participant_feedback_q6_score_check" CHECK ((("q6_score" >= 1) AND ("q6_score" <= 5))),
    CONSTRAINT "participant_feedback_q7_score_check" CHECK ((("q7_score" >= 1) AND ("q7_score" <= 5))),
    CONSTRAINT "participant_feedback_q8_score_check" CHECK ((("q8_score" >= 1) AND ("q8_score" <= 5))),
    CONSTRAINT "participant_feedback_q9_score_check" CHECK ((("q9_score" >= 1) AND ("q9_score" <= 5))),
    CONSTRAINT "participant_feedback_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'submitted'::"text"])))
);


ALTER TABLE "public"."participant_feedback" OWNER TO "postgres";

--
-- Name: TABLE "participant_feedback"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."participant_feedback" IS 'Participant feedback per schedule/enrollment. participant_id is stored for duplicate prevention / response-rate calculations only; trainers have no RLS access to this table.';


--
-- Name: participant_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE IF NOT EXISTS "public"."participant_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."participant_id_seq" OWNER TO "postgres";

--
-- Name: participant_skill_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."participant_skill_results" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "participant_id" "uuid" NOT NULL,
    "area" "text" NOT NULL,
    "status" "text" DEFAULT 'not_recorded'::"text" NOT NULL,
    "score" numeric,
    "notes" "text",
    "assessed_by" "uuid",
    "assessed_at" timestamp with time zone,
    "locked" boolean DEFAULT false NOT NULL,
    "locked_at" timestamp with time zone,
    "locked_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "participant_skill_results_area_check" CHECK (("area" = ANY (ARRAY['theory_session'::"text", 'practical_training'::"text", 'safety_awareness'::"text", 'practical_assessment'::"text"]))),
    CONSTRAINT "participant_skill_results_status_check" CHECK (("status" = ANY (ARRAY['not_recorded'::"text", 'completed'::"text", 'passed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."participant_skill_results" OWNER TO "postgres";

--
-- Name: TABLE "participant_skill_results"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."participant_skill_results" IS 'Per-area (theory/practical/safety/practical-assessment) trainer-entered result for one participant on one schedule. Feeds the Template A certificate Participant Skills Record (Phase 2C, not yet built) -- table is intentionally empty until the Assessment UI (Phase 2B, not yet built) can write to it.';


--
-- Name: participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "participant_code" "text" DEFAULT ('TRS-P-'::"text" || "upper"("substr"("replace"(("gen_random_uuid"())::"text", '-'::"text", ''::"text"), 1, 8))) NOT NULL,
    "full_name" "text" NOT NULL,
    "identity_no" "text",
    "identity_last4" "text",
    "email" "text",
    "phone" "text",
    "organization" "text",
    "position" "text",
    "address" "text",
    "notes" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "schedule_id" "uuid",
    "company" "text",
    "deleted_at" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "participant_id" "text",
    "ic_passport_no" "text",
    "nationality" "text" DEFAULT 'Malaysian'::"text",
    "gender" "text",
    "date_of_birth" "date",
    "registration_date" "date" DEFAULT CURRENT_DATE,
    "emergency_contact_name" "text",
    "emergency_contact_phone" "text",
    "company_id" "uuid",
    CONSTRAINT "participants_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'registered'::"text", 'confirmed'::"text", 'attended'::"text", 'no_show'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."participants" OWNER TO "postgres";

--
-- Name: COLUMN "participants"."participant_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."participants"."participant_id" IS 'Auto-generated public identifier, e.g. TU-000123.';


--
-- Name: COLUMN "participants"."ic_passport_no"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."participants"."ic_passport_no" IS 'IC or passport number (mirrors legacy identity_no for pre-existing rows).';


--
-- Name: photo_activity_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."photo_activity_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "photo_id" "uuid",
    "action" "text" NOT NULL,
    "actor_name" "text",
    "actor_telegram_id" bigint,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "photo_activity_log_action_check" CHECK (("action" = ANY (ARRAY['upload'::"text", 'approve'::"text", 'reject'::"text", 'event_change'::"text", 'category_change'::"text", 'usage_add'::"text", 'usage_remove'::"text", 'best_photo_on'::"text", 'best_photo_off'::"text", 'notes_change'::"text"])))
);

ALTER TABLE ONLY "public"."photo_activity_log" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_activity_log" OWNER TO "postgres";

--
-- Name: photo_ai_analysis; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."photo_ai_analysis" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "photo_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "model" "text" NOT NULL,
    "analysis_version" "text" NOT NULL,
    "overall_score" numeric NOT NULL,
    "sharpness_score" numeric NOT NULL,
    "composition_score" numeric NOT NULL,
    "subject_clarity_score" numeric NOT NULL,
    "training_relevance_score" numeric NOT NULL,
    "professionalism_score" numeric NOT NULL,
    "story_impact_score" numeric NOT NULL,
    "visual_engagement_score" numeric NOT NULL,
    "ppe_score" numeric,
    "recommended_best_photo" boolean DEFAULT false NOT NULL,
    "recommended_usages" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "quality_flags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "short_reason" "text" DEFAULT ''::"text" NOT NULL,
    "latency_ms" integer,
    "input_size_bytes" bigint,
    "provider_request_id" "text",
    "provider_metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "photo_ai_analysis_composition_score_check" CHECK ((("composition_score" >= (0)::numeric) AND ("composition_score" <= (100)::numeric))),
    CONSTRAINT "photo_ai_analysis_overall_score_check" CHECK ((("overall_score" >= (0)::numeric) AND ("overall_score" <= (100)::numeric))),
    CONSTRAINT "photo_ai_analysis_ppe_score_check" CHECK ((("ppe_score" IS NULL) OR (("ppe_score" >= (0)::numeric) AND ("ppe_score" <= (100)::numeric)))),
    CONSTRAINT "photo_ai_analysis_professionalism_score_check" CHECK ((("professionalism_score" >= (0)::numeric) AND ("professionalism_score" <= (100)::numeric))),
    CONSTRAINT "photo_ai_analysis_provider_metadata_check" CHECK ((("provider_metadata" IS NULL) OR ("jsonb_typeof"("provider_metadata") = 'object'::"text"))),
    CONSTRAINT "photo_ai_analysis_quality_flags_check" CHECK (("jsonb_typeof"("quality_flags") = 'array'::"text")),
    CONSTRAINT "photo_ai_analysis_recommended_usages_check" CHECK (("jsonb_typeof"("recommended_usages") = 'array'::"text")),
    CONSTRAINT "photo_ai_analysis_sharpness_score_check" CHECK ((("sharpness_score" >= (0)::numeric) AND ("sharpness_score" <= (100)::numeric))),
    CONSTRAINT "photo_ai_analysis_story_impact_score_check" CHECK ((("story_impact_score" >= (0)::numeric) AND ("story_impact_score" <= (100)::numeric))),
    CONSTRAINT "photo_ai_analysis_subject_clarity_score_check" CHECK ((("subject_clarity_score" >= (0)::numeric) AND ("subject_clarity_score" <= (100)::numeric))),
    CONSTRAINT "photo_ai_analysis_training_relevance_score_check" CHECK ((("training_relevance_score" >= (0)::numeric) AND ("training_relevance_score" <= (100)::numeric))),
    CONSTRAINT "photo_ai_analysis_visual_engagement_score_check" CHECK ((("visual_engagement_score" >= (0)::numeric) AND ("visual_engagement_score" <= (100)::numeric)))
);

ALTER TABLE ONLY "public"."photo_ai_analysis" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_ai_analysis" OWNER TO "postgres";

--
-- Name: TABLE "photo_ai_analysis"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."photo_ai_analysis" IS 'AI-assisted analysis history. Advisory only — never auto-approves, never auto-publishes, never sets Best Photo, never inserts photo_usages. Human remains the final decision maker. One row per (photo, provider, model, analysis_version); the same photo can carry analyses from different providers/models/versions for benchmark comparison.';


--
-- Name: COLUMN "photo_ai_analysis"."latency_ms"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."photo_ai_analysis"."latency_ms" IS 'Provider request duration in milliseconds (safe operational metadata).';


--
-- Name: COLUMN "photo_ai_analysis"."input_size_bytes"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."photo_ai_analysis"."input_size_bytes" IS 'Size of the image input submitted to the provider, in bytes.';


--
-- Name: COLUMN "photo_ai_analysis"."provider_request_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."photo_ai_analysis"."provider_request_id" IS 'Provider response/request identifier, when safely exposed.';


--
-- Name: COLUMN "photo_ai_analysis"."provider_metadata"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."photo_ai_analysis"."provider_metadata" IS 'Safe operational metadata only (finish reason, retry count, token counts). Must never contain API keys, signed URLs, image data, or request bodies.';


--
-- Name: photo_categories; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."photo_categories" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."photo_categories" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_categories" OWNER TO "postgres";

--
-- Name: photo_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."photo_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "event_date" "date",
    "location" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "photo_events_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'completed'::"text", 'archived'::"text"])))
);

ALTER TABLE ONLY "public"."photo_events" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_events" OWNER TO "postgres";

--
-- Name: photo_id_sequences; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."photo_id_sequences" (
    "seq_date" "date" NOT NULL,
    "last_value" bigint DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."photo_id_sequences" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_id_sequences" OWNER TO "postgres";

--
-- Name: photo_usage_types; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."photo_usage_types" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."photo_usage_types" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_usage_types" OWNER TO "postgres";

--
-- Name: photo_usages; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."photo_usages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "photo_id" "uuid" NOT NULL,
    "usage_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."photo_usages" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_usages" OWNER TO "postgres";

--
-- Name: photos; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "media_id" "uuid" NOT NULL,
    "photo_id" "text" NOT NULL,
    "telegram_file_id" "text",
    "telegram_file_unique_id" "text",
    "event_id" "uuid",
    "category" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "is_best_photo" boolean DEFAULT false NOT NULL,
    "uploaded_by" "text",
    "uploaded_by_telegram_id" bigint,
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reviewed_by" "text",
    "reviewed_at" timestamp with time zone,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "photos_best_photo_requires_approved_check" CHECK (((NOT "is_best_photo") OR ("status" = 'approved'::"text"))),
    CONSTRAINT "photos_photo_id_format_check" CHECK (("photo_id" ~ '^TERAS-PH-[0-9]{8}-[0-9]{4}$'::"text")),
    CONSTRAINT "photos_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"])))
);

ALTER TABLE ONLY "public"."photos" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photos" OWNER TO "postgres";

--
-- Name: profiles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "extensions"."citext" NOT NULL,
    "full_name" "text",
    "phone" "text",
    "avatar_url" "text",
    "job_title" "text",
    "role" "public"."user_role" DEFAULT 'editor'::"public"."user_role" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "last_login_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";

--
-- Name: proposal_requests; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."proposal_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_name" "text" NOT NULL,
    "contact_person" "text" NOT NULL,
    "job_title" "text",
    "email" "text" NOT NULL,
    "phone" "text" NOT NULL,
    "industry" "text" NOT NULL,
    "category" "text" NOT NULL,
    "programme" "text",
    "participants" integer,
    "location" "text",
    "preferred_month" "text",
    "budget" "text",
    "objectives" "text" NOT NULL,
    "notes" "text",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "assigned_to" "uuid",
    "email_sent" boolean DEFAULT false NOT NULL,
    "sheets_synced" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "proposal_requests_budget_check" CHECK ((("budget" IS NULL) OR ("char_length"("budget") <= 80))),
    CONSTRAINT "proposal_requests_category_check" CHECK (("category" = ANY (ARRAY['Industrial Safety'::"text", 'Technical Competency'::"text", 'Industrial Consultancy'::"text", 'Workforce Development'::"text"]))),
    CONSTRAINT "proposal_requests_company_name_check" CHECK ((("char_length"("company_name") >= 1) AND ("char_length"("company_name") <= 160))),
    CONSTRAINT "proposal_requests_contact_person_check" CHECK ((("char_length"("contact_person") >= 1) AND ("char_length"("contact_person") <= 120))),
    CONSTRAINT "proposal_requests_email_check" CHECK ((("char_length"("email") >= 3) AND ("char_length"("email") <= 254))),
    CONSTRAINT "proposal_requests_industry_check" CHECK (("industry" = ANY (ARRAY['Oil & Gas'::"text", 'Petrochemical'::"text", 'Construction'::"text", 'Manufacturing'::"text", 'Marine & Offshore'::"text", 'Power & Utilities'::"text", 'Government & GLC'::"text", 'Others'::"text"]))),
    CONSTRAINT "proposal_requests_job_title_check" CHECK ((("job_title" IS NULL) OR ("char_length"("job_title") <= 120))),
    CONSTRAINT "proposal_requests_location_check" CHECK ((("location" IS NULL) OR ("char_length"("location") <= 160))),
    CONSTRAINT "proposal_requests_notes_check" CHECK ((("notes" IS NULL) OR ("char_length"("notes") <= 3000))),
    CONSTRAINT "proposal_requests_objectives_check" CHECK ((("char_length"("objectives") >= 1) AND ("char_length"("objectives") <= 3000))),
    CONSTRAINT "proposal_requests_participants_check" CHECK ((("participants" IS NULL) OR (("participants" >= 1) AND ("participants" <= 1000000)))),
    CONSTRAINT "proposal_requests_phone_check" CHECK ((("char_length"("phone") >= 1) AND ("char_length"("phone") <= 40))),
    CONSTRAINT "proposal_requests_preferred_month_check" CHECK ((("preferred_month" IS NULL) OR ("char_length"("preferred_month") <= 7))),
    CONSTRAINT "proposal_requests_programme_check" CHECK ((("programme" IS NULL) OR ("char_length"("programme") <= 160))),
    CONSTRAINT "proposal_requests_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'in_review'::"text", 'assigned'::"text", 'quoted'::"text", 'won'::"text", 'lost'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."proposal_requests" OWNER TO "postgres";

--
-- Name: sales_activity; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."sales_activity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_metadata_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "note" "text",
    "actor_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "opportunity_id" "uuid",
    "quotation_id" "uuid",
    CONSTRAINT "sales_activity_note_check" CHECK ((("note" IS NULL) OR ("char_length"("note") <= 3000))),
    CONSTRAINT "sales_activity_type_check" CHECK (("type" = ANY (ARRAY['lead_created'::"text", 'status_changed'::"text", 'assigned'::"text", 'followup_scheduled'::"text", 'note_added'::"text", 'proposal_sent'::"text", 'won'::"text", 'lost'::"text", 'opportunity_created'::"text", 'quotation_created'::"text", 'quotation_sent'::"text", 'quotation_revised'::"text", 'quotation_accepted'::"text", 'quotation_rejected'::"text", 'opportunity_won'::"text", 'opportunity_lost'::"text", 'training_handoff_created'::"text", 'company_linked'::"text", 'company_created'::"text", 'task_created'::"text", 'task_completed'::"text", 'task_reopened'::"text", 'task_cancelled'::"text"])))
);


ALTER TABLE "public"."sales_activity" OWNER TO "postgres";

--
-- Name: sales_lead_metadata; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."sales_lead_metadata" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_source" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "assigned_to" "uuid",
    "follow_up_at" timestamp with time zone,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "lost_reason" "text",
    "won_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "sales_lead_metadata_lead_source_check" CHECK (("lead_source" = ANY (ARRAY['enquiry'::"text", 'proposal_request'::"text"]))),
    CONSTRAINT "sales_lead_metadata_lost_reason_check" CHECK ((("lost_reason" IS NULL) OR ("lost_reason" = ANY (ARRAY['price'::"text", 'no_budget'::"text", 'no_response'::"text", 'timing'::"text", 'competitor'::"text", 'requirement_changed'::"text", 'duplicate'::"text", 'other'::"text"])))),
    CONSTRAINT "sales_lead_metadata_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "sales_lead_metadata_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'contacted'::"text", 'qualified'::"text", 'proposal_sent'::"text", 'negotiation'::"text", 'won'::"text", 'lost'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."sales_lead_metadata" OWNER TO "postgres";

--
-- Name: sales_opportunities; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."sales_opportunities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_metadata_id" "uuid" NOT NULL,
    "opportunity_no" "text" DEFAULT "app"."next_opportunity_number"() NOT NULL,
    "company_name" "text",
    "contact_person" "text",
    "contact_email" "text",
    "contact_phone" "text",
    "title" "text" NOT NULL,
    "programme" "text",
    "stage" "text" DEFAULT 'qualified'::"text" NOT NULL,
    "assigned_to" "uuid",
    "expected_close_date" "date",
    "probability" integer,
    "estimated_value" numeric(12,2),
    "lost_reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "won_at" timestamp with time zone,
    "lost_at" timestamp with time zone,
    "company_id" "uuid",
    CONSTRAINT "sales_opportunities_estimated_value_check" CHECK ((("estimated_value" IS NULL) OR ("estimated_value" >= (0)::numeric))),
    CONSTRAINT "sales_opportunities_lost_reason_check" CHECK ((("lost_reason" IS NULL) OR ("lost_reason" = ANY (ARRAY['price'::"text", 'no_budget'::"text", 'no_response'::"text", 'timing'::"text", 'competitor'::"text", 'requirement_changed'::"text", 'duplicate'::"text", 'other'::"text"])))),
    CONSTRAINT "sales_opportunities_probability_check" CHECK ((("probability" IS NULL) OR (("probability" >= 0) AND ("probability" <= 100)))),
    CONSTRAINT "sales_opportunities_stage_check" CHECK (("stage" = ANY (ARRAY['new'::"text", 'qualified'::"text", 'quotation'::"text", 'negotiation'::"text", 'won'::"text", 'lost'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."sales_opportunities" OWNER TO "postgres";

--
-- Name: COLUMN "sales_opportunities"."company_id"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON COLUMN "public"."sales_opportunities"."company_id" IS 'Confirmed link to the canonical companies record, set only via explicit staff confirmation (Link Existing Company / Create Company on a Won Opportunity). Null until linked.';


--
-- Name: sales_quotation_items; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."sales_quotation_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "quotation_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "quantity" numeric(10,2) DEFAULT 1 NOT NULL,
    "unit" "text" DEFAULT 'pax'::"text" NOT NULL,
    "unit_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount" numeric(12,2) DEFAULT 0 NOT NULL,
    "line_total" numeric(12,2) GENERATED ALWAYS AS ("round"((("quantity" * "unit_price") - "discount"), 2)) STORED,
    "sort_order" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "sales_quotation_items_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 500))),
    CONSTRAINT "sales_quotation_items_discount_check" CHECK (("discount" >= (0)::numeric)),
    CONSTRAINT "sales_quotation_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "sales_quotation_items_unit_check" CHECK (("unit" = ANY (ARRAY['pax'::"text", 'session'::"text", 'day'::"text", 'lot'::"text", 'unit'::"text"]))),
    CONSTRAINT "sales_quotation_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."sales_quotation_items" OWNER TO "postgres";

--
-- Name: sales_quotations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."sales_quotations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "opportunity_id" "uuid" NOT NULL,
    "quotation_no" "text" DEFAULT "app"."next_quotation_number"() NOT NULL,
    "revision_no" integer DEFAULT 0 NOT NULL,
    "parent_quotation_id" "uuid",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_until" "date",
    "currency" "text" DEFAULT 'MYR'::"text" NOT NULL,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount" numeric(12,2) DEFAULT 0 NOT NULL,
    "sst_applicable" boolean DEFAULT false NOT NULL,
    "sst_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "tax" numeric(12,2) DEFAULT 0 NOT NULL,
    "total" numeric(12,2) DEFAULT 0 NOT NULL,
    "terms" "text",
    "notes" "text",
    "rejection_reason" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sent_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "superseded_at" timestamp with time zone,
    CONSTRAINT "sales_quotations_discount_check" CHECK (("discount" >= (0)::numeric)),
    CONSTRAINT "sales_quotations_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'accepted'::"text", 'rejected'::"text", 'expired'::"text", 'superseded'::"text"])))
);


ALTER TABLE "public"."sales_quotations" OWNER TO "postgres";

--
-- Name: sales_tasks; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."sales_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "due_at" timestamp with time zone,
    "assigned_to" "uuid",
    "lead_metadata_id" "uuid",
    "opportunity_id" "uuid",
    "quotation_id" "uuid",
    "created_by" "uuid",
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "sales_tasks_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "sales_tasks_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'in_progress'::"text", 'completed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."sales_tasks" OWNER TO "postgres";

--
-- Name: TABLE "sales_tasks"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON TABLE "public"."sales_tasks" IS 'Sales CRM Phase 4B — general sales to-dos, optionally linked to a lead/opportunity/quotation. Not a project-management suite; deliberately minimal.';


--
-- Name: schedule_code_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE IF NOT EXISTS "public"."schedule_code_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."schedule_code_seq" OWNER TO "postgres";

--
-- Name: schedule_participants; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE IF NOT EXISTS "public"."schedule_participants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "participant_id" "uuid" NOT NULL,
    "registration_status" "text" DEFAULT 'registered'::"text" NOT NULL,
    "enrolled_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "schedule_participants_registration_status_check" CHECK (("registration_status" = ANY (ARRAY['registered'::"text", 'confirmed'::"text", 'cancelled'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."schedule_participants" OWNER TO "postgres";

--
-- Name: v_certificate_eligibility; Type: VIEW; Schema: public; Owner: postgres
--

CREATE OR REPLACE VIEW "public"."v_certificate_eligibility" WITH ("security_invoker"='true') AS
 WITH "enrollment" AS (
         SELECT "schedule_participants"."schedule_id",
            "schedule_participants"."participant_id",
            "schedule_participants"."registration_status" AS "enrollment_status"
           FROM "public"."schedule_participants"
          WHERE ("schedule_participants"."deleted_at" IS NULL)
        ), "attendance_agg" AS (
         SELECT "attendance"."schedule_id",
            "attendance"."participant_id",
            "count"(*) FILTER (WHERE ("attendance"."attendance_status" = 'present'::"text")) AS "present_days",
            "count"(*) FILTER (WHERE ("attendance"."attendance_status" = 'late'::"text")) AS "late_days",
            "count"(*) FILTER (WHERE ("attendance"."attendance_status" = 'absent'::"text")) AS "absent_days",
            "count"(*) FILTER (WHERE ("attendance"."attendance_status" = 'excused'::"text")) AS "excused_days",
            "count"(DISTINCT "attendance"."session_date") AS "attendance_days"
           FROM "public"."attendance"
          WHERE ("attendance"."deleted_at" IS NULL)
          GROUP BY "attendance"."schedule_id", "attendance"."participant_id"
        ), "assessment_row" AS (
         SELECT "assessments"."schedule_id",
            "assessments"."participant_id",
            "assessments"."result",
            "assessments"."competency_status",
            "assessments"."theory_score",
            "assessments"."practical_score"
           FROM "public"."assessments"
          WHERE ("assessments"."deleted_at" IS NULL)
        ), "existing_cert" AS (
         SELECT DISTINCT ON ("certificates"."schedule_id", "certificates"."participant_id") "certificates"."schedule_id",
            "certificates"."participant_id",
            "certificates"."id" AS "certificate_id",
            "certificates"."certificate_number"
           FROM "public"."certificates"
          WHERE (("certificates"."deleted_at" IS NULL) AND ("certificates"."schedule_id" IS NOT NULL) AND ("certificates"."status" <> 'revoked'::"text"))
          ORDER BY "certificates"."schedule_id", "certificates"."participant_id", "certificates"."created_at" DESC
        ), "joined" AS (
         SELECT "e"."schedule_id",
            "cs"."schedule_code",
            "e"."participant_id",
            "cs"."course_id",
            COALESCE("co"."title", "co"."course_name") AS "course_name",
            "co"."course_code",
            "p"."full_name" AS "holder_name",
            "e"."enrollment_status",
            ("cs"."status")::"text" AS "schedule_status",
            "cs"."start_date" AS "schedule_start_date",
            "cs"."end_date" AS "schedule_end_date",
            "cs"."venue",
            "cs"."trainer_name",
            COALESCE("att"."present_days", (0)::bigint) AS "present_days",
            COALESCE("att"."late_days", (0)::bigint) AS "late_days",
            COALESCE("att"."absent_days", (0)::bigint) AS "absent_days",
            COALESCE("att"."excused_days", (0)::bigint) AS "excused_days",
            COALESCE("att"."attendance_days", (0)::bigint) AS "attendance_days",
            "co"."certificate_type",
            "co"."attendance_min_percent",
            "co"."assessment_required",
            "co"."competency_required",
            "co"."certificate_generation_enabled",
            "co"."certificate_template_id",
            ("ar"."schedule_id" IS NOT NULL) AS "assessment_row_exists",
            "ar"."result",
            "ar"."competency_status",
            "ar"."theory_score",
            "ar"."practical_score",
            "ec"."certificate_id" AS "existing_certificate_id",
            "ec"."certificate_number" AS "existing_certificate_number",
            (("cs"."end_date" - "cs"."start_date") + 1) AS "calendar_expected_days"
           FROM (((((("enrollment" "e"
             JOIN "public"."course_schedules" "cs" ON ((("cs"."id" = "e"."schedule_id") AND ("cs"."deleted_at" IS NULL))))
             JOIN "public"."courses" "co" ON (("co"."id" = "cs"."course_id")))
             JOIN "public"."participants" "p" ON (("p"."id" = "e"."participant_id")))
             LEFT JOIN "attendance_agg" "att" ON ((("att"."schedule_id" = "e"."schedule_id") AND ("att"."participant_id" = "e"."participant_id"))))
             LEFT JOIN "assessment_row" "ar" ON ((("ar"."schedule_id" = "e"."schedule_id") AND ("ar"."participant_id" = "e"."participant_id"))))
             LEFT JOIN "existing_cert" "ec" ON ((("ec"."schedule_id" = "e"."schedule_id") AND ("ec"."participant_id" = "e"."participant_id"))))
        ), "computed" AS (
         SELECT "j"."schedule_id",
            "j"."schedule_code",
            "j"."participant_id",
            "j"."course_id",
            "j"."course_name",
            "j"."course_code",
            "j"."holder_name",
            "j"."enrollment_status",
            "j"."schedule_status",
            "j"."schedule_start_date",
            "j"."schedule_end_date",
            "j"."venue",
            "j"."trainer_name",
            "j"."present_days",
            "j"."late_days",
            "j"."absent_days",
            "j"."excused_days",
            "j"."attendance_days",
            "j"."certificate_type",
            "j"."attendance_min_percent",
            "j"."assessment_required",
            "j"."competency_required",
            "j"."certificate_generation_enabled",
            "j"."certificate_template_id",
            "j"."assessment_row_exists",
            "j"."result",
            "j"."competency_status",
            "j"."theory_score",
            "j"."practical_score",
            "j"."existing_certificate_id",
            "j"."existing_certificate_number",
            "j"."calendar_expected_days",
            GREATEST(("j"."calendar_expected_days" - "j"."excused_days"), (0)::bigint) AS "effective_expected_days",
            ("j"."present_days" + "j"."late_days") AS "attended_days"
           FROM "joined" "j"
        ), "metrics" AS (
         SELECT "c"."schedule_id",
            "c"."schedule_code",
            "c"."participant_id",
            "c"."course_id",
            "c"."course_name",
            "c"."course_code",
            "c"."holder_name",
            "c"."enrollment_status",
            "c"."schedule_status",
            "c"."schedule_start_date",
            "c"."schedule_end_date",
            "c"."venue",
            "c"."trainer_name",
            "c"."present_days",
            "c"."late_days",
            "c"."absent_days",
            "c"."excused_days",
            "c"."attendance_days",
            "c"."certificate_type",
            "c"."attendance_min_percent",
            "c"."assessment_required",
            "c"."competency_required",
            "c"."certificate_generation_enabled",
            "c"."certificate_template_id",
            "c"."assessment_row_exists",
            "c"."result",
            "c"."competency_status",
            "c"."theory_score",
            "c"."practical_score",
            "c"."existing_certificate_id",
            "c"."existing_certificate_number",
            "c"."calendar_expected_days",
            "c"."effective_expected_days",
            "c"."attended_days",
                CASE
                    WHEN ("c"."effective_expected_days" <= 0) THEN (100)::numeric
                    ELSE "round"(((("c"."attended_days")::numeric * 100.0) / ("c"."effective_expected_days")::numeric), 2)
                END AS "attendance_percentage"
           FROM "computed" "c"
        ), "final" AS (
         SELECT "m"."schedule_id",
            "m"."schedule_code",
            "m"."participant_id",
            "m"."course_id",
            "m"."course_name",
            "m"."course_code",
            "m"."holder_name",
            "m"."enrollment_status",
            "m"."schedule_status",
            "m"."schedule_start_date",
            "m"."schedule_end_date",
            "m"."venue",
            "m"."trainer_name",
            "m"."present_days",
            "m"."late_days",
            "m"."absent_days",
            "m"."excused_days",
            "m"."attendance_days",
            "m"."certificate_type",
            "m"."attendance_min_percent",
            "m"."assessment_required",
            "m"."competency_required",
            "m"."certificate_generation_enabled",
            "m"."certificate_template_id",
            "m"."assessment_row_exists",
            "m"."result",
            "m"."competency_status",
            "m"."theory_score",
            "m"."practical_score",
            "m"."existing_certificate_id",
            "m"."existing_certificate_number",
            "m"."calendar_expected_days",
            "m"."effective_expected_days",
            "m"."attended_days",
            "m"."attendance_percentage",
            ("m"."attendance_percentage" >= "m"."attendance_min_percent") AS "attendance_satisfied",
                CASE
                    WHEN (NOT "m"."assessment_required") THEN true
                    WHEN (NOT "m"."assessment_row_exists") THEN false
                    WHEN ("m"."result" IS DISTINCT FROM 'pass'::"text") THEN false
                    WHEN ("m"."competency_required" AND (COALESCE("m"."competency_status", ''::"text") <> 'competent'::"text")) THEN false
                    ELSE true
                END AS "assessment_satisfied"
           FROM "metrics" "m"
        )
 SELECT "schedule_id",
    "schedule_code",
    "participant_id",
    "course_id",
    "course_name",
    "course_code",
    "holder_name",
    "enrollment_status",
    "schedule_status",
    "schedule_start_date",
    "schedule_end_date",
    "venue",
    "trainer_name",
    "calendar_expected_days",
    "attendance_days",
    "present_days",
    "late_days",
    "absent_days",
    "excused_days",
    "effective_expected_days",
    "attended_days",
    "attendance_percentage",
    "attendance_min_percent",
    "attendance_satisfied",
    "certificate_type",
    "assessment_required",
    "competency_required",
    "assessment_row_exists",
    "result",
    "competency_status",
    "theory_score",
    "practical_score",
    "assessment_satisfied",
    "existing_certificate_id",
    "existing_certificate_number",
    ("certificate_generation_enabled" AND ("certificate_template_id" IS NOT NULL) AND ("enrollment_status" <> 'cancelled'::"text") AND ("schedule_status" = 'completed'::"text") AND "attendance_satisfied" AND "assessment_satisfied" AND ("existing_certificate_id" IS NULL)) AS "eligible",
        CASE
            WHEN (NOT "certificate_generation_enabled") THEN 'certificate_generation_disabled'::"text"
            WHEN ("certificate_template_id" IS NULL) THEN 'certificate_template_not_configured'::"text"
            WHEN ("enrollment_status" = 'cancelled'::"text") THEN 'enrollment_cancelled'::"text"
            WHEN ("schedule_status" <> 'completed'::"text") THEN 'schedule_not_completed'::"text"
            WHEN (NOT "attendance_satisfied") THEN 'attendance_not_met'::"text"
            WHEN ("assessment_required" AND (NOT "assessment_row_exists")) THEN 'assessment_missing'::"text"
            WHEN ("assessment_required" AND ("result" IS DISTINCT FROM 'pass'::"text")) THEN 'assessment_not_passed'::"text"
            WHEN ("assessment_required" AND "competency_required" AND (COALESCE("competency_status", ''::"text") <> 'competent'::"text")) THEN 'competency_not_met'::"text"
            WHEN ("existing_certificate_id" IS NOT NULL) THEN 'certificate_already_exists'::"text"
            ELSE NULL::"text"
        END AS "ineligibility_reason",
    "certificate_generation_enabled",
    "certificate_template_id"
   FROM "final" "f";


ALTER VIEW "public"."v_certificate_eligibility" OWNER TO "postgres";

--
-- Name: v_sales_lead_inbox; Type: VIEW; Schema: public; Owner: postgres
--

CREATE OR REPLACE VIEW "public"."v_sales_lead_inbox" WITH ("security_invoker"='true') AS
 SELECT "m"."id" AS "lead_metadata_id",
    "m"."lead_source",
    "m"."source_id",
    "m"."status",
    "m"."assigned_to",
    "m"."follow_up_at",
    "m"."priority",
    "m"."lost_reason",
    "m"."won_at",
    "m"."created_at",
    "m"."updated_at",
        CASE
            WHEN ("m"."lead_source" = 'enquiry'::"text") THEN "e"."name"
            ELSE "p"."contact_person"
        END AS "contact_name",
        CASE
            WHEN ("m"."lead_source" = 'enquiry'::"text") THEN "e"."company"
            ELSE "p"."company_name"
        END AS "company",
        CASE
            WHEN ("m"."lead_source" = 'enquiry'::"text") THEN "e"."email"
            ELSE "p"."email"
        END AS "email",
        CASE
            WHEN ("m"."lead_source" = 'enquiry'::"text") THEN "e"."phone"
            ELSE "p"."phone"
        END AS "phone",
        CASE
            WHEN ("m"."lead_source" = 'enquiry'::"text") THEN "e"."subject"
            ELSE COALESCE("p"."programme", "p"."category")
        END AS "subject"
   FROM (("public"."sales_lead_metadata" "m"
     LEFT JOIN "public"."enquiries" "e" ON ((("m"."lead_source" = 'enquiry'::"text") AND ("e"."id" = "m"."source_id"))))
     LEFT JOIN "public"."proposal_requests" "p" ON ((("m"."lead_source" = 'proposal_request'::"text") AND ("p"."id" = "m"."source_id"))));


ALTER VIEW "public"."v_sales_lead_inbox" OWNER TO "postgres";

--
-- Name: admin_users admin_users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY ("user_id");


--
-- Name: assessments assessments_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_pkey" PRIMARY KEY ("id");


--
-- Name: assessments assessments_schedule_participant_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_schedule_participant_key" UNIQUE ("schedule_id", "participant_id");


--
-- Name: attendance attendance_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("id");


--
-- Name: attendance attendance_schedule_participant_session_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_schedule_participant_session_key" UNIQUE ("schedule_id", "participant_id", "session_date");


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");


--
-- Name: certificate_import_logs certificate_import_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificate_import_logs"
    ADD CONSTRAINT "certificate_import_logs_pkey" PRIMARY KEY ("id");


--
-- Name: certificate_skill_results certificate_skill_results_certificate_area_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificate_skill_results"
    ADD CONSTRAINT "certificate_skill_results_certificate_area_key" UNIQUE ("certificate_id", "area");


--
-- Name: certificate_skill_results certificate_skill_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificate_skill_results"
    ADD CONSTRAINT "certificate_skill_results_pkey" PRIMARY KEY ("id");


--
-- Name: certificate_templates certificate_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificate_templates"
    ADD CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id");


--
-- Name: certificate_verifications certificate_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificate_verifications"
    ADD CONSTRAINT "certificate_verifications_pkey" PRIMARY KEY ("id");


--
-- Name: certificates certificates_certificate_no_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_certificate_no_key" UNIQUE ("certificate_no");


--
-- Name: certificates certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_pkey" PRIMARY KEY ("id");


--
-- Name: cms_content cms_content_content_type_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."cms_content"
    ADD CONSTRAINT "cms_content_content_type_slug_key" UNIQUE ("content_type", "slug");


--
-- Name: cms_content cms_content_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."cms_content"
    ADD CONSTRAINT "cms_content_pkey" PRIMARY KEY ("id");


--
-- Name: cms_media cms_media_bucket_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."cms_media"
    ADD CONSTRAINT "cms_media_bucket_storage_path_key" UNIQUE ("bucket", "storage_path");


--
-- Name: cms_media cms_media_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."cms_media"
    ADD CONSTRAINT "cms_media_pkey" PRIMARY KEY ("id");


--
-- Name: companies companies_company_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_company_id_key" UNIQUE ("company_id");


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");


--
-- Name: company_profile company_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."company_profile"
    ADD CONSTRAINT "company_profile_pkey" PRIMARY KEY ("id");


--
-- Name: course_schedules course_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_pkey" PRIMARY KEY ("id");


--
-- Name: courses courses_course_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_course_code_key" UNIQUE ("course_code");


--
-- Name: courses courses_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");


--
-- Name: downloads downloads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."downloads"
    ADD CONSTRAINT "downloads_pkey" PRIMARY KEY ("id");


--
-- Name: downloads downloads_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."downloads"
    ADD CONSTRAINT "downloads_slug_key" UNIQUE ("slug");


--
-- Name: enquiries enquiries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."enquiries"
    ADD CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id");


--
-- Name: faq_categories faq_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."faq_categories"
    ADD CONSTRAINT "faq_categories_pkey" PRIMARY KEY ("id");


--
-- Name: faq_categories faq_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."faq_categories"
    ADD CONSTRAINT "faq_categories_slug_key" UNIQUE ("slug");


--
-- Name: faqs faqs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_pkey" PRIMARY KEY ("id");


--
-- Name: feedback_improvement_actions feedback_improvement_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_pkey" PRIMARY KEY ("id");


--
-- Name: feedback_issues feedback_issues_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_issues"
    ADD CONSTRAINT "feedback_issues_pkey" PRIMARY KEY ("id");


--
-- Name: feedback_schedule_links feedback_schedule_links_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_schedule_links"
    ADD CONSTRAINT "feedback_schedule_links_pkey" PRIMARY KEY ("id");


--
-- Name: feedback_schedule_links feedback_schedule_links_public_token_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_schedule_links"
    ADD CONSTRAINT "feedback_schedule_links_public_token_unique" UNIQUE ("public_token");


--
-- Name: feedback_schedule_links feedback_schedule_links_schedule_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_schedule_links"
    ADD CONSTRAINT "feedback_schedule_links_schedule_unique" UNIQUE ("schedule_id");


--
-- Name: feedback_schedule_lookup_attempts feedback_schedule_lookup_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_schedule_lookup_attempts"
    ADD CONSTRAINT "feedback_schedule_lookup_attempts_pkey" PRIMARY KEY ("schedule_link_id", "request_fingerprint_hash", "window_started_at");


--
-- Name: gallery_categories gallery_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."gallery_categories"
    ADD CONSTRAINT "gallery_categories_pkey" PRIMARY KEY ("id");


--
-- Name: gallery_categories gallery_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."gallery_categories"
    ADD CONSTRAINT "gallery_categories_slug_key" UNIQUE ("slug");


--
-- Name: gallery_images gallery_images_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."gallery_images"
    ADD CONSTRAINT "gallery_images_pkey" PRIMARY KEY ("id");


--
-- Name: media media_bucket_storage_path_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."media"
    ADD CONSTRAINT "media_bucket_storage_path_key" UNIQUE ("bucket", "storage_path");


--
-- Name: media_folders media_folders_parent_id_name_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."media_folders"
    ADD CONSTRAINT "media_folders_parent_id_name_key" UNIQUE ("parent_id", "name");


--
-- Name: media_folders media_folders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."media_folders"
    ADD CONSTRAINT "media_folders_pkey" PRIMARY KEY ("id");


--
-- Name: media media_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."media"
    ADD CONSTRAINT "media_pkey" PRIMARY KEY ("id");


--
-- Name: news_categories news_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."news_categories"
    ADD CONSTRAINT "news_categories_pkey" PRIMARY KEY ("id");


--
-- Name: news_categories news_categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."news_categories"
    ADD CONSTRAINT "news_categories_slug_key" UNIQUE ("slug");


--
-- Name: news_posts news_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_pkey" PRIMARY KEY ("id");


--
-- Name: news_posts news_posts_slug_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_slug_key" UNIQUE ("slug");


--
-- Name: participant_feedback participant_feedback_one_per_enrollment; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participant_feedback"
    ADD CONSTRAINT "participant_feedback_one_per_enrollment" UNIQUE ("schedule_id", "participant_id");


--
-- Name: participant_feedback participant_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participant_feedback"
    ADD CONSTRAINT "participant_feedback_pkey" PRIMARY KEY ("id");


--
-- Name: participant_skill_results participant_skill_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_pkey" PRIMARY KEY ("id");


--
-- Name: participant_skill_results participant_skill_results_schedule_participant_area_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_schedule_participant_area_key" UNIQUE ("schedule_id", "participant_id", "area");


--
-- Name: participants participants_participant_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_participant_code_key" UNIQUE ("participant_code");


--
-- Name: participants participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_pkey" PRIMARY KEY ("id");


--
-- Name: photo_activity_log photo_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_activity_log"
    ADD CONSTRAINT "photo_activity_log_pkey" PRIMARY KEY ("id");


--
-- Name: photo_ai_analysis photo_ai_analysis_identity_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_ai_analysis"
    ADD CONSTRAINT "photo_ai_analysis_identity_unique" UNIQUE ("photo_id", "provider", "model", "analysis_version");


--
-- Name: CONSTRAINT "photo_ai_analysis_identity_unique" ON "photo_ai_analysis"; Type: COMMENT; Schema: public; Owner: postgres
--

COMMENT ON CONSTRAINT "photo_ai_analysis_identity_unique" ON "public"."photo_ai_analysis" IS 'Identity of one analysis run: photo + provider + model + analysis_version. This is what makes multi-provider comparison possible without overwriting.';


--
-- Name: photo_ai_analysis photo_ai_analysis_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_ai_analysis"
    ADD CONSTRAINT "photo_ai_analysis_pkey" PRIMARY KEY ("id");


--
-- Name: photo_categories photo_categories_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_categories"
    ADD CONSTRAINT "photo_categories_pkey" PRIMARY KEY ("key");


--
-- Name: photo_events photo_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_events"
    ADD CONSTRAINT "photo_events_pkey" PRIMARY KEY ("id");


--
-- Name: photo_events photo_events_slug_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_events"
    ADD CONSTRAINT "photo_events_slug_unique" UNIQUE ("slug");


--
-- Name: photo_id_sequences photo_id_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_id_sequences"
    ADD CONSTRAINT "photo_id_sequences_pkey" PRIMARY KEY ("seq_date");


--
-- Name: photo_usage_types photo_usage_types_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_usage_types"
    ADD CONSTRAINT "photo_usage_types_pkey" PRIMARY KEY ("key");


--
-- Name: photo_usages photo_usages_photo_usage_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_usages"
    ADD CONSTRAINT "photo_usages_photo_usage_unique" UNIQUE ("photo_id", "usage_type");


--
-- Name: photo_usages photo_usages_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_usages"
    ADD CONSTRAINT "photo_usages_pkey" PRIMARY KEY ("id");


--
-- Name: photos photos_media_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_media_id_unique" UNIQUE ("media_id");


--
-- Name: photos photos_photo_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_photo_id_unique" UNIQUE ("photo_id");


--
-- Name: photos photos_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_pkey" PRIMARY KEY ("id");


--
-- Name: photos photos_telegram_file_unique_id_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_telegram_file_unique_id_unique" UNIQUE ("telegram_file_unique_id");


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");


--
-- Name: proposal_requests proposal_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."proposal_requests"
    ADD CONSTRAINT "proposal_requests_pkey" PRIMARY KEY ("id");


--
-- Name: sales_activity sales_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_activity"
    ADD CONSTRAINT "sales_activity_pkey" PRIMARY KEY ("id");


--
-- Name: sales_lead_metadata sales_lead_metadata_lead_source_source_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_lead_metadata"
    ADD CONSTRAINT "sales_lead_metadata_lead_source_source_id_key" UNIQUE ("lead_source", "source_id");


--
-- Name: sales_lead_metadata sales_lead_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_lead_metadata"
    ADD CONSTRAINT "sales_lead_metadata_pkey" PRIMARY KEY ("id");


--
-- Name: sales_opportunities sales_opportunities_lead_metadata_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_lead_metadata_id_key" UNIQUE ("lead_metadata_id");


--
-- Name: sales_opportunities sales_opportunities_opportunity_no_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_opportunity_no_key" UNIQUE ("opportunity_no");


--
-- Name: sales_opportunities sales_opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_pkey" PRIMARY KEY ("id");


--
-- Name: sales_quotation_items sales_quotation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_quotation_items"
    ADD CONSTRAINT "sales_quotation_items_pkey" PRIMARY KEY ("id");


--
-- Name: sales_quotations sales_quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_quotations"
    ADD CONSTRAINT "sales_quotations_pkey" PRIMARY KEY ("id");


--
-- Name: sales_quotations sales_quotations_quotation_no_revision_no_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_quotations"
    ADD CONSTRAINT "sales_quotations_quotation_no_revision_no_key" UNIQUE ("quotation_no", "revision_no");


--
-- Name: sales_tasks sales_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_pkey" PRIMARY KEY ("id");


--
-- Name: schedule_participants schedule_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."schedule_participants"
    ADD CONSTRAINT "schedule_participants_pkey" PRIMARY KEY ("id");


--
-- Name: assessments_participant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "assessments_participant_idx" ON "public"."assessments" USING "btree" ("participant_id") WHERE ("deleted_at" IS NULL);


--
-- Name: assessments_schedule_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "assessments_schedule_idx" ON "public"."assessments" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);


--
-- Name: attendance_participant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "attendance_participant_idx" ON "public"."attendance" USING "btree" ("participant_id") WHERE ("deleted_at" IS NULL);


--
-- Name: attendance_schedule_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "attendance_schedule_idx" ON "public"."attendance" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);


--
-- Name: certificate_import_logs_created_by_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "certificate_import_logs_created_by_idx" ON "public"."certificate_import_logs" USING "btree" ("created_by");


--
-- Name: certificates_active_schedule_participant_uniq; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "certificates_active_schedule_participant_uniq" ON "public"."certificates" USING "btree" ("schedule_id", "participant_id") WHERE (("deleted_at" IS NULL) AND ("status" <> 'revoked'::"text") AND ("schedule_id" IS NOT NULL));


--
-- Name: certificates_certificate_no_upper_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "certificates_certificate_no_upper_idx" ON "public"."certificates" USING "btree" ("upper"("certificate_no"));


--
-- Name: certificates_course_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "certificates_course_id_idx" ON "public"."certificates" USING "btree" ("course_id");


--
-- Name: certificates_identity_no_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "certificates_identity_no_idx" ON "public"."certificates" USING "btree" ("identity_no");


--
-- Name: certificates_participant_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "certificates_participant_id_idx" ON "public"."certificates" USING "btree" ("participant_id");


--
-- Name: certificates_schedule_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "certificates_schedule_idx" ON "public"."certificates" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);


--
-- Name: cms_content_live_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "cms_content_live_idx" ON "public"."cms_content" USING "btree" ("content_type", "status", "sort_order") WHERE ("deleted_at" IS NULL);


--
-- Name: course_schedules_course_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "course_schedules_course_idx" ON "public"."course_schedules" USING "btree" ("course_id") WHERE ("deleted_at" IS NULL);


--
-- Name: course_schedules_schedule_code_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "course_schedules_schedule_code_key" ON "public"."course_schedules" USING "btree" ("schedule_code") WHERE ("schedule_code" IS NOT NULL);


--
-- Name: course_schedules_source_opportunity_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "course_schedules_source_opportunity_unique" ON "public"."course_schedules" USING "btree" ("source_opportunity_id") WHERE (("source_opportunity_id" IS NOT NULL) AND ("deleted_at" IS NULL));


--
-- Name: course_schedules_source_quotation_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "course_schedules_source_quotation_id_idx" ON "public"."course_schedules" USING "btree" ("source_quotation_id") WHERE ("source_quotation_id" IS NOT NULL);


--
-- Name: course_schedules_start_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "course_schedules_start_idx" ON "public"."course_schedules" USING "btree" ("start_date") WHERE ("deleted_at" IS NULL);


--
-- Name: course_schedules_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "course_schedules_status_idx" ON "public"."course_schedules" USING "btree" ("status") WHERE ("deleted_at" IS NULL);


--
-- Name: courses_active_slug_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "courses_active_slug_unique" ON "public"."courses" USING "btree" ("lower"(TRIM(BOTH FROM "slug"))) WHERE (("deleted_at" IS NULL) AND ("status" <> 'archived'::"text") AND ("slug" IS NOT NULL) AND (TRIM(BOTH FROM "slug") <> ''::"text"));


--
-- Name: courses_certificate_template_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "courses_certificate_template_id_idx" ON "public"."courses" USING "btree" ("certificate_template_id") WHERE ("certificate_template_id" IS NOT NULL);


--
-- Name: courses_cms_slug_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "courses_cms_slug_idx" ON "public"."courses" USING "btree" ("slug") WHERE ("slug" IS NOT NULL);


--
-- Name: courses_course_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "courses_course_name_idx" ON "public"."courses" USING "btree" ("lower"("course_name"));


--
-- Name: enquiries_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "enquiries_created_at_idx" ON "public"."enquiries" USING "btree" ("created_at" DESC);


--
-- Name: enquiries_email_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "enquiries_email_created_at_idx" ON "public"."enquiries" USING "btree" ("email", "created_at" DESC);


--
-- Name: feedback_actions_assigned_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "feedback_actions_assigned_idx" ON "public"."feedback_improvement_actions" USING "btree" ("assigned_to") WHERE ("assigned_to" IS NOT NULL);


--
-- Name: feedback_actions_issue_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "feedback_actions_issue_idx" ON "public"."feedback_improvement_actions" USING "btree" ("issue_id");


--
-- Name: feedback_actions_schedule_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "feedback_actions_schedule_idx" ON "public"."feedback_improvement_actions" USING "btree" ("schedule_id");


--
-- Name: feedback_actions_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "feedback_actions_status_idx" ON "public"."feedback_improvement_actions" USING "btree" ("status");


--
-- Name: feedback_issues_schedule_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "feedback_issues_schedule_idx" ON "public"."feedback_issues" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);


--
-- Name: feedback_issues_source_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "feedback_issues_source_idx" ON "public"."feedback_issues" USING "btree" ("source_feedback_id") WHERE ("deleted_at" IS NULL);


--
-- Name: feedback_issues_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "feedback_issues_status_idx" ON "public"."feedback_issues" USING "btree" ("status") WHERE ("deleted_at" IS NULL);


--
-- Name: feedback_schedule_lookup_attempts_retention_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "feedback_schedule_lookup_attempts_retention_idx" ON "public"."feedback_schedule_lookup_attempts" USING "btree" ("last_attempt_at");


--
-- Name: idx_audit_actor; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_actor" ON "public"."audit_logs" USING "btree" ("actor_id");


--
-- Name: idx_audit_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_created" ON "public"."audit_logs" USING "btree" ("created_at" DESC);


--
-- Name: idx_audit_entity; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_audit_entity" ON "public"."audit_logs" USING "btree" ("entity_type", "entity_id");


--
-- Name: idx_cert_verif_cert; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_cert_verif_cert" ON "public"."certificate_verifications" USING "btree" ("certificate_id");


--
-- Name: idx_certificates_live; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_certificates_live" ON "public"."certificates" USING "btree" ("status") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_companies_name; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_companies_name" ON "public"."companies" USING "btree" ("lower"("company_name"));


--
-- Name: idx_companies_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_companies_status" ON "public"."companies" USING "btree" ("status") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_downloads_live; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_downloads_live" ON "public"."downloads" USING "btree" ("category") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_faqs_live; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_faqs_live" ON "public"."faqs" USING "btree" ("sort_order") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_gallery_live; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_gallery_live" ON "public"."gallery_images" USING "btree" ("sort_order") WHERE ("deleted_at" IS NULL);


--
-- Name: idx_media_live; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_media_live" ON "public"."media" USING "btree" ("created_at" DESC) WHERE ("deleted_at" IS NULL);


--
-- Name: idx_news_live; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_news_live" ON "public"."news_posts" USING "btree" ("updated_at" DESC) WHERE ("deleted_at" IS NULL);


--
-- Name: idx_participants_company_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "idx_participants_company_id" ON "public"."participants" USING "btree" ("company_id") WHERE ("deleted_at" IS NULL);


--
-- Name: participant_feedback_participant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "participant_feedback_participant_idx" ON "public"."participant_feedback" USING "btree" ("participant_id");


--
-- Name: participant_feedback_schedule_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "participant_feedback_schedule_idx" ON "public"."participant_feedback" USING "btree" ("schedule_id");


--
-- Name: participant_feedback_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "participant_feedback_status_idx" ON "public"."participant_feedback" USING "btree" ("status");


--
-- Name: participant_feedback_submitted_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "participant_feedback_submitted_idx" ON "public"."participant_feedback" USING "btree" ("submitted_at") WHERE ("submitted_at" IS NOT NULL);


--
-- Name: participant_feedback_token_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "participant_feedback_token_unique" ON "public"."participant_feedback" USING "btree" ("token");


--
-- Name: participant_skill_results_schedule_participant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "participant_skill_results_schedule_participant_idx" ON "public"."participant_skill_results" USING "btree" ("schedule_id", "participant_id") WHERE ("deleted_at" IS NULL);


--
-- Name: participants_active_email_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "participants_active_email_unique" ON "public"."participants" USING "btree" ("lower"("email")) WHERE (("deleted_at" IS NULL) AND ("email" IS NOT NULL) AND ("btrim"("email") <> ''::"text"));


--
-- Name: participants_active_ic_passport_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "participants_active_ic_passport_unique" ON "public"."participants" USING "btree" ("upper"("regexp_replace"("ic_passport_no", '[^0-9A-Za-z]'::"text", ''::"text", 'g'::"text"))) WHERE (("deleted_at" IS NULL) AND ("ic_passport_no" IS NOT NULL) AND ("btrim"("ic_passport_no") <> ''::"text"));


--
-- Name: participants_active_identity_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "participants_active_identity_unique" ON "public"."participants" USING "btree" ("regexp_replace"("identity_no", '[^0-9A-Za-z]'::"text", ''::"text", 'g'::"text")) WHERE (("deleted_at" IS NULL) AND ("identity_no" IS NOT NULL) AND ("btrim"("identity_no") <> ''::"text"));


--
-- Name: participants_full_name_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "participants_full_name_idx" ON "public"."participants" USING "btree" ("lower"("full_name"));


--
-- Name: participants_identity_last4_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "participants_identity_last4_idx" ON "public"."participants" USING "btree" ("identity_last4");


--
-- Name: participants_organization_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "participants_organization_idx" ON "public"."participants" USING "btree" ("organization");


--
-- Name: participants_schedule_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "participants_schedule_idx" ON "public"."participants" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);


--
-- Name: photo_activity_log_photo_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "photo_activity_log_photo_id_idx" ON "public"."photo_activity_log" USING "btree" ("photo_id");


--
-- Name: photo_ai_analysis_photo_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "photo_ai_analysis_photo_created_idx" ON "public"."photo_ai_analysis" USING "btree" ("photo_id", "created_at" DESC);


--
-- Name: photo_ai_analysis_rank_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "photo_ai_analysis_rank_idx" ON "public"."photo_ai_analysis" USING "btree" ("provider", "model", "analysis_version", "overall_score" DESC);


--
-- Name: photo_usages_usage_type_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "photo_usages_usage_type_idx" ON "public"."photo_usages" USING "btree" ("usage_type");


--
-- Name: photos_category_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "photos_category_idx" ON "public"."photos" USING "btree" ("category");


--
-- Name: photos_event_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "photos_event_id_idx" ON "public"."photos" USING "btree" ("event_id");


--
-- Name: photos_is_best_photo_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "photos_is_best_photo_idx" ON "public"."photos" USING "btree" ("is_best_photo") WHERE "is_best_photo";


--
-- Name: photos_status_uploaded_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "photos_status_uploaded_at_idx" ON "public"."photos" USING "btree" ("status", "uploaded_at");


--
-- Name: proposal_requests_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "proposal_requests_created_at_idx" ON "public"."proposal_requests" USING "btree" ("created_at" DESC);


--
-- Name: proposal_requests_email_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "proposal_requests_email_created_at_idx" ON "public"."proposal_requests" USING "btree" ("email", "created_at" DESC);


--
-- Name: sales_activity_lead_metadata_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_activity_lead_metadata_id_idx" ON "public"."sales_activity" USING "btree" ("lead_metadata_id", "created_at" DESC);


--
-- Name: sales_activity_opportunity_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_activity_opportunity_id_idx" ON "public"."sales_activity" USING "btree" ("opportunity_id", "created_at" DESC);


--
-- Name: sales_activity_quotation_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_activity_quotation_id_idx" ON "public"."sales_activity" USING "btree" ("quotation_id", "created_at" DESC);


--
-- Name: sales_lead_metadata_assigned_to_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_lead_metadata_assigned_to_idx" ON "public"."sales_lead_metadata" USING "btree" ("assigned_to");


--
-- Name: sales_lead_metadata_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_lead_metadata_created_at_idx" ON "public"."sales_lead_metadata" USING "btree" ("created_at" DESC);


--
-- Name: sales_lead_metadata_follow_up_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_lead_metadata_follow_up_at_idx" ON "public"."sales_lead_metadata" USING "btree" ("follow_up_at");


--
-- Name: sales_lead_metadata_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_lead_metadata_status_idx" ON "public"."sales_lead_metadata" USING "btree" ("status");


--
-- Name: sales_opportunities_assigned_to_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_opportunities_assigned_to_idx" ON "public"."sales_opportunities" USING "btree" ("assigned_to");


--
-- Name: sales_opportunities_company_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_opportunities_company_id_idx" ON "public"."sales_opportunities" USING "btree" ("company_id") WHERE ("company_id" IS NOT NULL);


--
-- Name: sales_opportunities_created_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_opportunities_created_at_idx" ON "public"."sales_opportunities" USING "btree" ("created_at" DESC);


--
-- Name: sales_opportunities_stage_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_opportunities_stage_idx" ON "public"."sales_opportunities" USING "btree" ("stage");


--
-- Name: sales_quotation_items_quotation_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_quotation_items_quotation_id_idx" ON "public"."sales_quotation_items" USING "btree" ("quotation_id", "sort_order");


--
-- Name: sales_quotations_opportunity_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_quotations_opportunity_id_idx" ON "public"."sales_quotations" USING "btree" ("opportunity_id");


--
-- Name: sales_quotations_parent_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_quotations_parent_idx" ON "public"."sales_quotations" USING "btree" ("parent_quotation_id");


--
-- Name: sales_quotations_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_quotations_status_idx" ON "public"."sales_quotations" USING "btree" ("status");


--
-- Name: sales_tasks_assigned_to_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_tasks_assigned_to_idx" ON "public"."sales_tasks" USING "btree" ("assigned_to") WHERE ("deleted_at" IS NULL);


--
-- Name: sales_tasks_due_at_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_tasks_due_at_idx" ON "public"."sales_tasks" USING "btree" ("due_at") WHERE ("deleted_at" IS NULL);


--
-- Name: sales_tasks_lead_metadata_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_tasks_lead_metadata_id_idx" ON "public"."sales_tasks" USING "btree" ("lead_metadata_id") WHERE ("lead_metadata_id" IS NOT NULL);


--
-- Name: sales_tasks_opportunity_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_tasks_opportunity_id_idx" ON "public"."sales_tasks" USING "btree" ("opportunity_id") WHERE ("opportunity_id" IS NOT NULL);


--
-- Name: sales_tasks_quotation_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_tasks_quotation_id_idx" ON "public"."sales_tasks" USING "btree" ("quotation_id") WHERE ("quotation_id" IS NOT NULL);


--
-- Name: sales_tasks_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "sales_tasks_status_idx" ON "public"."sales_tasks" USING "btree" ("status") WHERE ("deleted_at" IS NULL);


--
-- Name: schedule_participants_active_unique; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "schedule_participants_active_unique" ON "public"."schedule_participants" USING "btree" ("schedule_id", "participant_id") WHERE (("deleted_at" IS NULL) AND ("registration_status" <> 'cancelled'::"text"));


--
-- Name: schedule_participants_participant_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "schedule_participants_participant_idx" ON "public"."schedule_participants" USING "btree" ("participant_id") WHERE ("deleted_at" IS NULL);


--
-- Name: schedule_participants_schedule_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX "schedule_participants_schedule_idx" ON "public"."schedule_participants" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);


--
-- Name: uq_certificates_number; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "uq_certificates_number" ON "public"."certificates" USING "btree" ("certificate_number") WHERE ("certificate_number" IS NOT NULL);


--
-- Name: uq_certificates_verification_token; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "uq_certificates_verification_token" ON "public"."certificates" USING "btree" ("verification_token") WHERE ("verification_token" IS NOT NULL);


--
-- Name: uq_companies_company_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "uq_companies_company_id" ON "public"."companies" USING "btree" ("company_id");


--
-- Name: uq_participants_participant_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX "uq_participants_participant_id" ON "public"."participants" USING "btree" ("participant_id");


--
-- Name: certificates certificates_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "certificates_set_updated_at" BEFORE UPDATE ON "public"."certificates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: courses courses_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "courses_set_updated_at" BEFORE UPDATE ON "public"."courses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: participants participants_set_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "participants_set_updated_at" BEFORE UPDATE ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();


--
-- Name: participants participants_sync_last4; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "participants_sync_last4" BEFORE INSERT OR UPDATE OF "identity_no", "identity_last4" ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "public"."sync_participant_last4"();


--
-- Name: assessments trg_assessments_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_assessments_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."assessments" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: assessments trg_assessments_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_assessments_updated_at" BEFORE UPDATE ON "public"."assessments" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: attendance trg_attendance_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_attendance_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."attendance" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: attendance trg_attendance_sync_present; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_attendance_sync_present" BEFORE INSERT OR UPDATE ON "public"."attendance" FOR EACH ROW EXECUTE FUNCTION "app"."sync_attendance_present"();


--
-- Name: attendance trg_attendance_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_attendance_updated_at" BEFORE UPDATE ON "public"."attendance" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: certificate_templates trg_cert_templates_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_cert_templates_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."certificate_templates" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: certificate_templates trg_cert_templates_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_cert_templates_updated_at" BEFORE UPDATE ON "public"."certificate_templates" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: certificate_skill_results trg_certificate_skill_results_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_certificate_skill_results_audit" AFTER INSERT ON "public"."certificate_skill_results" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: certificates trg_certificates_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_certificates_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."certificates" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: certificates trg_certificates_before_insert; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_certificates_before_insert" BEFORE INSERT ON "public"."certificates" FOR EACH ROW EXECUTE FUNCTION "app"."certificates_before_insert"();


--
-- Name: certificates trg_certificates_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_certificates_updated_at" BEFORE UPDATE ON "public"."certificates" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: companies trg_companies_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_companies_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: companies trg_companies_stamp; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_companies_stamp" BEFORE INSERT OR UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "app"."stamp_actor"();


--
-- Name: companies trg_companies_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_companies_updated_at" BEFORE UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: companies trg_company_id; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_company_id" BEFORE INSERT ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "app"."gen_company_id"();


--
-- Name: course_schedules trg_course_schedules_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_course_schedules_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."course_schedules" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: course_schedules trg_course_schedules_code; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_course_schedules_code" BEFORE INSERT ON "public"."course_schedules" FOR EACH ROW EXECUTE FUNCTION "app"."gen_schedule_code"();


--
-- Name: course_schedules trg_course_schedules_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_course_schedules_updated_at" BEFORE UPDATE ON "public"."course_schedules" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: enquiries trg_enquiries_create_sales_lead; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_enquiries_create_sales_lead" AFTER INSERT ON "public"."enquiries" FOR EACH ROW EXECUTE FUNCTION "app"."create_sales_lead_metadata"();


--
-- Name: feedback_improvement_actions trg_feedback_actions_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_feedback_actions_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."feedback_improvement_actions" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: feedback_improvement_actions trg_feedback_actions_stamp; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_feedback_actions_stamp" BEFORE INSERT OR UPDATE ON "public"."feedback_improvement_actions" FOR EACH ROW EXECUTE FUNCTION "app"."stamp_actor"();


--
-- Name: feedback_improvement_actions trg_feedback_actions_transition_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_feedback_actions_transition_guard" BEFORE UPDATE ON "public"."feedback_improvement_actions" FOR EACH ROW EXECUTE FUNCTION "app"."feedback_action_transition_guard"();


--
-- Name: feedback_improvement_actions trg_feedback_actions_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_feedback_actions_updated_at" BEFORE UPDATE ON "public"."feedback_improvement_actions" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: feedback_issues trg_feedback_issues_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_feedback_issues_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."feedback_issues" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: feedback_issues trg_feedback_issues_stamp; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_feedback_issues_stamp" BEFORE INSERT OR UPDATE ON "public"."feedback_issues" FOR EACH ROW EXECUTE FUNCTION "app"."stamp_actor"();


--
-- Name: feedback_issues trg_feedback_issues_transition_guard; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_feedback_issues_transition_guard" BEFORE UPDATE ON "public"."feedback_issues" FOR EACH ROW EXECUTE FUNCTION "app"."feedback_issue_transition_guard"();


--
-- Name: feedback_issues trg_feedback_issues_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_feedback_issues_updated_at" BEFORE UPDATE ON "public"."feedback_issues" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: participant_feedback trg_participant_feedback_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_participant_feedback_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."participant_feedback" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: participant_feedback trg_participant_feedback_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_participant_feedback_updated_at" BEFORE UPDATE ON "public"."participant_feedback" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: participants trg_participant_id; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_participant_id" BEFORE INSERT ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "app"."gen_participant_id"();


--
-- Name: participant_skill_results trg_participant_skill_results_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_participant_skill_results_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."participant_skill_results" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: participant_skill_results trg_participant_skill_results_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_participant_skill_results_updated_at" BEFORE UPDATE ON "public"."participant_skill_results" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: participants trg_participants_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_participants_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: participants trg_participants_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_participants_updated_at" BEFORE UPDATE ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: photo_ai_analysis trg_photo_ai_analysis_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_photo_ai_analysis_updated_at" BEFORE UPDATE ON "public"."photo_ai_analysis" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: photo_events trg_photo_events_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_photo_events_updated_at" BEFORE UPDATE ON "public"."photo_events" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: photos trg_photos_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_photos_updated_at" BEFORE UPDATE ON "public"."photos" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: proposal_requests trg_proposal_requests_create_sales_lead; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_proposal_requests_create_sales_lead" AFTER INSERT ON "public"."proposal_requests" FOR EACH ROW EXECUTE FUNCTION "app"."create_sales_lead_metadata"();


--
-- Name: sales_tasks trg_sales_tasks_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_sales_tasks_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."sales_tasks" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: sales_tasks trg_sales_tasks_stamp; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_sales_tasks_stamp" BEFORE INSERT OR UPDATE ON "public"."sales_tasks" FOR EACH ROW EXECUTE FUNCTION "app"."stamp_actor"();


--
-- Name: sales_tasks trg_sales_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_sales_tasks_updated_at" BEFORE UPDATE ON "public"."sales_tasks" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: schedule_participants trg_schedule_participants_audit; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_schedule_participants_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."schedule_participants" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();


--
-- Name: schedule_participants trg_schedule_participants_sync_seats; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_schedule_participants_sync_seats" AFTER INSERT OR DELETE OR UPDATE ON "public"."schedule_participants" FOR EACH ROW EXECUTE FUNCTION "app"."sync_schedule_seats"();


--
-- Name: schedule_participants trg_schedule_participants_updated_at; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE OR REPLACE TRIGGER "trg_schedule_participants_updated_at" BEFORE UPDATE ON "public"."schedule_participants" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();


--
-- Name: admin_users admin_users_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: assessments assessments_assessor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_assessor_id_fkey" FOREIGN KEY ("assessor_id") REFERENCES "public"."profiles"("id");


--
-- Name: assessments assessments_locked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."profiles"("id");


--
-- Name: assessments assessments_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;


--
-- Name: assessments assessments_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE SET NULL;


--
-- Name: attendance attendance_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;


--
-- Name: attendance attendance_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id");


--
-- Name: attendance attendance_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: certificate_import_logs certificate_import_logs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificate_import_logs"
    ADD CONSTRAINT "certificate_import_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;


--
-- Name: certificate_skill_results certificate_skill_results_certificate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificate_skill_results"
    ADD CONSTRAINT "certificate_skill_results_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE CASCADE;


--
-- Name: certificate_skill_results certificate_skill_results_source_skill_result_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificate_skill_results"
    ADD CONSTRAINT "certificate_skill_results_source_skill_result_id_fkey" FOREIGN KEY ("source_skill_result_id") REFERENCES "public"."participant_skill_results"("id") ON DELETE SET NULL;


--
-- Name: certificate_templates certificate_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificate_templates"
    ADD CONSTRAINT "certificate_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: certificate_templates certificate_templates_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificate_templates"
    ADD CONSTRAINT "certificate_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: certificate_verifications certificate_verifications_certificate_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificate_verifications"
    ADD CONSTRAINT "certificate_verifications_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE SET NULL;


--
-- Name: certificates certificates_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE SET NULL;


--
-- Name: certificates certificates_issued_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "public"."profiles"("id");


--
-- Name: certificates certificates_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE RESTRICT;


--
-- Name: certificates certificates_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE SET NULL;


--
-- Name: cms_content cms_content_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."cms_content"
    ADD CONSTRAINT "cms_content_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: cms_content cms_content_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."cms_content"
    ADD CONSTRAINT "cms_content_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: cms_media cms_media_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."cms_media"
    ADD CONSTRAINT "cms_media_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: companies companies_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: companies companies_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: company_profile company_profile_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."company_profile"
    ADD CONSTRAINT "company_profile_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: course_schedules course_schedules_course_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE RESTRICT;


--
-- Name: course_schedules course_schedules_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: course_schedules course_schedules_source_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_source_opportunity_id_fkey" FOREIGN KEY ("source_opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE SET NULL;


--
-- Name: course_schedules course_schedules_source_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_source_quotation_id_fkey" FOREIGN KEY ("source_quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE SET NULL;


--
-- Name: course_schedules course_schedules_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: courses courses_certificate_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_certificate_template_id_fkey" FOREIGN KEY ("certificate_template_id") REFERENCES "public"."certificate_templates"("id") ON DELETE SET NULL;


--
-- Name: courses courses_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: courses courses_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: downloads downloads_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."downloads"
    ADD CONSTRAINT "downloads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: downloads downloads_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."downloads"
    ADD CONSTRAINT "downloads_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE SET NULL;


--
-- Name: downloads downloads_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."downloads"
    ADD CONSTRAINT "downloads_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: faqs faqs_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."faq_categories"("id") ON DELETE SET NULL;


--
-- Name: faqs faqs_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: faqs faqs_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: feedback_improvement_actions feedback_improvement_actions_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");


--
-- Name: feedback_improvement_actions feedback_improvement_actions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: feedback_improvement_actions feedback_improvement_actions_issue_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "public"."feedback_issues"("id") ON DELETE CASCADE;


--
-- Name: feedback_improvement_actions feedback_improvement_actions_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE SET NULL;


--
-- Name: feedback_improvement_actions feedback_improvement_actions_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: feedback_issues feedback_issues_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_issues"
    ADD CONSTRAINT "feedback_issues_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: feedback_issues feedback_issues_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_issues"
    ADD CONSTRAINT "feedback_issues_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE SET NULL;


--
-- Name: feedback_issues feedback_issues_source_feedback_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_issues"
    ADD CONSTRAINT "feedback_issues_source_feedback_id_fkey" FOREIGN KEY ("source_feedback_id") REFERENCES "public"."participant_feedback"("id") ON DELETE SET NULL;


--
-- Name: feedback_issues feedback_issues_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_issues"
    ADD CONSTRAINT "feedback_issues_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: feedback_schedule_links feedback_schedule_links_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_schedule_links"
    ADD CONSTRAINT "feedback_schedule_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: feedback_schedule_links feedback_schedule_links_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_schedule_links"
    ADD CONSTRAINT "feedback_schedule_links_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;


--
-- Name: feedback_schedule_lookup_attempts feedback_schedule_lookup_attempts_schedule_link_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."feedback_schedule_lookup_attempts"
    ADD CONSTRAINT "feedback_schedule_lookup_attempts_schedule_link_id_fkey" FOREIGN KEY ("schedule_link_id") REFERENCES "public"."feedback_schedule_links"("id") ON DELETE CASCADE;


--
-- Name: certificates fk_certificates_template; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "fk_certificates_template" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_templates"("id") ON DELETE SET NULL;


--
-- Name: gallery_images gallery_images_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."gallery_images"
    ADD CONSTRAINT "gallery_images_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."gallery_categories"("id") ON DELETE SET NULL;


--
-- Name: gallery_images gallery_images_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."gallery_images"
    ADD CONSTRAINT "gallery_images_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: gallery_images gallery_images_media_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."gallery_images"
    ADD CONSTRAINT "gallery_images_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE SET NULL;


--
-- Name: gallery_images gallery_images_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."gallery_images"
    ADD CONSTRAINT "gallery_images_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: media media_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."media"
    ADD CONSTRAINT "media_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: media media_folder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."media"
    ADD CONSTRAINT "media_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."media_folders"("id") ON DELETE SET NULL;


--
-- Name: media_folders media_folders_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."media_folders"
    ADD CONSTRAINT "media_folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: media_folders media_folders_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."media_folders"
    ADD CONSTRAINT "media_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."media_folders"("id") ON DELETE CASCADE;


--
-- Name: news_posts news_posts_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id");


--
-- Name: news_posts news_posts_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."news_categories"("id") ON DELETE SET NULL;


--
-- Name: news_posts news_posts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: news_posts news_posts_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: participant_feedback participant_feedback_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participant_feedback"
    ADD CONSTRAINT "participant_feedback_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;


--
-- Name: participant_feedback participant_feedback_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participant_feedback"
    ADD CONSTRAINT "participant_feedback_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;


--
-- Name: participant_skill_results participant_skill_results_assessed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "public"."profiles"("id");


--
-- Name: participant_skill_results participant_skill_results_locked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."profiles"("id");


--
-- Name: participant_skill_results participant_skill_results_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;


--
-- Name: participant_skill_results participant_skill_results_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;


--
-- Name: participants participants_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;


--
-- Name: participants participants_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: participants participants_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE SET NULL;


--
-- Name: participants participants_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");


--
-- Name: photo_activity_log photo_activity_log_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_activity_log"
    ADD CONSTRAINT "photo_activity_log_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE SET NULL;


--
-- Name: photo_ai_analysis photo_ai_analysis_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_ai_analysis"
    ADD CONSTRAINT "photo_ai_analysis_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE CASCADE;


--
-- Name: photo_usages photo_usages_photo_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_usages"
    ADD CONSTRAINT "photo_usages_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE CASCADE;


--
-- Name: photo_usages photo_usages_usage_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photo_usages"
    ADD CONSTRAINT "photo_usages_usage_type_fkey" FOREIGN KEY ("usage_type") REFERENCES "public"."photo_usage_types"("key") ON DELETE RESTRICT;


--
-- Name: photos photos_category_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_category_fk" FOREIGN KEY ("category") REFERENCES "public"."photo_categories"("key") ON DELETE RESTRICT;


--
-- Name: photos photos_event_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."photo_events"("id") ON DELETE SET NULL;


--
-- Name: photos photos_media_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE RESTRICT;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;


--
-- Name: proposal_requests proposal_requests_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."proposal_requests"
    ADD CONSTRAINT "proposal_requests_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");


--
-- Name: sales_activity sales_activity_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_activity"
    ADD CONSTRAINT "sales_activity_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id");


--
-- Name: sales_activity sales_activity_lead_metadata_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_activity"
    ADD CONSTRAINT "sales_activity_lead_metadata_id_fkey" FOREIGN KEY ("lead_metadata_id") REFERENCES "public"."sales_lead_metadata"("id") ON DELETE CASCADE;


--
-- Name: sales_activity sales_activity_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_activity"
    ADD CONSTRAINT "sales_activity_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id");


--
-- Name: sales_activity sales_activity_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_activity"
    ADD CONSTRAINT "sales_activity_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id");


--
-- Name: sales_lead_metadata sales_lead_metadata_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_lead_metadata"
    ADD CONSTRAINT "sales_lead_metadata_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");


--
-- Name: sales_opportunities sales_opportunities_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");


--
-- Name: sales_opportunities sales_opportunities_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;


--
-- Name: sales_opportunities sales_opportunities_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: sales_opportunities sales_opportunities_lead_metadata_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_lead_metadata_id_fkey" FOREIGN KEY ("lead_metadata_id") REFERENCES "public"."sales_lead_metadata"("id");


--
-- Name: sales_quotation_items sales_quotation_items_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_quotation_items"
    ADD CONSTRAINT "sales_quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE CASCADE;


--
-- Name: sales_quotations sales_quotations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_quotations"
    ADD CONSTRAINT "sales_quotations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");


--
-- Name: sales_quotations sales_quotations_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_quotations"
    ADD CONSTRAINT "sales_quotations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id");


--
-- Name: sales_quotations sales_quotations_parent_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_quotations"
    ADD CONSTRAINT "sales_quotations_parent_quotation_id_fkey" FOREIGN KEY ("parent_quotation_id") REFERENCES "public"."sales_quotations"("id");


--
-- Name: sales_tasks sales_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: sales_tasks sales_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;


--
-- Name: sales_tasks sales_tasks_lead_metadata_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_lead_metadata_id_fkey" FOREIGN KEY ("lead_metadata_id") REFERENCES "public"."sales_lead_metadata"("id") ON DELETE SET NULL;


--
-- Name: sales_tasks sales_tasks_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE SET NULL;


--
-- Name: sales_tasks sales_tasks_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE SET NULL;


--
-- Name: schedule_participants schedule_participants_participant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."schedule_participants"
    ADD CONSTRAINT "schedule_participants_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;


--
-- Name: schedule_participants schedule_participants_schedule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY "public"."schedule_participants"
    ADD CONSTRAINT "schedule_participants_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;


--
-- Name: certificate_import_logs Admins can create import logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins can create import logs" ON "public"."certificate_import_logs" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = ( SELECT "auth"."uid"() AS "uid")) AND (EXISTS ( SELECT 1
   FROM "public"."admin_users" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));


--
-- Name: admin_users Admins can read admin membership; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins can read admin membership" ON "public"."admin_users" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));


--
-- Name: certificate_import_logs Admins can read import logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "Admins can read import logs" ON "public"."certificate_import_logs" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."admin_users" "a"
  WHERE ("a"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));


--
-- Name: admin_users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."admin_users" ENABLE ROW LEVEL SECURITY;

--
-- Name: assessments; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."assessments" ENABLE ROW LEVEL SECURITY;

--
-- Name: assessments assessments_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "assessments_delete" ON "public"."assessments" FOR DELETE TO "authenticated" USING ("app"."is_admin"());


--
-- Name: assessments assessments_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "assessments_insert" ON "public"."assessments" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin_or_trainer"());


--
-- Name: assessments assessments_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "assessments_select" ON "public"."assessments" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));


--
-- Name: assessments assessments_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "assessments_update" ON "public"."assessments" FOR UPDATE TO "authenticated" USING ("app"."is_admin_or_trainer"()) WITH CHECK ("app"."is_admin_or_trainer"());


--
-- Name: attendance; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."attendance" ENABLE ROW LEVEL SECURITY;

--
-- Name: attendance attendance_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "attendance_delete" ON "public"."attendance" FOR DELETE TO "authenticated" USING ("app"."is_admin_or_trainer"());


--
-- Name: attendance attendance_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "attendance_insert" ON "public"."attendance" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin_or_trainer"());


--
-- Name: attendance attendance_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "attendance_select" ON "public"."attendance" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));


--
-- Name: attendance attendance_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "attendance_update" ON "public"."attendance" FOR UPDATE TO "authenticated" USING ("app"."is_admin_or_trainer"()) WITH CHECK ("app"."is_admin_or_trainer"());


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "audit_staff_read" ON "public"."audit_logs" FOR SELECT USING ("app"."is_admin"());


--
-- Name: certificate_templates cert_templates_admin_write; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "cert_templates_admin_write" ON "public"."certificate_templates" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());


--
-- Name: certificate_templates cert_templates_view; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "cert_templates_view" ON "public"."certificate_templates" FOR SELECT USING (("app"."is_editor"() OR ("app"."current_role"() = 'trainer'::"public"."user_role")));


--
-- Name: certificate_verifications cert_verif_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "cert_verif_staff_read" ON "public"."certificate_verifications" FOR SELECT USING (("app"."is_editor"() OR ("app"."current_role"() = 'trainer'::"public"."user_role")));


--
-- Name: certificate_import_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."certificate_import_logs" ENABLE ROW LEVEL SECURITY;

--
-- Name: certificate_skill_results; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."certificate_skill_results" ENABLE ROW LEVEL SECURITY;

--
-- Name: certificate_skill_results certificate_skill_results_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "certificate_skill_results_insert" ON "public"."certificate_skill_results" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());


--
-- Name: certificate_skill_results certificate_skill_results_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "certificate_skill_results_select" ON "public"."certificate_skill_results" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));


--
-- Name: certificate_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."certificate_templates" ENABLE ROW LEVEL SECURITY;

--
-- Name: certificate_verifications; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."certificate_verifications" ENABLE ROW LEVEL SECURITY;

--
-- Name: certificates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."certificates" ENABLE ROW LEVEL SECURITY;

--
-- Name: certificates certificates_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "certificates_delete" ON "public"."certificates" FOR DELETE TO "authenticated" USING ("app"."is_admin"());


--
-- Name: certificates certificates_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "certificates_insert" ON "public"."certificates" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());


--
-- Name: certificates certificates_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "certificates_select" ON "public"."certificates" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));


--
-- Name: certificates certificates_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "certificates_update" ON "public"."certificates" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());


--
-- Name: cms_content; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."cms_content" ENABLE ROW LEVEL SECURITY;

--
-- Name: cms_content cms_content_staff_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "cms_content_staff_all" ON "public"."cms_content" TO "authenticated" USING (( SELECT "app"."is_editor"() AS "is_editor")) WITH CHECK (( SELECT "app"."is_editor"() AS "is_editor"));


--
-- Name: cms_media; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."cms_media" ENABLE ROW LEVEL SECURITY;

--
-- Name: cms_media cms_media_staff_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "cms_media_staff_all" ON "public"."cms_media" TO "authenticated" USING (( SELECT "app"."is_editor"() AS "is_editor")) WITH CHECK (( SELECT "app"."is_editor"() AS "is_editor"));


--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;

--
-- Name: companies companies_admin_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "companies_admin_delete" ON "public"."companies" FOR DELETE USING ("app"."is_admin"());


--
-- Name: companies companies_admin_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "companies_admin_insert" ON "public"."companies" FOR INSERT WITH CHECK ("app"."is_admin"());


--
-- Name: companies companies_admin_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "companies_admin_update" ON "public"."companies" FOR UPDATE USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());


--
-- Name: companies companies_staff_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "companies_staff_read" ON "public"."companies" FOR SELECT USING ("app"."is_editor"());


--
-- Name: company_profile; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."company_profile" ENABLE ROW LEVEL SECURITY;

--
-- Name: company_profile company_profile_editor_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "company_profile_editor_insert" ON "public"."company_profile" FOR INSERT WITH CHECK ("app"."is_editor"());


--
-- Name: company_profile company_profile_editor_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "company_profile_editor_update" ON "public"."company_profile" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());


--
-- Name: company_profile company_profile_public_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "company_profile_public_read" ON "public"."company_profile" FOR SELECT USING (true);


--
-- Name: course_schedules; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."course_schedules" ENABLE ROW LEVEL SECURITY;

--
-- Name: course_schedules course_schedules_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "course_schedules_delete" ON "public"."course_schedules" FOR DELETE TO "authenticated" USING ("app"."is_admin"());


--
-- Name: course_schedules course_schedules_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "course_schedules_insert" ON "public"."course_schedules" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());


--
-- Name: course_schedules course_schedules_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "course_schedules_select" ON "public"."course_schedules" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));


--
-- Name: course_schedules course_schedules_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "course_schedules_update" ON "public"."course_schedules" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());


--
-- Name: courses; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;

--
-- Name: courses courses_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "courses_delete" ON "public"."courses" FOR DELETE TO "authenticated" USING ("app"."is_admin"());


--
-- Name: courses courses_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "courses_insert" ON "public"."courses" FOR INSERT TO "authenticated" WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: courses courses_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "courses_select" ON "public"."courses" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: courses courses_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "courses_update" ON "public"."courses" FOR UPDATE TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role")) WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: downloads; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."downloads" ENABLE ROW LEVEL SECURITY;

--
-- Name: downloads downloads_admin_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "downloads_admin_delete" ON "public"."downloads" FOR DELETE USING ("app"."is_admin"());


--
-- Name: downloads downloads_editor_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "downloads_editor_insert" ON "public"."downloads" FOR INSERT WITH CHECK ("app"."is_editor"());


--
-- Name: downloads downloads_editor_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "downloads_editor_read" ON "public"."downloads" FOR SELECT USING ("app"."is_editor"());


--
-- Name: downloads downloads_editor_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "downloads_editor_update" ON "public"."downloads" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());


--
-- Name: downloads downloads_public_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "downloads_public_read" ON "public"."downloads" FOR SELECT USING ((("status" = 'published'::"public"."content_status") AND ("deleted_at" IS NULL)));


--
-- Name: enquiries; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."enquiries" ENABLE ROW LEVEL SECURITY;

--
-- Name: enquiries enquiries_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "enquiries_select" ON "public"."enquiries" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: faq_categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."faq_categories" ENABLE ROW LEVEL SECURITY;

--
-- Name: faq_categories faq_categories_editor_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "faq_categories_editor_all" ON "public"."faq_categories" USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());


--
-- Name: faqs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."faqs" ENABLE ROW LEVEL SECURITY;

--
-- Name: faqs faqs_admin_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "faqs_admin_delete" ON "public"."faqs" FOR DELETE USING ("app"."is_admin"());


--
-- Name: faqs faqs_editor_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "faqs_editor_insert" ON "public"."faqs" FOR INSERT WITH CHECK ("app"."is_editor"());


--
-- Name: faqs faqs_editor_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "faqs_editor_read" ON "public"."faqs" FOR SELECT USING ("app"."is_editor"());


--
-- Name: faqs faqs_editor_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "faqs_editor_update" ON "public"."faqs" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());


--
-- Name: faqs faqs_public_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "faqs_public_read" ON "public"."faqs" FOR SELECT USING ((("status" = 'published'::"public"."content_status") AND ("deleted_at" IS NULL)));


--
-- Name: feedback_improvement_actions; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."feedback_improvement_actions" ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback_improvement_actions feedback_improvement_actions_staff_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "feedback_improvement_actions_staff_insert" ON "public"."feedback_improvement_actions" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));


--
-- Name: feedback_improvement_actions feedback_improvement_actions_staff_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "feedback_improvement_actions_staff_select" ON "public"."feedback_improvement_actions" FOR SELECT TO "authenticated" USING (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));


--
-- Name: feedback_improvement_actions feedback_improvement_actions_staff_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "feedback_improvement_actions_staff_update" ON "public"."feedback_improvement_actions" FOR UPDATE TO "authenticated" USING (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role")) WITH CHECK (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));


--
-- Name: feedback_issues; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."feedback_issues" ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback_issues feedback_issues_staff_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "feedback_issues_staff_insert" ON "public"."feedback_issues" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));


--
-- Name: feedback_issues feedback_issues_staff_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "feedback_issues_staff_select" ON "public"."feedback_issues" FOR SELECT TO "authenticated" USING (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));


--
-- Name: feedback_issues feedback_issues_staff_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "feedback_issues_staff_update" ON "public"."feedback_issues" FOR UPDATE TO "authenticated" USING (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role")) WITH CHECK (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));


--
-- Name: feedback_schedule_links; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."feedback_schedule_links" ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback_schedule_lookup_attempts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."feedback_schedule_lookup_attempts" ENABLE ROW LEVEL SECURITY;

--
-- Name: gallery_categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."gallery_categories" ENABLE ROW LEVEL SECURITY;

--
-- Name: gallery_categories gallery_categories_editor_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "gallery_categories_editor_all" ON "public"."gallery_categories" USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());


--
-- Name: gallery_images; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."gallery_images" ENABLE ROW LEVEL SECURITY;

--
-- Name: gallery_images gallery_images_admin_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "gallery_images_admin_delete" ON "public"."gallery_images" FOR DELETE USING ("app"."is_admin"());


--
-- Name: gallery_images gallery_images_editor_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "gallery_images_editor_insert" ON "public"."gallery_images" FOR INSERT WITH CHECK ("app"."is_editor"());


--
-- Name: gallery_images gallery_images_editor_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "gallery_images_editor_read" ON "public"."gallery_images" FOR SELECT USING ("app"."is_editor"());


--
-- Name: gallery_images gallery_images_editor_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "gallery_images_editor_update" ON "public"."gallery_images" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());


--
-- Name: gallery_images gallery_images_public_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "gallery_images_public_read" ON "public"."gallery_images" FOR SELECT USING ((("status" = 'published'::"public"."content_status") AND ("deleted_at" IS NULL)));


--
-- Name: media; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."media" ENABLE ROW LEVEL SECURITY;

--
-- Name: media media_admin_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "media_admin_delete" ON "public"."media" FOR DELETE USING ("app"."is_admin"());


--
-- Name: media media_editor_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "media_editor_insert" ON "public"."media" FOR INSERT WITH CHECK ("app"."is_editor"());


--
-- Name: media media_editor_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "media_editor_read" ON "public"."media" FOR SELECT USING ("app"."is_editor"());


--
-- Name: media media_editor_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "media_editor_update" ON "public"."media" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());


--
-- Name: media_folders; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."media_folders" ENABLE ROW LEVEL SECURITY;

--
-- Name: media_folders media_folders_editor_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "media_folders_editor_all" ON "public"."media_folders" USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());


--
-- Name: media media_public_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "media_public_read" ON "public"."media" FOR SELECT USING ((("status" = 'published'::"public"."content_status") AND ("deleted_at" IS NULL)));


--
-- Name: news_categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."news_categories" ENABLE ROW LEVEL SECURITY;

--
-- Name: news_categories news_categories_editor_all; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "news_categories_editor_all" ON "public"."news_categories" USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());


--
-- Name: news_posts; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."news_posts" ENABLE ROW LEVEL SECURITY;

--
-- Name: news_posts news_posts_admin_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "news_posts_admin_delete" ON "public"."news_posts" FOR DELETE USING ("app"."is_admin"());


--
-- Name: news_posts news_posts_editor_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "news_posts_editor_insert" ON "public"."news_posts" FOR INSERT WITH CHECK ("app"."is_editor"());


--
-- Name: news_posts news_posts_editor_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "news_posts_editor_read" ON "public"."news_posts" FOR SELECT USING ("app"."is_editor"());


--
-- Name: news_posts news_posts_editor_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "news_posts_editor_update" ON "public"."news_posts" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());


--
-- Name: news_posts news_posts_public_read; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "news_posts_public_read" ON "public"."news_posts" FOR SELECT USING ((("status" = 'published'::"public"."content_status") AND ("deleted_at" IS NULL)));


--
-- Name: participant_feedback; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."participant_feedback" ENABLE ROW LEVEL SECURITY;

--
-- Name: participant_feedback participant_feedback_staff_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "participant_feedback_staff_select" ON "public"."participant_feedback" FOR SELECT TO "authenticated" USING (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));


--
-- Name: participant_skill_results; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."participant_skill_results" ENABLE ROW LEVEL SECURITY;

--
-- Name: participant_skill_results participant_skill_results_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "participant_skill_results_delete" ON "public"."participant_skill_results" FOR DELETE TO "authenticated" USING ("app"."is_admin"());


--
-- Name: participant_skill_results participant_skill_results_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "participant_skill_results_insert" ON "public"."participant_skill_results" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin_or_trainer"());


--
-- Name: participant_skill_results participant_skill_results_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "participant_skill_results_select" ON "public"."participant_skill_results" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));


--
-- Name: participant_skill_results participant_skill_results_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "participant_skill_results_update" ON "public"."participant_skill_results" FOR UPDATE TO "authenticated" USING ("app"."is_admin_or_trainer"()) WITH CHECK ("app"."is_admin_or_trainer"());


--
-- Name: participants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."participants" ENABLE ROW LEVEL SECURITY;

--
-- Name: participants participants_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "participants_delete" ON "public"."participants" FOR DELETE TO "authenticated" USING ("app"."is_admin"());


--
-- Name: participants participants_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "participants_insert" ON "public"."participants" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());


--
-- Name: participants participants_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "participants_select" ON "public"."participants" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: participants participants_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "participants_update" ON "public"."participants" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());


--
-- Name: photo_activity_log; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."photo_activity_log" ENABLE ROW LEVEL SECURITY;

--
-- Name: photo_ai_analysis; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."photo_ai_analysis" ENABLE ROW LEVEL SECURITY;

--
-- Name: photo_categories; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."photo_categories" ENABLE ROW LEVEL SECURITY;

--
-- Name: photo_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."photo_events" ENABLE ROW LEVEL SECURITY;

--
-- Name: photo_id_sequences; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."photo_id_sequences" ENABLE ROW LEVEL SECURITY;

--
-- Name: photo_usage_types; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."photo_usage_types" ENABLE ROW LEVEL SECURITY;

--
-- Name: photo_usages; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."photo_usages" ENABLE ROW LEVEL SECURITY;

--
-- Name: photos; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."photos" ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_self_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "profiles_self_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "app"."is_admin"() AS "is_admin")));


--
-- Name: profiles profiles_self_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "profiles_self_update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "app"."is_super_admin"() AS "is_super_admin"))) WITH CHECK ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "app"."is_super_admin"() AS "is_super_admin")));


--
-- Name: proposal_requests; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."proposal_requests" ENABLE ROW LEVEL SECURITY;

--
-- Name: proposal_requests proposal_requests_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "proposal_requests_select" ON "public"."proposal_requests" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: proposal_requests proposal_requests_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "proposal_requests_update" ON "public"."proposal_requests" FOR UPDATE TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role")) WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: sales_activity; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."sales_activity" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_activity sales_activity_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_activity_insert" ON "public"."sales_activity" FOR INSERT TO "authenticated" WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: sales_activity sales_activity_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_activity_select" ON "public"."sales_activity" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: sales_lead_metadata; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."sales_lead_metadata" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_lead_metadata sales_lead_metadata_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_lead_metadata_select" ON "public"."sales_lead_metadata" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: sales_lead_metadata sales_lead_metadata_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_lead_metadata_update" ON "public"."sales_lead_metadata" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());


--
-- Name: sales_opportunities; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."sales_opportunities" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_opportunities sales_opportunities_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_opportunities_insert" ON "public"."sales_opportunities" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());


--
-- Name: sales_opportunities sales_opportunities_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_opportunities_select" ON "public"."sales_opportunities" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: sales_opportunities sales_opportunities_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_opportunities_update" ON "public"."sales_opportunities" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());


--
-- Name: sales_quotation_items; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."sales_quotation_items" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_quotation_items sales_quotation_items_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_quotation_items_delete" ON "public"."sales_quotation_items" FOR DELETE TO "authenticated" USING ("app"."is_admin"());


--
-- Name: sales_quotation_items sales_quotation_items_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_quotation_items_insert" ON "public"."sales_quotation_items" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());


--
-- Name: sales_quotation_items sales_quotation_items_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_quotation_items_select" ON "public"."sales_quotation_items" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: sales_quotation_items sales_quotation_items_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_quotation_items_update" ON "public"."sales_quotation_items" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());


--
-- Name: sales_quotations; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."sales_quotations" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_quotations sales_quotations_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_quotations_insert" ON "public"."sales_quotations" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());


--
-- Name: sales_quotations sales_quotations_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_quotations_select" ON "public"."sales_quotations" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: sales_quotations sales_quotations_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_quotations_update" ON "public"."sales_quotations" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());


--
-- Name: sales_tasks; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."sales_tasks" ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_tasks sales_tasks_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_tasks_delete" ON "public"."sales_tasks" FOR DELETE TO "authenticated" USING ("app"."is_admin"());


--
-- Name: sales_tasks sales_tasks_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_tasks_insert" ON "public"."sales_tasks" FOR INSERT TO "authenticated" WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: sales_tasks sales_tasks_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_tasks_select" ON "public"."sales_tasks" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));


--
-- Name: sales_tasks sales_tasks_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "sales_tasks_update" ON "public"."sales_tasks" FOR UPDATE TO "authenticated" USING (("app"."is_admin"() OR ("assigned_to" = "auth"."uid"()) OR ("created_by" = "auth"."uid"()))) WITH CHECK (("app"."is_admin"() OR ("assigned_to" = "auth"."uid"()) OR ("created_by" = "auth"."uid"())));


--
-- Name: schedule_participants; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE "public"."schedule_participants" ENABLE ROW LEVEL SECURITY;

--
-- Name: schedule_participants schedule_participants_delete; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "schedule_participants_delete" ON "public"."schedule_participants" FOR DELETE TO "authenticated" USING ("app"."is_admin"());


--
-- Name: schedule_participants schedule_participants_insert; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "schedule_participants_insert" ON "public"."schedule_participants" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());


--
-- Name: schedule_participants schedule_participants_select; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "schedule_participants_select" ON "public"."schedule_participants" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));


--
-- Name: schedule_participants schedule_participants_update; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY "schedule_participants_update" ON "public"."schedule_participants" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());


--
-- Name: SCHEMA "app"; Type: ACL; Schema: -; Owner: postgres
--

GRANT USAGE ON SCHEMA "app" TO "authenticated";


--
-- Name: SCHEMA "public"; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";


--
-- Name: FUNCTION "current_role"(); Type: ACL; Schema: app; Owner: postgres
--

REVOKE ALL ON FUNCTION "app"."current_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."current_role"() TO "authenticated";


--
-- Name: FUNCTION "duplicate_certificate_with_skill_snapshot"("p_source_certificate_id" "uuid"); Type: ACL; Schema: app; Owner: postgres
--

REVOKE ALL ON FUNCTION "app"."duplicate_certificate_with_skill_snapshot"("p_source_certificate_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."duplicate_certificate_with_skill_snapshot"("p_source_certificate_id" "uuid") TO "authenticated";


--
-- Name: FUNCTION "handle_new_user"(); Type: ACL; Schema: app; Owner: postgres
--

REVOKE ALL ON FUNCTION "app"."handle_new_user"() FROM PUBLIC;


--
-- Name: FUNCTION "has_min_role"("min_role" "public"."user_role"); Type: ACL; Schema: app; Owner: postgres
--

REVOKE ALL ON FUNCTION "app"."has_min_role"("min_role" "public"."user_role") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."has_min_role"("min_role" "public"."user_role") TO "authenticated";


--
-- Name: FUNCTION "is_active"(); Type: ACL; Schema: app; Owner: postgres
--

REVOKE ALL ON FUNCTION "app"."is_active"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."is_active"() TO "authenticated";


--
-- Name: FUNCTION "is_admin"(); Type: ACL; Schema: app; Owner: postgres
--

REVOKE ALL ON FUNCTION "app"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."is_admin"() TO "authenticated";


--
-- Name: FUNCTION "is_editor"(); Type: ACL; Schema: app; Owner: postgres
--

REVOKE ALL ON FUNCTION "app"."is_editor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."is_editor"() TO "authenticated";


--
-- Name: FUNCTION "is_super_admin"(); Type: ACL; Schema: app; Owner: postgres
--

REVOKE ALL ON FUNCTION "app"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."is_super_admin"() TO "authenticated";


--
-- Name: FUNCTION "issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text"); Type: ACL; Schema: app; Owner: postgres
--

REVOKE ALL ON FUNCTION "app"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text") TO "authenticated";


--
-- Name: FUNCTION "log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb"); Type: ACL; Schema: app; Owner: postgres
--

REVOKE ALL ON FUNCTION "app"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") TO "service_role";


--
-- Name: FUNCTION "accept_quotation"("p_quotation_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."accept_quotation"("p_quotation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_quotation"("p_quotation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_quotation"("p_quotation_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "convert_lead_to_opportunity"("p_lead_metadata_id" "uuid", "p_title" "text", "p_expected_close_date" "date", "p_estimated_value" numeric); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."convert_lead_to_opportunity"("p_lead_metadata_id" "uuid", "p_title" "text", "p_expected_close_date" "date", "p_estimated_value" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."convert_lead_to_opportunity"("p_lead_metadata_id" "uuid", "p_title" "text", "p_expected_close_date" "date", "p_estimated_value" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."convert_lead_to_opportunity"("p_lead_metadata_id" "uuid", "p_title" "text", "p_expected_close_date" "date", "p_estimated_value" numeric) TO "service_role";


--
-- Name: FUNCTION "feedback_anonymous_stats"("p_schedule_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "feedback_generate_links"("p_schedule_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."feedback_generate_links"("p_schedule_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feedback_generate_links"("p_schedule_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_generate_links"("p_schedule_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_generate_links"("p_schedule_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "feedback_get_by_token"("p_token" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."feedback_get_by_token"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feedback_get_by_token"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_get_by_token"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_get_by_token"("p_token" "text") TO "service_role";


--
-- Name: FUNCTION "feedback_reopen"("p_feedback_id" "uuid"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."feedback_reopen"("p_feedback_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feedback_reopen"("p_feedback_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_reopen"("p_feedback_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_reopen"("p_feedback_id" "uuid") TO "service_role";


--
-- Name: FUNCTION "feedback_submit"("p_token" "text", "p_data" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") TO "service_role";


--
-- Name: FUNCTION "get_public_upcoming_schedules"("p_include_past" boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."get_public_upcoming_schedules"("p_include_past" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_upcoming_schedules"("p_include_past" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_upcoming_schedules"("p_include_past" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_upcoming_schedules"("p_include_past" boolean) TO "service_role";


--
-- Name: FUNCTION "log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") TO "service_role";


--
-- Name: FUNCTION "log_event_as_service"("p_actor_id" "uuid", "p_actor_email" "text", "p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."log_event_as_service"("p_actor_id" "uuid", "p_actor_email" "text", "p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_event_as_service"("p_actor_id" "uuid", "p_actor_email" "text", "p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") TO "service_role";


--
-- Name: FUNCTION "mark_opportunity_lost"("p_opportunity_id" "uuid", "p_reason" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."mark_opportunity_lost"("p_opportunity_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_opportunity_lost"("p_opportunity_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_opportunity_lost"("p_opportunity_id" "uuid", "p_reason" "text") TO "service_role";


--
-- Name: FUNCTION "mark_proposal_delivery_status"("p_id" "uuid", "p_email_sent" boolean, "p_sheets_synced" boolean); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."mark_proposal_delivery_status"("p_id" "uuid", "p_email_sent" boolean, "p_sheets_synced" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_proposal_delivery_status"("p_id" "uuid", "p_email_sent" boolean, "p_sheets_synced" boolean) TO "service_role";


--
-- Name: FUNCTION "reject_quotation"("p_quotation_id" "uuid", "p_reason" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."reject_quotation"("p_quotation_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_quotation"("p_quotation_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_quotation"("p_quotation_id" "uuid", "p_reason" "text") TO "service_role";


--
-- Name: FUNCTION "resolve_schedule_feedback_participant"("p_public_token" "text", "p_identity_number" "text", "p_request_fingerprint_hash" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."resolve_schedule_feedback_participant"("p_public_token" "text", "p_identity_number" "text", "p_request_fingerprint_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_schedule_feedback_participant"("p_public_token" "text", "p_identity_number" "text", "p_request_fingerprint_hash" "text") TO "service_role";


--
-- Name: FUNCTION "set_updated_at"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";


--
-- Name: FUNCTION "submit_proposal_request"("p_company_name" "text", "p_contact_person" "text", "p_job_title" "text", "p_email" "text", "p_phone" "text", "p_industry" "text", "p_category" "text", "p_programme" "text", "p_participants" integer, "p_location" "text", "p_preferred_month" "text", "p_budget" "text", "p_objectives" "text", "p_notes" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."submit_proposal_request"("p_company_name" "text", "p_contact_person" "text", "p_job_title" "text", "p_email" "text", "p_phone" "text", "p_industry" "text", "p_category" "text", "p_programme" "text", "p_participants" integer, "p_location" "text", "p_preferred_month" "text", "p_budget" "text", "p_objectives" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_proposal_request"("p_company_name" "text", "p_contact_person" "text", "p_job_title" "text", "p_email" "text", "p_phone" "text", "p_industry" "text", "p_category" "text", "p_programme" "text", "p_participants" integer, "p_location" "text", "p_preferred_month" "text", "p_budget" "text", "p_objectives" "text", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_proposal_request"("p_company_name" "text", "p_contact_person" "text", "p_job_title" "text", "p_email" "text", "p_phone" "text", "p_industry" "text", "p_category" "text", "p_programme" "text", "p_participants" integer, "p_location" "text", "p_preferred_month" "text", "p_budget" "text", "p_objectives" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_proposal_request"("p_company_name" "text", "p_contact_person" "text", "p_job_title" "text", "p_email" "text", "p_phone" "text", "p_industry" "text", "p_category" "text", "p_programme" "text", "p_participants" integer, "p_location" "text", "p_preferred_month" "text", "p_budget" "text", "p_objectives" "text", "p_notes" "text") TO "service_role";


--
-- Name: FUNCTION "submit_public_enquiry"("p_name" "text", "p_company" "text", "p_email" "text", "p_phone" "text", "p_enquiry_type" "text", "p_subject" "text", "p_message" "text", "p_source_page" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."submit_public_enquiry"("p_name" "text", "p_company" "text", "p_email" "text", "p_phone" "text", "p_enquiry_type" "text", "p_subject" "text", "p_message" "text", "p_source_page" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_public_enquiry"("p_name" "text", "p_company" "text", "p_email" "text", "p_phone" "text", "p_enquiry_type" "text", "p_subject" "text", "p_message" "text", "p_source_page" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_public_enquiry"("p_name" "text", "p_company" "text", "p_email" "text", "p_phone" "text", "p_enquiry_type" "text", "p_subject" "text", "p_message" "text", "p_source_page" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_public_enquiry"("p_name" "text", "p_company" "text", "p_email" "text", "p_phone" "text", "p_enquiry_type" "text", "p_subject" "text", "p_message" "text", "p_source_page" "text") TO "service_role";


--
-- Name: FUNCTION "sync_participant_last4"(); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."sync_participant_last4"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_participant_last4"() TO "service_role";


--
-- Name: FUNCTION "teras_photo_next_id"(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION "public"."teras_photo_next_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."teras_photo_next_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."teras_photo_next_id"() TO "service_role";


--
-- Name: FUNCTION "verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text") TO "service_role";


--
-- Name: FUNCTION "verify_certificate"("input_certificate_no" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."verify_certificate"("input_certificate_no" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_certificate"("input_certificate_no" "text") TO "service_role";


--
-- Name: FUNCTION "verify_certificate_by_value"("search_value" "text"); Type: ACL; Schema: public; Owner: postgres
--

REVOKE ALL ON FUNCTION "public"."verify_certificate_by_value"("search_value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_certificate_by_value"("search_value" "text") TO "service_role";


--
-- Name: TABLE "admin_users"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."admin_users" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_users" TO "service_role";


--
-- Name: TABLE "assessments"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."assessments" TO "service_role";


--
-- Name: TABLE "attendance"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance" TO "service_role";


--
-- Name: TABLE "audit_logs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."audit_logs" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";


--
-- Name: SEQUENCE "audit_logs_id_seq"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "service_role";


--
-- Name: TABLE "certificate_import_logs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."certificate_import_logs" TO "anon";
GRANT ALL ON TABLE "public"."certificate_import_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."certificate_import_logs" TO "service_role";


--
-- Name: SEQUENCE "certificate_number_seq"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE "public"."certificate_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."certificate_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."certificate_number_seq" TO "service_role";


--
-- Name: TABLE "certificate_skill_results"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."certificate_skill_results" TO "authenticated";
GRANT ALL ON TABLE "public"."certificate_skill_results" TO "service_role";


--
-- Name: TABLE "certificate_templates"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."certificate_templates" TO "anon";
GRANT ALL ON TABLE "public"."certificate_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."certificate_templates" TO "service_role";


--
-- Name: TABLE "certificate_verifications"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."certificate_verifications" TO "anon";
GRANT ALL ON TABLE "public"."certificate_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."certificate_verifications" TO "service_role";


--
-- Name: SEQUENCE "certificate_verifications_id_seq"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE "public"."certificate_verifications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."certificate_verifications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."certificate_verifications_id_seq" TO "service_role";


--
-- Name: TABLE "certificates"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."certificates" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."certificates" TO "authenticated";


--
-- Name: TABLE "cms_content"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."cms_content" TO "authenticated";
GRANT ALL ON TABLE "public"."cms_content" TO "service_role";


--
-- Name: TABLE "cms_media"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."cms_media" TO "authenticated";
GRANT ALL ON TABLE "public"."cms_media" TO "service_role";


--
-- Name: TABLE "companies"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";


--
-- Name: SEQUENCE "company_id_seq"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE "public"."company_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."company_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."company_id_seq" TO "service_role";


--
-- Name: TABLE "company_profile"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."company_profile" TO "anon";
GRANT ALL ON TABLE "public"."company_profile" TO "authenticated";
GRANT ALL ON TABLE "public"."company_profile" TO "service_role";


--
-- Name: TABLE "course_schedules"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."course_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."course_schedules" TO "service_role";


--
-- Name: TABLE "courses"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."courses" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."courses" TO "authenticated";


--
-- Name: TABLE "downloads"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."downloads" TO "anon";
GRANT ALL ON TABLE "public"."downloads" TO "authenticated";
GRANT ALL ON TABLE "public"."downloads" TO "service_role";


--
-- Name: TABLE "enquiries"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."enquiries" TO "authenticated";
GRANT ALL ON TABLE "public"."enquiries" TO "service_role";


--
-- Name: TABLE "faq_categories"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."faq_categories" TO "anon";
GRANT ALL ON TABLE "public"."faq_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."faq_categories" TO "service_role";


--
-- Name: TABLE "faqs"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."faqs" TO "anon";
GRANT ALL ON TABLE "public"."faqs" TO "authenticated";
GRANT ALL ON TABLE "public"."faqs" TO "service_role";


--
-- Name: TABLE "feedback_improvement_actions"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."feedback_improvement_actions" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."feedback_improvement_actions" TO "authenticated";


--
-- Name: TABLE "feedback_issues"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."feedback_issues" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."feedback_issues" TO "authenticated";


--
-- Name: TABLE "feedback_schedule_links"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."feedback_schedule_links" TO "service_role";


--
-- Name: TABLE "feedback_schedule_lookup_attempts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."feedback_schedule_lookup_attempts" TO "service_role";


--
-- Name: TABLE "gallery_categories"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."gallery_categories" TO "anon";
GRANT ALL ON TABLE "public"."gallery_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."gallery_categories" TO "service_role";


--
-- Name: TABLE "gallery_images"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."gallery_images" TO "anon";
GRANT ALL ON TABLE "public"."gallery_images" TO "authenticated";
GRANT ALL ON TABLE "public"."gallery_images" TO "service_role";


--
-- Name: TABLE "media"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."media" TO "anon";
GRANT ALL ON TABLE "public"."media" TO "authenticated";
GRANT ALL ON TABLE "public"."media" TO "service_role";


--
-- Name: TABLE "media_folders"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."media_folders" TO "anon";
GRANT ALL ON TABLE "public"."media_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."media_folders" TO "service_role";


--
-- Name: TABLE "news_categories"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."news_categories" TO "anon";
GRANT ALL ON TABLE "public"."news_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."news_categories" TO "service_role";


--
-- Name: TABLE "news_posts"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."news_posts" TO "anon";
GRANT ALL ON TABLE "public"."news_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."news_posts" TO "service_role";


--
-- Name: TABLE "participant_feedback"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."participant_feedback" TO "service_role";
GRANT SELECT ON TABLE "public"."participant_feedback" TO "authenticated";


--
-- Name: SEQUENCE "participant_id_seq"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE "public"."participant_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."participant_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."participant_id_seq" TO "service_role";


--
-- Name: TABLE "participant_skill_results"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."participant_skill_results" TO "authenticated";
GRANT ALL ON TABLE "public"."participant_skill_results" TO "service_role";


--
-- Name: TABLE "participants"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."participants" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."participants" TO "authenticated";


--
-- Name: TABLE "photo_activity_log"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."photo_activity_log" TO "anon";
GRANT ALL ON TABLE "public"."photo_activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_activity_log" TO "service_role";


--
-- Name: TABLE "photo_ai_analysis"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."photo_ai_analysis" TO "service_role";


--
-- Name: TABLE "photo_categories"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."photo_categories" TO "anon";
GRANT ALL ON TABLE "public"."photo_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_categories" TO "service_role";


--
-- Name: TABLE "photo_events"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."photo_events" TO "anon";
GRANT ALL ON TABLE "public"."photo_events" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_events" TO "service_role";


--
-- Name: TABLE "photo_id_sequences"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."photo_id_sequences" TO "anon";
GRANT ALL ON TABLE "public"."photo_id_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_id_sequences" TO "service_role";


--
-- Name: TABLE "photo_usage_types"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."photo_usage_types" TO "anon";
GRANT ALL ON TABLE "public"."photo_usage_types" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_usage_types" TO "service_role";


--
-- Name: TABLE "photo_usages"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."photo_usages" TO "anon";
GRANT ALL ON TABLE "public"."photo_usages" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_usages" TO "service_role";


--
-- Name: TABLE "photos"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."photos" TO "anon";
GRANT ALL ON TABLE "public"."photos" TO "authenticated";
GRANT ALL ON TABLE "public"."photos" TO "service_role";


--
-- Name: TABLE "profiles"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";


--
-- Name: TABLE "proposal_requests"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN,UPDATE ON TABLE "public"."proposal_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."proposal_requests" TO "service_role";


--
-- Name: TABLE "sales_activity"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,MAINTAIN ON TABLE "public"."sales_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_activity" TO "service_role";


--
-- Name: TABLE "sales_lead_metadata"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN,UPDATE ON TABLE "public"."sales_lead_metadata" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_lead_metadata" TO "service_role";


--
-- Name: TABLE "sales_opportunities"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."sales_opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_opportunities" TO "service_role";


--
-- Name: TABLE "sales_quotation_items"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."sales_quotation_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_quotation_items" TO "service_role";


--
-- Name: TABLE "sales_quotations"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."sales_quotations" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_quotations" TO "service_role";


--
-- Name: TABLE "sales_tasks"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."sales_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_tasks" TO "service_role";


--
-- Name: SEQUENCE "schedule_code_seq"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON SEQUENCE "public"."schedule_code_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."schedule_code_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."schedule_code_seq" TO "service_role";


--
-- Name: TABLE "schedule_participants"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."schedule_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_participants" TO "service_role";


--
-- Name: TABLE "v_certificate_eligibility"; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE "public"."v_certificate_eligibility" TO "authenticated";
GRANT ALL ON TABLE "public"."v_certificate_eligibility" TO "service_role";


--
-- Name: TABLE "v_sales_lead_inbox"; Type: ACL; Schema: public; Owner: postgres
--

GRANT SELECT,MAINTAIN ON TABLE "public"."v_sales_lead_inbox" TO "authenticated";
GRANT ALL ON TABLE "public"."v_sales_lead_inbox" TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

-- The global default is required to remove PostgreSQL's implicit PUBLIC
-- EXECUTE grant for functions created by postgres. Schema-scoped defaults
-- below cannot revoke that global default.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
-- ALTER DEFAULT PRIVILEGES FOR ROLE "supabase_admin" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


--
--

--
-- PostgreSQL database dump complete
--

--
-- Application-owned Auth trigger omitted by schema-filtered pg_dump. This
-- definition was read from the production catalog and requires native Supabase
-- Auth to exist in a fresh environment; auth.* is not recreated.
--

CREATE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "app"."handle_new_user"();
