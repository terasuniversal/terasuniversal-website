"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "../../lib/admin-nav";
import { hasMinRole } from "../../lib/auth/rbac";
import type { UserRole } from "../../lib/supabase/database.types";
import { NavIcon } from "./icons";

/**
 * Left navigation. Renders only the items the current role may access, grouped
 * by department. Counts (e.g. new enquiries) are passed in so the sidebar stays
 * a pure, cache-friendly client component.
 */
export function Sidebar({
  role,
  modules,
  badges = {},
}: {
  role: UserRole;
  /** Module keys the current staff member may access (empty/undefined = all role-permitted). */
  modules?: string[];
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();

  const hasModule = (key: string) => {
    if (role === "super_admin") return true;
    if (!modules) return true;
    return modules.includes(key);
  };

  return (
    <aside className="ta-sidebar" aria-label="Admin navigation">
      <div className="ta-sidebar-brand">
        <img src="/teras-universal-logo.png" alt="" />
        <span>
          <strong>TERAS UNIVERSAL</strong>
          <small>Admin CMS</small>
        </span>
      </div>
      <nav className="ta-nav">
        {NAV.map((group) => {
          const items = group.items.filter((i) => hasMinRole(role, i.minRole) && hasModule(i.key));
          if (items.length === 0) return null;
          return (
            <div key={group.label}>
              <div className="ta-nav-group-label">{group.label}</div>
              {items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                const count = badges[item.key];
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`ta-nav-item${active ? " active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    <span className="ta-ico" aria-hidden="true">
                      <NavIcon name={item.icon} />
                    </span>
                    <span className="ta-nav-label">{item.label}</span>
                    {count ? <span className="ta-badge">{count}</span> : null}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className="ta-sidebar-footer" aria-label="Workspace status">
        <span className="ta-status-dot" aria-hidden="true" />
        <div>
          <strong>Secure workspace</strong>
          <small>Admin system online</small>
        </div>
      </div>
    </aside>
  );
}
