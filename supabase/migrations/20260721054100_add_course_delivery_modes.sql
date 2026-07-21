alter table public.courses add column if not exists delivery_modes text[] not null default '{}';
