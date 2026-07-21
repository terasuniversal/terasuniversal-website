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
    ],
  },
  {
    label: "Training Operations",
    items: [
      { key: "courses", label: "Courses", href: "/admin/courses", icon: "🎓", minRole: "editor" },
      { key: "schedules", label: "Training Schedule", href: "/admin/schedules", icon: "🗓", minRole: "editor" },
      { key: "participants", label: "Participants", href: "/admin/participants", icon: "👥", minRole: "editor" },
      { key: "attendance", label: "Attendance & Assessment", href: "/admin/attendance", icon: "✅", minRole: "editor" },
      { key: "certificates", label: "Certificates", href: "/admin/certificates", icon: "🏅", minRole: "editor" },
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
      { key: "audit", label: "Audit Log", href: "/admin/audit", icon: "📋", minRole: "admin" },
      { key: "users", label: "Users & Roles", href: "/admin/users", icon: "🔑", minRole: "super_admin" },
    ],
  },
];
