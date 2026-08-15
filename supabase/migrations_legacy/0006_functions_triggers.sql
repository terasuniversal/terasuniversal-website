-- =====================================================================
-- TERAS UNIVERSAL Admin CMS
-- Migration 0006 — Shared Functions & Triggers
-- =====================================================================
-- Cross-cutting behaviour: updated_at maintenance, stamping created_by /
-- updated_by, a generic audit trigger, a slugify helper, and the global
-- search function used by the admin command palette.
-- =====================================================================

-- --- updated_at maintenance -----------------------------------------
create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- --- Stamp created_by / updated_by from auth.uid() ------------------
create or replace function app.stamp_actor()
returns trigger language plpgsql as $$
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

-- --- Generic audit trigger ------------------------------------------
-- Attach to any table; records create/update/delete/archive/restore.
create or replace function app.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action audit_action;
  v_id text;
  v_email text;
  v_summary text;
begin
  select email into v_email from public.profiles where id = auth.uid();

  -- Extract the primary identifier generically so this trigger works on
  -- tables whose PK is not named "id" (e.g. site_settings.key, company_profile.id).
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'key');
  elsif tg_op = 'UPDATE' then
    -- distinguish soft-delete / restore / archive from a plain update
    if to_jsonb(new) ? 'deleted_at'
       and (to_jsonb(old)->>'deleted_at') is null
       and (to_jsonb(new)->>'deleted_at') is not null then
      v_action := 'delete';
    elsif to_jsonb(new) ? 'deleted_at'
       and (to_jsonb(old)->>'deleted_at') is not null
       and (to_jsonb(new)->>'deleted_at') is null then
      v_action := 'restore';
    elsif to_jsonb(new) ? 'status'
       and (to_jsonb(old)->>'status') is distinct from (to_jsonb(new)->>'status')
       and (to_jsonb(new)->>'status') = 'archived' then
      v_action := 'archive';
    else
      v_action := 'update';
    end if;
    v_id := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'key');
  else -- DELETE (hard)
    v_action := 'delete';
    v_id := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'key');
  end if;

  v_summary := tg_table_name || ' ' || v_action;

  insert into public.audit_logs (actor_id, actor_email, action, entity_type, entity_id, summary)
  values (auth.uid(), v_email, v_action, tg_table_name, v_id, v_summary);

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- --- slugify --------------------------------------------------------
create or replace function app.slugify(txt text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(lower(coalesce(txt,'')), '[^a-z0-9]+', '-', 'g'));
$$;

-- --- Attach triggers to every relevant table ------------------------
do $$
declare
  t text;
  audit_tables text[] := array[
    'courses','schedules','trainers','venues','downloads','news_posts',
    'gallery_images','faqs','testimonials','company_profile','site_settings',
    'enquiries','proposal_requests','participants','certificates','media','profiles'
  ];
  updated_at_tables text[] := array[
    'profiles','courses','schedules','trainers','venues','downloads','news_posts',
    'gallery_images','faqs','testimonials','company_profile','site_settings',
    'enquiries','proposal_requests','participants','certificates','media'
  ];
  actor_tables text[] := array[
    'courses','schedules','downloads','news_posts','gallery_images','faqs',
    'testimonials','participants','certificates','media'
  ];
begin
  foreach t in array updated_at_tables loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$s;', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$s
                    for each row execute function app.set_updated_at();', t);
  end loop;

  foreach t in array actor_tables loop
    execute format('drop trigger if exists trg_%1$s_stamp on public.%1$s;', t);
    execute format('create trigger trg_%1$s_stamp before insert or update on public.%1$s
                    for each row execute function app.stamp_actor();', t);
  end loop;

  foreach t in array audit_tables loop
    execute format('drop trigger if exists trg_%1$s_audit on public.%1$s;', t);
    execute format('create trigger trg_%1$s_audit after insert or update or delete on public.%1$s
                    for each row execute function app.audit_trigger();', t);
  end loop;
end$$;

-- --- Global admin search --------------------------------------------
-- Returns a unified result set across the primary entities. Used by the
-- Cmd-K command palette. SECURITY DEFINER + role gate so only staff run it.
create or replace function app.global_search(q text, max_rows int default 20)
returns table (entity_type text, entity_id uuid, title text, subtitle text, rank real)
language sql
stable
security definer
set search_path = public
as $$
  -- Scope: operational + website content only (enquiries/proposals excluded per locked scope).
  with input as (select nullif(trim(q), '') as q)
  select * from (
    select 'course'::text, c.id, c.title, c.category, similarity(c.title, i.q)
      from public.courses c, input i where i.q is not null and c.deleted_at is null and c.title ilike '%'||i.q||'%'
    union all
    select 'news', n.id, n.title, n.status::text, similarity(n.title, i.q)
      from public.news_posts n, input i where i.q is not null and n.deleted_at is null and n.title ilike '%'||i.q||'%'
    union all
    select 'participant', pt.id, pt.full_name, pt.company, similarity(pt.full_name, i.q)
      from public.participants pt, input i where i.q is not null and pt.deleted_at is null and pt.full_name ilike '%'||i.q||'%'
    union all
    select 'media', m.id, m.file_name, m.kind::text, similarity(m.file_name, i.q)
      from public.media m, input i where i.q is not null and m.deleted_at is null and m.file_name ilike '%'||i.q||'%'
  ) results(entity_type, entity_id, title, subtitle, rank)
  where app.is_editor()
  order by rank desc nulls last
  limit greatest(max_rows, 1);
$$;
