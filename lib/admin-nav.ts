import type { UserRole } from "./supabase/database.types";

export interface NavItem {
  key: string;
  /** Stored module key when the display key differs (e.g. certificate templates). */
  moduleKey?: string;
  label: string;
  href: string;
  /** Lightweight inline-SVG icon key, rendered by components/admin/icons.tsx. */
  icon: string;
  minRole: UserRole;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Admin navigation — reflects the LOCKED operational scope, grouped by
 * department (Overview / Training Operations / Certification / Sales /
 * Website Content / Administration). Only routes that exist are listed.
 * Excluded by scope: Enquiries, Proposal Requests, Website Settings.
 */
export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", href: "/admin/dashboard", icon: "dashboard", minRole: "editor" },
      { key: "reports", label: "Reports & Analytics", href: "/admin/reports", icon: "reports", minRole: "editor" },
    ],
  },
  {
    label: "Training Operations",
    items: [
      { key: "courses", label: "Courses", href: "/admin/courses", icon: "courses", minRole: "editor" },
      { key: "trainers", label: "Trainers", href: "/admin/trainers", icon: "trainers", minRole: "editor" },
      { key: "schedules", label: "Training Schedule", href: "/admin/schedules", icon: "schedules", minRole: "editor" },
      { key: "participants", label: "Participants", href: "/admin/participants", icon: "participants", minRole: "editor" },
      { key: "companies", label: "Companies", href: "/admin/companies", icon: "companies", minRole: "editor" },
      { key: "attendance", label: "Attendance", href: "/admin/attendance", icon: "attendance", minRole: "trainer" },
      { key: "assessment", label: "Assessment", href: "/admin/assessment", icon: "assessment", minRole: "trainer" },
      // Reconciled 2026-08-23: this module and its routes already existed
      // and were already DB-guarded (requireModuleAccess("assessors")) --
      // only the nav entry and the MODULE_CATALOG row (lib/auth/rbac.ts)
      // were missing, making it unreachable/ungrantable through this UI.
      { key: "assessors", label: "Assessors", href: "/admin/assessors", icon: "assessors", minRole: "admin" },
      { key: "legacy_import", label: "Legacy Import", href: "/admin/participants/legacy-import", icon: "legacy_import", minRole: "admin" },
    ],
  },
  {
    label: "Certification",
    items: [
      { key: "certificates", label: "Certificates", href: "/admin/certificates", icon: "certificates", minRole: "trainer" },
      { key: "cert-templates", moduleKey: "certificate_templates", label: "Certificate Templates", href: "/admin/certificates/templates", icon: "cert-templates", minRole: "admin" },
    ],
  },
  {
    label: "Sales",
    items: [
      // Only production-backed routes -- matches this file's own "only
      // routes that exist" convention. All Sales routes are now real as of
      // Phase 4C (Reports was the last SalesPlaceholder stub).
      { key: "sales", label: "Sales Dashboard", href: "/admin/sales", icon: "sales", minRole: "editor" },
      { key: "sales_leads", label: "Leads", href: "/admin/sales/leads", icon: "leads", minRole: "editor" },
      { key: "sales_opportunities", label: "Opportunities", href: "/admin/sales/opportunities", icon: "opportunities", minRole: "editor" },
      { key: "sales_quotations", label: "Quotations", href: "/admin/sales/quotations", icon: "quotations", minRole: "editor" },
      { key: "invoices", label: "Invoices", href: "/admin/invoices", icon: "quotations", minRole: "editor" },
      { key: "sales_followups", label: "Follow-ups", href: "/admin/sales/follow-ups", icon: "followups", minRole: "editor" },
      { key: "sales_tasks", label: "Tasks", href: "/admin/sales/tasks", icon: "tasks", minRole: "editor" },
      { key: "sales_reports", label: "Reports", href: "/admin/sales/reports", icon: "sales-reports", minRole: "editor" },
    ],
  },
  {
    label: "Marketing",
    items: [
      { key: "marketing", label: "Marketing Dashboard", href: "/admin/marketing", icon: "campaigns", minRole: "editor" },
      { key: "marketing_campaigns", label: "Campaigns", href: "/admin/marketing/campaigns", icon: "campaigns", minRole: "editor" },
      // Phase 1B-B -- Contacts. Reports/Attribution/Meta Ads are not live
      // yet (their module keys don't exist in staff_module_catalog), so
      // they are deliberately not listed here.
      { key: "marketing_contacts", label: "Contacts", href: "/admin/marketing/contacts", icon: "contacts", minRole: "editor" },
    ],
  },
  {
    label: "Website Content",
    items: [
      { key: "news", label: "News", href: "/admin/news", icon: "news", minRole: "editor" },
      { key: "gallery", label: "Gallery", href: "/admin/gallery", icon: "gallery", minRole: "editor" },
      { key: "faq", label: "FAQ", href: "/admin/faq", icon: "faq", minRole: "editor" },
      { key: "downloads", label: "Downloads", href: "/admin/downloads", icon: "downloads", minRole: "editor" },
      { key: "company", label: "Company Profile", href: "/admin/company", icon: "company", minRole: "editor" },
      { key: "media", label: "Media Library", href: "/admin/media", icon: "media", minRole: "editor" },
    ],
  },
  {
    label: "Administration",
    items: [
      { key: "automation", label: "Automation Centre", href: "/admin/automation", icon: "automation", minRole: "admin" },
      { key: "system", label: "System Health", href: "/admin/system", icon: "system", minRole: "admin" },
      { key: "backups", label: "Backup Manager", href: "/admin/backups", icon: "backups", minRole: "admin" },
      { key: "audit", label: "Audit Log", href: "/admin/audit", icon: "audit", minRole: "admin" },
      { key: "users", label: "Users & Roles", href: "/admin/users", icon: "users", minRole: "super_admin" },
    ],
  },
  {
    label: "Feedback",
    items: [
      { key: "feedback", label: "Feedback Dashboard", href: "/admin/feedback", icon: "feedback", minRole: "editor" },
      { key: "feedback_responses", label: "Responses", href: "/admin/feedback/responses", icon: "feedback-responses", minRole: "editor" },
      { key: "feedback_issues", label: "Issues", href: "/admin/feedback/issues", icon: "feedback-issues", minRole: "editor" },
      { key: "feedback_actions", label: "Improvement Actions", href: "/admin/feedback/actions", icon: "feedback-actions", minRole: "editor" },
    ],
  },
];
