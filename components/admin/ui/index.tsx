import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import Link from "next/link";

/* Reusable, dependency-free admin UI primitives. */

export function StatCard({
  label,
  value,
  icon,
  href,
  context,
}: {
  label: string;
  value: ReactNode;
  icon: ReactNode;
  href?: string;
  /** Optional small context line — only pass real data, never fabricated trends. */
  context?: string;
}) {
  const body = (
    <div className="ta-card ta-card-pad ta-stat ta-stat-card">
      <div className="ta-stat-top">
        <span className="ta-stat-ico" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="ta-stat-value">{value}</div>
      <div className="ta-stat-label">{label}</div>
      {context && <div className="ta-stat-context">{context}</div>}
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

export function EmptyState({
  icon = "📭",
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title?: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="ta-empty">
      <div className="ta-empty-ico" aria-hidden="true">
        {icon}
      </div>
      {title && <div className="ta-empty-title">{title}</div>}
      <p>{message}</p>
      {action && <div className="ta-empty-action">{action}</div>}
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
  required,
  controlId,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  required?: boolean;
  controlId?: string;
  children: ReactNode;
}) {
  const id = controlId ?? name;
  return (
    <div className="ta-field">
      <label htmlFor={id}>
        {label}
        {required && <span className="ta-req" aria-hidden="true"> *</span>}
      </label>
      {children}
      {hint && <small style={{ color: "var(--ta-muted)" }}>{hint}</small>}
      {error && <span className="ta-error">{error}</span>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}

export function fieldA11y(name: string, options: { hasHint?: boolean; hasError?: boolean } = {}) {
  const describedBy = [options.hasHint ? `${name}-hint` : null, options.hasError ? `${name}-error` : null]
    .filter(Boolean)
    .join(" ");
  return {
    describedBy: describedBy || undefined,
    invalid: options.hasError || undefined,
  };
}

/** Small 24-grid stroke icon wrapper for KPI cards (matches icons.tsx style). */
export function SvgIcon({ children }: { children: ReactNode }) {
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

/** Round avatar — photo when provided, initials placeholder otherwise. */
export function Avatar({
  name,
  src,
  size = 38,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  const initials = name
    .trim()
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (src) {
    return <img className="ta-avatar-img" src={src} alt="" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="ta-avatar"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.34) }}
      aria-hidden="true"
    >
      {initials || "•"}
    </span>
  );
}
