-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0001 — Extensions & Enum Types
-- =====================================================================
-- Establishes shared Postgres extensions and every enum used across the
-- schema. Kept in its own migration so later migrations can reference the
-- types freely. Idempotent where Postgres allows.
-- =====================================================================

-- --- Extensions -----------------------------------------------------
create extension if not exists "pgcrypto";      -- gen_random_uuid()
create extension if not exists "citext";        -- case-insensitive email
create extension if not exists "pg_trgm";       -- fuzzy / global search

-- --- Dedicated schema for internal helper functions -----------------
create schema if not exists app;

-- --- Enum types -----------------------------------------------------
-- Roles are ordered from most to least privileged. "trainer", "client"
-- and "participant" are declared now so the platform is future-ready
-- (per spec) even though only the first three are wired into the UI.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'user_role') then
    create type user_role as enum (
      'super_admin',
      'admin',
      'editor',
      'trainer',
      'client',
      'participant'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'content_status') then
    create type content_status as enum ('draft', 'scheduled', 'published', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'course_delivery_mode') then
    create type course_delivery_mode as enum ('public', 'in_house', 'onsite', 'online', 'hybrid');
  end if;

  if not exists (select 1 from pg_type where typname = 'schedule_status') then
    create type schedule_status as enum ('open', 'closing_soon', 'full', 'in_progress', 'completed', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'enquiry_status') then
    create type enquiry_status as enum ('new', 'in_review', 'assigned', 'responded', 'closed', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'proposal_status') then
    create type proposal_status as enum ('new', 'in_review', 'assigned', 'quoted', 'won', 'lost', 'archived');
  end if;

  if not exists (select 1 from pg_type where typname = 'participant_status') then
    create type participant_status as enum ('registered', 'confirmed', 'attended', 'no_show', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'certificate_status') then
    create type certificate_status as enum ('pending', 'issued', 'revoked', 'expired');
  end if;

  if not exists (select 1 from pg_type where typname = 'media_kind') then
    create type media_kind as enum ('image', 'pdf', 'document', 'video', 'other');
  end if;

  if not exists (select 1 from pg_type where typname = 'audit_action') then
    create type audit_action as enum ('login', 'logout', 'create', 'update', 'delete', 'archive', 'restore', 'publish', 'upload', 'export', 'assign');
  end if;
end$$;
