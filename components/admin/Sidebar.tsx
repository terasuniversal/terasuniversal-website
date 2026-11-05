"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";
import { activeNavKey, visibleNavGroups } from "../../lib/admin-nav";
import type { UserRole } from "../../lib/supabase/database.types";
import { NavIcon } from "./icons";

// Spoken after a nav count so "Certificates 4" is not ambiguous.
const BADGE_DESCRIPTIONS: Record<string, string> = {
  certificates: "draft certificates",
  participants: "registered participants",
};

const NONE: ReadonlySet<string> = new Set();

function ChevronIcon() {
  return (
    <svg className="ta-nav-group-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

function RailIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </svg>
  );
}

/**
 * Sidebar contents: brand, navigation and status footer. Renders only the
 * items the current role may access, grouped by department. AdminShell
 * places it in the fixed desktop column and in the mobile drawer; counts
 * and the current path come in as props so this stays a pure component.
 * Group collapse is display-only state owned by AdminShell (shared with the
 * drawer, saved in a cookie) and cannot add or reveal an item the access
 * filter removed.
 */
export function Sidebar({
  role,
  moduleKeys = [],
  accessControlEnabled = false,
  badges = {},
  pathname,
  onNavigate,
  brandAction,
  rail = false,
  onToggleRail,
  collapsed = NONE,
  onToggleGroup,
}: {
  role: UserRole;
  moduleKeys?: readonly string[];
  accessControlEnabled?: boolean;
  badges?: Record<string, number>;
  pathname: string;
  /** Called when a nav link is chosen (the drawer closes itself). */
  onNavigate?: () => void;
  /** Extra control in the brand row, such as the drawer's close button. */
  brandAction?: ReactNode;
  /** Icon-only layout (desktop column). Groups stay open so nothing is hidden. */
  rail?: boolean;
  /** Shows the rail toggle (desktop column only). */
  onToggleRail?: () => void;
  /** Labels of the groups the user collapsed. */
  collapsed?: ReadonlySet<string>;
  onToggleGroup?: (label: string) => void;
}) {
  const idPrefix = useId();
  const groups = visibleNavGroups(role, moduleKeys, accessControlEnabled);
  const activeKey = activeNavKey(pathname, groups.flatMap((group) => group.items));
  return (
    <>
      <div className="ta-sidebar-brand">
        <img src="/brand/teras-emblem-256.png" width={36} height={36} alt="" />
        <span>
          <strong>TERAS CRM</strong>
          <small>Admin workspace</small>
        </span>
        {brandAction}
      </div>
      <nav className="ta-nav" aria-label="Admin navigation">
        {groups.length === 0 && (
          <p className="m-0 px-3 py-4 text-[13px] leading-normal text-muted-foreground">
            No modules are assigned to your account yet. Ask a system administrator for access.
          </p>
        )}
        {groups.map((group, index) => {
          const labelId = `${idPrefix}-group-${index}`;
          const listId = `${idPrefix}-list-${index}`;
          const open = rail || !collapsed.has(group.label);
          const holdsCurrent = group.items.some((item) => item.key === activeKey);
          return (
            <div key={group.label} className="ta-nav-group" role="group" aria-labelledby={labelId}>
              {rail ? (
                <div id={labelId} className="sr-only">{group.label}</div>
              ) : (
                <button type="button" id={labelId} className="ta-nav-group-label" aria-expanded={open} aria-controls={listId} onClick={() => onToggleGroup?.(group.label)}>
                  <span>{group.label}</span>
                  {!open && holdsCurrent && (
                    <>
                      <span className="ta-nav-group-here" aria-hidden="true" />
                      <span className="sr-only">contains the current page</span>
                    </>
                  )}
                  <ChevronIcon />
                </button>
              )}
              <ul id={listId} role="list" className="m-0 list-none p-0" hidden={!open}>
                {group.items.map((item) => {
                  const active = item.key === activeKey;
                  const count = badges[item.key];
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        className={`ta-nav-item${active ? " active" : ""}`}
                        aria-current={active ? "page" : undefined}
                        title={rail ? item.label : undefined}
                        onClick={onNavigate}
                      >
                        <span className="ta-ico" aria-hidden="true">
                          <NavIcon name={item.icon} />
                        </span>
                        <span className="ta-nav-label">{item.label}</span>
                        {count ? (
                          <span className="ta-badge">
                            {count}
                            {BADGE_DESCRIPTIONS[item.key] && <span className="sr-only"> {BADGE_DESCRIPTIONS[item.key]}</span>}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>
      <div className="ta-sidebar-footer">
        <span className="ta-status-dot" aria-hidden="true" />
        <div className="ta-sidebar-footer-text">
          <strong>Secure workspace</strong>
          <small>Admin system online</small>
        </div>
        {onToggleRail && (
          <button type="button" className="ta-rail-toggle" onClick={onToggleRail} aria-label={rail ? "Expand sidebar" : "Collapse sidebar"} title={rail ? "Expand sidebar" : "Collapse sidebar"}>
            <RailIcon />
          </button>
        )}
      </div>
    </>
  );
}
