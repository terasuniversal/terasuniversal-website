alter table public.courses add column if not exists status text not null default 'draft' check (status in ('draft','published','archived'));
update public.courses set status = coalesce(status, cms_status::text, 'draft') where status is null;
