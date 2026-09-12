-- Restrict HRDF Claims role-default access to Admin while preserving
-- explicit view assignments for non-admin staff.
update public.staff_module_catalog
set min_role = 'admin'
where module_key = 'hrdf_claims'
  and min_role is distinct from 'admin';
