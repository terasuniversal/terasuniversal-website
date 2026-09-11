-- ============================================================================
-- TERAS UNIVERSAL - Database Baseline V2 BOOTSTRAP
-- ----------------------------------------------------------------------------
-- NEW-ENVIRONMENT-ONLY. DO NOT RUN AGAINST PRODUCTION OR ANY POPULATED DB.
-- Source snapshot: schema.sql from Production project iagzkrzeuawaxvacqprk.
-- A partial failure leaves the target dirty; recreate the empty project.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS "app";

DO $$
DECLARE
  marker regclass;
  existing text[];
BEGIN
  marker := to_regclass('app.app_schema_baseline');
  IF marker IS NOT NULL THEN
    RAISE EXCEPTION 'baseline_marker_exists: app.app_schema_baseline already exists -- refusing to rerun Baseline V2' USING ERRCODE = 'P0001';
  END IF;

  existing := (SELECT array_agg(obj_name) FROM (SELECT unnest(ARRAY[
    'public.profiles','public.courses','public.participants','public.sales_lead_metadata',
    'public.sales_opportunities','public.sales_quotations','public.invoices',
    'public.marketing_contacts','public.course_commercial_profiles'
  ]) AS obj_name) q WHERE to_regclass(obj_name) IS NOT NULL);

  IF existing IS NOT NULL AND cardinality(existing) > 0 THEN
    RAISE EXCEPTION 'non_empty_database: TERAS application objects already exist: % -- refusing Baseline V2 bootstrap' USING ERRCODE = 'P0001';
  END IF;
END
$$;
-- ============================================================================
-- TERAS UNIVERSAL - Database Baseline V2 canonical schema snapshot
-- ----------------------------------------------------------------------------
-- READ-ONLY VERIFIER. Do not run after bootstrap.sql.
-- Source: Production live schema, project iagzkrzeuawaxvacqprk.
-- This file contains schema objects only; no business rows or Auth users.
-- ============================================================================
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


-- Application extension dependencies required before public tables.
CREATE SCHEMA IF NOT EXISTS "extensions";
CREATE EXTENSION IF NOT EXISTS "citext" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public";
CREATE SCHEMA IF NOT EXISTS "app";


ALTER SCHEMA "app" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



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
    'import',
    'staff_created',
    'staff_updated',
    'staff_activated',
    'staff_deactivated',
    'staff_role_changed',
    'staff_department_changed',
    'staff_module_access_changed',
    'password_changed',
    'assessor_created',
    'assessor_updated',
    'assessor_activated',
    'assessor_deactivated',
    'assessor_assigned',
    'assessor_unassigned',
    'assessor_reassigned'
);


ALTER TYPE "public"."audit_action" OWNER TO "postgres";


CREATE TYPE "public"."company_status" AS ENUM (
    'active',
    'inactive',
    'prospect',
    'archived'
);


ALTER TYPE "public"."company_status" OWNER TO "postgres";


CREATE TYPE "public"."content_status" AS ENUM (
    'draft',
    'published',
    'archived'
);


ALTER TYPE "public"."content_status" OWNER TO "postgres";


CREATE TYPE "public"."media_kind" AS ENUM (
    'image',
    'pdf',
    'document',
    'video',
    'other'
);


ALTER TYPE "public"."media_kind" OWNER TO "postgres";


CREATE TYPE "public"."schedule_status" AS ENUM (
    'open',
    'full',
    'in_progress',
    'completed',
    'cancelled'
);


ALTER TYPE "public"."schedule_status" OWNER TO "postgres";


CREATE TYPE "public"."staff_department" AS ENUM (
    'management',
    'sales',
    'marketing',
    'training_operations',
    'administration',
    'finance',
    'hr'
);


ALTER TYPE "public"."staff_department" OWNER TO "postgres";


CREATE TYPE "public"."user_role" AS ENUM (
    'super_admin',
    'admin',
    'editor',
    'trainer',
    'client',
    'participant'
);


ALTER TYPE "public"."user_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."audit_staff_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_action public.audit_action;
  v_meta jsonb;
  v_email text;
  v_entity_id text;
begin
  select email into v_email from public.profiles where id = auth.uid();

  if tg_table_name = 'profiles' then
    if tg_op = 'INSERT' then
      v_action := 'staff_created';
      v_meta := jsonb_build_object('new', to_jsonb(new));
    elsif tg_op = 'UPDATE' then
      if new.is_active is distinct from old.is_active then
        v_action := case when new.is_active then 'staff_activated' else 'staff_deactivated' end;
      elsif new.role is distinct from old.role then
        v_action := 'staff_role_changed';
      elsif new.department is distinct from old.department then
        v_action := 'staff_department_changed';
      else
        v_action := 'staff_updated';
      end if;
      v_meta := jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new));
    else
      v_action := 'delete';
      v_meta := jsonb_build_object('old', to_jsonb(old));
    end if;
  elsif tg_table_name = 'staff_module_access' then
    v_action := 'staff_module_access_changed';
    if tg_op = 'INSERT' then
      v_meta := jsonb_build_object('module_key', new.module_key, 'new_level', new.access_level);
    elsif tg_op = 'UPDATE' then
      v_meta := jsonb_build_object('module_key', new.module_key, 'old_level', old.access_level, 'new_level', new.access_level);
    else
      v_meta := jsonb_build_object('module_key', old.module_key, 'old_level', old.access_level, 'new_level', 'none');
    end if;
  else
    return coalesce(new, old);
  end if;

  v_entity_id := coalesce(
    to_jsonb(new) ->> 'id',
    to_jsonb(new) ->> 'user_id',
    to_jsonb(old) ->> 'id',
    to_jsonb(old) ->> 'user_id'
  );
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), v_email, v_action, tg_table_name, v_entity_id, v_action, v_meta);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."audit_staff_change"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "app"."can_manage_assessors"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.has_module_access_level('assessors', 'admin');
$$;


ALTER FUNCTION "app"."can_manage_assessors"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."can_manage_schedule_assessors"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.has_module_access_level('schedules', 'admin')
     and public.has_module_access('assessors');
$$;


ALTER FUNCTION "app"."can_manage_schedule_assessors"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."can_manage_schedule_groups"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select app.is_super_admin()
    or (app.has_min_role('admin'::public.user_role) and public.has_module_access_level('schedules', 'admin'));
$$;


ALTER FUNCTION "app"."can_manage_schedule_groups"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."can_manage_staff"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    app.current_role() = 'super_admin'
    or (
      app.current_role() = 'admin'
      and public.has_module_access_level('users', 'admin')
    );
$$;


ALTER FUNCTION "app"."can_manage_staff"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."can_manage_trainers"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select app.is_super_admin()
    or (app.has_min_role('admin'::public.user_role) and public.has_module_access_level('trainers', 'view'));
$$;


ALTER FUNCTION "app"."can_manage_trainers"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."can_view_trainers"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select app.is_super_admin()
    or (app.has_min_role('editor'::public.user_role) and public.has_module_access_level('trainers', 'view'));
$$;


ALTER FUNCTION "app"."can_view_trainers"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "app"."current_role"() RETURNS "public"."user_role"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select role from public.profiles where id = (select auth.uid());
$$;


ALTER FUNCTION "app"."current_role"() OWNER TO "postgres";


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


COMMENT ON FUNCTION "app"."duplicate_certificate_with_skill_snapshot"("p_source_certificate_id" "uuid") IS 'Atomically duplicates a certificate and copies its certificate_skill_results snapshot rows verbatim (never re-derived from current participant_skill_results) in a single transaction.';



CREATE OR REPLACE FUNCTION "app"."enforce_invoice_financial_immutability"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_trusted boolean := coalesce(current_setting('app.invoice_trusted_write', true), '') = 'on';
begin
  if new.quotation_id is distinct from old.quotation_id
     or new.opportunity_id is distinct from old.opportunity_id
     or new.company_id is distinct from old.company_id
     or new.currency is distinct from old.currency
     or new.subtotal is distinct from old.subtotal
     or new.discount_amount is distinct from old.discount_amount
     or new.taxable_amount is distinct from old.taxable_amount
     or new.tax_rate is distinct from old.tax_rate
     or new.tax_amount is distinct from old.tax_amount
     or new.grand_total is distinct from old.grand_total
  then
    raise exception 'invoice_financial_fields_immutable' using errcode = 'P0001';
  end if;

  if old.status <> 'draft' and (
       new.billing_name is distinct from old.billing_name
    or new.billing_company is distinct from old.billing_company
    or new.billing_registration_no is distinct from old.billing_registration_no
    or new.billing_address is distinct from old.billing_address
    or new.billing_email is distinct from old.billing_email
    or new.billing_phone is distinct from old.billing_phone
    or new.invoice_date is distinct from old.invoice_date
    or new.due_date is distinct from old.due_date
    or new.notes is distinct from old.notes
    or new.payment_terms is distinct from old.payment_terms
  ) then
    raise exception 'invoice_presentation_fields_immutable_after_issue' using errcode = 'P0001';
  end if;

  if not v_trusted and (
       new.status is distinct from old.status
    or new.amount_paid is distinct from old.amount_paid
    or new.balance_due is distinct from old.balance_due
    or new.issued_at is distinct from old.issued_at
    or new.paid_at is distinct from old.paid_at
    or new.cancelled_at is distinct from old.cancelled_at
  ) then
    raise exception 'invoice_system_fields_require_controlled_path' using errcode = 'P0001';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "app"."enforce_invoice_financial_immutability"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."enforce_invoice_items_immutable"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_invoice_id uuid := coalesce(new.invoice_id, old.invoice_id);
  v_status text;
begin
  select status into v_status from public.invoices where id = v_invoice_id;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'invoice_items_immutable_after_issue' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;


ALTER FUNCTION "app"."enforce_invoice_items_immutable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."enforce_toyyibpay_attempt_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
begin
  if old.payment_provider <> 'toyyibpay' then
    raise exception 'invoice_payment_immutable' using errcode = 'P0001';
  end if;

  if old.status <> 'pending' then
    raise exception 'toyyibpay_attempt_terminal_immutable' using errcode = 'P0001';
  end if;

  if new.status not in ('successful', 'failed', 'superseded') then
    raise exception 'toyyibpay_attempt_illegal_transition' using errcode = 'P0001';
  end if;

  if new.invoice_id is distinct from old.invoice_id
     or new.payment_provider is distinct from old.payment_provider
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.provider_bill_code is distinct from old.provider_bill_code
     or new.payment_url is distinct from old.payment_url
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'toyyibpay_attempt_structural_fields_immutable' using errcode = 'P0001';
  end if;

  if new.status = 'successful' then
    if new.verified_amount is null or new.provider_transaction_id is null
       or new.verified_at is null or new.paid_at is null
    then
      raise exception 'toyyibpay_attempt_successful_requires_verification_fields' using errcode = 'P0001';
    end if;
  else
    if new.paid_at is not null or new.verified_amount is not null or new.provider_transaction_id is not null then
      raise exception 'toyyibpay_attempt_terminal_negative_fields_must_be_null' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "app"."enforce_toyyibpay_attempt_transition"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "app"."gen_trainer_id"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.trainer_id is null or new.trainer_id = '' then
    new.trainer_id := 'TR-' || lpad(nextval('public.trainer_id_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."gen_trainer_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."guard_quotation_commercial_snapshot_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'app'
    AS $$
declare
  v_quotation_status text;
begin
  if tg_table_name = 'sales_quotations' then
    if old.status <> 'draft' and (
      new.customer_company_name is distinct from old.customer_company_name
      or new.customer_contact_name is distinct from old.customer_contact_name
      or new.customer_registration_no is distinct from old.customer_registration_no
      or new.customer_email is distinct from old.customer_email
      or new.customer_phone is distinct from old.customer_phone
      or new.billing_address is distinct from old.billing_address
      or new.training_service_address is distinct from old.training_service_address
    ) then
      raise exception 'governed_quotation_snapshot_immutable' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'sales_quotation_items' then
    select status into v_quotation_status
    from public.sales_quotations
    where id = old.quotation_id;

    if v_quotation_status is distinct from 'draft' and (
      new.course_id is distinct from old.course_id
      or new.course_name_snapshot is distinct from old.course_name_snapshot
      or new.hrdf_claim is distinct from old.hrdf_claim
      or new.package_includes_snapshot is distinct from old.package_includes_snapshot
    ) then
      raise exception 'governed_quotation_item_snapshot_immutable' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."guard_quotation_commercial_snapshot_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."guard_sales_revenue_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'pg_catalog', 'public', 'app'
    AS $$
declare
  v_transition text := current_setting('app.sales_revenue_transition', true);
begin
  if tg_table_name = 'sales_quotations' and tg_op = 'INSERT' then
    if new.status = 'accepted' and (v_transition is distinct from 'accept' or current_user <> 'postgres') then
      raise exception 'quotation_acceptance_requires_governed_rpc' using errcode = 'P0001';
    end if;
    if new.status = 'cancelled' and (v_transition is distinct from 'reverse' or current_user <> 'postgres') then
      raise exception 'quotation_cancellation_requires_governed_rpc' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'sales_quotations' and tg_op = 'UPDATE' then
    if old.status = 'accepted' then
      if new.opportunity_id is distinct from old.opportunity_id
         or new.total is distinct from old.total
         or new.accepted_at is distinct from old.accepted_at then
        raise exception 'accepted_quotation_immutable' using errcode = 'P0001';
      end if;

      if new.status is distinct from old.status
         and not (new.status = 'cancelled' and v_transition = 'reverse' and current_user = 'postgres') then
        raise exception 'accepted_quotation_transition_requires_governed_rpc' using errcode = 'P0001';
      end if;
    elsif new.status = 'accepted' and (v_transition is distinct from 'accept' or current_user <> 'postgres') then
      raise exception 'quotation_acceptance_requires_governed_rpc' using errcode = 'P0001';
    elsif new.status = 'cancelled' and (v_transition is distinct from 'reverse' or current_user <> 'postgres') then
      raise exception 'quotation_cancellation_requires_governed_rpc' using errcode = 'P0001';
    end if;
  end if;

  if tg_table_name = 'sales_opportunities' and tg_op = 'INSERT' then
    if new.stage = 'won' and (v_transition is distinct from 'accept' or current_user <> 'postgres') then
      raise exception 'opportunity_won_requires_governed_rpc' using errcode = 'P0001';
    end if;
    if new.stage = 'cancelled' and (v_transition is distinct from 'reverse' or current_user <> 'postgres') then
      raise exception 'opportunity_cancellation_requires_governed_rpc' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'sales_opportunities' and tg_op = 'UPDATE' then
    if new.stage = 'won' and old.stage is distinct from 'won'
       and (v_transition is distinct from 'accept' or current_user <> 'postgres') then
      raise exception 'opportunity_won_requires_governed_rpc' using errcode = 'P0001';
    end if;

    if old.stage = 'won' and new.stage is distinct from old.stage
       and not (new.stage = 'cancelled' and v_transition = 'reverse' and current_user = 'postgres') then
      raise exception 'won_opportunity_transition_requires_governed_rpc' using errcode = 'P0001';
    end if;

    if old.stage = 'won' and new.won_at is distinct from old.won_at then
      raise exception 'won_at_is_immutable' using errcode = 'P0001';
    end if;

    if new.stage = 'cancelled' and (v_transition is distinct from 'reverse' or current_user <> 'postgres') then
      raise exception 'opportunity_cancellation_requires_governed_rpc' using errcode = 'P0001';
    end if;
    if old.stage = 'cancelled' and new.stage is distinct from old.stage then
      raise exception 'cancelled_opportunity_is_terminal' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "app"."guard_sales_revenue_mutation"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "app"."has_min_role"("min_role" "public"."user_role") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select app.is_active() and array_position(enum_range(null::public.user_role), app.current_role())
    <= array_position(enum_range(null::public.user_role), min_role);
$$;


ALTER FUNCTION "app"."has_min_role"("min_role" "public"."user_role") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."is_active"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select is_active from public.profiles where id = (select auth.uid())), false);
$$;


ALTER FUNCTION "app"."is_active"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select app.has_min_role('admin'::public.user_role); $$;


ALTER FUNCTION "app"."is_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."is_admin_or_trainer"() RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select app.is_active() and (app.is_admin() or app.current_role() = 'trainer'::public.user_role);
$$;


ALTER FUNCTION "app"."is_admin_or_trainer"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."is_editor"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select app.has_min_role('editor'::public.user_role); $$;


ALTER FUNCTION "app"."is_editor"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$ select app.current_role() = 'super_admin' and app.is_active(); $$;


ALTER FUNCTION "app"."is_super_admin"() OWNER TO "postgres";


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


COMMENT ON FUNCTION "app"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text") IS 'Atomically issues one certificate and its 5-row certificate_skill_results snapshot in a single transaction. Re-validates v_certificate_eligibility itself; never trusts a caller-supplied eligibility result.';



CREATE OR REPLACE FUNCTION "app"."legacy_merge_fingerprint"("p_batch_id" "uuid") RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app', 'extensions'
    AS $$
  select encode(
    digest(
      coalesce(
        string_agg(
          s.id::text || '|' ||
          coalesce(s.match_status, '') || '|' ||
          coalesce(s.matched_participant_id::text, '') || '|' ||
          coalesce(s.mapped_course_id::text, '') || '|' ||
          coalesce(trim(s.raw_certificate_number), '') || '|' ||
          coalesce(s.training_start_date::text, '') || '|' ||
          coalesce(s.training_end_date::text, ''),
          ',' order by s.id
        ),
        ''
      ),
      'sha256'
    ),
    'hex'
  )
  from public.legacy_participant_staging s
  where s.batch_id = p_batch_id
    and s.review_status in ('approved', 'merged');
$$;


ALTER FUNCTION "app"."legacy_merge_fingerprint"("p_batch_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "app"."next_campaign_number"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'app'
    AS $$
  select 'MC-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.marketing_campaign_seq')::text, 4, '0');
$$;


ALTER FUNCTION "app"."next_campaign_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."next_invoice_number"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'app'
    AS $$
  select 'INV-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.sales_invoice_seq')::text, 4, '0');
$$;


ALTER FUNCTION "app"."next_invoice_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."next_marketing_contact_number"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'app'
    AS $$
  select 'MCT-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.marketing_contact_seq')::text, 4, '0');
$$;


ALTER FUNCTION "app"."next_marketing_contact_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."next_opportunity_number"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'app'
    AS $$
  select 'OPP-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.sales_opportunity_seq')::text, 4, '0');
$$;


ALTER FUNCTION "app"."next_opportunity_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."next_quotation_number"() RETURNS "text"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'app'
    AS $$
  select 'QT-' || to_char(current_date, 'YYYY') || '-' || lpad(nextval('app.sales_quotation_seq')::text, 4, '0');
$$;


ALTER FUNCTION "app"."next_quotation_number"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."propagate_lead_is_test"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if old.is_test is distinct from new.is_test then
    update public.sales_opportunities
    set is_test = new.is_test
    where lead_metadata_id = old.id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."propagate_lead_is_test"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."propagate_opportunity_is_test"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if old.is_test is distinct from new.is_test then
    update public.sales_quotations
    set is_test = new.is_test
    where opportunity_id = old.id;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."propagate_opportunity_is_test"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."protect_last_super_admin"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if old.role = 'super_admin' and old.is_active
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not exists (
       select 1 from public.profiles p
       where p.id <> old.id and p.role = 'super_admin' and p.is_active
     ) then
    raise exception 'cannot remove the last active super admin' using errcode = '42501';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."protect_last_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."public_registration_payment_state_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if not (
      (old.status = 'pending' and new.status in ('processing', 'failed', 'cancelled'))
      or (old.status = 'processing' and new.status in ('paid', 'failed', 'cancelled'))
      or (old.status = 'paid' and new.status = 'refunded')
    ) then
      raise exception 'invalid_public_payment_attempt_transition' using errcode = 'P0001';
    end if;
  end if;

  if old.status in ('failed', 'cancelled', 'refunded')
     and new.status is distinct from old.status then
    raise exception 'terminal_public_payment_attempt_state' using errcode = 'P0001';
  end if;

  if old.status = 'paid' and (
    new.amount is distinct from old.amount
    or new.registration_id is distinct from old.registration_id
    or new.payment_provider is distinct from old.payment_provider
    or new.provider_bill_code is distinct from old.provider_bill_code
    or new.provider_transaction_id is distinct from old.provider_transaction_id
  ) then
    raise exception 'paid_public_payment_attempt_immutable' using errcode = 'P0001';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "app"."public_registration_payment_state_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."public_registration_state_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if tg_op = 'UPDATE' and old.registration_status is distinct from new.registration_status then
    if not (
      (old.registration_status = 'pending_payment' and new.registration_status in ('payment_pending', 'failed', 'cancelled', 'expired'))
      or (old.registration_status = 'payment_pending' and new.registration_status in ('confirmed', 'failed', 'cancelled', 'expired'))
      or (old.registration_status = 'failed' and new.registration_status = 'payment_pending')
      or (old.registration_status = 'confirmed' and new.registration_status = 'cancelled')
    ) then
      raise exception 'invalid_public_registration_transition' using errcode = 'P0001';
    end if;
  end if;

  if old.registration_status in ('cancelled', 'expired')
     and new.registration_status is distinct from old.registration_status then
    raise exception 'terminal_public_registration_state' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' and old.payment_status is distinct from new.payment_status then
    if not (
      (old.payment_status = 'pending' and new.payment_status in ('processing', 'paid', 'failed', 'cancelled'))
      or (old.payment_status = 'processing' and new.payment_status in ('paid', 'failed', 'cancelled'))
      or (old.payment_status = 'failed' and new.payment_status = 'processing')
      or (old.payment_status = 'paid' and new.payment_status = 'refunded')
    ) then
      raise exception 'invalid_public_payment_transition' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "app"."public_registration_state_guard"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."recompute_invoice_balance"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_amount_paid numeric(12,2);
  v_grand_total numeric(12,2);
  v_status text;
  v_balance numeric(12,2);
begin
  select coalesce(sum(
    case
      when payment_provider = 'toyyibpay' then verified_amount
      else amount
    end
  ), 0) into v_amount_paid
  from public.invoice_payments
  where invoice_id = new.invoice_id and status = 'successful';

  select grand_total, status into v_grand_total, v_status
  from public.invoices where id = new.invoice_id;

  v_balance := v_grand_total - v_amount_paid;

  perform set_config('app.invoice_trusted_write', 'on', true);
  update public.invoices
  set amount_paid = v_amount_paid,
      balance_due = v_balance,
      status = case
        when v_status = 'cancelled' then v_status
        when v_balance <= 0 and v_grand_total > 0 then 'paid'
        when v_amount_paid > 0 then 'partially_paid'
        else v_status
      end,
      paid_at = case when v_balance <= 0 and v_grand_total > 0 and paid_at is null then now() else paid_at end,
      updated_at = now()
  where id = new.invoice_id;

  return new;
end;
$$;


ALTER FUNCTION "app"."recompute_invoice_balance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "app"."set_updated_at"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "app"."sync_opportunity_is_test"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.is_test := coalesce(
      (select m.is_test from public.sales_lead_metadata m where m.id = new.lead_metadata_id),
      new.is_test, false
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."sync_opportunity_is_test"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "app"."sync_quotation_is_test"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op = 'INSERT' then
    new.is_test := coalesce(
      (select o.is_test from public.sales_opportunities o where o.id = new.opportunity_id),
      new.is_test, false
    );
  end if;
  return new;
end;
$$;


ALTER FUNCTION "app"."sync_quotation_is_test"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "app"."toyyibpay_system_actor"(OUT "actor_id" "uuid", OUT "actor_email" "text") RETURNS "record"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
  select id, email from public.profiles
  where role in ('super_admin', 'admin') and is_active = true
  order by (role = 'super_admin') desc, created_at asc
  limit 1;
$$;


