import type { ReactNode } from "react";
import Link from "next/link";

/* Reusable, dependency-free admin UI primitives. */

export function StatCard({
  label,
  value,
  icon,
  href,
}: {
  label: string;
  value: ReactNode;
  icon: string;
  href?: string;
}) {
  const body = (
    <div className="ta-card ta-card-pad ta-stat">
      <div className="ta-stat-top">
        <span className="ta-stat-ico" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="ta-stat-value">{value}</div>
      <div className="ta-stat-label">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Badge({ status }: { status: string }) {
  return <span className={`ta-badge-pill ${status}`}>{status.replace(/_/g, " ")}</span>;
}

export function Card({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ta-card">
      {title && (
        <div className="ta-card-head">
          <h3>{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function EmptyState({ icon = "📭", message }: { icon?: string; message: string }) {
  return (
    <div className="ta-empty">
      <div className="ta-empty-ico" aria-hidden="true">
        {icon}
      </div>
      <p>{message}</p>
    </div>
  );
}

export function PageHead({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="ta-page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Pagination({
  page,
  pageCount,
  basePath,
  query = {},
}: {
  page: number;
  pageCount: number;
  basePath: string;
  query?: Record<string, string>;
}) {
  if (pageCount <= 1) return null;
  const qs = (p: number) => {
    const params = new URLSearchParams({ ...query, page: String(p) });
    return `${basePath}?${params.toString()}`;
  };
  return (
    <div className="ta-pagination">
      {page > 1 && (
        <Link className="ta-btn ta-btn-outline ta-btn-sm" href={qs(page - 1)}>
          ← Prev
        </Link>
      )}
      <span style={{ color: "var(--ta-muted)", fontSize: 13 }}>
        Page {page} of {pageCount}
      </span>
      {page < pageCount && (
        <Link className="ta-btn ta-btn-outline ta-btn-sm" href={qs(page + 1)}>
          Next →
        </Link>
      )}
    </div>
  );
}

export function Field({
  label,
  name,
  error,
  children,
  hint,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="ta-field">
      <label htmlFor={name}>{label}</label>
      {children}
      {hint && <small style={{ color: "var(--ta-muted)" }}>{hint}</small>}
      {error && <span className="ta-error">{error}</span>}
    </div>
  );
}
