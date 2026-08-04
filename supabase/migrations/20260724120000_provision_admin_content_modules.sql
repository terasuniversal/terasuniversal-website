-- Additive migration for the production CRM.  It intentionally does not
-- alter legacy course, participant or certificate tables.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'media_kind') then
    create type public.media_kind as enum ('image', 'pdf', 'document', 'video', 'other');
  end if;
end $$;

create table if not exists public.media_folders (
  id uuid primary key default gen_random_uuid(), name text not null,
  parent_id uuid references public.media_folders(id) on delete cascade,
  path text not null default '/', created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), unique(parent_id, name)
);

create table if not exists public.media (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references public.media_folders(id) on delete set null,
  kind public.media_kind not null default 'image', bucket text not null default 'media',
  storage_path text not null, public_url text, file_name text not null,
  mime_type text, file_size bigint, width integer, height integer, alt_text text,
  title text, status public.content_status not null default 'published',
  created_by uuid references public.profiles(id), created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique(bucket, storage_path)
);

create table if not exists public.downloads (
  id uuid primary key default gen_random_uuid(), title text not null, slug text unique,
  description text, category text, media_id uuid references public.media(id) on delete set null,
  file_url text, file_size bigint, download_count integer not null default 0,
  status public.content_status not null default 'published', sort_order integer not null default 0,
  created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.news_categories (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  sort_order integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.news_posts (
  id uuid primary key default gen_random_uuid(), title text not null, slug text not null unique,
  excerpt text, body text, category_id uuid references public.news_categories(id) on delete set null,
  featured_image_url text, featured boolean not null default false,
  status public.content_status not null default 'draft', scheduled_for timestamptz, published_at timestamptz,
  seo_title text, seo_description text, author_id uuid references public.profiles(id),
  created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.gallery_categories (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  sort_order integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.gallery_images (
  id uuid primary key default gen_random_uuid(), title text, alt_text text not null default '',
  media_id uuid references public.media(id) on delete set null, image_url text not null,
  category_id uuid references public.gallery_categories(id) on delete set null,
  featured boolean not null default false, status public.content_status not null default 'published',
  sort_order integer not null default 0, created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.faq_categories (
  id uuid primary key default gen_random_uuid(), name text not null, slug text not null unique,
  sort_order integer not null default 0, created_at timestamptz not null default now()
);
create table if not exists public.faqs (
  id uuid primary key default gen_random_uuid(), question text not null, answer text not null,
  category_id uuid references public.faq_categories(id) on delete set null,
  status public.content_status not null default 'published', sort_order integer not null default 0,
  created_by uuid references public.profiles(id), updated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);

create table if not exists public.company_profile (
  id integer primary key default 1 check (id = 1), legal_name text, tagline text, about text, vision text, mission text,
  services jsonb not null default '[]'::jsonb, phone text, email_training text, email_admin text, address text,
  city text, state text, postcode text, country text default 'Malaysia', google_map_embed text, whatsapp text,
  social_media jsonb not null default '{}'::jsonb, updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create index if not exists idx_downloads_live on public.downloads(category) where deleted_at is null;
create index if not exists idx_news_live on public.news_posts(updated_at desc) where deleted_at is null;
create index if not exists idx_gallery_live on public.gallery_images(sort_order) where deleted_at is null;
create index if not exists idx_faqs_live on public.faqs(sort_order) where deleted_at is null;
create index if not exists idx_media_live on public.media(created_at desc) where deleted_at is null;

alter table public.media_folders enable row level security;
alter table public.media enable row level security;
alter table public.downloads enable row level security;
alter table public.news_categories enable row level security;
alter table public.news_posts enable row level security;
alter table public.gallery_categories enable row level security;
alter table public.gallery_images enable row level security;
alter table public.faq_categories enable row level security;
alter table public.faqs enable row level security;
alter table public.company_profile enable row level security;

do $$ declare t text; begin
  foreach t in array array['downloads','news_posts','gallery_images','faqs','media'] loop
    execute format('create policy %1$s_public_read on public.%1$s for select using (status = ''published'' and deleted_at is null)', t);
    execute format('create policy %1$s_editor_read on public.%1$s for select using (app.is_editor())', t);
    execute format('create policy %1$s_editor_insert on public.%1$s for insert with check (app.is_editor())', t);
    execute format('create policy %1$s_editor_update on public.%1$s for update using (app.is_editor()) with check (app.is_editor())', t);
    execute format('create policy %1$s_admin_delete on public.%1$s for delete using (app.is_admin())', t);
  end loop;
  foreach t in array array['news_categories','gallery_categories','faq_categories','media_folders'] loop
    execute format('create policy %1$s_editor_all on public.%1$s for all using (app.is_editor()) with check (app.is_editor())', t);
  end loop;
end $$;
create policy company_profile_public_read on public.company_profile for select using (true);
create policy company_profile_editor_insert on public.company_profile for insert with check (app.is_editor());
create policy company_profile_editor_update on public.company_profile for update using (app.is_editor()) with check (app.is_editor());

grant select on public.media_folders, public.media, public.downloads, public.news_categories, public.news_posts, public.gallery_categories, public.gallery_images, public.faq_categories, public.faqs, public.company_profile to anon, authenticated;
grant insert, update, delete on public.media_folders, public.media, public.downloads, public.news_categories, public.news_posts, public.gallery_categories, public.gallery_images, public.faq_categories, public.faqs, public.company_profile to authenticated;