ALTER FUNCTION "app"."toyyibpay_system_actor"(OUT "actor_id" "uuid", OUT "actor_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_quotation"("p_quotation_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'app'
    AS $$
declare
  v_opportunity_id uuid;
  v_locked_opportunity_id uuid;
  v_lead_metadata_id uuid;
  v_status text;
  v_opportunity_stage text;
  v_now timestamptz := now();
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select opportunity_id into v_opportunity_id
  from public.sales_quotations
  where id = p_quotation_id;
  if v_opportunity_id is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;

  select lead_metadata_id, stage into v_lead_metadata_id, v_opportunity_stage
  from public.sales_opportunities
  where id = v_opportunity_id
  for update;
  if v_lead_metadata_id is null then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;
  if v_opportunity_stage in ('won', 'lost', 'cancelled') then
    raise exception 'invalid_transition: opportunity is already resolved (current stage: %)', v_opportunity_stage using errcode = 'P0001';
  end if;

  select opportunity_id, status into v_locked_opportunity_id, v_status
  from public.sales_quotations
  where id = p_quotation_id
  for update;
  if v_locked_opportunity_id is distinct from v_opportunity_id then
    raise exception 'quotation_opportunity_changed_during_acceptance' using errcode = 'P0001',
      detail = 'The quotation relationship changed while acceptance was being prepared; retry after reloading the quotation.';
  end if;
  if v_status is distinct from 'sent' then
    raise exception 'invalid_transition: only a sent quotation can be accepted (current status: %)', v_status using errcode = 'P0001';
  end if;

  perform set_config('app.sales_revenue_transition', 'accept', true);
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


CREATE OR REPLACE FUNCTION "public"."attach_public_registration_toyy_pay_bill"("p_attempt_id" "uuid", "p_bill_code" "text", "p_payment_url" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_attempt_id is null or nullif(btrim(p_bill_code), '') is null or nullif(btrim(p_payment_url), '') is null then
    raise exception 'invalid_payment_bill' using errcode = 'P0001';
  end if;

  select * into v_attempt
  from public.public_registration_payments
  where id = p_attempt_id and payment_provider = 'toyyibpay'
  for update;

  if v_attempt.id is null then
    raise exception 'payment_attempt_not_found' using errcode = 'P0001';
  end if;
  if v_attempt.status not in ('pending', 'processing') or v_attempt.bill_creation_state <> 'claimed' then
    if v_attempt.provider_bill_code = p_bill_code then
      return jsonb_build_object('status', 'already_attached', 'payment_url', v_attempt.payment_url);
    end if;
    raise exception 'payment_attempt_not_attachable' using errcode = 'P0001';
  end if;

  update public.public_registration_payments
  set provider_bill_code = btrim(p_bill_code),
      payment_url = btrim(p_payment_url),
      bill_creation_state = 'attached',
      status = 'processing'
  where id = p_attempt_id;

  return jsonb_build_object('status', 'attached', 'payment_url', btrim(p_payment_url));
end;
$$;


ALTER FUNCTION "public"."attach_public_registration_toyy_pay_bill"("p_attempt_id" "uuid", "p_bill_code" "text", "p_payment_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."begin_public_registration_payment"("p_registration_reference" "text", "p_registration_secret" "text", "p_provider" "text" DEFAULT 'toyyibpay'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
declare
  v_registration public.public_registrations%rowtype;
  v_attempt public.public_registration_payments%rowtype;
  v_token_hash text;
begin
  if p_provider <> 'toyyibpay' then
    raise exception 'unsupported_payment_provider' using errcode = 'P0001';
  end if;

  v_token_hash := encode(digest(lower(btrim(p_registration_secret)), 'sha256'), 'hex');

  select * into v_registration
  from public.public_registrations
  where registration_reference = btrim(p_registration_reference)
    and confirmation_token_hash = v_token_hash
  for update;

  if v_registration.id is null then
    raise exception 'registration_not_found' using errcode = 'P0001';
  end if;
  if v_registration.hold_expires_at is null or v_registration.hold_expires_at <= now() then
    raise exception 'registration_expired' using errcode = 'P0001';
  end if;
  if v_registration.registration_status in ('cancelled', 'expired', 'confirmed') then
    raise exception 'registration_not_payable' using errcode = 'P0001';
  end if;
  if v_registration.amount_snapshot <= 0 then
    raise exception 'zero_amount_registration' using errcode = 'P0001';
  end if;

  select * into v_attempt
  from public.public_registration_payments
  where registration_id = v_registration.id
    and payment_provider = p_provider
    and status in ('pending', 'processing')
  order by created_at desc
  limit 1
  for update;

  if v_attempt.id is null then
    insert into public.public_registration_payments (
      registration_id, payment_provider, status, amount, currency
    ) values (
      v_registration.id, p_provider, 'pending', v_registration.amount_snapshot, v_registration.currency
    ) returning * into v_attempt;
  end if;

  if v_attempt.payment_url is not null then
    return jsonb_build_object(
      'registration_reference', v_registration.registration_reference,
      'amount', v_attempt.amount,
      'currency', v_attempt.currency,
      'status', v_attempt.status,
      'payment_url', v_attempt.payment_url,
      'bill_creation_owner', false
    );
  end if;

  if v_attempt.bill_creation_state = 'claimed' then
    return jsonb_build_object(
      'registration_reference', v_registration.registration_reference,
      'amount', v_attempt.amount,
      'currency', v_attempt.currency,
      'status', 'bill_creation_in_progress',
      'payment_url', null,
      'bill_creation_owner', false
    );
  end if;

  update public.public_registration_payments
  set bill_creation_state = 'claimed', bill_creation_claimed_at = now()
  where id = v_attempt.id
    and bill_creation_state = 'not_claimed';
  if not found then
    return jsonb_build_object(
      'registration_reference', v_registration.registration_reference,
      'amount', v_attempt.amount,
      'currency', v_attempt.currency,
      'status', 'bill_creation_in_progress',
      'payment_url', null,
      'bill_creation_owner', false
    );
  end if;

  if v_registration.registration_status in ('pending_payment', 'failed') then
    update public.public_registrations
    set registration_status = 'payment_pending', payment_status = 'processing'
    where id = v_registration.id;
  elsif v_registration.payment_status = 'pending' then
    update public.public_registrations
    set payment_status = 'processing'
    where id = v_registration.id;
  end if;

  return jsonb_build_object(
    'registration_reference', v_registration.registration_reference,
    'amount', v_attempt.amount,
    'currency', v_attempt.currency,
    'status', v_attempt.status,
    'payment_url', v_attempt.payment_url,
    'bill_creation_owner', true
  );
end;
$$;


ALTER FUNCTION "public"."begin_public_registration_payment"("p_registration_reference" "text", "p_registration_secret" "text", "p_provider" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_invoice"("p_invoice_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_invoice record;
  v_lead_metadata_id uuid;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if v_invoice.status = 'cancelled' then
    raise exception 'already_cancelled' using errcode = 'P0001';
  end if;
  if v_invoice.status = 'draft' then
    null;
  elsif v_invoice.status = 'issued' and v_invoice.amount_paid = 0 then
    null;
  else
    raise exception 'cannot_cancel_invoice_with_payments' using errcode = 'P0001';
  end if;

  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_invoice.opportunity_id;

  perform set_config('app.invoice_trusted_write', 'on', true);
  update public.invoices
  set status = 'cancelled', cancelled_at = now(), updated_at = now()
  where id = p_invoice_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoices', p_invoice_id::text,
    format('Invoice %s cancelled%s', v_invoice.invoice_no, case when p_reason is not null and length(trim(p_reason)) > 0 then ': ' || p_reason else '' end),
    jsonb_build_object('invoice_id', p_invoice_id, 'reason', p_reason));

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_cancelled',
    format('%s cancelled%s', v_invoice.invoice_no, case when p_reason is not null and length(trim(p_reason)) > 0 then ': ' || p_reason else '' end), v_actor);

  return jsonb_build_object('status', 'cancelled', 'invoice_id', p_invoice_id);
end;
$$;


ALTER FUNCTION "public"."cancel_invoice"("p_invoice_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_public_rate_limit"("p_key" "text", "p_window_seconds" integer DEFAULT 60, "p_max_attempts" integer DEFAULT 1) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_row public.public_rate_limits%rowtype;
  v_key text := left(trim(coalesce(p_key, '')), 200);
  v_expired boolean;
begin
  if v_key = '' or p_window_seconds not between 1 and 86400 or p_max_attempts not between 1 and 100 then
    return false;
  end if;
  select * into v_row from public.public_rate_limits where rate_key = v_key for update;
  if not found then
    insert into public.public_rate_limits(rate_key, window_started_at, request_count)
    values (v_key, now(), 1);
    return true;
  end if;
  v_expired := v_row.window_started_at <= now() - make_interval(secs => p_window_seconds);
  if v_expired then
    update public.public_rate_limits set window_started_at = now(), request_count = 1 where rate_key = v_key;
    return true;
  end if;
  if v_row.request_count >= p_max_attempts then
    return false;
  end if;
  update public.public_rate_limits set request_count = request_count + 1 where rate_key = v_key;
  return true;
end;
$$;


ALTER FUNCTION "public"."check_public_rate_limit"("p_key" "text", "p_window_seconds" integer, "p_max_attempts" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_password_change_flag"("p_forced" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  update public.profiles
  set must_change_password = false,
      updated_by = v_uid,
      updated_at = now()
  where id = v_uid;

  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  select v_uid, email, 'password_changed', 'profiles', v_uid::text, 'password_changed',
         jsonb_build_object('forced', coalesce(p_forced, true))
  from public.profiles
  where id = v_uid;
end;
$$;


ALTER FUNCTION "public"."clear_password_change_flag"("p_forced" boolean) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."create_invoice_from_quotation"("p_quotation_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_quotation record;
  v_opportunity record;
  v_company record;
  v_invoice_id uuid;
  v_taxable numeric(12,2);
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_quotation from public.sales_quotations where id = p_quotation_id;
  if v_quotation.id is null then
    raise exception 'quotation_not_found' using errcode = 'P0001';
  end if;
  if v_quotation.status <> 'accepted' then
    raise exception 'quotation_not_accepted' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.invoices where quotation_id = p_quotation_id) then
    raise exception 'invoice_already_exists' using errcode = 'P0001';
  end if;

  select * into v_opportunity from public.sales_opportunities where id = v_quotation.opportunity_id;
  if v_opportunity.id is null then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;

  select * into v_company from public.companies where id = v_opportunity.company_id;

  v_taxable := round(v_quotation.subtotal - v_quotation.discount, 2);
  if round(v_taxable + v_quotation.tax, 2) <> round(v_quotation.total, 2) then
    raise exception 'quotation_totals_inconsistent' using errcode = 'P0001';
  end if;

  insert into public.invoices (
    quotation_id, opportunity_id, company_id,
    billing_name, billing_company, billing_registration_no, billing_address, billing_email, billing_phone,
    subtotal, discount_amount, taxable_amount, tax_rate, tax_amount, grand_total,
    balance_due, payment_terms, created_by
  ) values (
    p_quotation_id, v_quotation.opportunity_id, v_opportunity.company_id,
    coalesce(v_opportunity.contact_person, v_opportunity.company_name, 'N/A'),
    v_opportunity.company_name,
    v_company.registration_no,
    coalesce(v_company.billing_address, v_company.address),
    v_opportunity.contact_email,
    v_opportunity.contact_phone,
    v_quotation.subtotal, v_quotation.discount, v_taxable, v_quotation.sst_rate, v_quotation.tax, v_quotation.total,
    v_quotation.total, v_quotation.terms, v_actor
  ) returning id into v_invoice_id;

  insert into public.invoice_items (invoice_id, description, quantity, unit, unit_price, discount, sort_order, source_quotation_item_id)
  select v_invoice_id, description, quantity, unit, unit_price, discount, sort_order, id
  from public.sales_quotation_items
  where quotation_id = p_quotation_id
  order by sort_order;

  perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action, 'invoices', v_invoice_id::text,
    format('Invoice created from quotation %s', v_quotation.quotation_no),
    jsonb_build_object('invoice_id', v_invoice_id, 'quotation_id', p_quotation_id));

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_opportunity.lead_metadata_id, v_quotation.opportunity_id, p_quotation_id, 'invoice_created', format('Draft invoice created from %s', v_quotation.quotation_no), v_actor);

  return v_invoice_id;
end;
$$;


ALTER FUNCTION "public"."create_invoice_from_quotation"("p_quotation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_public_registration"("p_schedule_id" "uuid", "p_idempotency_key" "text", "p_registration_secret" "text", "p_attendees" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $_$
declare
  v_schedule record;
  v_existing record;
  v_registration_id uuid;
  v_reference text;
  v_token_hash text;
  v_idempotency_hash text;
  v_attendee jsonb;
  v_name text;
  v_identity text;
  v_email text;
  v_phone text;
  v_company text;
  v_count integer;
  v_used integer;
  v_holds integer;
  v_amount numeric(12,2);
  v_identity_values text[] := array[]::text[];
begin
  if p_schedule_id is null
     or p_idempotency_key is null
     or char_length(btrim(p_idempotency_key)) not between 16 and 200
     or p_registration_secret is null
     or p_registration_secret !~ '^[0-9A-Fa-f]{64}$'
     or jsonb_typeof(p_attendees) <> 'array' then
    raise exception 'invalid_registration_input' using errcode = 'P0001';
  end if;

  v_count := jsonb_array_length(p_attendees);
  if v_count < 1 or v_count > 100 then
    raise exception 'invalid_attendee_count' using errcode = 'P0001';
  end if;

  v_idempotency_hash := encode(digest(btrim(p_idempotency_key), 'sha256'), 'hex');

  select pr.id, pr.registration_reference, pr.registration_status, pr.payment_status,
         pr.amount_snapshot, pr.hold_expires_at
    into v_existing
  from public.public_registrations pr
  where pr.schedule_id = p_schedule_id
    and pr.idempotency_key_hash = v_idempotency_hash;

  if v_existing.id is not null then
    return jsonb_build_object(
      'status', 'already_exists',
      'registration_reference', v_existing.registration_reference,
      'registration_status', v_existing.registration_status,
      'payment_status', v_existing.payment_status,
      'amount', v_existing.amount_snapshot,
      'hold_expires_at', v_existing.hold_expires_at
    );
  end if;

  select cs.id, cs.course_id, cs.capacity, cs.seats_taken, cs.status, cs.is_published,
         cs.deleted_at, cs.start_date, cs.end_date, cs.fee,
         c.title, c.course_name, c.status as course_status, c.deleted_at as course_deleted_at
    into v_schedule
  from public.course_schedules cs
  join public.courses c on c.id = cs.course_id
  where cs.id = p_schedule_id
  for update of cs;

  if v_schedule.id is null
     or v_schedule.deleted_at is not null
     or not v_schedule.is_published
     or v_schedule.course_deleted_at is not null
     or v_schedule.course_status <> 'published'
     or v_schedule.status <> 'open'::public.schedule_status
     or v_schedule.start_date < current_date
     or v_schedule.fee is null
     or v_schedule.capacity is null
     or v_schedule.capacity <= 0 then
    raise exception 'schedule_unavailable' using errcode = 'P0001';
  end if;

  -- Re-check after taking the schedule lock. This closes the retry race where
  -- two transactions pass the initial idempotency lookup before either commits.
  select pr.id, pr.registration_reference, pr.registration_status, pr.payment_status,
         pr.amount_snapshot, pr.hold_expires_at
    into v_existing
  from public.public_registrations pr
  where pr.schedule_id = p_schedule_id
    and pr.idempotency_key_hash = v_idempotency_hash;

  if v_existing.id is not null then
    return jsonb_build_object(
      'status', 'already_exists',
      'registration_reference', v_existing.registration_reference,
      'registration_status', v_existing.registration_status,
      'payment_status', v_existing.payment_status,
      'amount', v_existing.amount_snapshot,
      'hold_expires_at', v_existing.hold_expires_at
    );
  end if;

  select count(*) into v_used
  from public.schedule_participants sp
  where sp.schedule_id = p_schedule_id
    and sp.deleted_at is null
    and sp.registration_status <> 'cancelled';

  select coalesce(sum(pr.attendee_count), 0)::integer into v_holds
  from public.public_registrations pr
  where pr.schedule_id = p_schedule_id
    and pr.registration_status in ('pending_payment', 'payment_pending')
    and pr.hold_expires_at > now();

  if v_used + v_holds + v_count > v_schedule.capacity then
    raise exception 'capacity_exceeded' using errcode = 'P0001';
  end if;

  for v_attendee in select value from jsonb_array_elements(p_attendees)
  loop
    v_name := nullif(btrim(v_attendee->>'full_name'), '');
    v_identity := nullif(upper(regexp_replace(btrim(coalesce(v_attendee->>'ic_passport_no', '')), '[^0-9A-Za-z]', '', 'g')), '');
    v_email := nullif(lower(btrim(coalesce(v_attendee->>'email', ''))), '');
    v_phone := nullif(btrim(coalesce(v_attendee->>'phone', '')), '');
    v_company := nullif(btrim(coalesce(v_attendee->>'company', '')), '');

    if v_name is null or char_length(v_name) > 200
       or (v_identity is not null and char_length(v_identity) > 120)
       or (v_email is not null and (char_length(v_email) > 254 or position('@' in v_email) < 2))
       or (v_phone is not null and char_length(v_phone) > 40)
       or (v_company is not null and char_length(v_company) > 200) then
      raise exception 'invalid_attendee_input' using errcode = 'P0001';
    end if;

    if v_identity is not null then
      if v_identity = any(v_identity_values) then
        raise exception 'duplicate_attendee' using errcode = 'P0001';
      end if;
      if exists (
        select 1
        from public.public_registration_attendees pra
        join public.public_registrations pr on pr.id = pra.registration_id
        where pr.schedule_id = p_schedule_id
          and pr.registration_status in ('pending_payment', 'payment_pending', 'confirmed')
          and pra.identity_normalized = v_identity
      ) then
        raise exception 'duplicate_registration' using errcode = 'P0001';
      end if;
      if exists (
        select 1
        from public.participants p
        join public.schedule_participants sp on sp.participant_id = p.id
        where p.deleted_at is null
          and sp.schedule_id = p_schedule_id
          and sp.deleted_at is null
          and sp.registration_status <> 'cancelled'
          and upper(regexp_replace(coalesce(p.ic_passport_no, ''), '[^0-9A-Za-z]', '', 'g')) = v_identity
      ) then
        raise exception 'duplicate_registration' using errcode = 'P0001';
      end if;
      v_identity_values := array_append(v_identity_values, v_identity);
    end if;
  end loop;

  v_token_hash := encode(digest(lower(btrim(p_registration_secret)), 'sha256'), 'hex');
  v_amount := round(v_schedule.fee * v_count, 2);

  insert into public.public_registrations (
    confirmation_token_hash, schedule_id, course_id, attendee_count,
    amount_snapshot, registration_status, payment_status,
    idempotency_key_hash, hold_expires_at
  ) values (
    v_token_hash, p_schedule_id, v_schedule.course_id, v_count,
    v_amount, 'pending_payment', 'pending',
    v_idempotency_hash, now() + interval '30 minutes'
  ) returning id, registration_reference into v_registration_id, v_reference;

  for v_attendee in select value from jsonb_array_elements(p_attendees)
  loop
    v_identity := nullif(upper(regexp_replace(btrim(coalesce(v_attendee->>'ic_passport_no', '')), '[^0-9A-Za-z]', '', 'g')), '');
    insert into public.public_registration_attendees (
      registration_id, full_name, ic_passport_no, identity_normalized,
      email, phone, company
    ) values (
      v_registration_id,
      btrim(v_attendee->>'full_name'),
      nullif(btrim(coalesce(v_attendee->>'ic_passport_no', '')), ''),
      v_identity,
      nullif(lower(btrim(coalesce(v_attendee->>'email', ''))), ''),
      nullif(btrim(coalesce(v_attendee->>'phone', '')), ''),
      nullif(btrim(coalesce(v_attendee->>'company', '')), '')
    );
  end loop;

  return jsonb_build_object(
    'status', 'created',
    'registration_reference', v_reference,
    'registration_status', 'pending_payment',
    'payment_status', 'pending',
    'amount', v_amount,
    'currency', 'MYR',
    'hold_expires_at', now() + interval '30 minutes',
    'course_title', coalesce(v_schedule.title, v_schedule.course_name),
    'start_date', v_schedule.start_date,
    'end_date', v_schedule.end_date
  );
end;
$_$;


ALTER FUNCTION "public"."create_public_registration"("p_schedule_id" "uuid", "p_idempotency_key" "text", "p_registration_secret" "text", "p_attendees" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_public_registrations"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_count integer;
  v_registration_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  v_count := 0;
  -- Registration is locked before its payment attempts, preserving the
  -- global registration -> payment lock order.
  for v_registration_id in
    select id from public.public_registrations
    where registration_status in ('pending_payment', 'payment_pending')
      and hold_expires_at is not null and hold_expires_at <= now()
    order by hold_expires_at, id
    for update
  loop
    update public.public_registrations
    set registration_status = 'expired', expired_at = coalesce(expired_at, now())
    where id = v_registration_id;
    update public.public_registration_payments
    set status = 'cancelled',
        bill_creation_state = bill_creation_state,
        raw_response = jsonb_build_object('expired_at', now(), 'reason', 'registration_hold_expired')
    where registration_id = v_registration_id and status in ('pending', 'processing');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;


ALTER FUNCTION "public"."expire_public_registrations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."fail_public_registration_payment_setup"("p_attempt_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select pr.* into v_attempt
  from public.public_registration_payments pr
  where pr.id = p_attempt_id;
  if v_attempt.id is null then
    return jsonb_build_object('outcome', 'unknown_attempt');
  end if;

  -- Global lock order: registration -> payment attempt -> schedule.
  perform 1
  from public.public_registrations r
  where r.id = v_attempt.registration_id
  for update;
  if not found then
    return jsonb_build_object('outcome', 'unknown_registration');
  end if;

  select * into v_attempt
  from public.public_registration_payments
  where id = p_attempt_id
  for update;
  if v_attempt.status in ('paid', 'refunded') then
    return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
  end if;

  update public.public_registration_payments
  set status = 'failed',
      bill_creation_state = 'failed',
      raw_response = jsonb_build_object('setup_failure', left(coalesce(p_reason, 'payment setup failed'), 500))
  where id = v_attempt.id;
  update public.public_registrations
  set payment_status = 'failed', registration_status = 'failed'
  where id = v_attempt.registration_id
    and registration_status in ('pending_payment', 'payment_pending');
  return jsonb_build_object('outcome', 'failed');
end;
$$;


ALTER FUNCTION "public"."fail_public_registration_payment_setup"("p_attempt_id" "uuid", "p_reason" "text") OWNER TO "postgres";


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


COMMENT ON FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid") IS 'Trainer-safe anonymised feedback aggregates. No participant identity is ever returned; the base tables are not readable by trainers at all.';



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


COMMENT ON FUNCTION "public"."feedback_get_by_token"("p_token" "text") IS 'Resolve a public feedback token to the schedule/course the participant is being asked about. Never returns participant identity.';



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


COMMENT ON FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") IS 'Public feedback submission. Validates ratings/NPS/category, rejects duplicates (only a pending row can be submitted), never exposes identity.';



CREATE OR REPLACE FUNCTION "public"."finalize_public_registration_crm"("p_registration_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'app', 'extensions'
    AS $$
declare
  v_registration public.public_registrations%rowtype;
  v_schedule public.course_schedules%rowtype;
  v_attendee record;
  v_participant_id uuid;
  v_enrollment_id uuid;
  v_created_count integer := 0;
  v_enrolled_count integer := 0;
  v_identity text;
  v_email text;
  v_actor uuid;
  v_actor_email text;
begin
  if auth.role() <> 'service_role' and not app.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_registration
  from public.public_registrations
  where id = p_registration_id
  for update;
  if v_registration.id is null then
    raise exception 'registration_not_found' using errcode = 'P0001';
  end if;
  if v_registration.registration_status = 'confirmed' then
    return jsonb_build_object('outcome', 'already_confirmed', 'registration_reference', v_registration.registration_reference);
  end if;
  if v_registration.payment_status <> 'paid' then
    raise exception 'registration_payment_not_confirmed' using errcode = 'P0001';
  end if;
  if v_registration.registration_status in ('cancelled', 'expired') then
    raise exception 'registration_not_finalizable' using errcode = 'P0001';
  end if;
  if v_registration.registration_status in ('pending_payment', 'failed') then
    update public.public_registrations
    set registration_status = 'payment_pending'
    where id = v_registration.id;
  end if;

  -- Serialize finalization for one schedule so the existing participant
  -- identity indexes and schedule capacity mirror remain race-safe.
  select * into v_schedule
  from public.course_schedules
  where id = v_registration.schedule_id
  for update;
  if v_schedule.id is null or v_schedule.status in ('cancelled', 'completed') then
    raise exception 'schedule_not_finalizable' using errcode = 'P0001';
  end if;

  for v_attendee in
    select * from public.public_registration_attendees
    where registration_id = v_registration.id
    order by created_at, id
  loop
    v_identity := nullif(upper(regexp_replace(btrim(coalesce(v_attendee.ic_passport_no, '')), '[^0-9A-Za-z]', '', 'g')), '');
    v_email := nullif(lower(btrim(coalesce(v_attendee.email, ''))), '');
    v_participant_id := null;

    if v_identity is not null then
      select p.id into v_participant_id
      from public.participants p
      where p.deleted_at is null
        and upper(regexp_replace(coalesce(p.ic_passport_no, ''), '[^0-9A-Za-z]', '', 'g')) = v_identity
      order by p.created_at
      limit 1
      for update;
    end if;
    if v_participant_id is null and v_email is not null then
      select p.id into v_participant_id
      from public.participants p
      where p.deleted_at is null and lower(btrim(coalesce(p.email, ''))) = v_email
      order by p.created_at
      limit 1
      for update;
    end if;

    if v_participant_id is null then
      insert into public.participants (
        full_name, ic_passport_no, email, phone, company, status, registration_date
      ) values (
        btrim(v_attendee.full_name),
        nullif(btrim(coalesce(v_attendee.ic_passport_no, '')), ''),
        v_email,
        nullif(btrim(coalesce(v_attendee.phone, '')), ''),
        nullif(btrim(coalesce(v_attendee.company, '')), ''),
        'registered', current_date
      ) returning id into v_participant_id;
      v_created_count := v_created_count + 1;
    end if;

    update public.participants
    set email = coalesce(email, v_email),
        phone = coalesce(phone, nullif(btrim(coalesce(v_attendee.phone, '')), '')),
        company = coalesce(company, nullif(btrim(coalesce(v_attendee.company, '')), '')),
        updated_at = now()
    where id = v_participant_id;

    select sp.id into v_enrollment_id
    from public.schedule_participants sp
    where sp.schedule_id = v_registration.schedule_id
      and sp.participant_id = v_participant_id
      and sp.deleted_at is null
      and sp.registration_status <> 'cancelled'
    limit 1;

    if v_enrollment_id is null then
      insert into public.schedule_participants (schedule_id, participant_id, registration_status)
      values (v_registration.schedule_id, v_participant_id, 'registered')
      returning id into v_enrollment_id;
      v_enrolled_count := v_enrolled_count + 1;
    end if;

    update public.public_registration_attendees
    set participant_id = v_participant_id
    where id = v_attendee.id;
  end loop;

  update public.public_registrations
  set registration_status = 'confirmed',
      confirmed_at = coalesce(confirmed_at, now()),
      hold_expires_at = null
  where id = v_registration.id;

  if auth.uid() is null then
    select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();
  else
    v_actor := auth.uid();
    select email into v_actor_email from public.profiles where id = v_actor;
  end if;
  perform public.log_event_as_service(
    v_actor,
    v_actor_email,
    'create'::public.audit_action,
    'public_registrations',
    v_registration.id::text,
    'Public registration confirmed: ' || v_registration.registration_reference,
    jsonb_build_object('registration_reference', v_registration.registration_reference, 'schedule_id', v_registration.schedule_id, 'enrolled_count', v_enrolled_count)
  );

  return jsonb_build_object(
    'outcome', 'confirmed',
    'registration_reference', v_registration.registration_reference,
    'participants_created', v_created_count,
    'enrollments_created', v_enrolled_count
  );
end;
$$;


ALTER FUNCTION "public"."finalize_public_registration_crm"("p_registration_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_public_registration_payment_from_callback"("p_attempt_id" "uuid", "p_bill_code" "text", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_callback_received_at" timestamp with time zone, "p_raw_response" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'app'
    AS $$
declare
  v_registration public.public_registrations%rowtype;
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_attempt_id is null or nullif(btrim(p_bill_code), '') is null
     or nullif(btrim(p_provider_transaction_id), '') is null
     or p_verified_amount is null or p_verified_amount <= 0 then
    raise exception 'invalid_verified_payment' using errcode = 'P0001';
  end if;

  -- Lock registration first, then payment attempt; this is the global order.
  select pr.* into v_registration
  from public.public_registrations pr
  where pr.id = (select registration_id from public.public_registration_payments where id = p_attempt_id)
  for update;
  if v_registration.id is null then
    raise exception 'registration_not_found' using errcode = 'P0001';
  end if;
  select * into v_attempt
  from public.public_registration_payments
  where id = p_attempt_id and payment_provider = 'toyyibpay'
  for update;
  if v_attempt.id is null or v_attempt.registration_id <> v_registration.id then
    raise exception 'payment_attempt_not_found' using errcode = 'P0001';
  end if;

  if v_attempt.provider_bill_code is distinct from btrim(p_bill_code) then
    raise exception 'payment_bill_mismatch' using errcode = 'P0001';
  end if;

  if v_attempt.status = 'paid' then
    if v_attempt.provider_transaction_id = btrim(p_provider_transaction_id)
       and v_attempt.verified_amount = p_verified_amount then
      return jsonb_build_object('outcome', 'duplicate_ignored');
    end if;
    raise exception 'paid_attempt_conflict' using errcode = 'P0001';
  end if;
  if round(p_verified_amount, 2) <> round(v_attempt.amount, 2)
     or round(p_verified_amount, 2) <> round(v_registration.amount_snapshot, 2) then
    raise exception 'payment_amount_mismatch' using errcode = 'P0001';
  end if;

  if v_registration.registration_status in ('cancelled', 'expired') then
    if v_attempt.status in ('paid', 'refunded') then
      return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
    end if;
    update public.public_registration_payments
    set provider_transaction_id = btrim(p_provider_transaction_id),
        callback_received_at = p_callback_received_at,
        raw_response = jsonb_build_object(
          'late_success_reconciliation_required', true,
          'verified_amount', round(p_verified_amount, 2),
          'provider_response', coalesce(p_raw_response, '{}'::jsonb)
        )
    where id = v_attempt.id;
    perform public.log_public_registration_payment_event(
      v_attempt.id, 'late_success_after_expiry',
      jsonb_build_object('registration_reference', v_registration.registration_reference)
    );
    return jsonb_build_object('outcome', 'reconciliation_required', 'registration_reference', v_registration.registration_reference);
  end if;
  if v_attempt.status not in ('pending', 'processing') then
    return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
  end if;

  update public.public_registration_payments
  set status = 'paid',
      verified_amount = round(p_verified_amount, 2),
      provider_transaction_id = btrim(p_provider_transaction_id),
      verified_at = now(),
      callback_received_at = p_callback_received_at,
      raw_response = coalesce(p_raw_response, '{}'::jsonb)
  where id = v_attempt.id;

  update public.public_registrations
  set payment_status = 'paid'
  where id = v_registration.id;

  return public.finalize_public_registration_crm(v_registration.id);
end;
$$;


ALTER FUNCTION "public"."finalize_public_registration_payment_from_callback"("p_attempt_id" "uuid", "p_bill_code" "text", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_callback_received_at" timestamp with time zone, "p_raw_response" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_toyyibpay_payment"("p_attempt_id" "uuid", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_raw_response" "jsonb", "p_provider_transaction_time" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_callback_received_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_attempt record;
  v_invoice record;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_paid_at timestamptz;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_verified_amount is null or p_verified_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if p_provider_transaction_id is null or length(trim(p_provider_transaction_id)) = 0 then
    raise exception 'invalid_provider_transaction_id' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_attempt from public.invoice_payments where id = p_attempt_id and payment_provider = 'toyyibpay' for update;
  if v_attempt.id is null then
    raise exception 'attempt_not_found' using errcode = 'P0001';
  end if;
  if v_attempt.status <> 'pending' then
    raise exception 'attempt_not_pending' using errcode = 'P0001';
  end if;

  select * into v_invoice from public.invoices where id = v_attempt.invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if p_verified_amount > v_invoice.balance_due then
    raise exception 'amount_exceeds_balance' using errcode = 'P0001';
  end if;

  v_paid_at := coalesce(p_provider_transaction_time, now());

  update public.invoice_payments
  set status = 'successful',
      verified_amount = p_verified_amount,
      provider_transaction_id = p_provider_transaction_id,
      paid_at = v_paid_at,
      callback_received_at = p_callback_received_at,
      verified_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('raw_response', p_raw_response),
      updated_at = now()
  where id = p_attempt_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay payment verified successful for invoice %s (RM %s)', v_invoice.invoice_no, p_verified_amount),
    jsonb_build_object('invoice_id', v_invoice.id, 'attempt_id', p_attempt_id, 'verified_amount', p_verified_amount, 'provider_transaction_id', p_provider_transaction_id, 'paid_at', v_paid_at));

  return jsonb_build_object('attempt_id', p_attempt_id, 'status', 'successful');
end;
$$;


ALTER FUNCTION "public"."finalize_toyyibpay_payment"("p_attempt_id" "uuid", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_raw_response" "jsonb", "p_provider_transaction_time" timestamp with time zone, "p_callback_received_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_toyyibpay_payment_from_callback"("p_attempt_id" "uuid", "p_billcode" "text", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_provider_transaction_time" timestamp with time zone, "p_callback_received_at" timestamp with time zone, "p_raw_response" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_attempt record;
  v_invoice record;
  v_invoice_no text;
  v_lead_metadata_id uuid;
  v_paid_at timestamptz;
  v_new_amount_paid numeric(12,2);
  v_new_status text;
  v_actor uuid;
  v_actor_email text;
begin
  select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();

  if p_verified_amount is null or p_verified_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;
  if p_provider_transaction_id is null or length(trim(p_provider_transaction_id)) = 0 then
    raise exception 'invalid_provider_transaction_id' using errcode = 'P0001';
  end if;
  if p_billcode is null or length(trim(p_billcode)) = 0 then
    raise exception 'invalid_billcode' using errcode = 'P0001';
  end if;

  select * into v_attempt from public.invoice_payments where id = p_attempt_id and payment_provider = 'toyyibpay' for update;
  if v_attempt.id is null then
    raise exception 'attempt_not_found' using errcode = 'P0001';
  end if;
  if v_attempt.provider_bill_code is distinct from p_billcode then
    raise exception 'billcode_mismatch' using errcode = 'P0001';
  end if;

  select invoice_no into v_invoice_no from public.invoices where id = v_attempt.invoice_id;

  -- Already successful: replay (same refno) or a genuine anomaly (different refno).
  if v_attempt.status = 'successful' then
    if v_attempt.provider_transaction_id = p_provider_transaction_id then
      perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
        format('ToyyibPay callback replay ignored for invoice %s (%s) -- already finalized with the same provider transaction', coalesce(v_invoice_no, '?'), p_billcode),
        jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode, 'provider_transaction_id', p_provider_transaction_id));
      return jsonb_build_object('outcome', 'duplicate_ignored', 'attempt_id', p_attempt_id);
    end if;

    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
      format('ToyyibPay callback for invoice %s (%s) reports a DIFFERENT provider transaction than the one already recorded -- reconciliation required, nothing changed', coalesce(v_invoice_no, '?'), p_billcode),
      jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode,
        'existing_provider_transaction_id', v_attempt.provider_transaction_id, 'new_provider_transaction_id', p_provider_transaction_id,
        'verified_amount', p_verified_amount, 'raw_response', p_raw_response));
    return jsonb_build_object('outcome', 'reconciliation_required', 'attempt_id', p_attempt_id);
  end if;

  -- Terminal but NOT successful (superseded/failed/cancelled), yet the
  -- provider now confirms real money -- never silently apply against a
  -- balance that may have already moved for another reason (item 10).
  if v_attempt.status <> 'pending' then
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
      format('ToyyibPay callback for invoice %s (%s) confirms a real provider transaction, but the local attempt is already "%s" -- reconciliation required, evidence preserved, nothing changed', coalesce(v_invoice_no, '?'), p_billcode, v_attempt.status),
      jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode, 'local_status', v_attempt.status,
        'provider_transaction_id', p_provider_transaction_id, 'verified_amount', p_verified_amount, 'raw_response', p_raw_response));
    return jsonb_build_object('outcome', 'reconciliation_required', 'attempt_id', p_attempt_id);
  end if;

  -- Pending -- the normal path. Re-check against the CURRENT invoice
  -- balance (may have moved since the attempt was created, e.g. a manual
  -- payment) before ever writing anything.
  select * into v_invoice from public.invoices where id = v_attempt.invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if p_verified_amount > v_invoice.balance_due then
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
      format('ToyyibPay callback for invoice %s (%s): provider-confirmed amount RM %s exceeds current balance RM %s -- left pending, reconciliation required', v_invoice.invoice_no, p_billcode, p_verified_amount, v_invoice.balance_due),
      jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode,
        'verified_amount', p_verified_amount, 'balance_due', v_invoice.balance_due, 'provider_transaction_id', p_provider_transaction_id, 'raw_response', p_raw_response));
    return jsonb_build_object('outcome', 'amount_exceeds_balance', 'attempt_id', p_attempt_id);
  end if;

  v_paid_at := coalesce(p_provider_transaction_time, now());

  update public.invoice_payments
  set status = 'successful',
      verified_amount = p_verified_amount,
      provider_transaction_id = p_provider_transaction_id,
      paid_at = v_paid_at,
      callback_received_at = p_callback_received_at,
      verified_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('raw_response', p_raw_response),
      updated_at = now()
  where id = p_attempt_id;

  select amount_paid, status into v_new_amount_paid, v_new_status from public.invoices where id = v_attempt.invoice_id;
  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_invoice.opportunity_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay payment verified successful via callback for invoice %s (RM %s, %s)', v_invoice.invoice_no, p_verified_amount, p_billcode),
    jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode,
      'verified_amount', p_verified_amount, 'provider_transaction_id', p_provider_transaction_id, 'paid_at', v_paid_at));

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'payment_recorded',
    format('%s: ToyyibPay payment of RM %s verified (%s)', v_invoice.invoice_no, p_verified_amount, p_billcode), null);

  if v_new_status = 'paid' then
    insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
    values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_paid', format('%s fully paid (ToyyibPay)', v_invoice.invoice_no), null);
  elsif v_new_status = 'partially_paid' then
    insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
    values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_partially_paid',
      format('%s partially paid via ToyyibPay (balance RM %s)', v_invoice.invoice_no, v_invoice.grand_total - v_new_amount_paid), null);
  end if;

  return jsonb_build_object('outcome', 'finalized', 'attempt_id', p_attempt_id, 'status', 'successful');
end;
$$;


