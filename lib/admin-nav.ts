import type { UserRole } from "./supabase/database.types";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string; // emoji glyph keeps this dependency-free; swap for an icon set later
  minRole: UserRole;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Admin navigation — reflects the LOCKED operational scope.
 * Excluded by scope: Enquiries, Proposal Requests, Website Settings.
 */
export const NAV: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", href: "/admin/dashboard", icon: "▦", minRole: "editor" },
      { key: "reports", label: "Reports & Analytics", href: "/admin/reports", icon: "📊", minRole: "editor" },
    ],
  },
  {
    label: "Training Operations",
    items: [
      { key: "courses", label: "Courses", href: "/admin/courses", icon: "🎓", minRole: "editor" },
      { key: "trainers", label: "Trainers", href: "/admin/trainers", icon: "🧑‍🏫", minRole: "editor" },
      { key: "schedules", label: "Training Schedule", href: "/admin/schedules", icon: "🗓", minRole: "editor" },
      { key: "participants", label: "Participants", href: "/admin/participants", icon: "👥", minRole: "editor" },
      { key: "companies", label: "Companies", href: "/admin/companies", icon: "🏢", minRole: "editor" },
      { key: "attendance", label: "Attendance", href: "/admin/attendance", icon: "✅", minRole: "trainer" },
      { key: "assessment", label: "Assessment", href: "/admin/assessment", icon: "📝", minRole: "trainer" },
      { key: "certificates", label: "Certificates", href: "/admin/certificates", icon: "🏅", minRole: "trainer" },
      { key: "cert-templates", label: "Certificate Templates", href: "/admin/certificates/templates", icon: "🧩", minRole: "admin" },
    ],
  },
  {
    label: "Website Content",
    items: [
      { key: "news", label: "News", href: "/admin/news", icon: "📰", minRole: "editor" },
      { key: "gallery", label: "Gallery", href: "/admin/gallery", icon: "🖼", minRole: "editor" },
      { key: "faq", label: "FAQ", href: "/admin/faq", icon: "❔", minRole: "editor" },
      { key: "downloads", label: "Downloads", href: "/admin/downloads", icon: "⬇", minRole: "editor" },
      { key: "company", label: "Company Profile", href: "/admin/company", icon: "🏢", minRole: "editor" },
      { key: "media", label: "Media Library", href: "/admin/media", icon: "🗂", minRole: "editor" },
    ],
  },
  {
    label: "Administration",
    items: [
      { key: "automation", label: "Automation Centre", href: "/admin/automation", icon: "⚙️", minRole: "admin" },
      { key: "system", label: "System Health", href: "/admin/system", icon: "🩺", minRole: "admin" },
      { key: "backups", label: "Backup Manager", href: "/admin/backups", icon: "🛡️", minRole: "admin" },
      { key: "audit", label: "Audit Log", href: "/admin/audit", icon: "📋", minRole: "admin" },
      { key: "users", label: "Users & Roles", href: "/admin/users", icon: "🔑", minRole: "super_admin" },
    ],
  },
];
