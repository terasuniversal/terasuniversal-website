-- Reconcile deterministic Staff Module Catalog reference data.
--
-- This is reference configuration only. It deliberately does not delete
-- unknown/inactive historical rows, grant user access, or change profiles.

insert into public.staff_module_catalog (module_key, label, group_key, min_role, is_active)
values
  ('assessment', 'Assessment', 'training', 'trainer', true),
  ('assessors', 'Assessors', 'training', 'admin', true),
  ('attendance', 'Attendance', 'training', 'trainer', true),
  ('audit', 'Audit Log', 'administration', 'admin', true),
  ('automation', 'Automation Centre', 'administration', 'admin', true),
  ('backups', 'Backup Manager', 'administration', 'admin', true),
  ('certificate_templates', 'Certificate Templates', 'certification', 'admin', true),
  ('certificates', 'Certificates', 'certification', 'trainer', true),
  ('companies', 'Companies', 'training', 'editor', true),
  ('company', 'Company Profile', 'website', 'editor', true),
  ('courses', 'Courses', 'training', 'editor', true),
  ('dashboard', 'Dashboard', 'overview', 'editor', true),
  ('downloads', 'Downloads', 'website', 'editor', true),
  ('faq', 'FAQ', 'website', 'editor', true),
  ('feedback', 'Feedback Dashboard', 'feedback', 'editor', true),
  ('feedback_actions', 'Feedback Actions', 'feedback', 'editor', true),
  ('feedback_issues', 'Feedback Issues', 'feedback', 'editor', true),
  ('feedback_responses', 'Feedback Responses', 'feedback', 'editor', true),
  ('gallery', 'Gallery', 'website', 'editor', true),
  ('hrdf_claims', 'HRDF Claims', 'sales', 'editor', true),
  ('invoices', 'Invoices', 'sales', 'editor', true),
  ('legacy_import', 'Legacy Import', 'training', 'admin', true),
  ('marketing', 'Marketing Dashboard', 'marketing', 'editor', true),
  ('marketing_campaigns', 'Campaigns', 'marketing', 'editor', true),
  ('marketing_contacts', 'Marketing Contacts', 'marketing', 'editor', true),
  ('media', 'Media Library', 'website', 'editor', true),
  ('news', 'News', 'website', 'editor', true),
  ('participants', 'Participants', 'training', 'editor', true),
  ('reports', 'Reports & Analytics', 'overview', 'editor', true),
  ('sales', 'Sales Dashboard', 'sales', 'editor', true),
  ('sales_followups', 'Follow-ups', 'sales', 'editor', true),
  ('sales_leads', 'Leads', 'sales', 'editor', true),
  ('sales_opportunities', 'Opportunities', 'sales', 'editor', true),
  ('sales_quotations', 'Quotations', 'sales', 'editor', true),
  ('sales_reports', 'Sales Reports', 'sales', 'editor', true),
  ('sales_tasks', 'Tasks', 'sales', 'editor', true),
  ('schedules', 'Training Schedule', 'training', 'editor', true),
  ('system', 'System Health', 'administration', 'admin', true),
  ('trainers', 'Trainers', 'training', 'editor', true),
  ('users', 'Staff Users', 'administration', 'admin', true)
on conflict (module_key) do update set
  label = excluded.label,
  group_key = excluded.group_key,
  min_role = excluded.min_role,
  is_active = excluded.is_active;