ALTER FUNCTION "public"."finalize_toyyibpay_payment_from_callback"("p_attempt_id" "uuid", "p_billcode" "text", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_provider_transaction_time" timestamp with time zone, "p_callback_received_at" timestamp with time zone, "p_raw_response" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_active_toyyibpay_attempt"("p_invoice_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_attempt record;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select id, provider_bill_code into v_attempt
  from public.invoice_payments
  where invoice_id = p_invoice_id and payment_provider = 'toyyibpay' and status = 'pending'
  limit 1;

  if v_attempt.id is null then
    return jsonb_build_object('has_active_attempt', false);
  end if;

  return jsonb_build_object('has_active_attempt', true, 'attempt_id', v_attempt.id, 'billcode', v_attempt.provider_bill_code);
end;
$$;


ALTER FUNCTION "public"."get_active_toyyibpay_attempt"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_module_access"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    jsonb_agg(jsonb_build_object('module_key', k.module_key, 'access_level', k.access_level) order by k.module_key),
    '[]'::jsonb
  )
  from (
    select c.module_key,
      case
        when app.current_role() = 'super_admin' then 'admin'
        when not coalesce((select access_control_enabled from public.profiles where id = auth.uid()), false)
          then case when app.has_min_role(c.min_role) then 'edit' else 'none' end
        else coalesce(
          (select a.access_level from public.staff_module_access a
            where a.user_id = auth.uid() and a.module_key = c.module_key),
          'none'
        )
      end as access_level
    from public.staff_module_catalog c
    where c.is_active
  ) k
  where k.access_level <> 'none';
$$;


ALTER FUNCTION "public"."get_my_module_access"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_registration_schedule"("p_schedule_id" "uuid") RETURNS TABLE("schedule_id" "uuid", "schedule_code" "text", "course_id" "uuid", "course_title" "text", "course_slug" "text", "start_date" "date", "end_date" "date", "start_time" time without time zone, "end_time" time without time zone, "venue" "text", "delivery_mode" "text", "status" "text", "fee" numeric, "capacity" integer, "available_seats" integer, "registration_available" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
  select
    cs.id,
    cs.schedule_code,
    c.id,
    coalesce(c.title, c.course_name),
    c.slug,
    cs.start_date,
    cs.end_date,
    cs.start_time,
    cs.end_time,
    cs.venue,
    cs.training_mode,
    cs.status::text,
    cs.fee,
    cs.capacity,
    greatest(cs.capacity - cs.seats_taken - coalesce((
      select sum(pr.attendee_count)
      from public.public_registrations pr
      where pr.schedule_id = cs.id
        and pr.registration_status in ('pending_payment', 'payment_pending')
        and pr.hold_expires_at > now()
    ), 0)::integer, 0),
    coalesce((
      cs.is_published
      and cs.deleted_at is null
      and c.deleted_at is null
      and c.status = 'published'
      and cs.status = 'open'::public.schedule_status
      and cs.start_date >= current_date
      and cs.fee is not null
      and cs.capacity is not null
      and cs.capacity > 0
      and cs.capacity > cs.seats_taken + coalesce((
        select sum(pr2.attendee_count)
        from public.public_registrations pr2
        where pr2.schedule_id = cs.id
          and pr2.registration_status in ('pending_payment', 'payment_pending')
          and pr2.hold_expires_at > now()
      ), 0)
    ), false)
  from public.course_schedules cs
  join public.courses c on c.id = cs.course_id
  where cs.id = p_schedule_id
    and cs.is_published
    and cs.deleted_at is null
    and c.deleted_at is null
    and c.status = 'published';
$$;


ALTER FUNCTION "public"."get_public_registration_schedule"("p_schedule_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_registration_status"("p_registration_reference" "text", "p_registration_secret" "text") RETURNS TABLE("registration_reference" "text", "course_title" "text", "start_date" "date", "end_date" "date", "venue" "text", "delivery_mode" "text", "registration_status" "text", "payment_status" "text", "attendee_count" integer, "amount" numeric, "currency" "text", "hold_expires_at" timestamp with time zone)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'extensions'
    AS $$
  select pr.registration_reference,
         coalesce(c.title, c.course_name),
         cs.start_date,
         cs.end_date,
         cs.venue,
         cs.training_mode,
         case when pr.hold_expires_at is not null and pr.hold_expires_at <= now()
              and pr.registration_status in ('pending_payment', 'payment_pending')
              then 'expired' else pr.registration_status end,
         pr.payment_status,
         pr.attendee_count,
         pr.amount_snapshot,
         pr.currency,
         pr.hold_expires_at
  from public.public_registrations pr
  join public.course_schedules cs on cs.id = pr.schedule_id
  join public.courses c on c.id = pr.course_id
  where pr.registration_reference = btrim(p_registration_reference)
    and pr.confirmation_token_hash = encode(digest(lower(btrim(p_registration_secret)), 'sha256'), 'hex');
$$;


ALTER FUNCTION "public"."get_public_registration_status"("p_registration_reference" "text", "p_registration_secret" "text") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."has_module_access"("p_module_key" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when not app.is_active() then false
    when app.current_role() = 'super_admin' then true
    when not coalesce((select access_control_enabled from public.profiles where id = auth.uid()), false)
      then exists (
        select 1 from public.staff_module_catalog c
        where c.module_key = p_module_key
          and c.is_active
          and app.has_min_role(c.min_role)
      )
    else exists (
      select 1 from public.staff_module_access a
      join public.staff_module_catalog c on c.module_key = a.module_key
      where a.user_id = auth.uid()
        and a.module_key = p_module_key
        and c.is_active
    )
  end;
$$;


ALTER FUNCTION "public"."has_module_access"("p_module_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."has_module_access_level"("p_module_key" "text", "p_level" "text" DEFAULT 'view'::"text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case
    when not public.has_module_access(p_module_key) then false
    when app.current_role() = 'super_admin' then true
    when not coalesce((select access_control_enabled from public.profiles where id = auth.uid()), false)
      then true
    else exists (
      select 1 from public.staff_module_access a
      where a.user_id = auth.uid()
        and a.module_key = p_module_key
        and public.module_access_rank(a.access_level) >= public.module_access_rank(p_level)
    )
  end;
$$;


ALTER FUNCTION "public"."has_module_access_level"("p_module_key" "text", "p_level" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "verification_token" "text")
    LANGUAGE "sql"
    SET "search_path" TO 'public', 'app'
    AS $$
  select *
  from app.issue_certificate_with_skill_snapshot(
    p_schedule_id,
    p_participant_id,
    p_certificate_number
  );
$$;


ALTER FUNCTION "public"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_invoice"("p_invoice_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_invoice record;
  v_lead_metadata_id uuid;
  v_item_count integer;
  v_item_sum numeric(12,2);
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if v_invoice.status <> 'draft' then
    raise exception 'invoice_not_draft' using errcode = 'P0001';
  end if;
  if v_invoice.due_date is null then
    raise exception 'due_date_required' using errcode = 'P0001';
  end if;
  if v_invoice.grand_total <= 0 then
    raise exception 'invalid_grand_total' using errcode = 'P0001';
  end if;

  select count(*), coalesce(sum(line_total), 0) into v_item_count, v_item_sum
  from public.invoice_items where invoice_id = p_invoice_id;
  if v_item_count = 0 then
    raise exception 'no_items' using errcode = 'P0001';
  end if;
  if round(v_item_sum, 2) <> round(v_invoice.subtotal, 2) then
    raise exception 'totals_mismatch' using errcode = 'P0001';
  end if;
  if round(v_invoice.taxable_amount + v_invoice.tax_amount, 2) <> round(v_invoice.grand_total, 2) then
    raise exception 'totals_mismatch' using errcode = 'P0001';
  end if;

  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_invoice.opportunity_id;

  perform set_config('app.invoice_trusted_write', 'on', true);
  update public.invoices
  set status = 'issued', issued_at = now(), updated_at = now()
  where id = p_invoice_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoices', p_invoice_id::text,
    format('Invoice %s issued', v_invoice.invoice_no), jsonb_build_object('invoice_id', p_invoice_id, 'grand_total', v_invoice.grand_total));

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_issued', format('%s issued (RM %s)', v_invoice.invoice_no, v_invoice.grand_total), v_actor);

  return jsonb_build_object('status', 'issued', 'invoice_id', p_invoice_id);
end;
$$;


ALTER FUNCTION "public"."issue_invoice"("p_invoice_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."legacy_course_map_approve"("p_batch_id" "uuid", "p_course_map_id" "uuid", "p_course_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_batch_source text;
  v_map_source text;
  v_map_status text;
  v_normalized_name text;
  v_course_deleted_at timestamptz;
  v_updated integer;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select source_label into v_batch_source
  from public.legacy_import_batches
  where id = p_batch_id;
  if v_batch_source is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;

  select source_label, status, normalized_course_name
    into v_map_source, v_map_status, v_normalized_name
  from public.legacy_course_map
  where id = p_course_map_id;
  if v_map_source is null then
    raise exception 'mapping_not_found' using errcode = 'P0001';
  end if;
  if v_map_source <> v_batch_source then
    raise exception 'mapping_source_mismatch' using errcode = 'P0001';
  end if;
  if v_map_status = 'mapped' then
    raise exception 'mapping_already_mapped' using errcode = 'P0001';
  end if;

  select deleted_at into v_course_deleted_at
  from public.courses
  where id = p_course_id;
  if not found then
    raise exception 'course_not_found' using errcode = 'P0001';
  end if;
  if v_course_deleted_at is not null then
    raise exception 'course_deleted' using errcode = 'P0001';
  end if;

  update public.legacy_course_map
  set course_id = p_course_id, status = 'mapped'
  where id = p_course_map_id;

  with updated as (
    update public.legacy_participant_staging s
    set mapped_course_id = p_course_id
    from public.legacy_import_batches b
    where s.batch_id = b.id
      and b.source_label = v_batch_source
      and s.normalized_course_name = v_normalized_name
      and s.mapped_course_id is null
    returning 1
  )
  select count(*) into v_updated from updated;

  return v_updated;
end;
$$;


ALTER FUNCTION "public"."legacy_course_map_approve"("p_batch_id" "uuid", "p_course_map_id" "uuid", "p_course_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."legacy_import_create_batch"("p_source_label" "text", "p_original_filename" "text", "p_source_file_hash" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_existing_id uuid;
  v_new_id uuid;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  if p_source_file_hash is not null then
    select id into v_existing_id
    from public.legacy_import_batches
    where source_file_hash = p_source_file_hash;

    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  insert into public.legacy_import_batches (source_label, original_filename, source_file_hash, created_by)
  values (p_source_label, p_original_filename, p_source_file_hash, auth.uid())
  returning id into v_new_id;

  perform public.log_event('create'::audit_action, 'legacy_import_batches', v_new_id::text,
    format('Created legacy import batch for %s (%s)', p_original_filename, p_source_label));

  return v_new_id;
end;
$$;


ALTER FUNCTION "public"."legacy_import_create_batch"("p_source_label" "text", "p_original_filename" "text", "p_source_file_hash" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."legacy_import_ingest_rows"("p_batch_id" "uuid", "p_rows" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_status text;
  v_inserted integer;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select status into v_status from public.legacy_import_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;
  if v_status <> 'uploaded' then
    raise exception 'invalid_batch_status' using errcode = 'P0001';
  end if;

  with inserted as (
    insert into public.legacy_participant_staging (
      batch_id, source_row_number, raw_data,
      raw_name, raw_ic_passport, normalized_ic_passport,
      raw_email, normalized_email, raw_phone, normalized_phone,
      raw_company, raw_course_name, normalized_course_name,
      training_start_date, training_end_date,
      raw_certificate_number, raw_status
    )
    select
      p_batch_id,
      (row_data ->> 'source_row_number')::integer,
      coalesce(row_data -> 'raw_data', '{}'::jsonb),
      row_data ->> 'raw_name',
      row_data ->> 'raw_ic_passport',
      row_data ->> 'normalized_ic_passport',
      row_data ->> 'raw_email',
      row_data ->> 'normalized_email',
      row_data ->> 'raw_phone',
      row_data ->> 'normalized_phone',
      row_data ->> 'raw_company',
      row_data ->> 'raw_course_name',
      row_data ->> 'normalized_course_name',
      nullif(row_data ->> 'training_start_date', '')::date,
      nullif(row_data ->> 'training_end_date', '')::date,
      row_data ->> 'raw_certificate_number',
      row_data ->> 'raw_status'
    from jsonb_array_elements(p_rows) as row_data
    on conflict (batch_id, source_row_number) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  update public.legacy_import_batches
  set status = 'normalized',
      total_row_count = (select count(*) from public.legacy_participant_staging where batch_id = p_batch_id)
  where id = p_batch_id;

  perform public.log_event('import'::audit_action, 'legacy_participant_staging', p_batch_id::text,
    format('Ingested %s staging rows for batch %s', v_inserted, p_batch_id));

  return v_inserted;
end;
$$;


ALTER FUNCTION "public"."legacy_import_ingest_rows"("p_batch_id" "uuid", "p_rows" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."legacy_merge_dry_run"("p_batch_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app', 'extensions'
    AS $$
declare
  v_batch record;
  v_row record;
  v_rows jsonb := '[]'::jsonb;
  v_plan jsonb;
  v_eligible boolean;
  v_participant_action text;
  v_participant_existing_id uuid;
  v_participant_ref text;
  v_schedule_action text;
  v_schedule_existing_id uuid;
  v_schedule_ref text;
  v_schedule_key text;
  v_end_date date;
  v_enrollment_action text;
  v_enrollment_key text;
  v_certificate_action text;
  v_cert_key text;
  v_planned_participants jsonb := '{}'::jsonb;
  v_planned_schedules jsonb := '{}'::jsonb;
  v_planned_enrollments jsonb := '{}'::jsonb;
  v_planned_certs jsonb := '{}'::jsonb;
  v_hash text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select * into v_batch from public.legacy_import_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;

  for v_row in
    select * from public.legacy_participant_staging where batch_id = p_batch_id order by source_row_number, id
  loop
    v_eligible := (
      v_row.review_status = 'approved'
      and v_row.validation_error is null
      and v_row.match_status in ('exact_match', 'new_participant')
      and (v_row.raw_course_name is null or v_row.mapped_course_id is not null)
    );

    v_participant_existing_id := null;
    v_participant_ref := null;
    if v_row.review_status = 'merged' then
      v_participant_action := 'ALREADY_MERGED';
      v_participant_ref := v_row.result_participant_id::text;
    elsif v_row.review_status <> 'approved' then
      v_participant_action := 'BLOCKED_NOT_APPROVED';
    elsif v_row.validation_error is not null then
      v_participant_action := 'BLOCKED_VALIDATION_ERROR';
    elsif v_row.match_status = 'exact_match' and v_row.matched_participant_id is not null then
      v_participant_action := 'LINK_EXISTING';
      v_participant_existing_id := v_row.matched_participant_id;
      v_participant_ref := v_row.matched_participant_id::text;
    elsif v_row.match_status = 'new_participant' then
      select id into v_participant_existing_id
      from public.participants
      where deleted_at is null
        and v_row.normalized_ic_passport is not null
        and (
          regexp_replace(coalesce(identity_no, ''), '[^A-Za-z0-9]', '', 'g') = v_row.normalized_ic_passport
          or regexp_replace(coalesce(ic_passport_no, ''), '[^A-Za-z0-9]', '', 'g') = v_row.normalized_ic_passport
        )
      limit 1;

      if v_participant_existing_id is not null then
        v_participant_action := 'LINK_EXISTING';
        v_participant_ref := v_participant_existing_id::text;
      elsif v_row.normalized_ic_passport is not null and v_planned_participants ? v_row.normalized_ic_passport then
        v_participant_action := 'REUSE_PLANNED_NEW';
        v_participant_ref := v_planned_participants ->> v_row.normalized_ic_passport;
      else
        v_participant_action := 'CREATE_NEW';
        v_participant_ref := 'NEW#' || v_row.id::text;
        if v_row.normalized_ic_passport is not null then
          v_planned_participants := v_planned_participants || jsonb_build_object(v_row.normalized_ic_passport, v_participant_ref);
        end if;
      end if;
    else
      v_participant_action := 'BLOCKED_IDENTITY_UNRESOLVED';
    end if;

    v_schedule_action := null;
    v_schedule_existing_id := null;
    v_schedule_ref := null;
    if v_row.mapped_course_id is null and v_row.raw_course_name is not null then
      v_schedule_action := 'NO_SCHEDULE_COURSE_UNMAPPED';
    elsif v_row.mapped_course_id is null or v_row.training_start_date is null then
      v_schedule_action := 'NO_SCHEDULE_POSSIBLE';
    else
      v_end_date := coalesce(v_row.training_end_date, v_row.training_start_date);
      v_schedule_key := v_row.mapped_course_id::text || '|' || v_row.training_start_date::text || '|' || v_end_date::text;

      select id into v_schedule_existing_id
      from public.course_schedules
      where course_id = v_row.mapped_course_id
        and start_date = v_row.training_start_date
        and end_date = v_end_date
        and legacy_batch_id = p_batch_id
      limit 1;

      if v_schedule_existing_id is not null then
        v_schedule_action := 'REUSE_EXISTING_HISTORICAL';
        v_schedule_ref := v_schedule_existing_id::text;
      elsif v_planned_schedules ? v_schedule_key then
        v_schedule_action := 'REUSE_PLANNED_HISTORICAL';
        v_schedule_ref := v_planned_schedules ->> v_schedule_key;
      else
        v_schedule_action := 'CREATE_HISTORICAL';
        v_schedule_ref := 'NEW#' || v_row.id::text;
        v_planned_schedules := v_planned_schedules || jsonb_build_object(v_schedule_key, v_schedule_ref);
      end if;
    end if;

    if v_schedule_ref is null or v_participant_ref is null
       or v_participant_action like 'BLOCKED%' or v_participant_action = 'ALREADY_MERGED' then
      v_enrollment_action := 'SKIP_NOT_EVIDENCED';
    else
      v_enrollment_key := v_participant_ref || '::' || v_schedule_ref;
      if v_participant_ref not like 'NEW#%' and v_schedule_ref not like 'NEW#%' and exists (
        select 1 from public.schedule_participants
        where schedule_id = v_schedule_ref::uuid
          and participant_id = v_participant_ref::uuid
          and deleted_at is null
          and registration_status <> 'cancelled'
      ) then
        v_enrollment_action := 'REUSE_EXISTING_ENROLLMENT';
      elsif v_planned_enrollments ? v_enrollment_key then
        v_enrollment_action := 'REUSE_PLANNED_ENROLLMENT';
      else
        v_enrollment_action := 'CREATE_ENROLLMENT';
        v_planned_enrollments := v_planned_enrollments || jsonb_build_object(v_enrollment_key, true);
      end if;
    end if;

    if v_row.raw_certificate_number is null or length(trim(v_row.raw_certificate_number)) = 0 then
      v_certificate_action := 'NO_CERTIFICATE_NO_NUMBER';
    else
      v_cert_key := trim(v_row.raw_certificate_number);
      if v_row.training_start_date is null then
        v_certificate_action := 'BLOCKED_CERTIFICATE_DATE_REQUIRED';
      elsif exists (select 1 from public.certificates where certificate_no = v_cert_key) then
        v_certificate_action := 'CONFLICT_CERT_NUMBER_EXISTS';
      elsif v_planned_certs ? v_cert_key then
        v_certificate_action := 'CONFLICT_CERT_NUMBER_DUPLICATE_IN_BATCH';
      else
        v_certificate_action := 'CREATE_PRESERVE_NUMBER';
        v_planned_certs := v_planned_certs || jsonb_build_object(v_cert_key, v_row.id::text);
      end if;
    end if;

    v_plan := jsonb_build_object(
      'row_id', v_row.id,
      'source_row_number', v_row.source_row_number,
      'raw_name', v_row.raw_name,
      'review_status', v_row.review_status,
      'match_status', v_row.match_status,
      'eligible', v_eligible,
      'participant_action', v_participant_action,
      'participant_existing_id', v_participant_existing_id,
      'schedule_action', v_schedule_action,
      'schedule_existing_id', v_schedule_existing_id,
      'enrollment_action', v_enrollment_action,
      'attendance_action', 'NOT_CREATED_NO_EVIDENCE',
      'assessment_action', 'NOT_CREATED_NO_EVIDENCE',
      'certificate_action', v_certificate_action
    );
    v_rows := v_rows || jsonb_build_array(v_plan);
  end loop;

  v_hash := app.legacy_merge_fingerprint(p_batch_id);
  update public.legacy_import_batches
  set dry_run_at = now(), dry_run_hash = v_hash
  where id = p_batch_id;

  perform public.log_event_as_service(auth.uid(), (select email from public.profiles where id = auth.uid()),
    'update'::audit_action, 'legacy_import_batches', p_batch_id::text, 'Dry run requested for legacy import batch', jsonb_build_object('batch_id', p_batch_id, 'dry_run_hash', v_hash));

  return jsonb_build_object('batch_id', p_batch_id, 'batch_status', v_batch.status, 'dry_run_hash', v_hash, 'rows', v_rows);
end;
$$;


ALTER FUNCTION "public"."legacy_merge_dry_run"("p_batch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."legacy_merge_execute_row"("p_batch_id" "uuid", "p_row_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app', 'extensions'
    AS $$
declare
  v_row public.legacy_participant_staging%rowtype;
  v_batch record;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_participant_id uuid;
  v_schedule_id uuid;
  v_enrollment_id uuid;
  v_certificate_id uuid;
  v_end_date date;
  v_err text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_batch from public.legacy_import_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;
  if v_batch.status <> 'approved' then
    raise exception 'batch_not_approved' using errcode = 'P0001';
  end if;

  select * into v_row from public.legacy_participant_staging where id = p_row_id and batch_id = p_batch_id;
  if v_row.id is null then
    raise exception 'row_not_found' using errcode = 'P0001';
  end if;

  if v_row.review_status = 'merged' then
    return jsonb_build_object(
      'status', 'already_merged', 'row_id', p_row_id,
      'participant_id', v_row.result_participant_id, 'schedule_id', v_row.result_schedule_id,
      'enrollment_id', v_row.result_enrollment_id, 'certificate_id', v_row.result_certificate_id
    );
  end if;
  if v_row.review_status <> 'approved' then
    raise exception 'row_not_approved' using errcode = 'P0001';
  end if;
  if v_row.validation_error is not null then
    raise exception 'row_has_validation_error' using errcode = 'P0001';
  end if;
  if v_row.match_status not in ('exact_match', 'new_participant') then
    raise exception 'identity_not_resolved' using errcode = 'P0001';
  end if;
  if v_row.raw_course_name is not null and v_row.mapped_course_id is null then
    raise exception 'course_not_mapped' using errcode = 'P0001';
  end if;

  begin
    if v_row.match_status = 'exact_match' and v_row.matched_participant_id is not null then
      v_participant_id := v_row.matched_participant_id;
    else
      if v_row.normalized_ic_passport is not null then
        perform pg_advisory_xact_lock(hashtext('legacy_participant_ic:' || v_row.normalized_ic_passport));
      end if;

      select id into v_participant_id
      from public.participants
      where deleted_at is null
        and v_row.normalized_ic_passport is not null
        and (
          regexp_replace(coalesce(identity_no, ''), '[^A-Za-z0-9]', '', 'g') = v_row.normalized_ic_passport
          or regexp_replace(coalesce(ic_passport_no, ''), '[^A-Za-z0-9]', '', 'g') = v_row.normalized_ic_passport
        )
      limit 1;

      if v_participant_id is null then
        insert into public.participants (full_name, ic_passport_no, company, legacy_batch_id)
        values (v_row.raw_name, v_row.raw_ic_passport, v_row.raw_company, p_batch_id)
        returning id into v_participant_id;
      end if;
    end if;

    if v_row.mapped_course_id is not null and v_row.training_start_date is not null then
      v_end_date := coalesce(v_row.training_end_date, v_row.training_start_date);

      perform pg_advisory_xact_lock(hashtext(
        'legacy_schedule:' || p_batch_id::text || '|' || v_row.mapped_course_id::text || '|' ||
        v_row.training_start_date::text || '|' || v_end_date::text
      ));

      select id into v_schedule_id
      from public.course_schedules
      where course_id = v_row.mapped_course_id
        and start_date = v_row.training_start_date
        and end_date = v_end_date
        and legacy_batch_id = p_batch_id
      limit 1;

      if v_schedule_id is null then
        insert into public.course_schedules (course_id, start_date, end_date, status, capacity, is_published, legacy_batch_id, notes)
        values (
          v_row.mapped_course_id, v_row.training_start_date, v_end_date,
          'completed', null, false, p_batch_id,
          'Legacy historical schedule reconstructed from imported source data. Trainer, venue, exam date, and capacity were not recorded by the source and are intentionally left blank.'
        )
        returning id into v_schedule_id;
      end if;
    end if;

    if v_schedule_id is not null then
      select id into v_enrollment_id
      from public.schedule_participants
      where schedule_id = v_schedule_id
        and participant_id = v_participant_id
        and deleted_at is null
        and registration_status <> 'cancelled'
      limit 1;

      if v_enrollment_id is null then
        insert into public.schedule_participants (schedule_id, participant_id, registration_status, legacy_batch_id)
        values (v_schedule_id, v_participant_id, 'completed', p_batch_id)
        returning id into v_enrollment_id;
      end if;
    end if;

    if v_row.raw_certificate_number is not null and length(trim(v_row.raw_certificate_number)) > 0 then
      if v_row.training_start_date is null then
        raise exception 'certificate_date_required';
      end if;
      if exists (select 1 from public.certificates where certificate_no = trim(v_row.raw_certificate_number)) then
        raise exception 'certificate_number_collision';
      end if;
      insert into public.certificates (certificate_no, participant_id, course_id, participant_name, course_name, issue_date, schedule_id, legacy_batch_id)
      values (
        trim(v_row.raw_certificate_number), v_participant_id, v_row.mapped_course_id,
        v_row.raw_name, coalesce(v_row.raw_course_name, ''), v_row.training_start_date,
        v_schedule_id, p_batch_id
      )
      returning id into v_certificate_id;
    end if;

    update public.legacy_participant_staging
    set review_status = 'merged',
        result_participant_id = v_participant_id,
        result_schedule_id = v_schedule_id,
        result_enrollment_id = v_enrollment_id,
        result_certificate_id = v_certificate_id,
        merged_at = now(),
        merge_error = null
    where id = p_row_id;

    perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action, 'legacy_participant_staging', p_row_id::text,
      format('Legacy row "%s" merged (participant=%s, schedule=%s, enrollment=%s, certificate=%s)', v_row.raw_name, v_participant_id, v_schedule_id, v_enrollment_id, v_certificate_id),
      jsonb_build_object('batch_id', p_batch_id, 'row_id', p_row_id, 'participant_id', v_participant_id, 'schedule_id', v_schedule_id, 'enrollment_id', v_enrollment_id, 'certificate_id', v_certificate_id));

    return jsonb_build_object(
      'status', 'merged', 'row_id', p_row_id,
      'participant_id', v_participant_id, 'schedule_id', v_schedule_id,
      'enrollment_id', v_enrollment_id, 'certificate_id', v_certificate_id
    );

  exception when others then
    v_err := sqlerrm;
    update public.legacy_participant_staging set merge_error = v_err where id = p_row_id;
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'legacy_participant_staging', p_row_id::text,
      format('Legacy row "%s" merge FAILED: %s', v_row.raw_name, v_err),
      jsonb_build_object('batch_id', p_batch_id, 'row_id', p_row_id, 'error', v_err));
    return jsonb_build_object('status', 'failed', 'row_id', p_row_id, 'error', v_err);
  end;
end;
$$;


ALTER FUNCTION "public"."legacy_merge_execute_row"("p_batch_id" "uuid", "p_row_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."legacy_merge_finalize_batch"("p_batch_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_batch record;
  v_unmerged integer;
  v_failed integer;
  v_merged_count integer;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_batch from public.legacy_import_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;
  if v_batch.status = 'merged' then
    return jsonb_build_object('status', 'already_merged', 'batch_id', p_batch_id);
  end if;
  if v_batch.status <> 'approved' then
    raise exception 'batch_not_approved' using errcode = 'P0001';
  end if;

  select count(*) filter (where review_status = 'approved') into v_unmerged
  from public.legacy_participant_staging where batch_id = p_batch_id;
  -- Excludes rejected rows: an admin who rejects a row after a failed merge
  -- attempt (choosing not to pursue it) must not have that row's stale
  -- merge_error permanently block finalization -- rejected rows are always
  -- permanently excluded, per the same rule that excludes them from the
  -- approval-readiness check in Phase 2's approveBatch().
  select count(*) filter (where merge_error is not null and review_status <> 'rejected') into v_failed
  from public.legacy_participant_staging where batch_id = p_batch_id;
  select count(*) filter (where review_status = 'merged') into v_merged_count
  from public.legacy_participant_staging where batch_id = p_batch_id;

  if v_unmerged > 0 then
    raise exception 'rows_not_yet_merged' using errcode = 'P0001';
  end if;
  if v_failed > 0 then
    raise exception 'rows_have_merge_errors' using errcode = 'P0001';
  end if;

  update public.legacy_import_batches set status = 'merged', merged_count = v_merged_count where id = p_batch_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'legacy_import_batches', p_batch_id::text,
    format('Legacy import batch marked merged (%s row(s))', v_merged_count),
    jsonb_build_object('batch_id', p_batch_id, 'merged_count', v_merged_count));

  return jsonb_build_object('status', 'merged', 'batch_id', p_batch_id, 'merged_count', v_merged_count);
end;
$$;


ALTER FUNCTION "public"."legacy_merge_finalize_batch"("p_batch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."legacy_merge_verify_checkpoint"("p_batch_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app', 'extensions'
    AS $$
declare
  v_batch record;
  v_current_hash text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select * into v_batch from public.legacy_import_batches where id = p_batch_id;
  if v_batch.id is null then
    raise exception 'batch_not_found' using errcode = 'P0001';
  end if;

  if v_batch.dry_run_at is null or v_batch.dry_run_hash is null then
    raise exception 'dry_run_required' using errcode = 'P0001';
  end if;

  v_current_hash := app.legacy_merge_fingerprint(p_batch_id);
  if v_current_hash <> v_batch.dry_run_hash then
    raise exception 'DRY_RUN_STALE' using errcode = 'P0001';
  end if;
end;
$$;


ALTER FUNCTION "public"."legacy_merge_verify_checkpoint"("p_batch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text" DEFAULT NULL::"text", "p_entity_id" "text" DEFAULT NULL::"text", "p_summary" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select app.log_event(p_action, p_entity_type, p_entity_id, p_summary, p_metadata);
$$;


ALTER FUNCTION "public"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."log_public_registration_payment_event"("p_attempt_id" "uuid", "p_event_type" "text", "p_detail" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'app'
    AS $$
declare
  v_actor uuid;
  v_actor_email text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if p_event_type not in ('invalid_hash', 'missing_fields', 'unknown_attempt', 'billcode_mismatch', 'verification_failed', 'no_matching_transaction', 'amount_mismatch', 'late_success_after_expiry') then
    raise exception 'invalid_payment_event_type' using errcode = 'P0001';
  end if;

  select actor_id, actor_email into v_actor, v_actor_email
  from app.toyyibpay_system_actor();
  perform public.log_event_as_service(
    v_actor,
    v_actor_email,
    'update'::public.audit_action,
    'public_registration_payments',
    coalesce(p_attempt_id::text, 'unknown'),
    'Public registration payment event: ' || p_event_type,
    coalesce(p_detail, '{}'::jsonb)
  );
  return jsonb_build_object('logged', true);
end;
$$;


ALTER FUNCTION "public"."log_public_registration_payment_event"("p_attempt_id" "uuid", "p_event_type" "text", "p_detail" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_toyyibpay_callback_event"("p_attempt_id" "uuid", "p_event_type" "text", "p_detail" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_actor uuid;
  v_actor_email text;
begin
  select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();

  if p_event_type not in ('invalid_hash', 'missing_fields', 'unknown_billcode_or_order_id', 'billcode_mismatch', 'verification_failed', 'no_matching_transaction') then
    raise exception 'invalid_event_type' using errcode = 'P0001';
  end if;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', coalesce(p_attempt_id::text, 'unresolved'),
    format('ToyyibPay callback security event: %s', p_event_type),
    coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('event_type', p_event_type));

  return jsonb_build_object('logged', true);
end;
$$;


ALTER FUNCTION "public"."log_toyyibpay_callback_event"("p_attempt_id" "uuid", "p_event_type" "text", "p_detail" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_toyyibpay_conflict"("p_invoice_id" "uuid", "p_attempt_id" "uuid", "p_conflict_type" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_invoice_no text;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_conflict_type not in ('in_progress', 'reconciliation_required') then
    raise exception 'invalid_conflict_type' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;
  select invoice_no into v_invoice_no from public.invoices where id = p_invoice_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay conflict (%s) for invoice %s -- manual payment blocked pending reconciliation', p_conflict_type, coalesce(v_invoice_no, '?')),
    jsonb_build_object('invoice_id', p_invoice_id, 'attempt_id', p_attempt_id, 'conflict_type', p_conflict_type));

  return jsonb_build_object('logged', true);
end;
$$;


ALTER FUNCTION "public"."log_toyyibpay_conflict"("p_invoice_id" "uuid", "p_attempt_id" "uuid", "p_conflict_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_toyyibpay_orphan_bill_event"("p_invoice_id" "uuid", "p_billcode" "text", "p_compensation_status" "text", "p_detail" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_invoice_no text;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_billcode is null or length(trim(p_billcode)) = 0 then
    raise exception 'invalid_billcode' using errcode = 'P0001';
  end if;
  if p_compensation_status not in ('deactivated', 'deactivation_failed') then
    raise exception 'invalid_compensation_status' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;
  select invoice_no into v_invoice_no from public.invoices where id = p_invoice_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoices', p_invoice_id::text,
    case when p_compensation_status = 'deactivated'
      then format('ToyyibPay orphan bill (%s) for invoice %s compensated: provider confirmed deactivation after a local DB write failure', p_billcode, coalesce(v_invoice_no, '?'))
      else format('ToyyibPay orphan bill (%s) for invoice %s -- compensation FAILED, requires manual reconciliation', p_billcode, coalesce(v_invoice_no, '?'))
    end,
    jsonb_build_object('invoice_id', p_invoice_id, 'billcode', p_billcode, 'compensation_status', p_compensation_status, 'detail', p_detail));

  return jsonb_build_object('logged', true);
end;
$$;


ALTER FUNCTION "public"."log_toyyibpay_orphan_bill_event"("p_invoice_id" "uuid", "p_billcode" "text", "p_compensation_status" "text", "p_detail" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_lead_test"("p_lead_metadata_id" "uuid", "p_is_test" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if app.current_role() <> 'super_admin' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_lead_metadata_id is null then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  update public.sales_lead_metadata
  set is_test = coalesce(p_is_test, false),
      updated_at = now()
  where id = p_lead_metadata_id;
  if not found then
    raise exception 'lead_not_found' using errcode = 'P0001';
  end if;
end;
$$;


ALTER FUNCTION "public"."mark_lead_test"("p_lead_metadata_id" "uuid", "p_is_test" boolean) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."mark_public_registration_payment_failed_from_callback"("p_attempt_id" "uuid", "p_bill_code" "text", "p_callback_received_at" timestamp with time zone, "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'app'
    AS $$
declare
  v_registration public.public_registrations%rowtype;
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Lock registration first, then payment attempt; this is the global order.
  select pr.* into v_registration
  from public.public_registrations pr
  where pr.id = (select registration_id from public.public_registration_payments where id = p_attempt_id)
  for update;
  if v_registration.id is null then raise exception 'registration_not_found' using errcode = 'P0001'; end if;
  select * into v_attempt from public.public_registration_payments
  where id = p_attempt_id and payment_provider = 'toyyibpay' for update;
  if v_attempt.id is null or v_attempt.registration_id <> v_registration.id then raise exception 'payment_attempt_not_found' using errcode = 'P0001'; end if;
  if v_attempt.provider_bill_code is distinct from btrim(p_bill_code) then
    raise exception 'payment_bill_mismatch' using errcode = 'P0001';
  end if;
  if v_attempt.status in ('paid', 'refunded') then
    return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
  end if;
  if v_attempt.status in ('failed', 'cancelled') then
    return jsonb_build_object('outcome', 'duplicate_ignored', 'status', v_attempt.status);
  end if;

  update public.public_registration_payments
  set status = 'failed',
      callback_received_at = p_callback_received_at,
      raw_response = jsonb_build_object('reason', left(coalesce(p_reason, 'provider reported unsuccessful'), 500))
  where id = v_attempt.id;
  update public.public_registrations
  set payment_status = 'failed', registration_status = 'failed'
  where id = v_attempt.registration_id
    and registration_status in ('pending_payment', 'payment_pending');

  return jsonb_build_object('outcome', 'failed');
end;
$$;


ALTER FUNCTION "public"."mark_public_registration_payment_failed_from_callback"("p_attempt_id" "uuid", "p_bill_code" "text", "p_callback_received_at" timestamp with time zone, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_toyyibpay_attempt_failed"("p_attempt_id" "uuid", "p_reason" "text", "p_callback_received_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_attempt record;
  v_invoice_no text;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_attempt from public.invoice_payments where id = p_attempt_id and payment_provider = 'toyyibpay' for update;
  if v_attempt.id is null then
    raise exception 'attempt_not_found' using errcode = 'P0001';
  end if;
  if v_attempt.status <> 'pending' then
    raise exception 'attempt_not_pending' using errcode = 'P0001';
  end if;

  select invoice_no into v_invoice_no from public.invoices where id = v_attempt.invoice_id;

  update public.invoice_payments
  set status = 'failed',
      callback_received_at = p_callback_received_at,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('failure_reason', p_reason),
      updated_at = now()
  where id = p_attempt_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay payment failed for invoice %s: %s', coalesce(v_invoice_no, '?'), coalesce(p_reason, 'no reason given')),
    jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'reason', p_reason));

  return jsonb_build_object('attempt_id', p_attempt_id, 'status', 'failed');
end;
$$;


ALTER FUNCTION "public"."mark_toyyibpay_attempt_failed"("p_attempt_id" "uuid", "p_reason" "text", "p_callback_received_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_toyyibpay_attempt_failed_from_callback"("p_attempt_id" "uuid", "p_billcode" "text", "p_callback_received_at" timestamp with time zone, "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_attempt record;
  v_invoice_no text;
  v_actor uuid;
  v_actor_email text;
begin
  select actor_id, actor_email into v_actor, v_actor_email from app.toyyibpay_system_actor();

  if p_billcode is null or length(trim(p_billcode)) = 0 then
    raise exception 'invalid_billcode' using errcode = 'P0001';
  end if;

  select * into v_attempt from public.invoice_payments where id = p_attempt_id and payment_provider = 'toyyibpay' for update;
  if v_attempt.id is null then
    raise exception 'attempt_not_found' using errcode = 'P0001';
  end if;
  if v_attempt.provider_bill_code is distinct from p_billcode then
    raise exception 'billcode_mismatch' using errcode = 'P0001';
  end if;

  select invoice_no into v_invoice_no from public.invoices where id = v_attempt.invoice_id;

  if v_attempt.status <> 'pending' then
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
      format('ToyyibPay failure callback ignored for invoice %s (%s) -- attempt already "%s"', coalesce(v_invoice_no, '?'), p_billcode, v_attempt.status),
      jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode, 'local_status', v_attempt.status, 'reason', p_reason));
    return jsonb_build_object('outcome', 'duplicate_ignored', 'attempt_id', p_attempt_id);
  end if;

  update public.invoice_payments
  set status = 'failed',
      callback_received_at = p_callback_received_at,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('failure_reason', p_reason),
      updated_at = now()
  where id = p_attempt_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay payment failed (callback) for invoice %s: %s', coalesce(v_invoice_no, '?'), coalesce(p_reason, 'no reason given')),
    jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode, 'reason', p_reason));

  return jsonb_build_object('outcome', 'marked_failed', 'attempt_id', p_attempt_id);
end;
$$;


ALTER FUNCTION "public"."mark_toyyibpay_attempt_failed_from_callback"("p_attempt_id" "uuid", "p_billcode" "text", "p_callback_received_at" timestamp with time zone, "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."mark_toyyibpay_attempt_superseded"("p_attempt_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_attempt record;
  v_invoice_no text;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_attempt from public.invoice_payments where id = p_attempt_id and payment_provider = 'toyyibpay' for update;
  if v_attempt.id is null then
    raise exception 'attempt_not_found' using errcode = 'P0001';
  end if;
  if v_attempt.status <> 'pending' then
    raise exception 'attempt_not_pending' using errcode = 'P0001';
  end if;

  select invoice_no into v_invoice_no from public.invoices where id = v_attempt.invoice_id;

  update public.invoice_payments
  set status = 'superseded',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('superseded_reason', 'manual_payment_recorded'),
      updated_at = now()
  where id = p_attempt_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay bill superseded for invoice %s (manual payment recorded)', coalesce(v_invoice_no, '?')),
    jsonb_build_object('invoice_id', v_attempt.invoice_id, 'attempt_id', p_attempt_id));

  return jsonb_build_object('attempt_id', p_attempt_id, 'status', 'superseded');
end;
$$;


ALTER FUNCTION "public"."mark_toyyibpay_attempt_superseded"("p_attempt_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."module_access_rank"("p_level" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
  select case coalesce(p_level, 'none')
    when 'none' then 0
    when 'view' then 1
    when 'edit' then 2
    when 'admin' then 3
    else 0
  end;
$$;


ALTER FUNCTION "public"."module_access_rank"("p_level" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_marketing_contact_to_sales"("p_contact_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."promote_marketing_contact_to_sales"("p_contact_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_manual_payment"("p_invoice_id" "uuid", "p_payment_provider" "text", "p_payment_method" "text", "p_amount" numeric, "p_payment_date" "date", "p_payment_reference" "text", "p_notes" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_invoice record;
  v_lead_metadata_id uuid;
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_payment_id uuid;
  v_new_amount_paid numeric(12,2);
  v_new_status text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_payment_provider not in ('cash', 'bank_transfer', 'cheque', 'other') then
    raise exception 'invalid_payment_provider' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if v_invoice.status not in ('issued', 'partially_paid') then
    raise exception 'invoice_not_payable' using errcode = 'P0001';
  end if;
  if p_amount > v_invoice.balance_due then
    raise exception 'payment_exceeds_balance' using errcode = 'P0001';
  end if;

  select lead_metadata_id into v_lead_metadata_id from public.sales_opportunities where id = v_invoice.opportunity_id;

  insert into public.invoice_payments (
    invoice_id, payment_provider, payment_method, amount, currency, status,
    payment_reference, notes, paid_at, created_by
  ) values (
    p_invoice_id, p_payment_provider, p_payment_method, p_amount, v_invoice.currency, 'successful',
    p_payment_reference, p_notes, coalesce(p_payment_date, current_date)::timestamptz, v_actor
  ) returning id into v_payment_id;

  select amount_paid, status into v_new_amount_paid, v_new_status from public.invoices where id = p_invoice_id;

  perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action, 'invoice_payments', v_payment_id::text,
    format('Manual payment of RM %s recorded on invoice %s (%s)', p_amount, v_invoice.invoice_no, p_payment_provider),
    jsonb_build_object('invoice_id', p_invoice_id, 'payment_id', v_payment_id, 'amount', p_amount, 'provider', p_payment_provider));

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
  values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'payment_recorded',
    format('%s: payment of RM %s recorded (%s)', v_invoice.invoice_no, p_amount, p_payment_provider), v_actor);

  if v_new_status = 'paid' then
    perform public.log_event_as_service(v_actor, v_actor_email, 'update'::audit_action, 'invoices', p_invoice_id::text,
      format('Invoice %s fully paid', v_invoice.invoice_no), jsonb_build_object('invoice_id', p_invoice_id));
    insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
    values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_paid', format('%s fully paid', v_invoice.invoice_no), v_actor);
  elsif v_new_status = 'partially_paid' then
    insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id)
    values (v_lead_metadata_id, v_invoice.opportunity_id, v_invoice.quotation_id, 'invoice_partially_paid',
      format('%s partially paid (balance RM %s)', v_invoice.invoice_no, v_invoice.grand_total - v_new_amount_paid), v_actor);
  end if;

  return jsonb_build_object('payment_id', v_payment_id, 'amount_paid', v_new_amount_paid, 'status', v_new_status);
end;
$$;


ALTER FUNCTION "public"."record_manual_payment"("p_invoice_id" "uuid", "p_payment_provider" "text", "p_payment_method" "text", "p_amount" numeric, "p_payment_date" "date", "p_payment_reference" "text", "p_notes" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_public_registration_payment_orphan"("p_attempt_id" "uuid", "p_bill_code" "text", "p_payment_url" "text", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'not_authorized' using errcode = '42501'; end if;
  select * into v_attempt from public.public_registration_payments where id = p_attempt_id for update;
  if v_attempt.id is null then return jsonb_build_object('outcome', 'unknown_attempt'); end if;
  if v_attempt.status in ('paid', 'refunded') then
    return jsonb_build_object('outcome', 'terminal_ignored', 'status', v_attempt.status);
  end if;
  update public.public_registration_payments
  set status = case when status in ('paid', 'refunded') then status else 'failed' end,
      bill_creation_state = 'orphaned',
      provider_bill_code = coalesce(provider_bill_code, nullif(btrim(p_bill_code), '')),
      payment_url = coalesce(payment_url, nullif(btrim(p_payment_url), '')),
      provider_reference = 'orphaned_provider_bill',
      raw_response = jsonb_build_object('reason', left(coalesce(p_reason, 'provider bill attachment failed'), 500), 'bill_code', btrim(p_bill_code), 'payment_url', btrim(p_payment_url))
  where id = v_attempt.id;
  return jsonb_build_object('outcome', 'recorded');
end;
$$;


ALTER FUNCTION "public"."record_public_registration_payment_orphan"("p_attempt_id" "uuid", "p_bill_code" "text", "p_payment_url" "text", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_toyyibpay_bill"("p_invoice_id" "uuid", "p_attempt_id" "uuid", "p_billcode" "text", "p_payment_url" "text", "p_amount" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'app'
    AS $$
declare
  v_invoice record;
  v_actor uuid := auth.uid();
  v_actor_email text;
begin
  if not app.is_admin() then
    raise exception 'not_authorized' using errcode = 'P0001';
  end if;
  if p_billcode is null or length(trim(p_billcode)) = 0 then
    raise exception 'invalid_billcode' using errcode = 'P0001';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = 'P0001';
  end if;

  select email into v_actor_email from public.profiles where id = v_actor;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if v_invoice.id is null then
    raise exception 'invoice_not_found' using errcode = 'P0001';
  end if;
  if v_invoice.status not in ('issued', 'partially_paid') then
    raise exception 'invoice_not_payable' using errcode = 'P0001';
  end if;
  if round(p_amount, 2) <> round(v_invoice.balance_due, 2) then
    raise exception 'balance_mismatch' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.invoice_payments
    where invoice_id = p_invoice_id and payment_provider = 'toyyibpay' and status = 'pending'
  ) then
    raise exception 'active_attempt_exists' using errcode = 'P0001';
  end if;

  insert into public.invoice_payments (
    id, invoice_id, payment_provider, amount, currency, status,
    provider_bill_code, payment_url, paid_at, created_by
  ) values (
    p_attempt_id, p_invoice_id, 'toyyibpay', p_amount, v_invoice.currency, 'pending',
    p_billcode, p_payment_url, null, v_actor
  );

  perform public.log_event_as_service(v_actor, v_actor_email, 'create'::audit_action, 'invoice_payments', p_attempt_id::text,
    format('ToyyibPay bill created for invoice %s (%s)', v_invoice.invoice_no, p_billcode),
    jsonb_build_object('invoice_id', p_invoice_id, 'attempt_id', p_attempt_id, 'billcode', p_billcode, 'amount', p_amount));

  return jsonb_build_object('attempt_id', p_attempt_id, 'status', 'pending');
end;
$$;


ALTER FUNCTION "public"."record_toyyibpay_bill"("p_invoice_id" "uuid", "p_attempt_id" "uuid", "p_billcode" "text", "p_payment_url" "text", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recover_public_registration_payment_claim"("p_attempt_id" "uuid", "p_reason" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
declare
  v_attempt public.public_registration_payments%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Claims are never automatically reclaimed. This trusted recovery path
  -- explicitly closes a stale claim before a fresh payment attempt may be
  -- created for the registration.
  select pr.* into v_attempt
  from public.public_registration_payments pr
  where pr.id = p_attempt_id;
  if v_attempt.id is null then
    return jsonb_build_object('outcome', 'unknown_attempt');
  end if;
  perform 1 from public.public_registrations r where r.id = v_attempt.registration_id for update;
  select * into v_attempt from public.public_registration_payments where id = p_attempt_id for update;
  if v_attempt.bill_creation_state <> 'claimed' or v_attempt.status in ('paid', 'refunded', 'cancelled') then
    return jsonb_build_object('outcome', 'not_recoverable', 'status', v_attempt.status, 'bill_creation_state', v_attempt.bill_creation_state);
  end if;
  update public.public_registration_payments
  set status = 'failed',
      bill_creation_state = 'orphaned',
      raw_response = jsonb_build_object('claim_recovery', left(coalesce(p_reason, 'manual claim recovery'), 500))
  where id = p_attempt_id;
  return jsonb_build_object('outcome', 'recovered');
end;
$$;


ALTER FUNCTION "public"."recover_public_registration_payment_claim"("p_attempt_id" "uuid", "p_reason" "text") OWNER TO "postgres";


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


COMMENT ON FUNCTION "public"."resolve_schedule_feedback_participant"("p_public_token" "text", "p_identity_number" "text", "p_request_fingerprint_hash" "text") IS 'Service-role-only class-feedback resolver. Returns only a matched individual feedback token and submitted state.';



CREATE OR REPLACE FUNCTION "public"."reverse_won_opportunity"("p_opportunity_id" "uuid", "p_reason" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'app'
    AS $$
declare
  v_lead_metadata_id uuid;
  v_stage text;
  v_quotation_id uuid;
  v_invoice_status text;
  v_now timestamptz := now();
begin
  if not app.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'P0001';
  end if;

  select lead_metadata_id, stage into v_lead_metadata_id, v_stage
  from public.sales_opportunities
  where id = p_opportunity_id
  for update;
  if v_lead_metadata_id is null then
    raise exception 'opportunity_not_found' using errcode = 'P0001';
  end if;
  if v_stage is distinct from 'won' then
    raise exception 'invalid_transition: only a won opportunity can be reversed (current stage: %)', v_stage using errcode = 'P0001';
  end if;

  -- Resolve and lock the canonical accepted quotation before checking any
  -- downstream rows. The unique index makes this a single-row invariant;
  -- the lock also keeps the relationship stable for the rest of the RPC.
  select id into v_quotation_id
  from public.sales_quotations
  where opportunity_id = p_opportunity_id and status = 'accepted'
  order by accepted_at desc nulls last, revision_no desc, id desc
  limit 1
  for update;
  if v_quotation_id is null then
    raise exception 'accepted_quotation_not_found' using errcode = 'P0001';
  end if;

  -- This scope does not cancel accounting or operational records. Once a
  -- downstream dependency exists, the commercial reversal must be handled by
  -- a later governed workflow instead of silently orphaning it.
  if exists (
    select 1
    from public.invoice_payments ip
    join public.invoices i on i.id = ip.invoice_id
    where i.opportunity_id = p_opportunity_id
      and ip.status in ('pending', 'successful')
  ) then
    raise exception 'payment_dependency_exists' using errcode = 'P0001',
      detail = 'A payment record exists for this opportunity; reversal requires a governed financial workflow.';
  end if;

  select status into v_invoice_status
  from public.invoices
  where opportunity_id = p_opportunity_id
    and status <> 'cancelled'
  order by created_at asc
  limit 1;
  if v_invoice_status is not null then
    raise exception 'invoice_dependency_exists' using errcode = 'P0001',
      detail = 'Cancel or reconcile the invoice through a governed financial workflow before reversing the opportunity.';
  end if;

  if exists (
    select 1
    from public.course_schedules cs
    where (cs.source_opportunity_id = p_opportunity_id
      or cs.source_quotation_id = v_quotation_id)
      and cs.deleted_at is null
      and cs.status <> 'cancelled'
  ) then
    raise exception 'training_handoff_dependency_exists' using errcode = 'P0001',
      detail = 'A training handoff exists for this opportunity; reverse the operational workflow first.';
  end if;

  if exists (
    select 1
    from public.schedule_participants sp
    join public.course_schedules cs on cs.id = sp.schedule_id
    where (cs.source_opportunity_id = p_opportunity_id
      or cs.source_quotation_id = v_quotation_id)
      and cs.deleted_at is null
      and sp.deleted_at is null
      and sp.registration_status <> 'cancelled'
  ) then
    raise exception 'registration_dependency_exists' using errcode = 'P0001',
      detail = 'An active training registration exists for this opportunity; reversal requires an operational workflow.';
  end if;

  perform set_config('app.sales_revenue_transition', 'reverse', true);
  update public.sales_quotations
  set status = 'cancelled', cancelled_at = v_now, cancellation_reason = trim(p_reason), updated_at = v_now
  where id = v_quotation_id;
  update public.sales_opportunities
  set stage = 'cancelled', cancelled_at = v_now, cancellation_reason = trim(p_reason), updated_at = v_now
  where id = p_opportunity_id;

  insert into public.sales_activity (lead_metadata_id, opportunity_id, quotation_id, type, note, actor_id) values
    (v_lead_metadata_id, p_opportunity_id, v_quotation_id, 'quotation_cancelled', 'Accepted quotation cancelled: ' || trim(p_reason), auth.uid()),
    (v_lead_metadata_id, p_opportunity_id, null, 'opportunity_reversed', 'Won opportunity reversed: ' || trim(p_reason), auth.uid());
end;
$$;


ALTER FUNCTION "public"."reverse_won_opportunity"("p_opportunity_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."schedule_group_assessor_conflicts"("p_assessor_id" "uuid", "p_schedule_id" "uuid", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_exclude_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("group_id" "uuid", "group_name" "text", "schedule_code" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select g.id, g.name, cs.schedule_code
  from public.schedule_groups g
  join public.course_schedules cs on cs.id = g.schedule_id
  join public.course_schedules target on target.id = p_schedule_id
  left join public.schedule_assessors sa on sa.schedule_id = g.schedule_id and sa.is_primary
  where p_assessor_id is not null
    and p_start_time is not null and p_end_time is not null
    and coalesce(g.assessor_id, sa.assessor_id) = p_assessor_id
    and g.deleted_at is null
    and cs.deleted_at is null
    and cs.id <> target.id
    and (p_exclude_group_id is null or g.id <> p_exclude_group_id)
    and cs.start_date <= target.end_date and cs.end_date >= target.start_date
    and coalesce(g.start_time, cs.start_time) is not null
    and coalesce(g.end_time, cs.end_time) is not null
    and coalesce(g.start_time, cs.start_time) < p_end_time
    and coalesce(g.end_time, cs.end_time) > p_start_time

  union all

  select null::uuid, 'Primary assessor'::text, cs.schedule_code
  from public.schedule_assessors sa
  join public.course_schedules cs on cs.id = sa.schedule_id
  join public.course_schedules target on target.id = p_schedule_id
  where sa.is_primary
    and sa.assessor_id = p_assessor_id
    and p_assessor_id is not null
    and p_start_time is not null and p_end_time is not null
    and cs.deleted_at is null
    and cs.id <> target.id
    and cs.start_date <= target.end_date and cs.end_date >= target.start_date
    and cs.start_time is not null and cs.end_time is not null
    and cs.start_time < p_end_time and cs.end_time > p_start_time
    and not exists (
      select 1 from public.schedule_groups g2 where g2.schedule_id = sa.schedule_id and g2.deleted_at is null
    );
$$;


ALTER FUNCTION "public"."schedule_group_assessor_conflicts"("p_assessor_id" "uuid", "p_schedule_id" "uuid", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_exclude_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."schedule_group_trainer_conflicts"("p_trainer_id" "uuid", "p_schedule_id" "uuid", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_exclude_group_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("group_id" "uuid", "group_name" "text", "schedule_code" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  select g.id, g.name, cs.schedule_code
  from public.schedule_groups g
  join public.course_schedules cs on cs.id = g.schedule_id
  join public.course_schedules target on target.id = p_schedule_id
  where p_trainer_id is not null
    and p_start_time is not null and p_end_time is not null
    and g.trainer_id = p_trainer_id
    and g.deleted_at is null
    and cs.deleted_at is null
    and (p_exclude_group_id is null or g.id <> p_exclude_group_id)
    and cs.start_date <= target.end_date and cs.end_date >= target.start_date
    and coalesce(g.start_time, cs.start_time) is not null
    and coalesce(g.end_time, cs.end_time) is not null
    and coalesce(g.start_time, cs.start_time) < p_end_time
    and coalesce(g.end_time, cs.end_time) > p_start_time;
$$;


ALTER FUNCTION "public"."schedule_group_trainer_conflicts"("p_trainer_id" "uuid", "p_schedule_id" "uuid", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_exclude_group_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_must_change_password"("p_user_id" "uuid", "p_value" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not app.is_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.can_manage_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'invalid_user' using errcode = 'P0001';
  end if;

  update public.profiles
  set must_change_password = coalesce(p_value, true),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_user_id;
end;
$$;


ALTER FUNCTION "public"."set_must_change_password"("p_user_id" "uuid", "p_value" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_schedule_assessor"("p_schedule_id" "uuid", "p_assessor_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_prev       uuid;
  v_prev_name  text;
  v_target     public.assessors%rowtype;
  v_action     public.audit_action;
  v_email      text;
  v_summary    text;
  v_meta       jsonb;
begin
  if not app.can_manage_schedule_assessors() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_schedule_id is null then
    raise exception 'invalid_schedule' using errcode = 'P0001';
  end if;

  perform 1 from public.course_schedules
  where id = p_schedule_id and deleted_at is null;
  if not found then
    raise exception 'schedule_not_found' using errcode = 'P0001';
  end if;

  select sa.assessor_id, a.full_name into v_prev, v_prev_name
  from public.schedule_assessors sa
  left join public.assessors a on a.id = sa.assessor_id
  where sa.schedule_id = p_schedule_id and sa.is_primary
  limit 1;

  -- REMOVE
  if p_assessor_id is null then
    if v_prev is null then
      return jsonb_build_object('status', 'removed', 'schedule_id', p_schedule_id,
        'assessor_id', null, 'previous_assessor_id', null, 'full_name', null);
    end if;
    delete from public.schedule_assessors where schedule_id = p_schedule_id;
    v_action := 'assessor_unassigned';
    v_summary := 'Assessor ' || coalesce(v_prev_name, '') || ' unassigned from schedule';
    v_meta := jsonb_build_object('schedule_id', p_schedule_id, 'assessor_id', v_prev);
    insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    values (auth.uid(), (select email from public.profiles where id = auth.uid()),
            v_action, 'schedule_assessors', p_schedule_id::text, v_summary, v_meta);
    return jsonb_build_object('status', 'removed', 'schedule_id', p_schedule_id,
      'assessor_id', null, 'previous_assessor_id', v_prev, 'previous_full_name', v_prev_name, 'full_name', null);
  end if;

  -- UNCHANGED
  if v_prev = p_assessor_id then
    return jsonb_build_object('status', 'unchanged', 'schedule_id', p_schedule_id,
      'assessor_id', p_assessor_id, 'previous_assessor_id', v_prev, 'previous_full_name', v_prev_name, 'full_name', v_prev_name);
  end if;

  -- target must exist and be active
  select * into v_target from public.assessors where id = p_assessor_id and is_active;
  if not found then
    raise exception 'assessor_not_found_or_inactive' using errcode = 'P0001';
  end if;

  -- ASSIGN / REPLACE (one transaction; the delete below is rolled back if the
  -- insert violates a constraint, so the old assignment is preserved).
  delete from public.schedule_assessors where schedule_id = p_schedule_id;
  insert into public.schedule_assessors (schedule_id, assessor_id, is_primary, assigned_by)
  values (p_schedule_id, p_assessor_id, true, auth.uid());

  v_action := case when v_prev is null then 'assessor_assigned' else 'assessor_reassigned' end;
  v_summary := 'Assessor ' || v_target.full_name || ' ' ||
    case when v_prev is null then 'assigned to' else 'reassigned on' end || ' schedule';
  v_meta := jsonb_build_object('schedule_id', p_schedule_id, 'assessor_id', p_assessor_id,
    'previous_assessor_id', v_prev);
  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
  values (auth.uid(), (select email from public.profiles where id = auth.uid()),
          v_action, 'schedule_assessors', p_schedule_id::text, v_summary, v_meta);

  return jsonb_build_object('status', v_action, 'schedule_id', p_schedule_id,
    'assessor_id', p_assessor_id, 'previous_assessor_id', v_prev,
    'previous_full_name', v_prev_name, 'full_name', v_target.full_name);
end;
$$;


ALTER FUNCTION "public"."set_schedule_assessor"("p_schedule_id" "uuid", "p_assessor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_staff_module_access"("p_user_id" "uuid", "p_modules" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_role public.user_role;
  v_target_role public.user_role;
  v_module record;
  v_level text;
begin
  if not app.is_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.can_manage_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_actor_role := app.current_role();

  if p_user_id is null then
    raise exception 'invalid_user' using errcode = 'P0001';
  end if;

  select role into v_target_role from public.profiles where id = p_user_id;
  if v_target_role is null then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;

  if v_actor_role <> 'super_admin' then
    if v_target_role in ('admin', 'super_admin') then
      raise exception 'forbidden_admin_target' using errcode = '42501';
    end if;
    if p_user_id = auth.uid() then
      raise exception 'cannot_modify_self' using errcode = '42501';
    end if;
  end if;

  if jsonb_typeof(p_modules) <> 'array' then
    raise exception 'invalid_modules' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_modules) = 0 then
    raise exception 'empty_modules' using errcode = 'P0001';
  end if;

  delete from public.staff_module_access where user_id = p_user_id;

  for v_module in
    select * from jsonb_to_recordset(p_modules) as x(module_key text, access_level text)
  loop
    v_level := lower(trim(coalesce(v_module.access_level, 'view')));
    if v_level not in ('view', 'edit', 'admin') then
      raise exception 'invalid_access_level' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.staff_module_catalog c
      where c.module_key = v_module.module_key and c.is_active
    ) then
      raise exception 'invalid_module_key' using errcode = 'P0001';
    end if;
    insert into public.staff_module_access (user_id, module_key, access_level, created_by, updated_by)
    values (p_user_id, v_module.module_key, v_level, auth.uid(), auth.uid());
  end loop;
end;
$$;


ALTER FUNCTION "public"."set_staff_module_access"("p_user_id" "uuid", "p_modules" "jsonb") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."update_staff_profile"("p_user_id" "uuid", "p_full_name" "text" DEFAULT NULL::"text", "p_department" "public"."staff_department" DEFAULT NULL::"public"."staff_department", "p_role" "public"."user_role" DEFAULT NULL::"public"."user_role", "p_is_active" boolean DEFAULT NULL::boolean, "p_access_control_enabled" boolean DEFAULT NULL::boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_actor_role public.user_role;
  v_target_role public.user_role;
begin
  if not app.is_active() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not app.can_manage_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_actor_role := app.current_role();

  if p_user_id is null then
    raise exception 'invalid_user' using errcode = 'P0001';
  end if;

  select role into v_target_role from public.profiles where id = p_user_id;
  if v_target_role is null then
    raise exception 'user_not_found' using errcode = 'P0001';
  end if;

  if v_actor_role <> 'super_admin' then
    if p_user_id = auth.uid() then
      raise exception 'cannot_modify_self' using errcode = '42501';
    end if;
    if v_target_role in ('admin', 'super_admin') then
      raise exception 'forbidden_admin_target' using errcode = '42501';
    end if;
    if p_role in ('admin', 'super_admin') then
      raise exception 'forbidden_promotion' using errcode = '42501';
    end if;
  end if;

  update public.profiles
  set full_name = coalesce(nullif(trim(coalesce(p_full_name, '')), ''), full_name),
      department = coalesce(p_department, department),
      role = coalesce(p_role, role),
      is_active = coalesce(p_is_active, is_active),
      access_control_enabled = coalesce(p_access_control_enabled, access_control_enabled),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_user_id;
end;
$$;


ALTER FUNCTION "public"."update_staff_profile"("p_user_id" "uuid", "p_full_name" "text", "p_department" "public"."staff_department", "p_role" "public"."user_role", "p_is_active" boolean, "p_access_control_enabled" boolean) OWNER TO "postgres";


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


COMMENT ON FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text") IS 'Public certificate verification + logging (Module 5 fix). Returns only publicly-safe fields.';



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


CREATE OR REPLACE FUNCTION "public"."verify_public_registration_manual_payment"("p_registration_reference" "text", "p_registration_secret" "text", "p_amount" numeric, "p_payment_reference" "text", "p_notes" "text" DEFAULT NULL::"text", "p_verifier_id" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'app', 'extensions'
    AS $$
declare
  v_registration public.public_registrations%rowtype;
  v_payment public.public_registration_payments%rowtype;
  v_token_hash text;
  v_verifier_id uuid;
  v_verifier_email text;
begin
  if auth.role() <> 'service_role' and not app.is_admin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  v_verifier_id := coalesce(p_verifier_id, auth.uid());
  if auth.role() = 'authenticated' and p_verifier_id is not null and p_verifier_id <> auth.uid() then
    raise exception 'invalid_manual_verifier' using errcode = '42501';
  end if;
  if v_verifier_id is null or not exists (
    select 1 from public.profiles
    where id = v_verifier_id and is_active = true and role in ('admin', 'super_admin')
  ) then
    raise exception 'invalid_manual_verifier' using errcode = '42501';
  end if;
  select email into v_verifier_email from public.profiles where id = v_verifier_id;
  if p_amount is null or p_amount <= 0 or nullif(btrim(p_payment_reference), '') is null then
    raise exception 'invalid_manual_payment' using errcode = 'P0001';
  end if;

  v_token_hash := encode(digest(lower(btrim(p_registration_secret)), 'sha256'), 'hex');
  select * into v_registration
  from public.public_registrations
  where registration_reference = btrim(p_registration_reference)
    and confirmation_token_hash = v_token_hash
  for update;
  if v_registration.id is null then
    raise exception 'registration_not_found' using errcode = 'P0001';
  end if;
  if round(p_amount, 2) <> round(v_registration.amount_snapshot, 2) then
    raise exception 'manual_payment_amount_mismatch' using errcode = 'P0001';
  end if;
  if v_registration.registration_status in ('cancelled', 'expired') then
    raise exception 'registration_not_verifiable' using errcode = 'P0001';
  end if;

  select * into v_payment
  from public.public_registration_payments
  where registration_id = v_registration.id
    and payment_provider = 'bank_transfer'
    and status in ('pending', 'processing', 'paid')
  order by created_at desc
  limit 1
  for update;

  if v_payment.id is null then
    insert into public.public_registration_payments (
      registration_id, payment_provider, status, amount, currency,
      provider_reference
    ) values (
      v_registration.id, 'bank_transfer', 'pending', v_registration.amount_snapshot, v_registration.currency,
      btrim(p_payment_reference)
    ) returning * into v_payment;
  elsif v_payment.status = 'paid' then
    return jsonb_build_object('outcome', 'already_paid', 'registration_reference', v_registration.registration_reference);
  end if;

  -- Move through the bounded payment state machine even for staff-verified
  -- transfers; never create a payment attempt directly in `paid` state.
  update public.public_registration_payments
  set status = 'processing', provider_reference = btrim(p_payment_reference)
  where id = v_payment.id and status = 'pending';
  update public.public_registration_payments
  set status = 'paid', provider_reference = btrim(p_payment_reference),
      verified_amount = v_registration.amount_snapshot, verified_at = now(),
      raw_response = jsonb_build_object('notes', left(coalesce(p_notes, ''), 500), 'verified_by', v_verifier_id, 'verified_by_email', v_verifier_email)
  where id = v_payment.id and status = 'processing';

  update public.public_registrations
  set payment_status = case when payment_status = 'pending' then 'processing' else payment_status end
  where id = v_registration.id;
  update public.public_registrations set payment_status = 'paid' where id = v_registration.id;
  return public.finalize_public_registration_crm(v_registration.id);
end;
$$;


ALTER FUNCTION "public"."verify_public_registration_manual_payment"("p_registration_reference" "text", "p_registration_secret" "text", "p_amount" numeric, "p_payment_reference" "text", "p_notes" "text", "p_verifier_id" "uuid") OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "app"."marketing_campaign_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "app"."marketing_campaign_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "app"."marketing_contact_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "app"."marketing_contact_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "app"."sales_invoice_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "app"."sales_invoice_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "app"."sales_opportunity_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "app"."sales_opportunity_seq" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "app"."sales_quotation_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "app"."sales_quotation_seq" OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_users" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."admin_users" OWNER TO "postgres";


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
    "theory_result" "text" DEFAULT 'pending'::"text" NOT NULL,
    "practical_result" "text" DEFAULT 'pending'::"text" NOT NULL,
    "legacy_batch_id" "uuid",
    CONSTRAINT "assessments_competency_status_check" CHECK ((("competency_status" IS NULL) OR ("competency_status" = ANY (ARRAY['pending_review'::"text", 'competent'::"text", 'not_yet_competent'::"text"])))),
    CONSTRAINT "assessments_practical_result_check" CHECK (("practical_result" = ANY (ARRAY['pending'::"text", 'pass'::"text", 'fail'::"text"]))),
    CONSTRAINT "assessments_result_check" CHECK (("result" = ANY (ARRAY['pending'::"text", 'pass'::"text", 'fail'::"text"]))),
    CONSTRAINT "assessments_theory_result_check" CHECK (("theory_result" = ANY (ARRAY['pending'::"text", 'pass'::"text", 'fail'::"text"])))
);


ALTER TABLE "public"."assessments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assessors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "full_name" "text" NOT NULL,
    "ic_passport_no" "text",
    "phone" "text",
    "email" "text",
    "organization" "text",
    "qualification" "text",
    "notes" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid"
);


ALTER TABLE "public"."assessors" OWNER TO "postgres";


COMMENT ON TABLE "public"."assessors" IS 'Assessor master data. Deactivate (is_active=false) instead of deleting; a deactivated assessor with historical schedule assignments stays readable.';



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
    "legacy_batch_id" "uuid",
    CONSTRAINT "attendance_status_check" CHECK (("attendance_status" = ANY (ARRAY['present'::"text", 'absent'::"text", 'late'::"text", 'excused'::"text"])))
);


ALTER TABLE "public"."attendance" OWNER TO "postgres";


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


ALTER TABLE "public"."audit_logs" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."audit_logs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



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


CREATE SEQUENCE IF NOT EXISTS "public"."certificate_number_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."certificate_number_seq" OWNER TO "postgres";


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


COMMENT ON TABLE "public"."certificate_skill_results" IS 'Immutable snapshot of a participant''s skill/attendance results, taken once at certificate issuance (Phase 2C). Never updated or deleted by normal staff action -- see app.issue_certificate_with_skill_snapshot / app.duplicate_certificate_with_skill_snapshot.';



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


ALTER TABLE "public"."certificate_verifications" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."certificate_verifications_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



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
    "legacy_batch_id" "uuid",
    CONSTRAINT "certificates_status_check" CHECK (("status" = ANY (ARRAY['valid'::"text", 'expired'::"text", 'revoked'::"text", 'draft'::"text", 'issued'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."certificates" OWNER TO "postgres";


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


CREATE SEQUENCE IF NOT EXISTS "public"."company_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."company_id_seq" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."course_commercial_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "standard_display_name" "text" NOT NULL,
    "hrdf_display_name" "text",
    "hrdf_claimable" boolean DEFAULT false NOT NULL,
    "quotation_description" "text" NOT NULL,
    "package_includes" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "accommodation_included_default" boolean DEFAULT false NOT NULL,
    "accommodation_description_default" "text",
    "meals_included_default" boolean DEFAULT false NOT NULL,
    "meals_description_default" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "course_commercial_profiles_accommodation_description_check" CHECK (("accommodation_included_default" OR ("accommodation_description_default" IS NULL))),
    CONSTRAINT "course_commercial_profiles_meals_description_check" CHECK (("meals_included_default" OR ("meals_description_default" IS NULL))),
    CONSTRAINT "course_commercial_profiles_package_includes_array_check" CHECK (("jsonb_typeof"("package_includes") = 'array'::"text"))
);


ALTER TABLE "public"."course_commercial_profiles" OWNER TO "postgres";


COMMENT ON TABLE "public"."course_commercial_profiles" IS 'Quotation-facing defaults kept separate from public course CMS content.';



COMMENT ON COLUMN "public"."course_commercial_profiles"."package_includes" IS 'JSON array of non-accommodation/non-meal inclusion objects; optional accommodation and meals use their explicit fields.';



CREATE TABLE IF NOT EXISTS "public"."course_schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "course_id" "uuid" NOT NULL,
    "trainer_name" "text",
    "venue" "text",
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "capacity" integer DEFAULT 0,
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
    "legacy_batch_id" "uuid",
    "fee" numeric(12,2),
    CONSTRAINT "course_schedules_capacity_check" CHECK (("capacity" >= 0)),
    CONSTRAINT "course_schedules_capacity_required_unless_legacy" CHECK ((("capacity" IS NOT NULL) OR ("legacy_batch_id" IS NOT NULL))),
    CONSTRAINT "course_schedules_check" CHECK ((("seats_taken" >= 0) AND ("seats_taken" <= "capacity"))),
    CONSTRAINT "course_schedules_check1" CHECK (("end_date" >= "start_date")),
    CONSTRAINT "course_schedules_fee_check" CHECK ((("fee" IS NULL) OR ("fee" >= (0)::numeric)))
);


ALTER TABLE "public"."course_schedules" OWNER TO "postgres";


COMMENT ON COLUMN "public"."course_schedules"."source_opportunity_id" IS 'Traceability only, set exclusively by the Sales -> Training Operations handoff. Null for schedules created the normal way.';



COMMENT ON COLUMN "public"."course_schedules"."source_quotation_id" IS 'The accepted quotation the handoff was created from, if any. Traceability only.';



COMMENT ON COLUMN "public"."course_schedules"."exam_date" IS 'Optional exam date entered by an admin. Not fixed or derived from the training planner.';



COMMENT ON COLUMN "public"."course_schedules"."fee" IS 'Per-session MYR price snapshot for public registration. NULL disables paid public registration for the session.';



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


COMMENT ON COLUMN "public"."courses"."certificate_type" IS 'participation | completion | competency -- drives v_certificate_eligibility, never inferred from category/template names.';



COMMENT ON COLUMN "public"."courses"."attendance_min_percent" IS 'Minimum attendance percentage required for certificate eligibility (0-100, default 100).';



COMMENT ON COLUMN "public"."courses"."assessment_required" IS 'Whether v_certificate_eligibility requires a passing assessments row before a certificate can be issued.';



COMMENT ON COLUMN "public"."courses"."competency_required" IS 'Whether assessments.competency_status must equal competent in addition to result=pass. Implies assessment_required.';



COMMENT ON COLUMN "public"."courses"."certificate_generation_enabled" IS 'Explicit opt-in: certificate generation for schedules of this course is only permitted once staff have deliberately enabled it (and bound a template). Never inferred from other config defaults.';



COMMENT ON COLUMN "public"."courses"."certificate_template_id" IS 'Which certificate_templates row generateCertificate must bind new certificates to for this course. NULL blocks generation even if certificate_generation_enabled=true (see v_certificate_eligibility).';



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


CREATE TABLE IF NOT EXISTS "public"."faq_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."faq_categories" OWNER TO "postgres";


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


COMMENT ON TABLE "public"."feedback_schedule_links" IS 'One opaque public class-feedback entry token per schedule. It never replaces individual participant feedback tokens.';



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


COMMENT ON TABLE "public"."feedback_schedule_lookup_attempts" IS 'Short-lived schedule-feedback lookup throttle. Stores only a server HMAC request fingerprint, never identity data.';



CREATE TABLE IF NOT EXISTS "public"."gallery_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."gallery_categories" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."invoice_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "quantity" numeric(10,2) NOT NULL,
    "unit" "text" DEFAULT 'pax'::"text" NOT NULL,
    "unit_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount" numeric(12,2) DEFAULT 0 NOT NULL,
    "line_total" numeric(12,2) GENERATED ALWAYS AS ("round"((("quantity" * "unit_price") - "discount"), 2)) STORED,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "source_quotation_item_id" "uuid",
    CONSTRAINT "invoice_items_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 500))),
    CONSTRAINT "invoice_items_discount_check" CHECK (("discount" >= (0)::numeric)),
    CONSTRAINT "invoice_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "invoice_items_unit_check" CHECK (("unit" = ANY (ARRAY['pax'::"text", 'session'::"text", 'day'::"text", 'lot'::"text", 'unit'::"text"]))),
    CONSTRAINT "invoice_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."invoice_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoice_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "payment_provider" "text" NOT NULL,
    "payment_method" "text",
    "amount" numeric(12,2) NOT NULL,
    "currency" "text" DEFAULT 'MYR'::"text" NOT NULL,
    "status" "text" DEFAULT 'successful'::"text" NOT NULL,
    "provider_bill_code" "text",
    "provider_transaction_id" "text",
    "provider_reference" "text",
    "payment_reference" "text",
    "notes" "text",
    "paid_at" timestamp with time zone,
    "verified_at" timestamp with time zone,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "payment_url" "text",
    "verified_amount" numeric(12,2),
    "callback_received_at" timestamp with time zone,
    CONSTRAINT "invoice_payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "invoice_payments_provider_check" CHECK (("payment_provider" = ANY (ARRAY['cash'::"text", 'bank_transfer'::"text", 'cheque'::"text", 'toyyibpay'::"text", 'other'::"text"]))),
    CONSTRAINT "invoice_payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'successful'::"text", 'failed'::"text", 'cancelled'::"text", 'refunded'::"text", 'superseded'::"text"])))
);


ALTER TABLE "public"."invoice_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invoices" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "invoice_no" "text" DEFAULT "app"."next_invoice_number"() NOT NULL,
    "quotation_id" "uuid" NOT NULL,
    "opportunity_id" "uuid" NOT NULL,
    "company_id" "uuid",
    "billing_name" "text" NOT NULL,
    "billing_company" "text",
    "billing_registration_no" "text",
    "billing_address" "text",
    "billing_email" "text",
    "billing_phone" "text",
    "invoice_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "due_date" "date" DEFAULT (CURRENT_DATE + 30) NOT NULL,
    "currency" "text" DEFAULT 'MYR'::"text" NOT NULL,
    "subtotal" numeric(12,2) DEFAULT 0 NOT NULL,
    "discount_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "taxable_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "tax_rate" numeric(5,2) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "grand_total" numeric(12,2) DEFAULT 0 NOT NULL,
    "amount_paid" numeric(12,2) DEFAULT 0 NOT NULL,
    "balance_due" numeric(12,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "notes" "text",
    "payment_terms" "text",
    "issued_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    CONSTRAINT "invoices_amount_paid_check" CHECK (("amount_paid" >= (0)::numeric)),
    CONSTRAINT "invoices_balance_due_check" CHECK (("balance_due" >= (0)::numeric)),
    CONSTRAINT "invoices_grand_total_check" CHECK (("grand_total" >= (0)::numeric)),
    CONSTRAINT "invoices_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'issued'::"text", 'partially_paid'::"text", 'paid'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."invoices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legacy_course_map" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_label" "text" NOT NULL,
    "raw_course_name" "text" NOT NULL,
    "normalized_course_name" "text" NOT NULL,
    "course_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "legacy_course_map_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'mapped'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."legacy_course_map" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legacy_import_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_label" "text" NOT NULL,
    "original_filename" "text" NOT NULL,
    "source_file_hash" "text",
    "status" "text" DEFAULT 'uploaded'::"text" NOT NULL,
    "total_row_count" integer DEFAULT 0 NOT NULL,
    "valid_count" integer DEFAULT 0 NOT NULL,
    "invalid_count" integer DEFAULT 0 NOT NULL,
    "approved_count" integer DEFAULT 0 NOT NULL,
    "merged_count" integer DEFAULT 0 NOT NULL,
    "notes" "text",
    "error_summary" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dry_run_at" timestamp with time zone,
    "dry_run_hash" "text",
    CONSTRAINT "legacy_import_batches_status_check" CHECK (("status" = ANY (ARRAY['uploaded'::"text", 'normalized'::"text", 'review'::"text", 'approved'::"text", 'merged'::"text", 'failed'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."legacy_import_batches" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legacy_participant_staging" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "source_row_number" integer NOT NULL,
    "raw_data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "raw_name" "text",
    "raw_ic_passport" "text",
    "normalized_ic_passport" "text",
    "raw_email" "text",
    "normalized_email" "text",
    "raw_phone" "text",
    "normalized_phone" "text",
    "raw_company" "text",
    "raw_course_name" "text",
    "normalized_course_name" "text",
    "training_start_date" "date",
    "training_end_date" "date",
    "raw_certificate_number" "text",
    "raw_status" "text",
    "matched_participant_id" "uuid",
    "mapped_course_id" "uuid",
    "match_status" "text",
    "review_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "validation_error" "text",
    "duplicate_conflict_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "result_participant_id" "uuid",
    "result_schedule_id" "uuid",
    "result_enrollment_id" "uuid",
    "result_certificate_id" "uuid",
    "merge_error" "text",
    "merged_at" timestamp with time zone,
    CONSTRAINT "legacy_participant_staging_match_status_check" CHECK (("match_status" = ANY (ARRAY['exact_match'::"text", 'probable_duplicate'::"text", 'new_participant'::"text", 'conflict'::"text"]))),
    CONSTRAINT "legacy_participant_staging_review_status_check" CHECK (("review_status" = ANY (ARRAY['pending'::"text", 'reviewed'::"text", 'approved'::"text", 'rejected'::"text", 'merged'::"text"])))
);


ALTER TABLE "public"."legacy_participant_staging" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."marketing_campaigns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "campaign_number" "text" DEFAULT "app"."next_campaign_number"() NOT NULL,
    "name" "text" NOT NULL,
    "channel" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "start_date" "date",
    "end_date" "date",
    "budget" numeric(12,2),
    "actual_spend" numeric(12,2),
    "owner_id" "uuid",
    "course_id" "uuid",
    "utm_campaign" "text",
    "notes" "text",
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "objective" "text",
    CONSTRAINT "marketing_campaigns_actual_spend_check" CHECK ((("actual_spend" IS NULL) OR ("actual_spend" >= (0)::numeric))),
    CONSTRAINT "marketing_campaigns_budget_check" CHECK ((("budget" IS NULL) OR ("budget" >= (0)::numeric))),
    CONSTRAINT "marketing_campaigns_channel_check" CHECK (("channel" = ANY (ARRAY['meta_ads'::"text", 'facebook_organic'::"text", 'instagram'::"text", 'tiktok'::"text", 'google'::"text", 'whatsapp'::"text", 'email'::"text", 'website'::"text", 'event'::"text", 'referral'::"text", 'other'::"text"]))),
    CONSTRAINT "marketing_campaigns_check" CHECK ((("end_date" IS NULL) OR ("start_date" IS NULL) OR ("end_date" >= "start_date"))),
    CONSTRAINT "marketing_campaigns_dates_check" CHECK ((("end_date" IS NULL) OR ("start_date" IS NULL) OR ("end_date" >= "start_date"))),
    CONSTRAINT "marketing_campaigns_name_check" CHECK ((("char_length"("name") >= 1) AND ("char_length"("name") <= 160))),
    CONSTRAINT "marketing_campaigns_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'completed'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."marketing_campaigns" OWNER TO "postgres";


COMMENT ON TABLE "public"."marketing_campaigns" IS 'Marketing CRM Phase 1A -- core Campaign entity. No attribution FK from Sales tables yet (Phase 1C); no Meta Ads sync yet (Phase 2).';



CREATE TABLE IF NOT EXISTS "public"."marketing_contact_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "note" "text",
    "campaign_id" "uuid",
    "lead_metadata_id" "uuid",
    "actor_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "marketing_contact_events_check" CHECK ((("event_type" <> 'campaign_linked'::"text") OR ("campaign_id" IS NOT NULL))),
    CONSTRAINT "marketing_contact_events_check1" CHECK ((("event_type" <> 'promoted_to_sales'::"text") OR ("lead_metadata_id" IS NOT NULL))),
    CONSTRAINT "marketing_contact_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['created'::"text", 'status_changed'::"text", 'note_added'::"text", 'campaign_linked'::"text", 'consent_changed'::"text", 'unsubscribed'::"text", 'promoted_to_sales'::"text"]))),
    CONSTRAINT "marketing_contact_events_note_check" CHECK ((("note" IS NULL) OR ("char_length"("note") <= 3000)))
);


ALTER TABLE "public"."marketing_contact_events" OWNER TO "postgres";


COMMENT ON TABLE "public"."marketing_contact_events" IS 'Marketing CRM Phase 1B-A -- append-only nurture timeline for marketing_contacts, same architecture as public.sales_activity. No UPDATE/DELETE policy for anyone.';



CREATE TABLE IF NOT EXISTS "public"."marketing_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contact_number" "text" DEFAULT "app"."next_marketing_contact_number"() NOT NULL,
    "full_name" "text",
    "email" "text",
    "phone" "text",
    "company" "text",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "source" "text" NOT NULL,
    "source_campaign_id" "uuid",
    "consent_status" "text" DEFAULT 'not_set'::"text" NOT NULL,
    "consent_source" "text",
    "consented_at" timestamp with time zone,
    "unsubscribed_at" timestamp with time zone,
    "owner_id" "uuid",
    "promoted_lead_metadata_id" "uuid",
    "promoted_at" timestamp with time zone,
    "next_follow_up_at" timestamp with time zone,
    "created_by" "uuid",
    "updated_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "marketing_contacts_check" CHECK (((("email" IS NOT NULL) AND ("char_length"(TRIM(BOTH FROM "email")) > 0)) OR (("phone" IS NOT NULL) AND ("char_length"(TRIM(BOTH FROM "phone")) > 0)))),
    CONSTRAINT "marketing_contacts_check1" CHECK ((("status" <> 'promoted'::"text") OR ("promoted_lead_metadata_id" IS NOT NULL))),
    CONSTRAINT "marketing_contacts_consent_status_check" CHECK (("consent_status" = ANY (ARRAY['not_set'::"text", 'opted_in'::"text", 'opted_out'::"text"]))),
    CONSTRAINT "marketing_contacts_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'newsletter'::"text", 'event'::"text", 'referral'::"text", 'import'::"text", 'website'::"text", 'other'::"text"]))),
    CONSTRAINT "marketing_contacts_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'nurturing'::"text", 'sales_ready'::"text", 'promoted'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."marketing_contacts" OWNER TO "postgres";


COMMENT ON TABLE "public"."marketing_contacts" IS 'Marketing CRM Phase 1B-A -- pre-sales nurture contact. Upstream of and independent from sales_lead_metadata/enquiries/proposal_requests -- promotion (Phase 1B-D) creates a NEW sales_lead_metadata row via RPC, it does not repurpose this one.';



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


CREATE TABLE IF NOT EXISTS "public"."media_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "parent_id" "uuid",
    "path" "text" DEFAULT '/'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."media_folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."news_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."news_categories" OWNER TO "postgres";


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


COMMENT ON TABLE "public"."participant_feedback" IS 'Participant feedback per schedule/enrollment. participant_id is stored for duplicate prevention / response-rate calculations only; trainers have no RLS access to this table.';



CREATE SEQUENCE IF NOT EXISTS "public"."participant_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."participant_id_seq" OWNER TO "postgres";


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


COMMENT ON TABLE "public"."participant_skill_results" IS 'Per-area (theory/practical/safety/practical-assessment) trainer-entered result for one participant on one schedule. Feeds the Template A certificate Participant Skills Record (Phase 2C, not yet built) -- table is intentionally empty until the Assessment UI (Phase 2B, not yet built) can write to it.';



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
    "legacy_batch_id" "uuid",
    CONSTRAINT "participants_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'registered'::"text", 'confirmed'::"text", 'attended'::"text", 'no_show'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."participants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."participants"."participant_id" IS 'Auto-generated public identifier, e.g. TU-000123.';



COMMENT ON COLUMN "public"."participants"."ic_passport_no" IS 'IC or passport number (mirrors legacy identity_no for pre-existing rows).';



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


COMMENT ON TABLE "public"."photo_ai_analysis" IS 'AI-assisted analysis history. Advisory only — never auto-approves, never auto-publishes, never sets Best Photo, never inserts photo_usages. Human remains the final decision maker. One row per (photo, provider, model, analysis_version); the same photo can carry analyses from different providers/models/versions for benchmark comparison.';



COMMENT ON COLUMN "public"."photo_ai_analysis"."latency_ms" IS 'Provider request duration in milliseconds (safe operational metadata).';



COMMENT ON COLUMN "public"."photo_ai_analysis"."input_size_bytes" IS 'Size of the image input submitted to the provider, in bytes.';



COMMENT ON COLUMN "public"."photo_ai_analysis"."provider_request_id" IS 'Provider response/request identifier, when safely exposed.';



COMMENT ON COLUMN "public"."photo_ai_analysis"."provider_metadata" IS 'Safe operational metadata only (finish reason, retry count, token counts). Must never contain API keys, signed URLs, image data, or request bodies.';



CREATE TABLE IF NOT EXISTS "public"."photo_categories" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."photo_categories" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_categories" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."photo_id_sequences" (
    "seq_date" "date" NOT NULL,
    "last_value" bigint DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."photo_id_sequences" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_id_sequences" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."photo_usage_types" (
    "key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."photo_usage_types" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_usage_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."photo_usages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "photo_id" "uuid" NOT NULL,
    "usage_type" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."photo_usages" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_usages" OWNER TO "postgres";


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
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "department" "public"."staff_department",
    "access_control_enabled" boolean DEFAULT false NOT NULL,
    "updated_by" "uuid",
    "must_change_password" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."public_rate_limits" (
    "rate_key" "text" NOT NULL,
    "window_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "request_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "public_rate_limits_count_nonnegative" CHECK (("request_count" >= 0)),
    CONSTRAINT "public_rate_limits_key_length" CHECK ((("char_length"("rate_key") >= 1) AND ("char_length"("rate_key") <= 200)))
);


ALTER TABLE "public"."public_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."public_registration_attendees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "registration_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "ic_passport_no" "text",
    "identity_normalized" "text",
    "email" "text",
    "phone" "text",
    "company" "text",
    "participant_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "public_registration_attendees_company_check" CHECK ((("company" IS NULL) OR (("char_length"("company") >= 1) AND ("char_length"("company") <= 200)))),
    CONSTRAINT "public_registration_attendees_email_check" CHECK ((("email" IS NULL) OR (("char_length"("email") >= 3) AND ("char_length"("email") <= 254)))),
    CONSTRAINT "public_registration_attendees_identity_check" CHECK ((("identity_normalized" IS NULL) OR (("char_length"("identity_normalized") >= 1) AND ("char_length"("identity_normalized") <= 120)))),
    CONSTRAINT "public_registration_attendees_name_check" CHECK ((("char_length"("btrim"("full_name")) >= 1) AND ("char_length"("btrim"("full_name")) <= 200))),
    CONSTRAINT "public_registration_attendees_phone_check" CHECK ((("phone" IS NULL) OR (("char_length"("phone") >= 3) AND ("char_length"("phone") <= 40))))
);


ALTER TABLE "public"."public_registration_attendees" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."public_registration_payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "registration_id" "uuid" NOT NULL,
    "payment_provider" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "currency" "text" DEFAULT 'MYR'::"text" NOT NULL,
    "provider_bill_code" "text",
    "provider_transaction_id" "text",
    "provider_reference" "text",
    "payment_url" "text",
    "bill_creation_state" "text" DEFAULT 'not_claimed'::"text" NOT NULL,
    "bill_creation_claimed_at" timestamp with time zone,
    "verified_amount" numeric(12,2),
    "verified_at" timestamp with time zone,
    "callback_received_at" timestamp with time zone,
    "raw_response" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "public_registration_payments_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "public_registration_payments_bill_creation_state_check" CHECK (("bill_creation_state" = ANY (ARRAY['not_claimed'::"text", 'claimed'::"text", 'attached'::"text", 'failed'::"text", 'orphaned'::"text"]))),
    CONSTRAINT "public_registration_payments_currency_check" CHECK (("currency" = 'MYR'::"text")),
    CONSTRAINT "public_registration_payments_provider_check" CHECK (("payment_provider" = ANY (ARRAY['toyyibpay'::"text", 'bank_transfer'::"text", 'cash'::"text", 'cheque'::"text", 'other'::"text"]))),
    CONSTRAINT "public_registration_payments_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'paid'::"text", 'failed'::"text", 'cancelled'::"text", 'refunded'::"text"]))),
    CONSTRAINT "public_registration_payments_verified_amount_check" CHECK ((("verified_amount" IS NULL) OR ("verified_amount" >= (0)::numeric)))
);


ALTER TABLE "public"."public_registration_payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."public_registrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "registration_reference" "text" DEFAULT ('TU-REG-'::"text" || "upper"("substr"("replace"(("gen_random_uuid"())::"text", '-'::"text", ''::"text"), 1, 12))) NOT NULL,
    "confirmation_token_hash" "text" NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "course_id" "uuid" NOT NULL,
    "attendee_count" integer NOT NULL,
    "currency" "text" DEFAULT 'MYR'::"text" NOT NULL,
    "amount_snapshot" numeric(12,2) NOT NULL,
    "registration_status" "text" DEFAULT 'pending_payment'::"text" NOT NULL,
    "payment_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "idempotency_key_hash" "text" NOT NULL,
    "hold_expires_at" timestamp with time zone,
    "confirmed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "expired_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "public_registrations_amount_check" CHECK (("amount_snapshot" >= (0)::numeric)),
    CONSTRAINT "public_registrations_attendee_count_check" CHECK ((("attendee_count" > 0) AND ("attendee_count" <= 100))),
    CONSTRAINT "public_registrations_currency_check" CHECK (("currency" = 'MYR'::"text")),
    CONSTRAINT "public_registrations_payment_status_check" CHECK (("payment_status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'paid'::"text", 'failed'::"text", 'cancelled'::"text", 'refunded'::"text"]))),
    CONSTRAINT "public_registrations_status_check" CHECK (("registration_status" = ANY (ARRAY['pending_payment'::"text", 'payment_pending'::"text", 'confirmed'::"text", 'failed'::"text", 'cancelled'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."public_registrations" OWNER TO "postgres";


COMMENT ON TABLE "public"."public_registrations" IS 'Private public-registration aggregate. Access is through narrowly scoped RPCs, never direct client table access.';



CREATE TABLE IF NOT EXISTS "public"."sales_activity" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_metadata_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "note" "text",
    "actor_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "opportunity_id" "uuid",
    "quotation_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "sales_activity_metadata_object_check" CHECK (("jsonb_typeof"("metadata") = 'object'::"text")),
    CONSTRAINT "sales_activity_note_check" CHECK ((("note" IS NULL) OR ("char_length"("note") <= 3000))),
    CONSTRAINT "sales_activity_type_check" CHECK (("type" = ANY (ARRAY['lead_created'::"text", 'status_changed'::"text", 'assigned'::"text", 'followup_scheduled'::"text", 'note_added'::"text", 'proposal_sent'::"text", 'won'::"text", 'lost'::"text", 'opportunity_created'::"text", 'quotation_created'::"text", 'quotation_sent'::"text", 'quotation_revised'::"text", 'quotation_accepted'::"text", 'quotation_rejected'::"text", 'opportunity_won'::"text", 'opportunity_lost'::"text", 'training_handoff_created'::"text", 'company_linked'::"text", 'company_created'::"text", 'task_created'::"text", 'task_completed'::"text", 'task_reopened'::"text", 'task_cancelled'::"text", 'registration_completed'::"text", 'invoice_created'::"text", 'invoice_issued'::"text", 'invoice_partially_paid'::"text", 'invoice_paid'::"text", 'invoice_cancelled'::"text", 'payment_recorded'::"text", 'quotation_cancelled'::"text", 'opportunity_reversed'::"text", 'qualification_changed'::"text", 'temperature_changed'::"text", 'priority_changed'::"text"])))
);


ALTER TABLE "public"."sales_activity" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."sales_lead_attributions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "lead_metadata_id" "uuid" NOT NULL,
    "source" "text" NOT NULL,
    "campaign_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "utm_source" "text",
    "utm_medium" "text",
    "utm_campaign" "text",
    "utm_content" "text",
    "utm_term" "text",
    CONSTRAINT "sales_lead_attributions_source_check" CHECK (("source" = ANY (ARRAY['facebook'::"text", 'tiktok'::"text", 'whatsapp'::"text", 'website'::"text", 'referral'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."sales_lead_attributions" OWNER TO "postgres";


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
    "is_test" boolean DEFAULT false NOT NULL,
    "qualification_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "temperature" "text",
    "qualification_reason" "text",
    "disqualification_reason" "text",
    "qualification_changed_at" timestamp with time zone,
    "qualification_changed_by" "uuid",
    CONSTRAINT "sales_lead_metadata_disqualification_reason_check" CHECK ((("disqualification_reason" IS NULL) OR ("disqualification_reason" = ANY (ARRAY['no_budget'::"text", 'no_requirement'::"text", 'wrong_course'::"text", 'outside_target'::"text", 'no_response'::"text", 'timing_not_suitable'::"text", 'duplicate'::"text", 'invalid_contact'::"text", 'other'::"text"])))),
    CONSTRAINT "sales_lead_metadata_lead_source_check" CHECK (("lead_source" = ANY (ARRAY['enquiry'::"text", 'proposal_request'::"text", 'marketing_contact'::"text"]))),
    CONSTRAINT "sales_lead_metadata_lost_reason_check" CHECK ((("lost_reason" IS NULL) OR ("lost_reason" = ANY (ARRAY['price'::"text", 'no_budget'::"text", 'no_response'::"text", 'timing'::"text", 'competitor'::"text", 'requirement_changed'::"text", 'duplicate'::"text", 'other'::"text"])))),
    CONSTRAINT "sales_lead_metadata_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "sales_lead_metadata_qualification_reason_check" CHECK ((("qualification_reason" IS NULL) OR ("qualification_reason" = ANY (ARRAY['course_match'::"text", 'budget_confirmed'::"text", 'decision_maker_engaged'::"text", 'training_date_fit'::"text", 'company_requirement_confirmed'::"text", 'repeat_client'::"text", 'other'::"text"])))),
    CONSTRAINT "sales_lead_metadata_qualification_reason_state_check" CHECK (((("qualification_status" = 'pending'::"text") AND ("qualification_reason" IS NULL) AND ("disqualification_reason" IS NULL)) OR (("qualification_status" = 'qualified'::"text") AND ("disqualification_reason" IS NULL)) OR (("qualification_status" = 'unqualified'::"text") AND ("qualification_reason" IS NULL)))),
    CONSTRAINT "sales_lead_metadata_qualification_status_check" CHECK (("qualification_status" = ANY (ARRAY['pending'::"text", 'qualified'::"text", 'unqualified'::"text"]))),
    CONSTRAINT "sales_lead_metadata_status_check" CHECK (("status" = ANY (ARRAY['new'::"text", 'contacted'::"text", 'qualified'::"text", 'proposal_sent'::"text", 'negotiation'::"text", 'won'::"text", 'lost'::"text", 'archived'::"text"]))),
    CONSTRAINT "sales_lead_metadata_temperature_check" CHECK ((("temperature" IS NULL) OR ("temperature" = ANY (ARRAY['hot'::"text", 'warm'::"text", 'cold'::"text"]))))
);


ALTER TABLE "public"."sales_lead_metadata" OWNER TO "postgres";


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
    "is_test" boolean DEFAULT false NOT NULL,
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    CONSTRAINT "sales_opportunities_estimated_value_check" CHECK ((("estimated_value" IS NULL) OR ("estimated_value" >= (0)::numeric))),
    CONSTRAINT "sales_opportunities_lost_reason_check" CHECK ((("lost_reason" IS NULL) OR ("lost_reason" = ANY (ARRAY['price'::"text", 'no_budget'::"text", 'no_response'::"text", 'timing'::"text", 'competitor'::"text", 'requirement_changed'::"text", 'duplicate'::"text", 'other'::"text"])))),
    CONSTRAINT "sales_opportunities_probability_check" CHECK ((("probability" IS NULL) OR (("probability" >= 0) AND ("probability" <= 100)))),
    CONSTRAINT "sales_opportunities_stage_check" CHECK (("stage" = ANY (ARRAY['new'::"text", 'qualified'::"text", 'quotation'::"text", 'negotiation'::"text", 'won'::"text", 'lost'::"text", 'archived'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."sales_opportunities" OWNER TO "postgres";


COMMENT ON COLUMN "public"."sales_opportunities"."company_id" IS 'Confirmed link to the canonical companies record, set only via explicit staff confirmation (Link Existing Company / Create Company on a Won Opportunity). Null until linked.';



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
    "course_id" "uuid",
    "course_name_snapshot" "text",
    "hrdf_claim" boolean,
    "package_includes_snapshot" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "sales_quotation_items_description_check" CHECK ((("char_length"("description") >= 1) AND ("char_length"("description") <= 500))),
    CONSTRAINT "sales_quotation_items_discount_check" CHECK (("discount" >= (0)::numeric)),
    CONSTRAINT "sales_quotation_items_package_includes_array_check" CHECK (("jsonb_typeof"("package_includes_snapshot") = 'array'::"text")),
    CONSTRAINT "sales_quotation_items_quantity_check" CHECK (("quantity" > (0)::numeric)),
    CONSTRAINT "sales_quotation_items_unit_check" CHECK (("unit" = ANY (ARRAY['pax'::"text", 'session'::"text", 'day'::"text", 'lot'::"text", 'unit'::"text"]))),
    CONSTRAINT "sales_quotation_items_unit_price_check" CHECK (("unit_price" >= (0)::numeric))
);


ALTER TABLE "public"."sales_quotation_items" OWNER TO "postgres";


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
    "is_test" boolean DEFAULT false NOT NULL,
    "cancelled_at" timestamp with time zone,
    "cancellation_reason" "text",
    "customer_company_name" "text",
    "customer_contact_name" "text",
    "customer_registration_no" "text",
    "customer_email" "text",
    "customer_phone" "text",
    "billing_address" "text",
    "training_service_address" "text",
    CONSTRAINT "sales_quotations_discount_check" CHECK (("discount" >= (0)::numeric)),
    CONSTRAINT "sales_quotations_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'accepted'::"text", 'rejected'::"text", 'expired'::"text", 'superseded'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."sales_quotations" OWNER TO "postgres";


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


COMMENT ON TABLE "public"."sales_tasks" IS 'Sales CRM Phase 4B — general sales to-dos, optionally linked to a lead/opportunity/quotation. Not a project-management suite; deliberately minimal.';



CREATE TABLE IF NOT EXISTS "public"."schedule_assessors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "assessor_id" "uuid" NOT NULL,
    "is_primary" boolean DEFAULT true NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assigned_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."schedule_assessors" OWNER TO "postgres";


COMMENT ON TABLE "public"."schedule_assessors" IS 'Schedule → assessor assignment. Phase 1 UI manages a single primary assessor; the shape supports multiple assessors later (is_primary distinguishes them).';



CREATE SEQUENCE IF NOT EXISTS "public"."schedule_code_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."schedule_code_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedule_groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "trainer_id" "uuid",
    "assessor_id" "uuid",
    "capacity" integer,
    "start_time" time without time zone,
    "end_time" time without time zone,
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_by" "uuid",
    CONSTRAINT "schedule_groups_capacity_check" CHECK ((("capacity" IS NULL) OR ("capacity" >= 0)))
);


ALTER TABLE "public"."schedule_groups" OWNER TO "postgres";


COMMENT ON TABLE "public"."schedule_groups" IS 'Training Schedule Groups V1 — optional subdivision of a course_schedules row (Group A / Group B / ...), each with its own trainer and an optional assessor override. A schedule with no groups is legacy/ungrouped and behaves exactly as before this migration. Soft-delete only (deleted_at); the app layer blocks removal while participants are still assigned.';



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
    "schedule_group_id" "uuid",
    "legacy_batch_id" "uuid",
    CONSTRAINT "schedule_participants_registration_status_check" CHECK (("registration_status" = ANY (ARRAY['registered'::"text", 'confirmed'::"text", 'cancelled'::"text", 'completed'::"text"])))
);


ALTER TABLE "public"."schedule_participants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."schedule_participants"."schedule_group_id" IS 'Optional group within the parent schedule. NULL = ungrouped/legacy enrollment. A column (not a mapping table) so "one group per participant per schedule" holds by construction. Enforced (not just app-checked) to belong to the SAME schedule_id via the composite FK below.';



CREATE TABLE IF NOT EXISTS "public"."staff_module_access" (
    "user_id" "uuid" NOT NULL,
    "module_key" "text" NOT NULL,
    "access_level" "text" DEFAULT 'view'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    CONSTRAINT "staff_module_access_access_level_check" CHECK (("access_level" = ANY (ARRAY['view'::"text", 'edit'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."staff_module_access" OWNER TO "postgres";


COMMENT ON TABLE "public"."staff_module_access" IS 'Explicit module allow-list for profiles with access_control_enabled=true.';



CREATE TABLE IF NOT EXISTS "public"."staff_module_catalog" (
    "module_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "group_key" "text" NOT NULL,
    "min_role" "public"."user_role" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."staff_module_catalog" OWNER TO "postgres";


COMMENT ON TABLE "public"."staff_module_catalog" IS 'Controlled CMS module keys. Role threshold and explicit staff access are separate decisions.';



CREATE SEQUENCE IF NOT EXISTS "public"."trainer_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."trainer_id_seq" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trainers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trainer_id" "text",
    "full_name" "text" NOT NULL,
    "ic_passport_no" "text",
    "staff_no" "text",
    "email" "text",
    "phone" "text",
    "position" "text",
    "department" "text",
    "employment_type" "text",
    "specialisation" "text",
    "qualifications" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "competencies" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "trainer_photo" "text",
    "signature_image" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "joining_date" "date",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trainers_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text", 'retired'::"text", 'on_leave'::"text"])))
);


ALTER TABLE "public"."trainers" OWNER TO "postgres";


COMMENT ON TABLE "public"."trainers" IS 'Trainer master data (Trainer Master V1). Soft-delete only: deactivate via deleted_at, never DROP a row. course_schedules.trainer_name remains the live free-text scheduling field — this table is not yet FK-linked to course_schedules (separate future phase).';



CREATE OR REPLACE VIEW "public"."v_certificate_eligibility" WITH ("security_invoker"='true') AS
 WITH "enrollment" AS (
         SELECT "schedule_participants"."schedule_id",
            "schedule_participants"."participant_id",
            "schedule_participants"."registration_status" AS "enrollment_status"
           FROM "public"."schedule_participants"
          WHERE (("schedule_participants"."deleted_at" IS NULL) AND ("schedule_participants"."registration_status" <> 'cancelled'::"text"))
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
    ("certificate_generation_enabled" AND ("certificate_template_id" IS NOT NULL) AND ("schedule_status" = 'completed'::"text") AND "attendance_satisfied" AND "assessment_satisfied" AND ("existing_certificate_id" IS NULL)) AS "eligible",
        CASE
            WHEN (NOT "certificate_generation_enabled") THEN 'certificate_generation_disabled'::"text"
            WHEN ("certificate_template_id" IS NULL) THEN 'certificate_template_not_configured'::"text"
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
    "m"."is_test",
    "m"."created_at",
    "m"."updated_at",
        CASE "m"."lead_source"
            WHEN 'enquiry'::"text" THEN "e"."name"
            WHEN 'proposal_request'::"text" THEN "p"."contact_person"
            WHEN 'marketing_contact'::"text" THEN COALESCE("mc"."full_name", "mc"."email", "mc"."phone")
            ELSE NULL::"text"
        END AS "contact_name",
        CASE "m"."lead_source"
            WHEN 'enquiry'::"text" THEN "e"."company"
            WHEN 'proposal_request'::"text" THEN "p"."company_name"
            WHEN 'marketing_contact'::"text" THEN "mc"."company"
            ELSE NULL::"text"
        END AS "company",
        CASE "m"."lead_source"
            WHEN 'enquiry'::"text" THEN "e"."email"
            WHEN 'proposal_request'::"text" THEN "p"."email"
            WHEN 'marketing_contact'::"text" THEN "mc"."email"
            ELSE NULL::"text"
        END AS "email",
        CASE "m"."lead_source"
            WHEN 'enquiry'::"text" THEN "e"."phone"
            WHEN 'proposal_request'::"text" THEN "p"."phone"
            WHEN 'marketing_contact'::"text" THEN "mc"."phone"
            ELSE NULL::"text"
        END AS "phone",
        CASE "m"."lead_source"
            WHEN 'enquiry'::"text" THEN "e"."subject"
            WHEN 'proposal_request'::"text" THEN COALESCE("p"."programme", "p"."category")
            ELSE NULL::"text"
        END AS "subject"
   FROM ((("public"."sales_lead_metadata" "m"
     LEFT JOIN "public"."enquiries" "e" ON ((("m"."lead_source" = 'enquiry'::"text") AND ("e"."id" = "m"."source_id"))))
     LEFT JOIN "public"."proposal_requests" "p" ON ((("m"."lead_source" = 'proposal_request'::"text") AND ("p"."id" = "m"."source_id"))))
     LEFT JOIN "public"."marketing_contacts" "mc" ON ((("m"."lead_source" = 'marketing_contact'::"text") AND ("mc"."id" = "m"."source_id"))));


ALTER VIEW "public"."v_sales_lead_inbox" OWNER TO "postgres";


ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_schedule_participant_key" UNIQUE ("schedule_id", "participant_id");



ALTER TABLE ONLY "public"."assessors"
    ADD CONSTRAINT "assessors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_schedule_participant_session_key" UNIQUE ("schedule_id", "participant_id", "session_date");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certificate_import_logs"
    ADD CONSTRAINT "certificate_import_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certificate_skill_results"
    ADD CONSTRAINT "certificate_skill_results_certificate_area_key" UNIQUE ("certificate_id", "area");



ALTER TABLE ONLY "public"."certificate_skill_results"
    ADD CONSTRAINT "certificate_skill_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certificate_templates"
    ADD CONSTRAINT "certificate_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certificate_verifications"
    ADD CONSTRAINT "certificate_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_certificate_no_key" UNIQUE ("certificate_no");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cms_content"
    ADD CONSTRAINT "cms_content_content_type_slug_key" UNIQUE ("content_type", "slug");



ALTER TABLE ONLY "public"."cms_content"
    ADD CONSTRAINT "cms_content_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cms_media"
    ADD CONSTRAINT "cms_media_bucket_storage_path_key" UNIQUE ("bucket", "storage_path");



ALTER TABLE ONLY "public"."cms_media"
    ADD CONSTRAINT "cms_media_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_company_id_key" UNIQUE ("company_id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_profile"
    ADD CONSTRAINT "company_profile_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_commercial_profiles"
    ADD CONSTRAINT "course_commercial_profiles_course_id_key" UNIQUE ("course_id");



ALTER TABLE ONLY "public"."course_commercial_profiles"
    ADD CONSTRAINT "course_commercial_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_course_code_key" UNIQUE ("course_code");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."downloads"
    ADD CONSTRAINT "downloads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."downloads"
    ADD CONSTRAINT "downloads_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."enquiries"
    ADD CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."faq_categories"
    ADD CONSTRAINT "faq_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."faq_categories"
    ADD CONSTRAINT "faq_categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_issues"
    ADD CONSTRAINT "feedback_issues_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_schedule_links"
    ADD CONSTRAINT "feedback_schedule_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."feedback_schedule_links"
    ADD CONSTRAINT "feedback_schedule_links_public_token_unique" UNIQUE ("public_token");



ALTER TABLE ONLY "public"."feedback_schedule_links"
    ADD CONSTRAINT "feedback_schedule_links_schedule_unique" UNIQUE ("schedule_id");



ALTER TABLE ONLY "public"."feedback_schedule_lookup_attempts"
    ADD CONSTRAINT "feedback_schedule_lookup_attempts_pkey" PRIMARY KEY ("schedule_link_id", "request_fingerprint_hash", "window_started_at");



ALTER TABLE ONLY "public"."gallery_categories"
    ADD CONSTRAINT "gallery_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gallery_categories"
    ADD CONSTRAINT "gallery_categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."gallery_images"
    ADD CONSTRAINT "gallery_images_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_invoice_no_key" UNIQUE ("invoice_no");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_quotation_id_key" UNIQUE ("quotation_id");



ALTER TABLE ONLY "public"."legacy_course_map"
    ADD CONSTRAINT "legacy_course_map_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legacy_import_batches"
    ADD CONSTRAINT "legacy_import_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legacy_participant_staging"
    ADD CONSTRAINT "legacy_participant_staging_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_campaign_number_key" UNIQUE ("campaign_number");



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketing_contact_events"
    ADD CONSTRAINT "marketing_contact_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."marketing_contacts"
    ADD CONSTRAINT "marketing_contacts_contact_number_key" UNIQUE ("contact_number");



ALTER TABLE ONLY "public"."marketing_contacts"
    ADD CONSTRAINT "marketing_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."media"
    ADD CONSTRAINT "media_bucket_storage_path_key" UNIQUE ("bucket", "storage_path");



ALTER TABLE ONLY "public"."media_folders"
    ADD CONSTRAINT "media_folders_parent_id_name_key" UNIQUE ("parent_id", "name");



ALTER TABLE ONLY "public"."media_folders"
    ADD CONSTRAINT "media_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."media"
    ADD CONSTRAINT "media_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."news_categories"
    ADD CONSTRAINT "news_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."news_categories"
    ADD CONSTRAINT "news_categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."participant_feedback"
    ADD CONSTRAINT "participant_feedback_one_per_enrollment" UNIQUE ("schedule_id", "participant_id");



ALTER TABLE ONLY "public"."participant_feedback"
    ADD CONSTRAINT "participant_feedback_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_schedule_participant_area_key" UNIQUE ("schedule_id", "participant_id", "area");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_participant_code_key" UNIQUE ("participant_code");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_activity_log"
    ADD CONSTRAINT "photo_activity_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_ai_analysis"
    ADD CONSTRAINT "photo_ai_analysis_identity_unique" UNIQUE ("photo_id", "provider", "model", "analysis_version");



COMMENT ON CONSTRAINT "photo_ai_analysis_identity_unique" ON "public"."photo_ai_analysis" IS 'Identity of one analysis run: photo + provider + model + analysis_version. This is what makes multi-provider comparison possible without overwriting.';



ALTER TABLE ONLY "public"."photo_ai_analysis"
    ADD CONSTRAINT "photo_ai_analysis_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_categories"
    ADD CONSTRAINT "photo_categories_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."photo_events"
    ADD CONSTRAINT "photo_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photo_events"
    ADD CONSTRAINT "photo_events_slug_unique" UNIQUE ("slug");



ALTER TABLE ONLY "public"."photo_id_sequences"
    ADD CONSTRAINT "photo_id_sequences_pkey" PRIMARY KEY ("seq_date");



ALTER TABLE ONLY "public"."photo_usage_types"
    ADD CONSTRAINT "photo_usage_types_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."photo_usages"
    ADD CONSTRAINT "photo_usages_photo_usage_unique" UNIQUE ("photo_id", "usage_type");



ALTER TABLE ONLY "public"."photo_usages"
    ADD CONSTRAINT "photo_usages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_media_id_unique" UNIQUE ("media_id");



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_photo_id_unique" UNIQUE ("photo_id");



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_telegram_file_unique_id_unique" UNIQUE ("telegram_file_unique_id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."proposal_requests"
    ADD CONSTRAINT "proposal_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_rate_limits"
    ADD CONSTRAINT "public_rate_limits_pkey" PRIMARY KEY ("rate_key");



ALTER TABLE ONLY "public"."public_registration_attendees"
    ADD CONSTRAINT "public_registration_attendees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_registration_payments"
    ADD CONSTRAINT "public_registration_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_registrations"
    ADD CONSTRAINT "public_registrations_confirmation_token_key" UNIQUE ("confirmation_token_hash");



ALTER TABLE ONLY "public"."public_registrations"
    ADD CONSTRAINT "public_registrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_registrations"
    ADD CONSTRAINT "public_registrations_reference_key" UNIQUE ("registration_reference");



ALTER TABLE ONLY "public"."public_registrations"
    ADD CONSTRAINT "public_registrations_schedule_idempotency_key" UNIQUE ("schedule_id", "idempotency_key_hash");



ALTER TABLE ONLY "public"."sales_activity"
    ADD CONSTRAINT "sales_activity_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_lead_attributions"
    ADD CONSTRAINT "sales_lead_attributions_lead_metadata_id_key" UNIQUE ("lead_metadata_id");



ALTER TABLE ONLY "public"."sales_lead_attributions"
    ADD CONSTRAINT "sales_lead_attributions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_lead_metadata"
    ADD CONSTRAINT "sales_lead_metadata_lead_source_source_id_key" UNIQUE ("lead_source", "source_id");



ALTER TABLE ONLY "public"."sales_lead_metadata"
    ADD CONSTRAINT "sales_lead_metadata_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_lead_metadata_id_key" UNIQUE ("lead_metadata_id");



ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_opportunity_no_key" UNIQUE ("opportunity_no");



ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_quotation_items"
    ADD CONSTRAINT "sales_quotation_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_quotations"
    ADD CONSTRAINT "sales_quotations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."sales_quotations"
    ADD CONSTRAINT "sales_quotations_quotation_no_revision_no_key" UNIQUE ("quotation_no", "revision_no");



ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_assessors"
    ADD CONSTRAINT "schedule_assessors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_groups"
    ADD CONSTRAINT "schedule_groups_id_schedule_id_unique" UNIQUE ("id", "schedule_id");



ALTER TABLE ONLY "public"."schedule_groups"
    ADD CONSTRAINT "schedule_groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedule_participants"
    ADD CONSTRAINT "schedule_participants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."staff_module_access"
    ADD CONSTRAINT "staff_module_access_pkey" PRIMARY KEY ("user_id", "module_key");



ALTER TABLE ONLY "public"."staff_module_catalog"
    ADD CONSTRAINT "staff_module_catalog_pkey" PRIMARY KEY ("module_key");



ALTER TABLE ONLY "public"."trainers"
    ADD CONSTRAINT "trainers_pkey" PRIMARY KEY ("id");



CREATE INDEX "assessments_legacy_batch_idx" ON "public"."assessments" USING "btree" ("legacy_batch_id") WHERE ("legacy_batch_id" IS NOT NULL);



CREATE INDEX "assessments_participant_idx" ON "public"."assessments" USING "btree" ("participant_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "assessments_schedule_idx" ON "public"."assessments" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "assessors_active_email_unique" ON "public"."assessors" USING "btree" ("email") WHERE ("is_active" AND ("email" IS NOT NULL));



CREATE UNIQUE INDEX "assessors_active_ic_unique" ON "public"."assessors" USING "btree" ("ic_passport_no") WHERE ("is_active" AND ("ic_passport_no" IS NOT NULL));



CREATE INDEX "assessors_active_idx" ON "public"."assessors" USING "btree" ("is_active");



CREATE INDEX "attendance_legacy_batch_idx" ON "public"."attendance" USING "btree" ("legacy_batch_id") WHERE ("legacy_batch_id" IS NOT NULL);



CREATE INDEX "attendance_participant_idx" ON "public"."attendance" USING "btree" ("participant_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "attendance_schedule_idx" ON "public"."attendance" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "certificate_import_logs_created_by_idx" ON "public"."certificate_import_logs" USING "btree" ("created_by");



CREATE UNIQUE INDEX "certificates_active_schedule_participant_uniq" ON "public"."certificates" USING "btree" ("schedule_id", "participant_id") WHERE (("deleted_at" IS NULL) AND ("status" <> 'revoked'::"text") AND ("schedule_id" IS NOT NULL));



CREATE INDEX "certificates_certificate_no_upper_idx" ON "public"."certificates" USING "btree" ("upper"("certificate_no"));



CREATE INDEX "certificates_course_id_idx" ON "public"."certificates" USING "btree" ("course_id");



CREATE INDEX "certificates_identity_no_idx" ON "public"."certificates" USING "btree" ("identity_no");



CREATE INDEX "certificates_legacy_batch_idx" ON "public"."certificates" USING "btree" ("legacy_batch_id") WHERE ("legacy_batch_id" IS NOT NULL);



CREATE INDEX "certificates_participant_id_idx" ON "public"."certificates" USING "btree" ("participant_id");



CREATE INDEX "certificates_schedule_idx" ON "public"."certificates" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "cms_content_live_idx" ON "public"."cms_content" USING "btree" ("content_type", "status", "sort_order") WHERE ("deleted_at" IS NULL);



CREATE INDEX "course_commercial_profiles_course_id_idx" ON "public"."course_commercial_profiles" USING "btree" ("course_id");



CREATE INDEX "course_schedules_course_idx" ON "public"."course_schedules" USING "btree" ("course_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "course_schedules_legacy_batch_idx" ON "public"."course_schedules" USING "btree" ("legacy_batch_id") WHERE ("legacy_batch_id" IS NOT NULL);



CREATE UNIQUE INDEX "course_schedules_schedule_code_key" ON "public"."course_schedules" USING "btree" ("schedule_code") WHERE ("schedule_code" IS NOT NULL);



CREATE UNIQUE INDEX "course_schedules_source_opportunity_unique" ON "public"."course_schedules" USING "btree" ("source_opportunity_id") WHERE (("source_opportunity_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "course_schedules_source_quotation_id_idx" ON "public"."course_schedules" USING "btree" ("source_quotation_id") WHERE ("source_quotation_id" IS NOT NULL);



CREATE INDEX "course_schedules_start_idx" ON "public"."course_schedules" USING "btree" ("start_date") WHERE ("deleted_at" IS NULL);



CREATE INDEX "course_schedules_status_idx" ON "public"."course_schedules" USING "btree" ("status") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "courses_active_slug_unique" ON "public"."courses" USING "btree" ("lower"(TRIM(BOTH FROM "slug"))) WHERE (("deleted_at" IS NULL) AND ("status" <> 'archived'::"text") AND ("slug" IS NOT NULL) AND (TRIM(BOTH FROM "slug") <> ''::"text"));



CREATE INDEX "courses_certificate_template_id_idx" ON "public"."courses" USING "btree" ("certificate_template_id") WHERE ("certificate_template_id" IS NOT NULL);



CREATE INDEX "courses_cms_slug_idx" ON "public"."courses" USING "btree" ("slug") WHERE ("slug" IS NOT NULL);



CREATE INDEX "courses_course_name_idx" ON "public"."courses" USING "btree" ("lower"("course_name"));



CREATE INDEX "enquiries_created_at_idx" ON "public"."enquiries" USING "btree" ("created_at" DESC);



CREATE INDEX "enquiries_email_created_at_idx" ON "public"."enquiries" USING "btree" ("email", "created_at" DESC);



CREATE INDEX "feedback_actions_assigned_idx" ON "public"."feedback_improvement_actions" USING "btree" ("assigned_to") WHERE ("assigned_to" IS NOT NULL);



CREATE INDEX "feedback_actions_issue_idx" ON "public"."feedback_improvement_actions" USING "btree" ("issue_id");



CREATE INDEX "feedback_actions_schedule_idx" ON "public"."feedback_improvement_actions" USING "btree" ("schedule_id");



CREATE INDEX "feedback_actions_status_idx" ON "public"."feedback_improvement_actions" USING "btree" ("status");



CREATE INDEX "feedback_issues_schedule_idx" ON "public"."feedback_issues" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "feedback_issues_source_idx" ON "public"."feedback_issues" USING "btree" ("source_feedback_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "feedback_issues_status_idx" ON "public"."feedback_issues" USING "btree" ("status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "feedback_schedule_lookup_attempts_retention_idx" ON "public"."feedback_schedule_lookup_attempts" USING "btree" ("last_attempt_at");



CREATE INDEX "idx_assessments_participant_id" ON "public"."assessments" USING "btree" ("participant_id");



CREATE INDEX "idx_assessments_schedule_id" ON "public"."assessments" USING "btree" ("schedule_id");



CREATE INDEX "idx_attendance_schedule_id" ON "public"."attendance" USING "btree" ("schedule_id");



CREATE INDEX "idx_audit_actor" ON "public"."audit_logs" USING "btree" ("actor_id");



CREATE INDEX "idx_audit_created" ON "public"."audit_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_audit_entity" ON "public"."audit_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_cert_verif_cert" ON "public"."certificate_verifications" USING "btree" ("certificate_id");



CREATE INDEX "idx_certificates_live" ON "public"."certificates" USING "btree" ("status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_companies_name" ON "public"."companies" USING "btree" ("lower"("company_name"));



CREATE INDEX "idx_companies_status" ON "public"."companies" USING "btree" ("status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_downloads_live" ON "public"."downloads" USING "btree" ("category") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_downloads_media_id" ON "public"."downloads" USING "btree" ("media_id");



CREATE INDEX "idx_faqs_category_id" ON "public"."faqs" USING "btree" ("category_id");



CREATE INDEX "idx_faqs_live" ON "public"."faqs" USING "btree" ("sort_order") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_gallery_images_category_id" ON "public"."gallery_images" USING "btree" ("category_id");



CREATE INDEX "idx_gallery_images_media_id" ON "public"."gallery_images" USING "btree" ("media_id");



CREATE INDEX "idx_gallery_live" ON "public"."gallery_images" USING "btree" ("sort_order") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_invoice_items_invoice_id" ON "public"."invoice_items" USING "btree" ("invoice_id");



CREATE INDEX "idx_invoice_payments_invoice_id" ON "public"."invoice_payments" USING "btree" ("invoice_id");



CREATE UNIQUE INDEX "idx_invoice_payments_one_pending_toyyibpay" ON "public"."invoice_payments" USING "btree" ("invoice_id") WHERE (("payment_provider" = 'toyyibpay'::"text") AND ("status" = 'pending'::"text"));



CREATE UNIQUE INDEX "idx_invoice_payments_provider_txn" ON "public"."invoice_payments" USING "btree" ("payment_provider", "provider_transaction_id") WHERE ("provider_transaction_id" IS NOT NULL);



CREATE INDEX "idx_invoices_company_id" ON "public"."invoices" USING "btree" ("company_id");



CREATE INDEX "idx_invoices_opportunity_id" ON "public"."invoices" USING "btree" ("opportunity_id");



CREATE INDEX "idx_invoices_status_due_date" ON "public"."invoices" USING "btree" ("status", "due_date");



CREATE INDEX "idx_media_folder_id" ON "public"."media" USING "btree" ("folder_id");



CREATE INDEX "idx_media_live" ON "public"."media" USING "btree" ("created_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_news_live" ON "public"."news_posts" USING "btree" ("updated_at" DESC) WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_news_posts_author_id" ON "public"."news_posts" USING "btree" ("author_id");



CREATE INDEX "idx_news_posts_category_id" ON "public"."news_posts" USING "btree" ("category_id");



CREATE INDEX "idx_participants_company_id" ON "public"."participants" USING "btree" ("company_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_schedule_groups_assessor" ON "public"."schedule_groups" USING "btree" ("assessor_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_schedule_groups_schedule" ON "public"."schedule_groups" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_schedule_groups_trainer" ON "public"."schedule_groups" USING "btree" ("trainer_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_schedule_participants_group" ON "public"."schedule_participants" USING "btree" ("schedule_group_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_trainers_department" ON "public"."trainers" USING "btree" ("department") WHERE ("deleted_at" IS NULL);



CREATE INDEX "idx_trainers_status" ON "public"."trainers" USING "btree" ("status") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "legacy_course_map_source_name_unique" ON "public"."legacy_course_map" USING "btree" ("source_label", "normalized_course_name");



CREATE UNIQUE INDEX "legacy_import_batches_source_hash_unique" ON "public"."legacy_import_batches" USING "btree" ("source_file_hash") WHERE ("source_file_hash" IS NOT NULL);



CREATE INDEX "legacy_participant_staging_batch_idx" ON "public"."legacy_participant_staging" USING "btree" ("batch_id");



CREATE UNIQUE INDEX "legacy_participant_staging_batch_row_unique" ON "public"."legacy_participant_staging" USING "btree" ("batch_id", "source_row_number");



CREATE INDEX "legacy_participant_staging_ic_idx" ON "public"."legacy_participant_staging" USING "btree" ("normalized_ic_passport");



CREATE INDEX "legacy_participant_staging_matched_participant_idx" ON "public"."legacy_participant_staging" USING "btree" ("matched_participant_id");



CREATE INDEX "marketing_campaigns_channel_idx" ON "public"."marketing_campaigns" USING "btree" ("channel");



CREATE INDEX "marketing_campaigns_course_id_idx" ON "public"."marketing_campaigns" USING "btree" ("course_id");



CREATE INDEX "marketing_campaigns_created_at_idx" ON "public"."marketing_campaigns" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "marketing_campaigns_name_lower_uidx" ON "public"."marketing_campaigns" USING "btree" ("lower"("name"));



CREATE INDEX "marketing_campaigns_owner_id_idx" ON "public"."marketing_campaigns" USING "btree" ("owner_id");



CREATE INDEX "marketing_campaigns_status_idx" ON "public"."marketing_campaigns" USING "btree" ("status");



CREATE INDEX "marketing_contact_events_contact_id_idx" ON "public"."marketing_contact_events" USING "btree" ("contact_id", "created_at" DESC);



CREATE INDEX "marketing_contacts_created_at_idx" ON "public"."marketing_contacts" USING "btree" ("created_at" DESC);



CREATE INDEX "marketing_contacts_email_idx" ON "public"."marketing_contacts" USING "btree" ("email");



CREATE INDEX "marketing_contacts_next_follow_up_at_idx" ON "public"."marketing_contacts" USING "btree" ("next_follow_up_at");



CREATE INDEX "marketing_contacts_owner_id_idx" ON "public"."marketing_contacts" USING "btree" ("owner_id");



CREATE INDEX "marketing_contacts_source_campaign_id_idx" ON "public"."marketing_contacts" USING "btree" ("source_campaign_id");



CREATE INDEX "marketing_contacts_source_idx" ON "public"."marketing_contacts" USING "btree" ("source");



CREATE INDEX "marketing_contacts_status_idx" ON "public"."marketing_contacts" USING "btree" ("status");



CREATE INDEX "participant_feedback_participant_idx" ON "public"."participant_feedback" USING "btree" ("participant_id");



CREATE INDEX "participant_feedback_schedule_idx" ON "public"."participant_feedback" USING "btree" ("schedule_id");



CREATE INDEX "participant_feedback_status_idx" ON "public"."participant_feedback" USING "btree" ("status");



CREATE INDEX "participant_feedback_submitted_idx" ON "public"."participant_feedback" USING "btree" ("submitted_at") WHERE ("submitted_at" IS NOT NULL);



CREATE UNIQUE INDEX "participant_feedback_token_unique" ON "public"."participant_feedback" USING "btree" ("token");



CREATE INDEX "participant_skill_results_schedule_participant_idx" ON "public"."participant_skill_results" USING "btree" ("schedule_id", "participant_id") WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "participants_active_email_unique" ON "public"."participants" USING "btree" ("lower"("email")) WHERE (("deleted_at" IS NULL) AND ("email" IS NOT NULL) AND ("btrim"("email") <> ''::"text"));



CREATE UNIQUE INDEX "participants_active_ic_passport_unique" ON "public"."participants" USING "btree" ("upper"("regexp_replace"("ic_passport_no", '[^0-9A-Za-z]'::"text", ''::"text", 'g'::"text"))) WHERE (("deleted_at" IS NULL) AND ("ic_passport_no" IS NOT NULL) AND ("btrim"("ic_passport_no") <> ''::"text"));



CREATE UNIQUE INDEX "participants_active_identity_unique" ON "public"."participants" USING "btree" ("regexp_replace"("identity_no", '[^0-9A-Za-z]'::"text", ''::"text", 'g'::"text")) WHERE (("deleted_at" IS NULL) AND ("identity_no" IS NOT NULL) AND ("btrim"("identity_no") <> ''::"text"));



CREATE INDEX "participants_full_name_idx" ON "public"."participants" USING "btree" ("lower"("full_name"));



CREATE INDEX "participants_identity_last4_idx" ON "public"."participants" USING "btree" ("identity_last4");



CREATE INDEX "participants_legacy_batch_idx" ON "public"."participants" USING "btree" ("legacy_batch_id") WHERE ("legacy_batch_id" IS NOT NULL);



CREATE INDEX "participants_organization_idx" ON "public"."participants" USING "btree" ("organization");



CREATE INDEX "participants_schedule_idx" ON "public"."participants" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "photo_activity_log_photo_id_idx" ON "public"."photo_activity_log" USING "btree" ("photo_id");



CREATE INDEX "photo_ai_analysis_photo_created_idx" ON "public"."photo_ai_analysis" USING "btree" ("photo_id", "created_at" DESC);



CREATE INDEX "photo_ai_analysis_rank_idx" ON "public"."photo_ai_analysis" USING "btree" ("provider", "model", "analysis_version", "overall_score" DESC);



CREATE INDEX "photo_usages_usage_type_idx" ON "public"."photo_usages" USING "btree" ("usage_type");



CREATE INDEX "photos_category_idx" ON "public"."photos" USING "btree" ("category");



CREATE INDEX "photos_event_id_idx" ON "public"."photos" USING "btree" ("event_id");



CREATE INDEX "photos_is_best_photo_idx" ON "public"."photos" USING "btree" ("is_best_photo") WHERE "is_best_photo";



CREATE INDEX "photos_status_uploaded_at_idx" ON "public"."photos" USING "btree" ("status", "uploaded_at");



CREATE INDEX "proposal_requests_created_at_idx" ON "public"."proposal_requests" USING "btree" ("created_at" DESC);



CREATE INDEX "proposal_requests_email_created_at_idx" ON "public"."proposal_requests" USING "btree" ("email", "created_at" DESC);



CREATE INDEX "public_registration_attendees_identity_idx" ON "public"."public_registration_attendees" USING "btree" ("identity_normalized") WHERE ("identity_normalized" IS NOT NULL);



CREATE INDEX "public_registration_attendees_registration_idx" ON "public"."public_registration_attendees" USING "btree" ("registration_id");



CREATE UNIQUE INDEX "public_registration_payments_one_active_toyyibpay" ON "public"."public_registration_payments" USING "btree" ("registration_id") WHERE (("payment_provider" = 'toyyibpay'::"text") AND ("status" = ANY (ARRAY['pending'::"text", 'processing'::"text"])));



CREATE UNIQUE INDEX "public_registration_payments_provider_bill_key" ON "public"."public_registration_payments" USING "btree" ("payment_provider", "provider_bill_code") WHERE ("provider_bill_code" IS NOT NULL);



CREATE UNIQUE INDEX "public_registration_payments_provider_transaction_key" ON "public"."public_registration_payments" USING "btree" ("payment_provider", "provider_transaction_id") WHERE ("provider_transaction_id" IS NOT NULL);



CREATE INDEX "public_registration_payments_registration_idx" ON "public"."public_registration_payments" USING "btree" ("registration_id", "created_at" DESC);



CREATE INDEX "public_registrations_schedule_idx" ON "public"."public_registrations" USING "btree" ("schedule_id", "registration_status", "hold_expires_at");



CREATE INDEX "public_registrations_status_idx" ON "public"."public_registrations" USING "btree" ("registration_status", "payment_status");



CREATE INDEX "sales_activity_lead_metadata_id_idx" ON "public"."sales_activity" USING "btree" ("lead_metadata_id", "created_at" DESC);



CREATE INDEX "sales_activity_opportunity_id_idx" ON "public"."sales_activity" USING "btree" ("opportunity_id", "created_at" DESC);



CREATE INDEX "sales_activity_quotation_id_idx" ON "public"."sales_activity" USING "btree" ("quotation_id", "created_at" DESC);



CREATE INDEX "sales_lead_attributions_campaign_idx" ON "public"."sales_lead_attributions" USING "btree" ("campaign_id");



CREATE INDEX "sales_lead_attributions_source_idx" ON "public"."sales_lead_attributions" USING "btree" ("source");



CREATE INDEX "sales_lead_attributions_utm_campaign_idx" ON "public"."sales_lead_attributions" USING "btree" ("utm_campaign") WHERE ("utm_campaign" IS NOT NULL);



CREATE INDEX "sales_lead_metadata_assigned_to_idx" ON "public"."sales_lead_metadata" USING "btree" ("assigned_to");



CREATE INDEX "sales_lead_metadata_created_at_idx" ON "public"."sales_lead_metadata" USING "btree" ("created_at" DESC);



CREATE INDEX "sales_lead_metadata_follow_up_at_idx" ON "public"."sales_lead_metadata" USING "btree" ("follow_up_at");



CREATE INDEX "sales_lead_metadata_is_test_idx" ON "public"."sales_lead_metadata" USING "btree" ("is_test");



CREATE INDEX "sales_lead_metadata_qualification_status_updated_at_idx" ON "public"."sales_lead_metadata" USING "btree" ("qualification_status", "updated_at" DESC);



CREATE INDEX "sales_lead_metadata_status_idx" ON "public"."sales_lead_metadata" USING "btree" ("status");



CREATE INDEX "sales_lead_metadata_temperature_follow_up_at_idx" ON "public"."sales_lead_metadata" USING "btree" ("temperature", "follow_up_at");



CREATE INDEX "sales_opportunities_assigned_to_idx" ON "public"."sales_opportunities" USING "btree" ("assigned_to");



CREATE INDEX "sales_opportunities_company_id_idx" ON "public"."sales_opportunities" USING "btree" ("company_id") WHERE ("company_id" IS NOT NULL);



CREATE INDEX "sales_opportunities_created_at_idx" ON "public"."sales_opportunities" USING "btree" ("created_at" DESC);



CREATE INDEX "sales_opportunities_is_test_idx" ON "public"."sales_opportunities" USING "btree" ("is_test");



CREATE INDEX "sales_opportunities_stage_idx" ON "public"."sales_opportunities" USING "btree" ("stage");



CREATE INDEX "sales_quotation_items_course_id_idx" ON "public"."sales_quotation_items" USING "btree" ("course_id");



CREATE INDEX "sales_quotation_items_quotation_id_idx" ON "public"."sales_quotation_items" USING "btree" ("quotation_id", "sort_order");



CREATE INDEX "sales_quotations_is_test_idx" ON "public"."sales_quotations" USING "btree" ("is_test");



CREATE UNIQUE INDEX "sales_quotations_one_accepted_per_opportunity_uidx" ON "public"."sales_quotations" USING "btree" ("opportunity_id") WHERE ("status" = 'accepted'::"text");



CREATE INDEX "sales_quotations_opportunity_id_idx" ON "public"."sales_quotations" USING "btree" ("opportunity_id");



CREATE INDEX "sales_quotations_parent_idx" ON "public"."sales_quotations" USING "btree" ("parent_quotation_id");



CREATE INDEX "sales_quotations_status_idx" ON "public"."sales_quotations" USING "btree" ("status");



CREATE INDEX "sales_tasks_assigned_to_idx" ON "public"."sales_tasks" USING "btree" ("assigned_to") WHERE ("deleted_at" IS NULL);



CREATE INDEX "sales_tasks_due_at_idx" ON "public"."sales_tasks" USING "btree" ("due_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "sales_tasks_lead_metadata_id_idx" ON "public"."sales_tasks" USING "btree" ("lead_metadata_id") WHERE ("lead_metadata_id" IS NOT NULL);



CREATE INDEX "sales_tasks_opportunity_id_idx" ON "public"."sales_tasks" USING "btree" ("opportunity_id") WHERE ("opportunity_id" IS NOT NULL);



CREATE INDEX "sales_tasks_quotation_id_idx" ON "public"."sales_tasks" USING "btree" ("quotation_id") WHERE ("quotation_id" IS NOT NULL);



CREATE INDEX "sales_tasks_status_idx" ON "public"."sales_tasks" USING "btree" ("status") WHERE ("deleted_at" IS NULL);



CREATE INDEX "schedule_assessors_assessor_idx" ON "public"."schedule_assessors" USING "btree" ("assessor_id");



CREATE UNIQUE INDEX "schedule_assessors_one_primary_idx" ON "public"."schedule_assessors" USING "btree" ("schedule_id") WHERE "is_primary";



CREATE UNIQUE INDEX "schedule_assessors_schedule_assessor_unique" ON "public"."schedule_assessors" USING "btree" ("schedule_id", "assessor_id");



CREATE INDEX "schedule_assessors_schedule_idx" ON "public"."schedule_assessors" USING "btree" ("schedule_id");



CREATE UNIQUE INDEX "schedule_groups_active_name_unique" ON "public"."schedule_groups" USING "btree" ("schedule_id", "lower"("name")) WHERE ("deleted_at" IS NULL);



CREATE UNIQUE INDEX "schedule_participants_active_unique" ON "public"."schedule_participants" USING "btree" ("schedule_id", "participant_id") WHERE (("deleted_at" IS NULL) AND ("registration_status" <> 'cancelled'::"text"));



CREATE INDEX "schedule_participants_legacy_batch_idx" ON "public"."schedule_participants" USING "btree" ("legacy_batch_id") WHERE ("legacy_batch_id" IS NOT NULL);



CREATE INDEX "schedule_participants_participant_idx" ON "public"."schedule_participants" USING "btree" ("participant_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "schedule_participants_schedule_idx" ON "public"."schedule_participants" USING "btree" ("schedule_id") WHERE ("deleted_at" IS NULL);



CREATE INDEX "staff_module_access_module_idx" ON "public"."staff_module_access" USING "btree" ("module_key");



CREATE UNIQUE INDEX "trainers_active_email_unique" ON "public"."trainers" USING "btree" ("lower"("email")) WHERE (("deleted_at" IS NULL) AND ("email" IS NOT NULL));



CREATE UNIQUE INDEX "trainers_active_ic_unique" ON "public"."trainers" USING "btree" ("lower"("ic_passport_no")) WHERE (("deleted_at" IS NULL) AND ("ic_passport_no" IS NOT NULL));



CREATE UNIQUE INDEX "trainers_active_staff_unique" ON "public"."trainers" USING "btree" ("lower"("staff_no")) WHERE (("deleted_at" IS NULL) AND ("staff_no" IS NOT NULL));



CREATE UNIQUE INDEX "trainers_trainer_id_unique" ON "public"."trainers" USING "btree" ("trainer_id");



CREATE UNIQUE INDEX "uq_certificates_number" ON "public"."certificates" USING "btree" ("certificate_number") WHERE ("certificate_number" IS NOT NULL);



CREATE UNIQUE INDEX "uq_certificates_verification_token" ON "public"."certificates" USING "btree" ("verification_token") WHERE ("verification_token" IS NOT NULL);



CREATE UNIQUE INDEX "uq_participants_participant_id" ON "public"."participants" USING "btree" ("participant_id");



CREATE OR REPLACE TRIGGER "certificates_set_updated_at" BEFORE UPDATE ON "public"."certificates" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "courses_set_updated_at" BEFORE UPDATE ON "public"."courses" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "participants_set_updated_at" BEFORE UPDATE ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "participants_sync_last4" BEFORE INSERT OR UPDATE OF "identity_no", "identity_last4" ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "public"."sync_participant_last4"();



CREATE OR REPLACE TRIGGER "trg_assessments_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."assessments" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_assessments_updated_at" BEFORE UPDATE ON "public"."assessments" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_assessors_stamp" BEFORE INSERT OR UPDATE ON "public"."assessors" FOR EACH ROW EXECUTE FUNCTION "app"."stamp_actor"();



CREATE OR REPLACE TRIGGER "trg_assessors_updated_at" BEFORE UPDATE ON "public"."assessors" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_attendance_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."attendance" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_attendance_sync_present" BEFORE INSERT OR UPDATE ON "public"."attendance" FOR EACH ROW EXECUTE FUNCTION "app"."sync_attendance_present"();



CREATE OR REPLACE TRIGGER "trg_attendance_updated_at" BEFORE UPDATE ON "public"."attendance" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_cert_templates_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."certificate_templates" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_cert_templates_updated_at" BEFORE UPDATE ON "public"."certificate_templates" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_certificate_skill_results_audit" AFTER INSERT ON "public"."certificate_skill_results" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_certificates_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."certificates" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_certificates_before_insert" BEFORE INSERT ON "public"."certificates" FOR EACH ROW EXECUTE FUNCTION "app"."certificates_before_insert"();



CREATE OR REPLACE TRIGGER "trg_certificates_updated_at" BEFORE UPDATE ON "public"."certificates" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_companies_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_companies_stamp" BEFORE INSERT OR UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "app"."stamp_actor"();



CREATE OR REPLACE TRIGGER "trg_companies_updated_at" BEFORE UPDATE ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_company_id" BEFORE INSERT ON "public"."companies" FOR EACH ROW EXECUTE FUNCTION "app"."gen_company_id"();



CREATE OR REPLACE TRIGGER "trg_course_schedules_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."course_schedules" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_course_schedules_code" BEFORE INSERT ON "public"."course_schedules" FOR EACH ROW EXECUTE FUNCTION "app"."gen_schedule_code"();



CREATE OR REPLACE TRIGGER "trg_course_schedules_updated_at" BEFORE UPDATE ON "public"."course_schedules" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_enforce_invoice_financial_immutability" BEFORE UPDATE ON "public"."invoices" FOR EACH ROW EXECUTE FUNCTION "app"."enforce_invoice_financial_immutability"();



CREATE OR REPLACE TRIGGER "trg_enforce_invoice_items_immutable" BEFORE INSERT OR DELETE OR UPDATE ON "public"."invoice_items" FOR EACH ROW EXECUTE FUNCTION "app"."enforce_invoice_items_immutable"();



CREATE OR REPLACE TRIGGER "trg_enforce_toyyibpay_attempt_transition" BEFORE UPDATE ON "public"."invoice_payments" FOR EACH ROW EXECUTE FUNCTION "app"."enforce_toyyibpay_attempt_transition"();



CREATE OR REPLACE TRIGGER "trg_enquiries_create_sales_lead" AFTER INSERT ON "public"."enquiries" FOR EACH ROW EXECUTE FUNCTION "app"."create_sales_lead_metadata"();



CREATE OR REPLACE TRIGGER "trg_feedback_actions_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."feedback_improvement_actions" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_feedback_actions_stamp" BEFORE INSERT OR UPDATE ON "public"."feedback_improvement_actions" FOR EACH ROW EXECUTE FUNCTION "app"."stamp_actor"();



CREATE OR REPLACE TRIGGER "trg_feedback_actions_transition_guard" BEFORE UPDATE ON "public"."feedback_improvement_actions" FOR EACH ROW EXECUTE FUNCTION "app"."feedback_action_transition_guard"();



CREATE OR REPLACE TRIGGER "trg_feedback_actions_updated_at" BEFORE UPDATE ON "public"."feedback_improvement_actions" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_feedback_issues_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."feedback_issues" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_feedback_issues_stamp" BEFORE INSERT OR UPDATE ON "public"."feedback_issues" FOR EACH ROW EXECUTE FUNCTION "app"."stamp_actor"();



CREATE OR REPLACE TRIGGER "trg_feedback_issues_transition_guard" BEFORE UPDATE ON "public"."feedback_issues" FOR EACH ROW EXECUTE FUNCTION "app"."feedback_issue_transition_guard"();



CREATE OR REPLACE TRIGGER "trg_feedback_issues_updated_at" BEFORE UPDATE ON "public"."feedback_issues" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_guard_quotation_commercial_snapshot" BEFORE UPDATE ON "public"."sales_quotations" FOR EACH ROW EXECUTE FUNCTION "app"."guard_quotation_commercial_snapshot_mutation"();



CREATE OR REPLACE TRIGGER "trg_guard_quotation_item_commercial_snapshot" BEFORE UPDATE ON "public"."sales_quotation_items" FOR EACH ROW EXECUTE FUNCTION "app"."guard_quotation_commercial_snapshot_mutation"();



CREATE OR REPLACE TRIGGER "trg_guard_sales_opportunity_revenue_mutation" BEFORE INSERT OR UPDATE ON "public"."sales_opportunities" FOR EACH ROW EXECUTE FUNCTION "app"."guard_sales_revenue_mutation"();



CREATE OR REPLACE TRIGGER "trg_guard_sales_quotation_revenue_mutation" BEFORE INSERT OR UPDATE ON "public"."sales_quotations" FOR EACH ROW EXECUTE FUNCTION "app"."guard_sales_revenue_mutation"();



CREATE OR REPLACE TRIGGER "trg_lead_is_test_propagate" AFTER UPDATE OF "is_test" ON "public"."sales_lead_metadata" FOR EACH ROW EXECUTE FUNCTION "app"."propagate_lead_is_test"();



CREATE OR REPLACE TRIGGER "trg_legacy_course_map_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."legacy_course_map" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_legacy_course_map_updated_at" BEFORE UPDATE ON "public"."legacy_course_map" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_legacy_import_batches_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."legacy_import_batches" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_legacy_import_batches_updated_at" BEFORE UPDATE ON "public"."legacy_import_batches" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_legacy_participant_staging_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."legacy_participant_staging" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_legacy_participant_staging_updated_at" BEFORE UPDATE ON "public"."legacy_participant_staging" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_marketing_campaigns_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."marketing_campaigns" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_marketing_campaigns_updated_at" BEFORE UPDATE ON "public"."marketing_campaigns" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_marketing_contacts_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."marketing_contacts" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_marketing_contacts_stamp" BEFORE INSERT OR UPDATE ON "public"."marketing_contacts" FOR EACH ROW EXECUTE FUNCTION "app"."stamp_actor"();



CREATE OR REPLACE TRIGGER "trg_marketing_contacts_updated_at" BEFORE UPDATE ON "public"."marketing_contacts" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_opportunity_is_test_default" BEFORE INSERT ON "public"."sales_opportunities" FOR EACH ROW EXECUTE FUNCTION "app"."sync_opportunity_is_test"();



CREATE OR REPLACE TRIGGER "trg_opportunity_is_test_propagate" AFTER UPDATE OF "is_test" ON "public"."sales_opportunities" FOR EACH ROW EXECUTE FUNCTION "app"."propagate_opportunity_is_test"();



CREATE OR REPLACE TRIGGER "trg_participant_feedback_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."participant_feedback" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_participant_feedback_updated_at" BEFORE UPDATE ON "public"."participant_feedback" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_participant_id" BEFORE INSERT ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "app"."gen_participant_id"();



CREATE OR REPLACE TRIGGER "trg_participant_skill_results_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."participant_skill_results" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_participant_skill_results_updated_at" BEFORE UPDATE ON "public"."participant_skill_results" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_participants_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_participants_updated_at" BEFORE UPDATE ON "public"."participants" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_photo_ai_analysis_updated_at" BEFORE UPDATE ON "public"."photo_ai_analysis" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_photo_events_updated_at" BEFORE UPDATE ON "public"."photo_events" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_photos_updated_at" BEFORE UPDATE ON "public"."photos" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profiles_protect_last_super_admin" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "app"."protect_last_super_admin"();



CREATE OR REPLACE TRIGGER "trg_profiles_staff_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "app"."audit_staff_change"();



CREATE OR REPLACE TRIGGER "trg_proposal_requests_create_sales_lead" AFTER INSERT ON "public"."proposal_requests" FOR EACH ROW EXECUTE FUNCTION "app"."create_sales_lead_metadata"();



CREATE OR REPLACE TRIGGER "trg_public_registration_attendees_updated_at" BEFORE UPDATE ON "public"."public_registration_attendees" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_public_registration_payment_state_guard" BEFORE UPDATE ON "public"."public_registration_payments" FOR EACH ROW EXECUTE FUNCTION "app"."public_registration_payment_state_guard"();



CREATE OR REPLACE TRIGGER "trg_public_registration_payments_audit" AFTER INSERT OR UPDATE ON "public"."public_registration_payments" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_public_registration_payments_updated_at" BEFORE UPDATE ON "public"."public_registration_payments" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_public_registration_state_guard" BEFORE UPDATE ON "public"."public_registrations" FOR EACH ROW EXECUTE FUNCTION "app"."public_registration_state_guard"();



CREATE OR REPLACE TRIGGER "trg_public_registrations_audit" AFTER INSERT OR UPDATE ON "public"."public_registrations" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_public_registrations_updated_at" BEFORE UPDATE ON "public"."public_registrations" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_quotation_is_test_default" BEFORE INSERT ON "public"."sales_quotations" FOR EACH ROW EXECUTE FUNCTION "app"."sync_quotation_is_test"();



CREATE OR REPLACE TRIGGER "trg_recompute_invoice_balance" AFTER INSERT OR UPDATE OF "status" ON "public"."invoice_payments" FOR EACH ROW EXECUTE FUNCTION "app"."recompute_invoice_balance"();



CREATE OR REPLACE TRIGGER "trg_sales_lead_attributions_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."sales_lead_attributions" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_sales_lead_attributions_updated_at" BEFORE UPDATE ON "public"."sales_lead_attributions" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_sales_tasks_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."sales_tasks" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_sales_tasks_stamp" BEFORE INSERT OR UPDATE ON "public"."sales_tasks" FOR EACH ROW EXECUTE FUNCTION "app"."stamp_actor"();



CREATE OR REPLACE TRIGGER "trg_sales_tasks_updated_at" BEFORE UPDATE ON "public"."sales_tasks" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_schedule_groups_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."schedule_groups" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_schedule_groups_stamp" BEFORE INSERT OR UPDATE ON "public"."schedule_groups" FOR EACH ROW EXECUTE FUNCTION "app"."stamp_actor"();



CREATE OR REPLACE TRIGGER "trg_schedule_groups_updated_at" BEFORE UPDATE ON "public"."schedule_groups" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_schedule_participants_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."schedule_participants" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_schedule_participants_sync_seats" AFTER INSERT OR DELETE OR UPDATE ON "public"."schedule_participants" FOR EACH ROW EXECUTE FUNCTION "app"."sync_schedule_seats"();



CREATE OR REPLACE TRIGGER "trg_schedule_participants_updated_at" BEFORE UPDATE ON "public"."schedule_participants" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_staff_module_access_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."staff_module_access" FOR EACH ROW EXECUTE FUNCTION "app"."audit_staff_change"();



CREATE OR REPLACE TRIGGER "trg_trainers_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."trainers" FOR EACH ROW EXECUTE FUNCTION "app"."audit_trigger"();



CREATE OR REPLACE TRIGGER "trg_trainers_gen_id" BEFORE INSERT ON "public"."trainers" FOR EACH ROW EXECUTE FUNCTION "app"."gen_trainer_id"();



CREATE OR REPLACE TRIGGER "trg_trainers_updated_at" BEFORE UPDATE ON "public"."trainers" FOR EACH ROW EXECUTE FUNCTION "app"."set_updated_at"();



ALTER TABLE ONLY "public"."admin_users"
    ADD CONSTRAINT "admin_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_assessor_id_fkey" FOREIGN KEY ("assessor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_legacy_batch_id_fkey" FOREIGN KEY ("legacy_batch_id") REFERENCES "public"."legacy_import_batches"("id");



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."assessments"
    ADD CONSTRAINT "assessments_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assessors"
    ADD CONSTRAINT "assessors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assessors"
    ADD CONSTRAINT "assessors_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_legacy_batch_id_fkey" FOREIGN KEY ("legacy_batch_id") REFERENCES "public"."legacy_import_batches"("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."certificate_import_logs"
    ADD CONSTRAINT "certificate_import_logs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."certificate_skill_results"
    ADD CONSTRAINT "certificate_skill_results_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."certificate_skill_results"
    ADD CONSTRAINT "certificate_skill_results_source_skill_result_id_fkey" FOREIGN KEY ("source_skill_result_id") REFERENCES "public"."participant_skill_results"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."certificate_templates"
    ADD CONSTRAINT "certificate_templates_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."certificate_templates"
    ADD CONSTRAINT "certificate_templates_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."certificate_verifications"
    ADD CONSTRAINT "certificate_verifications_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_legacy_batch_id_fkey" FOREIGN KEY ("legacy_batch_id") REFERENCES "public"."legacy_import_batches"("id");



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "certificates_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."cms_content"
    ADD CONSTRAINT "cms_content_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."cms_content"
    ADD CONSTRAINT "cms_content_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."cms_media"
    ADD CONSTRAINT "cms_media_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."companies"
    ADD CONSTRAINT "companies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."company_profile"
    ADD CONSTRAINT "company_profile_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."course_commercial_profiles"
    ADD CONSTRAINT "course_commercial_profiles_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."course_commercial_profiles"
    ADD CONSTRAINT "course_commercial_profiles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."course_commercial_profiles"
    ADD CONSTRAINT "course_commercial_profiles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_legacy_batch_id_fkey" FOREIGN KEY ("legacy_batch_id") REFERENCES "public"."legacy_import_batches"("id");



ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_source_opportunity_id_fkey" FOREIGN KEY ("source_opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_source_quotation_id_fkey" FOREIGN KEY ("source_quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."course_schedules"
    ADD CONSTRAINT "course_schedules_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_certificate_template_id_fkey" FOREIGN KEY ("certificate_template_id") REFERENCES "public"."certificate_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."courses"
    ADD CONSTRAINT "courses_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."downloads"
    ADD CONSTRAINT "downloads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."downloads"
    ADD CONSTRAINT "downloads_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."downloads"
    ADD CONSTRAINT "downloads_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."faq_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."faqs"
    ADD CONSTRAINT "faqs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "public"."feedback_issues"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback_improvement_actions"
    ADD CONSTRAINT "feedback_improvement_actions_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."feedback_issues"
    ADD CONSTRAINT "feedback_issues_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."feedback_issues"
    ADD CONSTRAINT "feedback_issues_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback_issues"
    ADD CONSTRAINT "feedback_issues_source_feedback_id_fkey" FOREIGN KEY ("source_feedback_id") REFERENCES "public"."participant_feedback"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback_issues"
    ADD CONSTRAINT "feedback_issues_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."feedback_schedule_links"
    ADD CONSTRAINT "feedback_schedule_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."feedback_schedule_links"
    ADD CONSTRAINT "feedback_schedule_links_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedback_schedule_lookup_attempts"
    ADD CONSTRAINT "feedback_schedule_lookup_attempts_schedule_link_id_fkey" FOREIGN KEY ("schedule_link_id") REFERENCES "public"."feedback_schedule_links"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."certificates"
    ADD CONSTRAINT "fk_certificates_template" FOREIGN KEY ("template_id") REFERENCES "public"."certificate_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."gallery_images"
    ADD CONSTRAINT "gallery_images_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."gallery_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."gallery_images"
    ADD CONSTRAINT "gallery_images_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."gallery_images"
    ADD CONSTRAINT "gallery_images_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."gallery_images"
    ADD CONSTRAINT "gallery_images_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invoice_items"
    ADD CONSTRAINT "invoice_items_source_quotation_item_id_fkey" FOREIGN KEY ("source_quotation_item_id") REFERENCES "public"."sales_quotation_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."invoice_payments"
    ADD CONSTRAINT "invoice_payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id");



ALTER TABLE ONLY "public"."invoices"
    ADD CONSTRAINT "invoices_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."legacy_course_map"
    ADD CONSTRAINT "legacy_course_map_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id");



ALTER TABLE ONLY "public"."legacy_course_map"
    ADD CONSTRAINT "legacy_course_map_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."legacy_import_batches"
    ADD CONSTRAINT "legacy_import_batches_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."legacy_participant_staging"
    ADD CONSTRAINT "legacy_participant_staging_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."legacy_import_batches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."legacy_participant_staging"
    ADD CONSTRAINT "legacy_participant_staging_mapped_course_id_fkey" FOREIGN KEY ("mapped_course_id") REFERENCES "public"."courses"("id");



ALTER TABLE ONLY "public"."legacy_participant_staging"
    ADD CONSTRAINT "legacy_participant_staging_matched_participant_id_fkey" FOREIGN KEY ("matched_participant_id") REFERENCES "public"."participants"("id");



ALTER TABLE ONLY "public"."legacy_participant_staging"
    ADD CONSTRAINT "legacy_participant_staging_result_certificate_id_fkey" FOREIGN KEY ("result_certificate_id") REFERENCES "public"."certificates"("id");



ALTER TABLE ONLY "public"."legacy_participant_staging"
    ADD CONSTRAINT "legacy_participant_staging_result_enrollment_id_fkey" FOREIGN KEY ("result_enrollment_id") REFERENCES "public"."schedule_participants"("id");



ALTER TABLE ONLY "public"."legacy_participant_staging"
    ADD CONSTRAINT "legacy_participant_staging_result_participant_id_fkey" FOREIGN KEY ("result_participant_id") REFERENCES "public"."participants"("id");



ALTER TABLE ONLY "public"."legacy_participant_staging"
    ADD CONSTRAINT "legacy_participant_staging_result_schedule_id_fkey" FOREIGN KEY ("result_schedule_id") REFERENCES "public"."course_schedules"("id");



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id");



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."marketing_contact_events"
    ADD CONSTRAINT "marketing_contact_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."marketing_contact_events"
    ADD CONSTRAINT "marketing_contact_events_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id");



ALTER TABLE ONLY "public"."marketing_contact_events"
    ADD CONSTRAINT "marketing_contact_events_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."marketing_contacts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."marketing_contact_events"
    ADD CONSTRAINT "marketing_contact_events_lead_metadata_id_fkey" FOREIGN KEY ("lead_metadata_id") REFERENCES "public"."sales_lead_metadata"("id");



ALTER TABLE ONLY "public"."marketing_contacts"
    ADD CONSTRAINT "marketing_contacts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."marketing_contacts"
    ADD CONSTRAINT "marketing_contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."marketing_contacts"
    ADD CONSTRAINT "marketing_contacts_promoted_lead_metadata_id_fkey" FOREIGN KEY ("promoted_lead_metadata_id") REFERENCES "public"."sales_lead_metadata"("id");



ALTER TABLE ONLY "public"."marketing_contacts"
    ADD CONSTRAINT "marketing_contacts_source_campaign_id_fkey" FOREIGN KEY ("source_campaign_id") REFERENCES "public"."marketing_campaigns"("id");



ALTER TABLE ONLY "public"."marketing_contacts"
    ADD CONSTRAINT "marketing_contacts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."media"
    ADD CONSTRAINT "media_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."media"
    ADD CONSTRAINT "media_folder_id_fkey" FOREIGN KEY ("folder_id") REFERENCES "public"."media_folders"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."media_folders"
    ADD CONSTRAINT "media_folders_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."media_folders"
    ADD CONSTRAINT "media_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."media_folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."news_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."news_posts"
    ADD CONSTRAINT "news_posts_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."participant_feedback"
    ADD CONSTRAINT "participant_feedback_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."participant_feedback"
    ADD CONSTRAINT "participant_feedback_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_assessed_by_fkey" FOREIGN KEY ("assessed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_locked_by_fkey" FOREIGN KEY ("locked_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."participant_skill_results"
    ADD CONSTRAINT "participant_skill_results_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_legacy_batch_id_fkey" FOREIGN KEY ("legacy_batch_id") REFERENCES "public"."legacy_import_batches"("id");



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."participants"
    ADD CONSTRAINT "participants_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."photo_activity_log"
    ADD CONSTRAINT "photo_activity_log_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."photo_ai_analysis"
    ADD CONSTRAINT "photo_ai_analysis_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photo_usages"
    ADD CONSTRAINT "photo_usages_photo_id_fkey" FOREIGN KEY ("photo_id") REFERENCES "public"."photos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photo_usages"
    ADD CONSTRAINT "photo_usages_usage_type_fkey" FOREIGN KEY ("usage_type") REFERENCES "public"."photo_usage_types"("key") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_category_fk" FOREIGN KEY ("category") REFERENCES "public"."photo_categories"("key") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."photo_events"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."proposal_requests"
    ADD CONSTRAINT "proposal_requests_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."public_registration_attendees"
    ADD CONSTRAINT "public_registration_attendees_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."public_registration_attendees"
    ADD CONSTRAINT "public_registration_attendees_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "public"."public_registrations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."public_registration_payments"
    ADD CONSTRAINT "public_registration_payments_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "public"."public_registrations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."public_registrations"
    ADD CONSTRAINT "public_registrations_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."public_registrations"
    ADD CONSTRAINT "public_registrations_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."sales_activity"
    ADD CONSTRAINT "sales_activity_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sales_activity"
    ADD CONSTRAINT "sales_activity_lead_metadata_id_fkey" FOREIGN KEY ("lead_metadata_id") REFERENCES "public"."sales_lead_metadata"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_activity"
    ADD CONSTRAINT "sales_activity_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id");



ALTER TABLE ONLY "public"."sales_activity"
    ADD CONSTRAINT "sales_activity_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id");



ALTER TABLE ONLY "public"."sales_lead_attributions"
    ADD CONSTRAINT "sales_lead_attributions_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_lead_attributions"
    ADD CONSTRAINT "sales_lead_attributions_lead_metadata_id_fkey" FOREIGN KEY ("lead_metadata_id") REFERENCES "public"."sales_lead_metadata"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_lead_metadata"
    ADD CONSTRAINT "sales_lead_metadata_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sales_lead_metadata"
    ADD CONSTRAINT "sales_lead_metadata_qualification_changed_by_fkey" FOREIGN KEY ("qualification_changed_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sales_opportunities"
    ADD CONSTRAINT "sales_opportunities_lead_metadata_id_fkey" FOREIGN KEY ("lead_metadata_id") REFERENCES "public"."sales_lead_metadata"("id");



ALTER TABLE ONLY "public"."sales_quotation_items"
    ADD CONSTRAINT "sales_quotation_items_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_quotation_items"
    ADD CONSTRAINT "sales_quotation_items_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."sales_quotations"
    ADD CONSTRAINT "sales_quotations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."sales_quotations"
    ADD CONSTRAINT "sales_quotations_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id");



ALTER TABLE ONLY "public"."sales_quotations"
    ADD CONSTRAINT "sales_quotations_parent_quotation_id_fkey" FOREIGN KEY ("parent_quotation_id") REFERENCES "public"."sales_quotations"("id");



ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_lead_metadata_id_fkey" FOREIGN KEY ("lead_metadata_id") REFERENCES "public"."sales_lead_metadata"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."sales_opportunities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."sales_tasks"
    ADD CONSTRAINT "sales_tasks_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "public"."sales_quotations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_assessors"
    ADD CONSTRAINT "schedule_assessors_assessor_id_fkey" FOREIGN KEY ("assessor_id") REFERENCES "public"."assessors"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_assessors"
    ADD CONSTRAINT "schedule_assessors_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_assessors"
    ADD CONSTRAINT "schedule_assessors_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_groups"
    ADD CONSTRAINT "schedule_groups_assessor_id_fkey" FOREIGN KEY ("assessor_id") REFERENCES "public"."assessors"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_groups"
    ADD CONSTRAINT "schedule_groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_groups"
    ADD CONSTRAINT "schedule_groups_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_groups"
    ADD CONSTRAINT "schedule_groups_trainer_id_fkey" FOREIGN KEY ("trainer_id") REFERENCES "public"."trainers"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_groups"
    ADD CONSTRAINT "schedule_groups_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedule_participants"
    ADD CONSTRAINT "schedule_participants_group_same_schedule_fkey" FOREIGN KEY ("schedule_group_id", "schedule_id") REFERENCES "public"."schedule_groups"("id", "schedule_id");



ALTER TABLE ONLY "public"."schedule_participants"
    ADD CONSTRAINT "schedule_participants_legacy_batch_id_fkey" FOREIGN KEY ("legacy_batch_id") REFERENCES "public"."legacy_import_batches"("id");



ALTER TABLE ONLY "public"."schedule_participants"
    ADD CONSTRAINT "schedule_participants_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedule_participants"
    ADD CONSTRAINT "schedule_participants_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."course_schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."staff_module_access"
    ADD CONSTRAINT "staff_module_access_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staff_module_access"
    ADD CONSTRAINT "staff_module_access_module_key_fkey" FOREIGN KEY ("module_key") REFERENCES "public"."staff_module_catalog"("module_key");



ALTER TABLE ONLY "public"."staff_module_access"
    ADD CONSTRAINT "staff_module_access_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."staff_module_access"
    ADD CONSTRAINT "staff_module_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



CREATE POLICY "Admins can create import logs" ON "public"."certificate_import_logs" FOR INSERT TO "authenticated" WITH CHECK ((("created_by" = "auth"."uid"()) AND "app"."is_admin"()));



CREATE POLICY "Admins can read admin membership" ON "public"."admin_users" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "Admins can read import logs" ON "public"."certificate_import_logs" FOR SELECT TO "authenticated" USING ("app"."is_admin"());



CREATE POLICY "No direct client access to rate limits" ON "public"."public_rate_limits" TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."admin_users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assessments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assessments_delete" ON "public"."assessments" FOR DELETE TO "authenticated" USING ("app"."is_admin"());



CREATE POLICY "assessments_insert" ON "public"."assessments" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin_or_trainer"());



CREATE POLICY "assessments_select" ON "public"."assessments" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));



CREATE POLICY "assessments_update" ON "public"."assessments" FOR UPDATE TO "authenticated" USING ("app"."is_admin_or_trainer"()) WITH CHECK ("app"."is_admin_or_trainer"());



ALTER TABLE "public"."assessors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assessors_insert" ON "public"."assessors" FOR INSERT TO "authenticated" WITH CHECK ("app"."can_manage_assessors"());



CREATE POLICY "assessors_read" ON "public"."assessors" FOR SELECT TO "authenticated" USING ("app"."is_active"());



CREATE POLICY "assessors_update" ON "public"."assessors" FOR UPDATE TO "authenticated" USING ("app"."can_manage_assessors"()) WITH CHECK ("app"."can_manage_assessors"());



ALTER TABLE "public"."attendance" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attendance_delete" ON "public"."attendance" FOR DELETE TO "authenticated" USING ("app"."is_admin_or_trainer"());



CREATE POLICY "attendance_insert" ON "public"."attendance" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin_or_trainer"());



CREATE POLICY "attendance_select" ON "public"."attendance" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));



CREATE POLICY "attendance_update" ON "public"."attendance" FOR UPDATE TO "authenticated" USING ("app"."is_admin_or_trainer"()) WITH CHECK ("app"."is_admin_or_trainer"());



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_staff_read" ON "public"."audit_logs" FOR SELECT USING ("app"."is_admin"());



CREATE POLICY "cert_templates_admin_write" ON "public"."certificate_templates" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



CREATE POLICY "cert_templates_view" ON "public"."certificate_templates" FOR SELECT USING (("app"."is_editor"() OR ("app"."current_role"() = 'trainer'::"public"."user_role")));



CREATE POLICY "cert_verif_staff_read" ON "public"."certificate_verifications" FOR SELECT USING (("app"."is_editor"() OR ("app"."current_role"() = 'trainer'::"public"."user_role")));



ALTER TABLE "public"."certificate_import_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."certificate_skill_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "certificate_skill_results_insert" ON "public"."certificate_skill_results" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());



CREATE POLICY "certificate_skill_results_select" ON "public"."certificate_skill_results" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));



ALTER TABLE "public"."certificate_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."certificate_verifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."certificates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "certificates_delete" ON "public"."certificates" FOR DELETE TO "authenticated" USING ("app"."is_admin"());



CREATE POLICY "certificates_insert" ON "public"."certificates" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());



CREATE POLICY "certificates_select" ON "public"."certificates" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));



CREATE POLICY "certificates_update" ON "public"."certificates" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



ALTER TABLE "public"."cms_content" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cms_content_staff_all" ON "public"."cms_content" TO "authenticated" USING (( SELECT "app"."is_editor"() AS "is_editor")) WITH CHECK (( SELECT "app"."is_editor"() AS "is_editor"));



ALTER TABLE "public"."cms_media" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cms_media_staff_all" ON "public"."cms_media" TO "authenticated" USING (( SELECT "app"."is_editor"() AS "is_editor")) WITH CHECK (( SELECT "app"."is_editor"() AS "is_editor"));



ALTER TABLE "public"."companies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "companies_admin_delete" ON "public"."companies" FOR DELETE USING ("app"."is_admin"());



CREATE POLICY "companies_admin_insert" ON "public"."companies" FOR INSERT WITH CHECK ("app"."is_admin"());



CREATE POLICY "companies_admin_update" ON "public"."companies" FOR UPDATE USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



CREATE POLICY "companies_staff_read" ON "public"."companies" FOR SELECT USING ("app"."is_editor"());



ALTER TABLE "public"."company_profile" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_profile_editor_insert" ON "public"."company_profile" FOR INSERT WITH CHECK ("app"."is_editor"());



CREATE POLICY "company_profile_editor_update" ON "public"."company_profile" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());



CREATE POLICY "company_profile_public_read" ON "public"."company_profile" FOR SELECT USING (true);



ALTER TABLE "public"."course_commercial_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "course_commercial_profiles_delete" ON "public"."course_commercial_profiles" FOR DELETE TO "authenticated" USING ("app"."is_admin"());



CREATE POLICY "course_commercial_profiles_insert" ON "public"."course_commercial_profiles" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());



CREATE POLICY "course_commercial_profiles_select" ON "public"."course_commercial_profiles" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "course_commercial_profiles_update" ON "public"."course_commercial_profiles" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



ALTER TABLE "public"."course_schedules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "course_schedules_delete" ON "public"."course_schedules" FOR DELETE TO "authenticated" USING ("app"."is_admin"());



CREATE POLICY "course_schedules_insert" ON "public"."course_schedules" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());



CREATE POLICY "course_schedules_select" ON "public"."course_schedules" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));



CREATE POLICY "course_schedules_update" ON "public"."course_schedules" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



ALTER TABLE "public"."courses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "courses_delete" ON "public"."courses" FOR DELETE TO "authenticated" USING ("app"."is_admin"());



CREATE POLICY "courses_insert" ON "public"."courses" FOR INSERT TO "authenticated" WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "courses_select" ON "public"."courses" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "courses_update" ON "public"."courses" FOR UPDATE TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role")) WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



ALTER TABLE "public"."downloads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "downloads_admin_delete" ON "public"."downloads" FOR DELETE USING ("app"."is_admin"());



CREATE POLICY "downloads_editor_insert" ON "public"."downloads" FOR INSERT WITH CHECK ("app"."is_editor"());



CREATE POLICY "downloads_editor_read" ON "public"."downloads" FOR SELECT USING ("app"."is_editor"());



CREATE POLICY "downloads_editor_update" ON "public"."downloads" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());



CREATE POLICY "downloads_public_read" ON "public"."downloads" FOR SELECT USING ((("status" = 'published'::"public"."content_status") AND ("deleted_at" IS NULL)));



ALTER TABLE "public"."enquiries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "enquiries_select" ON "public"."enquiries" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



ALTER TABLE "public"."faq_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "faq_categories_editor_all" ON "public"."faq_categories" USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());



ALTER TABLE "public"."faqs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "faqs_admin_delete" ON "public"."faqs" FOR DELETE USING ("app"."is_admin"());



CREATE POLICY "faqs_editor_insert" ON "public"."faqs" FOR INSERT WITH CHECK ("app"."is_editor"());



CREATE POLICY "faqs_editor_read" ON "public"."faqs" FOR SELECT USING ("app"."is_editor"());



CREATE POLICY "faqs_editor_update" ON "public"."faqs" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());



CREATE POLICY "faqs_public_read" ON "public"."faqs" FOR SELECT USING ((("status" = 'published'::"public"."content_status") AND ("deleted_at" IS NULL)));



ALTER TABLE "public"."feedback_improvement_actions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_improvement_actions_staff_insert" ON "public"."feedback_improvement_actions" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));



CREATE POLICY "feedback_improvement_actions_staff_select" ON "public"."feedback_improvement_actions" FOR SELECT TO "authenticated" USING (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));



CREATE POLICY "feedback_improvement_actions_staff_update" ON "public"."feedback_improvement_actions" FOR UPDATE TO "authenticated" USING (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role")) WITH CHECK (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));



ALTER TABLE "public"."feedback_issues" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedback_issues_staff_insert" ON "public"."feedback_issues" FOR INSERT TO "authenticated" WITH CHECK (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));



CREATE POLICY "feedback_issues_staff_select" ON "public"."feedback_issues" FOR SELECT TO "authenticated" USING (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));



CREATE POLICY "feedback_issues_staff_update" ON "public"."feedback_issues" FOR UPDATE TO "authenticated" USING (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role")) WITH CHECK (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));



ALTER TABLE "public"."feedback_schedule_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feedback_schedule_lookup_attempts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gallery_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gallery_categories_editor_all" ON "public"."gallery_categories" USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());



ALTER TABLE "public"."gallery_images" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gallery_images_admin_delete" ON "public"."gallery_images" FOR DELETE USING ("app"."is_admin"());



CREATE POLICY "gallery_images_editor_insert" ON "public"."gallery_images" FOR INSERT WITH CHECK ("app"."is_editor"());



CREATE POLICY "gallery_images_editor_read" ON "public"."gallery_images" FOR SELECT USING ("app"."is_editor"());



CREATE POLICY "gallery_images_editor_update" ON "public"."gallery_images" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());



CREATE POLICY "gallery_images_public_read" ON "public"."gallery_images" FOR SELECT USING ((("status" = 'published'::"public"."content_status") AND ("deleted_at" IS NULL)));



ALTER TABLE "public"."invoice_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_items_select" ON "public"."invoice_items" FOR SELECT USING ("app"."has_min_role"('editor'::"public"."user_role"));



ALTER TABLE "public"."invoice_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoice_payments_select" ON "public"."invoice_payments" FOR SELECT USING ("app"."has_min_role"('editor'::"public"."user_role"));



ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invoices_select" ON "public"."invoices" FOR SELECT USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "invoices_update" ON "public"."invoices" FOR UPDATE USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



ALTER TABLE "public"."legacy_course_map" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "legacy_course_map_delete" ON "public"."legacy_course_map" FOR DELETE USING ("app"."is_admin"());



CREATE POLICY "legacy_course_map_insert" ON "public"."legacy_course_map" FOR INSERT WITH CHECK ("app"."is_admin"());



CREATE POLICY "legacy_course_map_select" ON "public"."legacy_course_map" FOR SELECT USING ("app"."is_admin"());



CREATE POLICY "legacy_course_map_update" ON "public"."legacy_course_map" FOR UPDATE USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



ALTER TABLE "public"."legacy_import_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "legacy_import_batches_delete" ON "public"."legacy_import_batches" FOR DELETE USING ("app"."is_admin"());



CREATE POLICY "legacy_import_batches_insert" ON "public"."legacy_import_batches" FOR INSERT WITH CHECK ("app"."is_admin"());



CREATE POLICY "legacy_import_batches_select" ON "public"."legacy_import_batches" FOR SELECT USING ("app"."is_admin"());



CREATE POLICY "legacy_import_batches_update" ON "public"."legacy_import_batches" FOR UPDATE USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



ALTER TABLE "public"."legacy_participant_staging" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "legacy_participant_staging_delete" ON "public"."legacy_participant_staging" FOR DELETE USING ("app"."is_admin"());



CREATE POLICY "legacy_participant_staging_insert" ON "public"."legacy_participant_staging" FOR INSERT WITH CHECK ("app"."is_admin"());



CREATE POLICY "legacy_participant_staging_select" ON "public"."legacy_participant_staging" FOR SELECT USING ("app"."is_admin"());



CREATE POLICY "legacy_participant_staging_update" ON "public"."legacy_participant_staging" FOR UPDATE USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



ALTER TABLE "public"."marketing_campaigns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "marketing_campaigns_insert" ON "public"."marketing_campaigns" FOR INSERT TO "authenticated" WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "marketing_campaigns_select" ON "public"."marketing_campaigns" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "marketing_campaigns_update" ON "public"."marketing_campaigns" FOR UPDATE TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role")) WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



ALTER TABLE "public"."marketing_contact_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "marketing_contact_events_insert" ON "public"."marketing_contact_events" FOR INSERT TO "authenticated" WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "marketing_contact_events_select" ON "public"."marketing_contact_events" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



ALTER TABLE "public"."marketing_contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "marketing_contacts_insert" ON "public"."marketing_contacts" FOR INSERT TO "authenticated" WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "marketing_contacts_select" ON "public"."marketing_contacts" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "marketing_contacts_update" ON "public"."marketing_contacts" FOR UPDATE TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role")) WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



ALTER TABLE "public"."media" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "media_admin_delete" ON "public"."media" FOR DELETE USING ("app"."is_admin"());



CREATE POLICY "media_editor_insert" ON "public"."media" FOR INSERT WITH CHECK ("app"."is_editor"());



CREATE POLICY "media_editor_read" ON "public"."media" FOR SELECT USING ("app"."is_editor"());



CREATE POLICY "media_editor_update" ON "public"."media" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());



ALTER TABLE "public"."media_folders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "media_folders_editor_all" ON "public"."media_folders" USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());



CREATE POLICY "media_public_read" ON "public"."media" FOR SELECT USING ((("status" = 'published'::"public"."content_status") AND ("deleted_at" IS NULL)));



ALTER TABLE "public"."news_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "news_categories_editor_all" ON "public"."news_categories" USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());



ALTER TABLE "public"."news_posts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "news_posts_admin_delete" ON "public"."news_posts" FOR DELETE USING ("app"."is_admin"());



CREATE POLICY "news_posts_editor_insert" ON "public"."news_posts" FOR INSERT WITH CHECK ("app"."is_editor"());



CREATE POLICY "news_posts_editor_read" ON "public"."news_posts" FOR SELECT USING ("app"."is_editor"());



CREATE POLICY "news_posts_editor_update" ON "public"."news_posts" FOR UPDATE USING ("app"."is_editor"()) WITH CHECK ("app"."is_editor"());



CREATE POLICY "news_posts_public_read" ON "public"."news_posts" FOR SELECT USING ((("status" = 'published'::"public"."content_status") AND ("deleted_at" IS NULL)));



ALTER TABLE "public"."participant_feedback" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "participant_feedback_staff_select" ON "public"."participant_feedback" FOR SELECT TO "authenticated" USING (( SELECT "app"."has_min_role"('editor'::"public"."user_role") AS "has_min_role"));



ALTER TABLE "public"."participant_skill_results" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "participant_skill_results_delete" ON "public"."participant_skill_results" FOR DELETE TO "authenticated" USING ("app"."is_admin"());



CREATE POLICY "participant_skill_results_insert" ON "public"."participant_skill_results" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin_or_trainer"());



CREATE POLICY "participant_skill_results_select" ON "public"."participant_skill_results" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));



CREATE POLICY "participant_skill_results_update" ON "public"."participant_skill_results" FOR UPDATE TO "authenticated" USING ("app"."is_admin_or_trainer"()) WITH CHECK ("app"."is_admin_or_trainer"());



ALTER TABLE "public"."participants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "participants_delete" ON "public"."participants" FOR DELETE TO "authenticated" USING ("app"."is_admin"());



CREATE POLICY "participants_insert" ON "public"."participants" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());



CREATE POLICY "participants_select" ON "public"."participants" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "participants_update" ON "public"."participants" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



ALTER TABLE "public"."photo_activity_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_ai_analysis" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_id_sequences" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_usage_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photo_usages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_self_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "app"."is_admin"() AS "is_admin")));



CREATE POLICY "profiles_self_update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "app"."is_super_admin"() AS "is_super_admin"))) WITH CHECK ((("id" = ( SELECT "auth"."uid"() AS "uid")) OR ( SELECT "app"."is_super_admin"() AS "is_super_admin")));



ALTER TABLE "public"."proposal_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "proposal_requests_select" ON "public"."proposal_requests" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "proposal_requests_update" ON "public"."proposal_requests" FOR UPDATE TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role")) WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



ALTER TABLE "public"."public_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."public_registration_attendees" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_registration_attendees_no_direct_client_access" ON "public"."public_registration_attendees" TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."public_registration_payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_registration_payments_no_direct_client_access" ON "public"."public_registration_payments" TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."public_registrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_registrations_no_direct_client_access" ON "public"."public_registrations" TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."sales_activity" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_activity_insert" ON "public"."sales_activity" FOR INSERT TO "authenticated" WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "sales_activity_select" ON "public"."sales_activity" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



ALTER TABLE "public"."sales_lead_attributions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_lead_attributions_insert" ON "public"."sales_lead_attributions" FOR INSERT TO "authenticated" WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "sales_lead_attributions_select" ON "public"."sales_lead_attributions" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "sales_lead_attributions_update" ON "public"."sales_lead_attributions" FOR UPDATE TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role")) WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



ALTER TABLE "public"."sales_lead_metadata" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_lead_metadata_select" ON "public"."sales_lead_metadata" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "sales_lead_metadata_update" ON "public"."sales_lead_metadata" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



ALTER TABLE "public"."sales_opportunities" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_opportunities_insert" ON "public"."sales_opportunities" FOR INSERT TO "authenticated" WITH CHECK (("app"."is_admin"() AND ("stage" <> ALL (ARRAY['won'::"text", 'cancelled'::"text"]))));



CREATE POLICY "sales_opportunities_select" ON "public"."sales_opportunities" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "sales_opportunities_update" ON "public"."sales_opportunities" FOR UPDATE TO "authenticated" USING (("app"."is_admin"() AND ("stage" <> ALL (ARRAY['won'::"text", 'cancelled'::"text"])))) WITH CHECK (("app"."is_admin"() AND ("stage" <> ALL (ARRAY['won'::"text", 'cancelled'::"text"]))));



ALTER TABLE "public"."sales_quotation_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_quotation_items_delete" ON "public"."sales_quotation_items" FOR DELETE TO "authenticated" USING ("app"."is_admin"());



CREATE POLICY "sales_quotation_items_insert" ON "public"."sales_quotation_items" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());



CREATE POLICY "sales_quotation_items_select" ON "public"."sales_quotation_items" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "sales_quotation_items_update" ON "public"."sales_quotation_items" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



ALTER TABLE "public"."sales_quotations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_quotations_insert" ON "public"."sales_quotations" FOR INSERT TO "authenticated" WITH CHECK (("app"."is_admin"() AND ("status" <> ALL (ARRAY['accepted'::"text", 'cancelled'::"text"]))));



CREATE POLICY "sales_quotations_select" ON "public"."sales_quotations" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "sales_quotations_update" ON "public"."sales_quotations" FOR UPDATE TO "authenticated" USING (("app"."is_admin"() AND ("status" <> ALL (ARRAY['accepted'::"text", 'cancelled'::"text"])))) WITH CHECK (("app"."is_admin"() AND ("status" <> ALL (ARRAY['accepted'::"text", 'cancelled'::"text"]))));



ALTER TABLE "public"."sales_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "sales_tasks_delete" ON "public"."sales_tasks" FOR DELETE TO "authenticated" USING ("app"."is_admin"());



CREATE POLICY "sales_tasks_insert" ON "public"."sales_tasks" FOR INSERT TO "authenticated" WITH CHECK ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "sales_tasks_select" ON "public"."sales_tasks" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('editor'::"public"."user_role"));



CREATE POLICY "sales_tasks_update" ON "public"."sales_tasks" FOR UPDATE TO "authenticated" USING (("app"."is_admin"() OR ("assigned_to" = "auth"."uid"()) OR ("created_by" = "auth"."uid"()))) WITH CHECK (("app"."is_admin"() OR ("assigned_to" = "auth"."uid"()) OR ("created_by" = "auth"."uid"())));



ALTER TABLE "public"."schedule_assessors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_assessors_delete" ON "public"."schedule_assessors" FOR DELETE TO "authenticated" USING ("app"."can_manage_schedule_assessors"());



CREATE POLICY "schedule_assessors_insert" ON "public"."schedule_assessors" FOR INSERT TO "authenticated" WITH CHECK ("app"."can_manage_schedule_assessors"());



CREATE POLICY "schedule_assessors_read" ON "public"."schedule_assessors" FOR SELECT TO "authenticated" USING ("app"."is_active"());



CREATE POLICY "schedule_assessors_update" ON "public"."schedule_assessors" FOR UPDATE TO "authenticated" USING ("app"."can_manage_schedule_assessors"()) WITH CHECK ("app"."can_manage_schedule_assessors"());



ALTER TABLE "public"."schedule_groups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_groups_insert" ON "public"."schedule_groups" FOR INSERT TO "authenticated" WITH CHECK ("app"."can_manage_schedule_groups"());



CREATE POLICY "schedule_groups_read" ON "public"."schedule_groups" FOR SELECT TO "authenticated" USING ("app"."is_active"());



CREATE POLICY "schedule_groups_update" ON "public"."schedule_groups" FOR UPDATE TO "authenticated" USING ("app"."can_manage_schedule_groups"()) WITH CHECK ("app"."can_manage_schedule_groups"());



ALTER TABLE "public"."schedule_participants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedule_participants_delete" ON "public"."schedule_participants" FOR DELETE TO "authenticated" USING ("app"."is_admin"());



CREATE POLICY "schedule_participants_insert" ON "public"."schedule_participants" FOR INSERT TO "authenticated" WITH CHECK ("app"."is_admin"());



CREATE POLICY "schedule_participants_select" ON "public"."schedule_participants" FOR SELECT TO "authenticated" USING ("app"."has_min_role"('trainer'::"public"."user_role"));



CREATE POLICY "schedule_participants_update" ON "public"."schedule_participants" FOR UPDATE TO "authenticated" USING ("app"."is_admin"()) WITH CHECK ("app"."is_admin"());



ALTER TABLE "public"."staff_module_access" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_module_access_self_read" ON "public"."staff_module_access" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "app"."is_super_admin"() OR "public"."has_module_access"('users'::"text")));



CREATE POLICY "staff_module_access_super_all" ON "public"."staff_module_access" TO "authenticated" USING ("app"."is_super_admin"()) WITH CHECK ("app"."is_super_admin"());



ALTER TABLE "public"."staff_module_catalog" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "staff_module_catalog_staff_read" ON "public"."staff_module_catalog" FOR SELECT TO "authenticated" USING (("app"."is_active"() AND "is_active"));



ALTER TABLE "public"."trainers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trainers_insert" ON "public"."trainers" FOR INSERT TO "authenticated" WITH CHECK ("app"."can_manage_trainers"());



CREATE POLICY "trainers_read" ON "public"."trainers" FOR SELECT TO "authenticated" USING ("app"."can_view_trainers"());



CREATE POLICY "trainers_update" ON "public"."trainers" FOR UPDATE TO "authenticated" USING ("app"."can_manage_trainers"()) WITH CHECK ("app"."can_manage_trainers"());



GRANT USAGE ON SCHEMA "app" TO "authenticated";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "app"."audit_staff_change"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."can_manage_assessors"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."can_manage_assessors"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."can_manage_schedule_assessors"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."can_manage_schedule_assessors"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."can_manage_schedule_groups"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."can_manage_schedule_groups"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."can_manage_staff"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."can_manage_trainers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."can_manage_trainers"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."can_view_trainers"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."can_view_trainers"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."current_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."current_role"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."duplicate_certificate_with_skill_snapshot"("p_source_certificate_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."duplicate_certificate_with_skill_snapshot"("p_source_certificate_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "app"."enforce_invoice_financial_immutability"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."enforce_invoice_items_immutable"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."enforce_toyyibpay_attempt_transition"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."gen_trainer_id"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."guard_quotation_commercial_snapshot_mutation"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."guard_sales_revenue_mutation"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."handle_new_user"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."has_min_role"("min_role" "public"."user_role") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."has_min_role"("min_role" "public"."user_role") TO "authenticated";



REVOKE ALL ON FUNCTION "app"."is_active"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."is_active"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."is_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."is_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."is_editor"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."is_editor"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."is_super_admin"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."is_super_admin"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "app"."legacy_merge_fingerprint"("p_batch_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "app"."next_campaign_number"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."next_campaign_number"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."next_invoice_number"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."next_marketing_contact_number"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."next_quotation_number"() FROM PUBLIC;
GRANT ALL ON FUNCTION "app"."next_quotation_number"() TO "authenticated";



REVOKE ALL ON FUNCTION "app"."propagate_lead_is_test"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."propagate_opportunity_is_test"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."protect_last_super_admin"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."public_registration_payment_state_guard"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."public_registration_state_guard"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."recompute_invoice_balance"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."sync_opportunity_is_test"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."sync_quotation_is_test"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "app"."toyyibpay_system_actor"(OUT "actor_id" "uuid", OUT "actor_email" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."accept_quotation"("p_quotation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_quotation"("p_quotation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_quotation"("p_quotation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."attach_public_registration_toyy_pay_bill"("p_attempt_id" "uuid", "p_bill_code" "text", "p_payment_url" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."attach_public_registration_toyy_pay_bill"("p_attempt_id" "uuid", "p_bill_code" "text", "p_payment_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."begin_public_registration_payment"("p_registration_reference" "text", "p_registration_secret" "text", "p_provider" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."begin_public_registration_payment"("p_registration_reference" "text", "p_registration_secret" "text", "p_provider" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."begin_public_registration_payment"("p_registration_reference" "text", "p_registration_secret" "text", "p_provider" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."begin_public_registration_payment"("p_registration_reference" "text", "p_registration_secret" "text", "p_provider" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."cancel_invoice"("p_invoice_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_invoice"("p_invoice_id" "uuid", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."cancel_invoice"("p_invoice_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."check_public_rate_limit"("p_key" "text", "p_window_seconds" integer, "p_max_attempts" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_public_rate_limit"("p_key" "text", "p_window_seconds" integer, "p_max_attempts" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."check_public_rate_limit"("p_key" "text", "p_window_seconds" integer, "p_max_attempts" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."check_public_rate_limit"("p_key" "text", "p_window_seconds" integer, "p_max_attempts" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."clear_password_change_flag"("p_forced" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."clear_password_change_flag"("p_forced" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."clear_password_change_flag"("p_forced" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."convert_lead_to_opportunity"("p_lead_metadata_id" "uuid", "p_title" "text", "p_expected_close_date" "date", "p_estimated_value" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."convert_lead_to_opportunity"("p_lead_metadata_id" "uuid", "p_title" "text", "p_expected_close_date" "date", "p_estimated_value" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."convert_lead_to_opportunity"("p_lead_metadata_id" "uuid", "p_title" "text", "p_expected_close_date" "date", "p_estimated_value" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_invoice_from_quotation"("p_quotation_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_invoice_from_quotation"("p_quotation_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_invoice_from_quotation"("p_quotation_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_public_registration"("p_schedule_id" "uuid", "p_idempotency_key" "text", "p_registration_secret" "text", "p_attendees" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_public_registration"("p_schedule_id" "uuid", "p_idempotency_key" "text", "p_registration_secret" "text", "p_attendees" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."create_public_registration"("p_schedule_id" "uuid", "p_idempotency_key" "text", "p_registration_secret" "text", "p_attendees" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_public_registration"("p_schedule_id" "uuid", "p_idempotency_key" "text", "p_registration_secret" "text", "p_attendees" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."expire_public_registrations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_public_registrations"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."fail_public_registration_payment_setup"("p_attempt_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."fail_public_registration_payment_setup"("p_attempt_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_anonymous_stats"("p_schedule_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."feedback_generate_links"("p_schedule_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feedback_generate_links"("p_schedule_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_generate_links"("p_schedule_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_generate_links"("p_schedule_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."feedback_get_by_token"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feedback_get_by_token"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_get_by_token"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_get_by_token"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."feedback_reopen"("p_feedback_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feedback_reopen"("p_feedback_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_reopen"("p_feedback_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_reopen"("p_feedback_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."feedback_submit"("p_token" "text", "p_data" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_public_registration_crm"("p_registration_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_public_registration_crm"("p_registration_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."finalize_public_registration_crm"("p_registration_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."finalize_public_registration_payment_from_callback"("p_attempt_id" "uuid", "p_bill_code" "text", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_callback_received_at" timestamp with time zone, "p_raw_response" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_public_registration_payment_from_callback"("p_attempt_id" "uuid", "p_bill_code" "text", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_callback_received_at" timestamp with time zone, "p_raw_response" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_toyyibpay_payment"("p_attempt_id" "uuid", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_raw_response" "jsonb", "p_provider_transaction_time" timestamp with time zone, "p_callback_received_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_toyyibpay_payment"("p_attempt_id" "uuid", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_raw_response" "jsonb", "p_provider_transaction_time" timestamp with time zone, "p_callback_received_at" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."finalize_toyyibpay_payment"("p_attempt_id" "uuid", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_raw_response" "jsonb", "p_provider_transaction_time" timestamp with time zone, "p_callback_received_at" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."finalize_toyyibpay_payment_from_callback"("p_attempt_id" "uuid", "p_billcode" "text", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_provider_transaction_time" timestamp with time zone, "p_callback_received_at" timestamp with time zone, "p_raw_response" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_toyyibpay_payment_from_callback"("p_attempt_id" "uuid", "p_billcode" "text", "p_verified_amount" numeric, "p_provider_transaction_id" "text", "p_provider_transaction_time" timestamp with time zone, "p_callback_received_at" timestamp with time zone, "p_raw_response" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_active_toyyibpay_attempt"("p_invoice_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_active_toyyibpay_attempt"("p_invoice_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_active_toyyibpay_attempt"("p_invoice_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_my_module_access"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_module_access"() TO "service_role";
GRANT ALL ON FUNCTION "public"."get_my_module_access"() TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_public_registration_schedule"("p_schedule_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_registration_schedule"("p_schedule_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_public_registration_schedule"("p_schedule_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_registration_schedule"("p_schedule_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_public_registration_status"("p_registration_reference" "text", "p_registration_secret" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_registration_status"("p_registration_reference" "text", "p_registration_secret" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_public_registration_status"("p_registration_reference" "text", "p_registration_secret" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_registration_status"("p_registration_reference" "text", "p_registration_secret" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_public_upcoming_schedules"("p_include_past" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_upcoming_schedules"("p_include_past" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_upcoming_schedules"("p_include_past" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_upcoming_schedules"("p_include_past" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."has_module_access"("p_module_key" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_module_access"("p_module_key" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."has_module_access"("p_module_key" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."has_module_access_level"("p_module_key" "text", "p_level" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."has_module_access_level"("p_module_key" "text", "p_level" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."has_module_access_level"("p_module_key" "text", "p_level" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."issue_certificate_with_skill_snapshot"("p_schedule_id" "uuid", "p_participant_id" "uuid", "p_certificate_number" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."issue_invoice"("p_invoice_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."issue_invoice"("p_invoice_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."issue_invoice"("p_invoice_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."legacy_course_map_approve"("p_batch_id" "uuid", "p_course_map_id" "uuid", "p_course_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."legacy_course_map_approve"("p_batch_id" "uuid", "p_course_map_id" "uuid", "p_course_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."legacy_course_map_approve"("p_batch_id" "uuid", "p_course_map_id" "uuid", "p_course_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."legacy_import_create_batch"("p_source_label" "text", "p_original_filename" "text", "p_source_file_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."legacy_import_create_batch"("p_source_label" "text", "p_original_filename" "text", "p_source_file_hash" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."legacy_import_create_batch"("p_source_label" "text", "p_original_filename" "text", "p_source_file_hash" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."legacy_import_ingest_rows"("p_batch_id" "uuid", "p_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."legacy_import_ingest_rows"("p_batch_id" "uuid", "p_rows" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."legacy_import_ingest_rows"("p_batch_id" "uuid", "p_rows" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."legacy_merge_dry_run"("p_batch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."legacy_merge_dry_run"("p_batch_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."legacy_merge_dry_run"("p_batch_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."legacy_merge_execute_row"("p_batch_id" "uuid", "p_row_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."legacy_merge_execute_row"("p_batch_id" "uuid", "p_row_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."legacy_merge_execute_row"("p_batch_id" "uuid", "p_row_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."legacy_merge_finalize_batch"("p_batch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."legacy_merge_finalize_batch"("p_batch_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."legacy_merge_finalize_batch"("p_batch_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."legacy_merge_verify_checkpoint"("p_batch_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."legacy_merge_verify_checkpoint"("p_batch_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."legacy_merge_verify_checkpoint"("p_batch_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_event"("p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_event_as_service"("p_actor_id" "uuid", "p_actor_email" "text", "p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_event_as_service"("p_actor_id" "uuid", "p_actor_email" "text", "p_action" "public"."audit_action", "p_entity_type" "text", "p_entity_id" "text", "p_summary" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_public_registration_payment_event"("p_attempt_id" "uuid", "p_event_type" "text", "p_detail" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_public_registration_payment_event"("p_attempt_id" "uuid", "p_event_type" "text", "p_detail" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_toyyibpay_callback_event"("p_attempt_id" "uuid", "p_event_type" "text", "p_detail" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_toyyibpay_callback_event"("p_attempt_id" "uuid", "p_event_type" "text", "p_detail" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_toyyibpay_conflict"("p_invoice_id" "uuid", "p_attempt_id" "uuid", "p_conflict_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_toyyibpay_conflict"("p_invoice_id" "uuid", "p_attempt_id" "uuid", "p_conflict_type" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."log_toyyibpay_conflict"("p_invoice_id" "uuid", "p_attempt_id" "uuid", "p_conflict_type" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."log_toyyibpay_orphan_bill_event"("p_invoice_id" "uuid", "p_billcode" "text", "p_compensation_status" "text", "p_detail" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_toyyibpay_orphan_bill_event"("p_invoice_id" "uuid", "p_billcode" "text", "p_compensation_status" "text", "p_detail" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."log_toyyibpay_orphan_bill_event"("p_invoice_id" "uuid", "p_billcode" "text", "p_compensation_status" "text", "p_detail" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mark_lead_test"("p_lead_metadata_id" "uuid", "p_is_test" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_lead_test"("p_lead_metadata_id" "uuid", "p_is_test" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."mark_lead_test"("p_lead_metadata_id" "uuid", "p_is_test" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mark_opportunity_lost"("p_opportunity_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_opportunity_lost"("p_opportunity_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."mark_opportunity_lost"("p_opportunity_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_proposal_delivery_status"("p_id" "uuid", "p_email_sent" boolean, "p_sheets_synced" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_proposal_delivery_status"("p_id" "uuid", "p_email_sent" boolean, "p_sheets_synced" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_public_registration_payment_failed_from_callback"("p_attempt_id" "uuid", "p_bill_code" "text", "p_callback_received_at" timestamp with time zone, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_public_registration_payment_failed_from_callback"("p_attempt_id" "uuid", "p_bill_code" "text", "p_callback_received_at" timestamp with time zone, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_toyyibpay_attempt_failed"("p_attempt_id" "uuid", "p_reason" "text", "p_callback_received_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_toyyibpay_attempt_failed"("p_attempt_id" "uuid", "p_reason" "text", "p_callback_received_at" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."mark_toyyibpay_attempt_failed"("p_attempt_id" "uuid", "p_reason" "text", "p_callback_received_at" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."mark_toyyibpay_attempt_failed_from_callback"("p_attempt_id" "uuid", "p_billcode" "text", "p_callback_received_at" timestamp with time zone, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_toyyibpay_attempt_failed_from_callback"("p_attempt_id" "uuid", "p_billcode" "text", "p_callback_received_at" timestamp with time zone, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_toyyibpay_attempt_superseded"("p_attempt_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_toyyibpay_attempt_superseded"("p_attempt_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."mark_toyyibpay_attempt_superseded"("p_attempt_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."module_access_rank"("p_level" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."module_access_rank"("p_level" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."module_access_rank"("p_level" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."promote_marketing_contact_to_sales"("p_contact_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."promote_marketing_contact_to_sales"("p_contact_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."promote_marketing_contact_to_sales"("p_contact_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_manual_payment"("p_invoice_id" "uuid", "p_payment_provider" "text", "p_payment_method" "text", "p_amount" numeric, "p_payment_date" "date", "p_payment_reference" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_manual_payment"("p_invoice_id" "uuid", "p_payment_provider" "text", "p_payment_method" "text", "p_amount" numeric, "p_payment_date" "date", "p_payment_reference" "text", "p_notes" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."record_manual_payment"("p_invoice_id" "uuid", "p_payment_provider" "text", "p_payment_method" "text", "p_amount" numeric, "p_payment_date" "date", "p_payment_reference" "text", "p_notes" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."record_public_registration_payment_orphan"("p_attempt_id" "uuid", "p_bill_code" "text", "p_payment_url" "text", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_public_registration_payment_orphan"("p_attempt_id" "uuid", "p_bill_code" "text", "p_payment_url" "text", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_toyyibpay_bill"("p_invoice_id" "uuid", "p_attempt_id" "uuid", "p_billcode" "text", "p_payment_url" "text", "p_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_toyyibpay_bill"("p_invoice_id" "uuid", "p_attempt_id" "uuid", "p_billcode" "text", "p_payment_url" "text", "p_amount" numeric) TO "service_role";
GRANT ALL ON FUNCTION "public"."record_toyyibpay_bill"("p_invoice_id" "uuid", "p_attempt_id" "uuid", "p_billcode" "text", "p_payment_url" "text", "p_amount" numeric) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."recover_public_registration_payment_claim"("p_attempt_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recover_public_registration_payment_claim"("p_attempt_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reject_quotation"("p_quotation_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reject_quotation"("p_quotation_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_quotation"("p_quotation_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_schedule_feedback_participant"("p_public_token" "text", "p_identity_number" "text", "p_request_fingerprint_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_schedule_feedback_participant"("p_public_token" "text", "p_identity_number" "text", "p_request_fingerprint_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reverse_won_opportunity"("p_opportunity_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reverse_won_opportunity"("p_opportunity_id" "uuid", "p_reason" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."reverse_won_opportunity"("p_opportunity_id" "uuid", "p_reason" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."schedule_group_assessor_conflicts"("p_assessor_id" "uuid", "p_schedule_id" "uuid", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_exclude_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."schedule_group_assessor_conflicts"("p_assessor_id" "uuid", "p_schedule_id" "uuid", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_exclude_group_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."schedule_group_assessor_conflicts"("p_assessor_id" "uuid", "p_schedule_id" "uuid", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_exclude_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."schedule_group_trainer_conflicts"("p_trainer_id" "uuid", "p_schedule_id" "uuid", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_exclude_group_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."schedule_group_trainer_conflicts"("p_trainer_id" "uuid", "p_schedule_id" "uuid", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_exclude_group_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."schedule_group_trainer_conflicts"("p_trainer_id" "uuid", "p_schedule_id" "uuid", "p_start_time" time without time zone, "p_end_time" time without time zone, "p_exclude_group_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_must_change_password"("p_user_id" "uuid", "p_value" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_must_change_password"("p_user_id" "uuid", "p_value" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_must_change_password"("p_user_id" "uuid", "p_value" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_schedule_assessor"("p_schedule_id" "uuid", "p_assessor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_schedule_assessor"("p_schedule_id" "uuid", "p_assessor_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."set_schedule_assessor"("p_schedule_id" "uuid", "p_assessor_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_staff_module_access"("p_user_id" "uuid", "p_modules" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_staff_module_access"("p_user_id" "uuid", "p_modules" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."set_staff_module_access"("p_user_id" "uuid", "p_modules" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_proposal_request"("p_company_name" "text", "p_contact_person" "text", "p_job_title" "text", "p_email" "text", "p_phone" "text", "p_industry" "text", "p_category" "text", "p_programme" "text", "p_participants" integer, "p_location" "text", "p_preferred_month" "text", "p_budget" "text", "p_objectives" "text", "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_proposal_request"("p_company_name" "text", "p_contact_person" "text", "p_job_title" "text", "p_email" "text", "p_phone" "text", "p_industry" "text", "p_category" "text", "p_programme" "text", "p_participants" integer, "p_location" "text", "p_preferred_month" "text", "p_budget" "text", "p_objectives" "text", "p_notes" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_proposal_request"("p_company_name" "text", "p_contact_person" "text", "p_job_title" "text", "p_email" "text", "p_phone" "text", "p_industry" "text", "p_category" "text", "p_programme" "text", "p_participants" integer, "p_location" "text", "p_preferred_month" "text", "p_budget" "text", "p_objectives" "text", "p_notes" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_proposal_request"("p_company_name" "text", "p_contact_person" "text", "p_job_title" "text", "p_email" "text", "p_phone" "text", "p_industry" "text", "p_category" "text", "p_programme" "text", "p_participants" integer, "p_location" "text", "p_preferred_month" "text", "p_budget" "text", "p_objectives" "text", "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."submit_public_enquiry"("p_name" "text", "p_company" "text", "p_email" "text", "p_phone" "text", "p_enquiry_type" "text", "p_subject" "text", "p_message" "text", "p_source_page" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."submit_public_enquiry"("p_name" "text", "p_company" "text", "p_email" "text", "p_phone" "text", "p_enquiry_type" "text", "p_subject" "text", "p_message" "text", "p_source_page" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_public_enquiry"("p_name" "text", "p_company" "text", "p_email" "text", "p_phone" "text", "p_enquiry_type" "text", "p_subject" "text", "p_message" "text", "p_source_page" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_public_enquiry"("p_name" "text", "p_company" "text", "p_email" "text", "p_phone" "text", "p_enquiry_type" "text", "p_subject" "text", "p_message" "text", "p_source_page" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_participant_last4"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_participant_last4"() TO "service_role";



GRANT ALL ON FUNCTION "public"."teras_photo_next_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."teras_photo_next_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."teras_photo_next_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_staff_profile"("p_user_id" "uuid", "p_full_name" "text", "p_department" "public"."staff_department", "p_role" "public"."user_role", "p_is_active" boolean, "p_access_control_enabled" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_staff_profile"("p_user_id" "uuid", "p_full_name" "text", "p_department" "public"."staff_department", "p_role" "public"."user_role", "p_is_active" boolean, "p_access_control_enabled" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."update_staff_profile"("p_user_id" "uuid", "p_full_name" "text", "p_department" "public"."staff_department", "p_role" "public"."user_role", "p_is_active" boolean, "p_access_control_enabled" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_and_log"("p_query" "text", "p_method" "text", "p_ip" "text", "p_ua" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_certificate"("input_certificate_no" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_certificate"("input_certificate_no" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_certificate_by_value"("search_value" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_certificate_by_value"("search_value" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."verify_public_registration_manual_payment"("p_registration_reference" "text", "p_registration_secret" "text", "p_amount" numeric, "p_payment_reference" "text", "p_notes" "text", "p_verifier_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."verify_public_registration_manual_payment"("p_registration_reference" "text", "p_registration_secret" "text", "p_amount" numeric, "p_payment_reference" "text", "p_notes" "text", "p_verifier_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."verify_public_registration_manual_payment"("p_registration_reference" "text", "p_registration_secret" "text", "p_amount" numeric, "p_payment_reference" "text", "p_notes" "text", "p_verifier_id" "uuid") TO "authenticated";



GRANT ALL ON TABLE "public"."admin_users" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_users" TO "service_role";



GRANT ALL ON TABLE "public"."assessments" TO "authenticated";
GRANT ALL ON TABLE "public"."assessments" TO "service_role";



GRANT ALL ON TABLE "public"."assessors" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."assessors" TO "authenticated";



GRANT ALL ON TABLE "public"."attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance" TO "service_role";



GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."audit_logs" TO "anon";
GRANT SELECT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."audit_logs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."certificate_import_logs" TO "anon";
GRANT ALL ON TABLE "public"."certificate_import_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."certificate_import_logs" TO "service_role";



GRANT ALL ON SEQUENCE "public"."certificate_number_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."certificate_number_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."certificate_number_seq" TO "service_role";



GRANT ALL ON TABLE "public"."certificate_skill_results" TO "authenticated";
GRANT ALL ON TABLE "public"."certificate_skill_results" TO "service_role";



GRANT ALL ON TABLE "public"."certificate_templates" TO "anon";
GRANT ALL ON TABLE "public"."certificate_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."certificate_templates" TO "service_role";



GRANT ALL ON TABLE "public"."certificate_verifications" TO "anon";
GRANT ALL ON TABLE "public"."certificate_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."certificate_verifications" TO "service_role";



GRANT ALL ON SEQUENCE "public"."certificate_verifications_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."certificate_verifications_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."certificate_verifications_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."certificates" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."certificates" TO "authenticated";



GRANT ALL ON TABLE "public"."cms_content" TO "authenticated";
GRANT ALL ON TABLE "public"."cms_content" TO "service_role";



GRANT ALL ON TABLE "public"."cms_media" TO "authenticated";
GRANT ALL ON TABLE "public"."cms_media" TO "service_role";



GRANT ALL ON TABLE "public"."companies" TO "anon";
GRANT ALL ON TABLE "public"."companies" TO "authenticated";
GRANT ALL ON TABLE "public"."companies" TO "service_role";



GRANT ALL ON SEQUENCE "public"."company_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."company_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."company_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."company_profile" TO "anon";
GRANT ALL ON TABLE "public"."company_profile" TO "authenticated";
GRANT ALL ON TABLE "public"."company_profile" TO "service_role";



GRANT ALL ON TABLE "public"."course_commercial_profiles" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."course_commercial_profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."course_schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."course_schedules" TO "service_role";



GRANT ALL ON TABLE "public"."courses" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."courses" TO "authenticated";



GRANT ALL ON TABLE "public"."downloads" TO "anon";
GRANT ALL ON TABLE "public"."downloads" TO "authenticated";
GRANT ALL ON TABLE "public"."downloads" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."enquiries" TO "authenticated";
GRANT ALL ON TABLE "public"."enquiries" TO "service_role";



GRANT ALL ON TABLE "public"."faq_categories" TO "anon";
GRANT ALL ON TABLE "public"."faq_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."faq_categories" TO "service_role";



GRANT ALL ON TABLE "public"."faqs" TO "anon";
GRANT ALL ON TABLE "public"."faqs" TO "authenticated";
GRANT ALL ON TABLE "public"."faqs" TO "service_role";



GRANT ALL ON TABLE "public"."feedback_improvement_actions" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."feedback_improvement_actions" TO "authenticated";



GRANT ALL ON TABLE "public"."feedback_issues" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."feedback_issues" TO "authenticated";



GRANT ALL ON TABLE "public"."feedback_schedule_links" TO "service_role";



GRANT ALL ON TABLE "public"."feedback_schedule_lookup_attempts" TO "service_role";



GRANT ALL ON TABLE "public"."gallery_categories" TO "anon";
GRANT ALL ON TABLE "public"."gallery_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."gallery_categories" TO "service_role";



GRANT ALL ON TABLE "public"."gallery_images" TO "anon";
GRANT ALL ON TABLE "public"."gallery_images" TO "authenticated";
GRANT ALL ON TABLE "public"."gallery_images" TO "service_role";



GRANT ALL ON TABLE "public"."invoice_items" TO "service_role";
GRANT SELECT ON TABLE "public"."invoice_items" TO "authenticated";



GRANT ALL ON TABLE "public"."invoice_payments" TO "service_role";
GRANT SELECT ON TABLE "public"."invoice_payments" TO "authenticated";



GRANT ALL ON TABLE "public"."invoices" TO "service_role";
GRANT SELECT,UPDATE ON TABLE "public"."invoices" TO "authenticated";



GRANT ALL ON TABLE "public"."legacy_course_map" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."legacy_course_map" TO "authenticated";



GRANT ALL ON TABLE "public"."legacy_import_batches" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."legacy_import_batches" TO "authenticated";



GRANT ALL ON TABLE "public"."legacy_participant_staging" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."legacy_participant_staging" TO "authenticated";



GRANT ALL ON TABLE "public"."marketing_campaigns" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."marketing_campaigns" TO "authenticated";



GRANT ALL ON TABLE "public"."marketing_contact_events" TO "service_role";
GRANT SELECT,INSERT ON TABLE "public"."marketing_contact_events" TO "authenticated";



GRANT ALL ON TABLE "public"."marketing_contacts" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."marketing_contacts" TO "authenticated";



GRANT ALL ON TABLE "public"."media" TO "anon";
GRANT ALL ON TABLE "public"."media" TO "authenticated";
GRANT ALL ON TABLE "public"."media" TO "service_role";



GRANT ALL ON TABLE "public"."media_folders" TO "anon";
GRANT ALL ON TABLE "public"."media_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."media_folders" TO "service_role";



GRANT ALL ON TABLE "public"."news_categories" TO "anon";
GRANT ALL ON TABLE "public"."news_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."news_categories" TO "service_role";



GRANT ALL ON TABLE "public"."news_posts" TO "anon";
GRANT ALL ON TABLE "public"."news_posts" TO "authenticated";
GRANT ALL ON TABLE "public"."news_posts" TO "service_role";



GRANT ALL ON TABLE "public"."participant_feedback" TO "service_role";
GRANT SELECT ON TABLE "public"."participant_feedback" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."participant_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."participant_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."participant_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."participant_skill_results" TO "authenticated";
GRANT ALL ON TABLE "public"."participant_skill_results" TO "service_role";



GRANT ALL ON TABLE "public"."participants" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."participants" TO "authenticated";



GRANT ALL ON TABLE "public"."photo_activity_log" TO "anon";
GRANT ALL ON TABLE "public"."photo_activity_log" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_activity_log" TO "service_role";



GRANT ALL ON TABLE "public"."photo_ai_analysis" TO "service_role";



GRANT ALL ON TABLE "public"."photo_categories" TO "anon";
GRANT ALL ON TABLE "public"."photo_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_categories" TO "service_role";



GRANT ALL ON TABLE "public"."photo_events" TO "anon";
GRANT ALL ON TABLE "public"."photo_events" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_events" TO "service_role";



GRANT ALL ON TABLE "public"."photo_id_sequences" TO "anon";
GRANT ALL ON TABLE "public"."photo_id_sequences" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_id_sequences" TO "service_role";



GRANT ALL ON TABLE "public"."photo_usage_types" TO "anon";
GRANT ALL ON TABLE "public"."photo_usage_types" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_usage_types" TO "service_role";



GRANT ALL ON TABLE "public"."photo_usages" TO "anon";
GRANT ALL ON TABLE "public"."photo_usages" TO "authenticated";
GRANT ALL ON TABLE "public"."photo_usages" TO "service_role";



GRANT ALL ON TABLE "public"."photos" TO "anon";
GRANT ALL ON TABLE "public"."photos" TO "authenticated";
GRANT ALL ON TABLE "public"."photos" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT UPDATE("full_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("phone") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("avatar_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("job_title") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("last_login_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT,MAINTAIN,UPDATE ON TABLE "public"."proposal_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."proposal_requests" TO "service_role";



GRANT ALL ON TABLE "public"."public_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."public_registration_attendees" TO "service_role";



GRANT ALL ON TABLE "public"."public_registration_payments" TO "service_role";



GRANT ALL ON TABLE "public"."public_registrations" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN ON TABLE "public"."sales_activity" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_activity" TO "service_role";



GRANT ALL ON TABLE "public"."sales_lead_attributions" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."sales_lead_attributions" TO "authenticated";



GRANT SELECT,MAINTAIN,UPDATE ON TABLE "public"."sales_lead_metadata" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_lead_metadata" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."sales_opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_opportunities" TO "service_role";



GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."sales_quotation_items" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_quotation_items" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."sales_quotations" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_quotations" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."sales_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."sales_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_assessors" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."schedule_assessors" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."schedule_code_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."schedule_code_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."schedule_code_seq" TO "service_role";



GRANT ALL ON TABLE "public"."schedule_groups" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."schedule_groups" TO "authenticated";



GRANT ALL ON TABLE "public"."schedule_participants" TO "authenticated";
GRANT ALL ON TABLE "public"."schedule_participants" TO "service_role";



GRANT ALL ON TABLE "public"."staff_module_access" TO "service_role";
GRANT SELECT ON TABLE "public"."staff_module_access" TO "authenticated";



GRANT ALL ON TABLE "public"."staff_module_catalog" TO "service_role";
GRANT SELECT ON TABLE "public"."staff_module_catalog" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."trainer_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."trainers" TO "service_role";
GRANT SELECT,INSERT,UPDATE ON TABLE "public"."trainers" TO "authenticated";



GRANT ALL ON TABLE "public"."v_certificate_eligibility" TO "authenticated";
GRANT ALL ON TABLE "public"."v_certificate_eligibility" TO "service_role";



GRANT ALL ON TABLE "public"."v_sales_lead_inbox" TO "service_role";
GRANT SELECT ON TABLE "public"."v_sales_lead_inbox" TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";-- Application-owned Auth trigger; auth.* remains Supabase-managed.
CREATE TRIGGER "on_auth_user_created" AFTER INSERT ON "auth"."users" FOR EACH ROW EXECUTE FUNCTION "app"."handle_new_user"();
-- Bootstrap-only marker; schema.sql intentionally does not contain this table.
CREATE TABLE IF NOT EXISTS app.app_schema_baseline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  baseline_version text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  schema_hash text NOT NULL,
  notes text
);

INSERT INTO app.app_schema_baseline (baseline_version, schema_hash, notes)
VALUES ('v2', '7709534BA0593CC3361AE13B3DDC75C3319E87C7E76027A9D0600D4C6DD566B9', 'TERAS Baseline V2 bootstrap complete from Production schema snapshot; new environment only.')
ON CONFLICT DO NOTHING;

COMMIT;