-- Registers the Legacy Import review module so requireModuleAccess()/
-- has_module_access_level() can grant/deny it -- without a catalog row,
-- has_module_access() denies everyone except super_admin, including plain
-- Admins, since it falls back to `staff_module_catalog.min_role` lookup.
-- min_role 'admin' matches this module's actual sensitivity: raw legacy PII
-- and participant-identity decisions, never trainer/editor-visible.
insert into public.staff_module_catalog (module_key, label, group_key, min_role, is_active)
values ('legacy_import', 'Legacy Import', 'training', 'admin', true)
on conflict (module_key) do nothing;
