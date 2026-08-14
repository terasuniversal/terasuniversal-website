import type { ReactNode } from "react";

/**
 * Lightweight inline SVG icons for the admin navigation.
 *
 * Deliberately dependency-free: a small set of 24×24 stroke icons drawn to the
 * same grid, rendered with `currentColor` so the sidebar can tint them (gold on
 * the active item). Kept separate from any business icon usage so this stays a
 * pure presentational map.
 */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const ICONS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </>
  ),
  courses: (
    <>
      <path d="M12 6.5 4 10l8 3.5L20 10l-8-3.5Z" />
      <path d="M7 12v4c0 1 2.2 2.5 5 2.5s5-1.5 5-2.5v-4" />
      <path d="M4 10v5" />
    </>
  ),
  trainers: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.5-3 2.5-4.5 5.5-4.5s5 1.5 5.5 4.5" />
      <circle cx="17.5" cy="9" r="2.3" />
      <path d="M15.5 14.6c2.6.1 4.4 1.5 5 4.4" />
    </>
  ),
  schedules: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18" />
      <path d="M8 2.5v4M16 2.5v4" />
    </>
  ),
  participants: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.5-3 2.5-4.5 5.5-4.5s5 1.5 5.5 4.5" />
      <path d="M16 5.2a3 3 0 0 1 0 5.6" />
      <path d="M17.5 14.7c2 .4 3.2 1.8 3.6 4.3" />
    </>
  ),
  companies: (
    <>
      <rect x="4" y="3" width="10" height="18" rx="1.5" />
      <path d="M14 8h6v13" />
      <path d="M7 7h1.5M7 11h1.5M7 15h1.5" />
      <path d="M17 12h1.5M17 16h1.5" />
    </>
  ),
  attendance: (
    <>
      <path d="M9 11.5 11 13.5 15.5 9" />
      <rect x="3.5" y="4.5" width="17" height="16" rx="2" />
    </>
  ),
  assessment: (
    <>
      <path d="M9 6h6M9 11h6M9 16h3" />
      <rect x="4" y="3.5" width="16" height="18" rx="2" />
      <path d="M8 2.5v2M16 2.5v2" />
    </>
  ),
  certificates: (
    <>
      <circle cx="12" cy="9" r="5.5" />
      <path d="M9.5 13.5 8 20l4-2 4 2-1.5-6.5" />
    </>
  ),
  "cert-templates": (
    <>
      <path d="m12 3 8 4-8 4-8-4 8-4Z" />
      <path d="m4 11 8 4 8-4" />
      <path d="m4 15 8 4 8-4" />
    </>
  ),
  sales: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7" />
      <path d="M3 12h18" />
    </>
  ),
  leads: (
    <>
      <path d="M4 5 11 13v6l3-2v-4l7-8H4Z" />
    </>
  ),
  opportunities: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  quotations: (
    <>
      <path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5Z" />
      <path d="M14 3.5V8h4" />
      <path d="M9 12h6M9 15.5h6" />
    </>
  ),
  followups: (
    <>
      <path d="M6.5 3.5h3l1.5 4.5-2 1.5a11 11 0 0 0 4.5 4.5l1.5-2 4.5 1.5v3A1.5 1.5 0 0 1 18 18 14 14 0 0 1 6 6a1.5 1.5 0 0 1 .5-2.5Z" />
    </>
  ),
  tasks: (
    <>
      <rect x="3.5" y="4" width="17" height="16.5" rx="2" />
      <path d="m7.5 12 2 2 4-4.5" />
      <path d="M16 8h1M16 12h1M16 16h1" />
    </>
  ),
  "sales-reports": (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="m8 16 3.5-5 3 2 3.5-6" />
    </>
  ),
  news: (
    <>
      <path d="M4 5h13a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2V5Z" />
      <path d="M6 19a2 2 0 0 0 2 2h11v-3" />
      <path d="M7 8h7M7 12h7M7 16h4" />
    </>
  ),
  gallery: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="9.5" r="1.6" />
      <path d="m6 17 4.5-5 3.5 3 3-3.5L20 17" />
    </>
  ),
  faq: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.2a2.5 2.5 0 0 1 4.9.8c0 1.6-2.5 2.2-2.5 3.5" />
      <circle cx="12" cy="16.6" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  downloads: (
    <>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M4 17v2a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2" />
    </>
  ),
  company: (
    <>
      <rect x="4" y="3" width="10" height="18" rx="1.5" />
      <path d="M14 8h6v13" />
      <path d="M7 7h1.5M7 11h1.5M7 15h1.5" />
      <path d="M17 12h1.5M17 16h1.5" />
    </>
  ),
  media: (
    <>
      <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h3l2-2h6a2 2 0 0 1 2 2v2" />
      <rect x="3.5" y="7" width="17" height="12.5" rx="2" />
      <path d="M7 14.5h10" />
    </>
  ),
  automation: (
    <>
      <path d="M13 3 5 13.5h6L11 21l8-10.5h-6L13 3Z" />
    </>
  ),
  system: (
    <>
      <rect x="2.5" y="5" width="19" height="13" rx="2" />
      <path d="M8 21h8M12 18v3" />
    </>
  ),
  backups: (
    <>
      <path d="M12 3 4.5 6v5.5c0 4.5 3 8 7.5 9.5 4.5-1.5 7.5-5 7.5-9.5V6L12 3Z" />
      <path d="m8.8 12 2.2 2.2 4-4" />
    </>
  ),
  audit: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.5-3 2.5-4.5 5.5-4.5s5 1.5 5.5 4.5" />
      <path d="M16.5 5a2.8 2.8 0 1 1 0 5.6" />
    </>
  ),
  feedback: (
    <>
      <path d="M4 5.5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4H4a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z" />
      <path d="M8 10h8M8 13.5h5" />
    </>
  ),
  "feedback-responses": (
    <>
      <path d="M8 6.5 5.5 9 3.5 7" />
      <path d="M9 5.5h11M9 11h11M9 16.5h11" />
      <path d="M8 15 5.5 17.5 3.5 15.5" />
    </>
  ),
  "feedback-issues": (
    <>
      <path d="M5 3.5h9l5 5v12H5a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z" />
      <path d="M14 3.5V9h5" />
      <path d="M9 12v.01M12 12v.01" />
    </>
  ),
  "feedback-actions": (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.5 12.2 2.3 2.3 4.8-4.8" />
    </>
  ),
};

export function NavIcon({ name }: { name: string }) {
  return Icon({ children: ICONS[name] ?? <circle cx="12" cy="12" r="8.5" /> });
}
