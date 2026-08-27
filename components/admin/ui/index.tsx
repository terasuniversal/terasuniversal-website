import { forwardRef, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
import { Card as ShadcnCard } from "@/components/ui/card";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Textarea as ShadcnTextarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/* Reusable admin UI primitives. Badge, Card, Input and Textarea are built
   on the shadcn/ui primitives (components/ui/badge.tsx, card.tsx,
   input.tsx, textarea.tsx). Select is deliberately NOT — see its own
   comment below. Everything else here is dependency-free. */

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

/**
 * Status → visual tone. Mirrors the color buckets admin.css's
 * `.ta-badge-pill.<status>` rules already define (admin.css lines
 * 192-203, 364-365, 742) — this migration changes the rendering
 * primitive underneath Badge, not which statuses mean what.
 *
 * "info", "warning" and "purple" aren't part of the approved
 * navy/gold/neutral/red/green TERAS palette — they're pre-existing,
 * non-brand status colors (blue/amber/violet) carried over verbatim so
 * business-status meaning doesn't change. Any status not listed here
 * falls back to "plain", matching the current behaviour for statuses
 * admin.css never styled (e.g. task/follow-up priority values, audit
 * action strings): no color, just the base pill shape.
 */
const STATUS_TONE: Record<string, "success" | "info" | "warning" | "neutral" | "danger" | "purple"> = {
  published: "success", won: "success", issued: "success", attended: "success", open: "success",
  completed: "success", competent: "success", pass: "success", submitted: "success",
  healthy: "success", "provider-managed": "success", active: "success", super_admin: "success", admin: "success",
  draft: "info", new: "info", registered: "info", pending: "info", today: "info", editor: "info", trainer: "info",
  scheduled: "warning", in_review: "warning", assigned: "warning", quoted: "warning", closing_soon: "warning",
  full: "warning", confirmed: "warning", qualified: "warning", in_progress: "warning", pending_review: "warning",
  late: "warning", negotiation: "warning",
  archived: "neutral", closed: "neutral", lost: "neutral", cancelled: "neutral", revoked: "neutral",
  no_show: "neutral", not_yet_competent: "neutral", medical_leave: "neutral", excused: "neutral",
  client: "neutral", participant: "neutral", inactive: "neutral", unknown: "neutral",
  fail: "danger", absent: "danger", attention: "danger", overdue: "danger",
  proposal_sent: "purple", contacted: "purple",
};

const TONE_CLASSES: Record<string, string> = {
  success: "bg-success/12 text-success",
  info: "bg-[rgba(47,111,237,0.12)] text-[#2f6fed]",
  warning: "bg-accent/16 text-[#a9791a]",
  neutral: "bg-[rgba(102,112,133,0.14)] text-muted-foreground",
  danger: "bg-destructive/12 text-destructive",
  purple: "bg-[rgba(124,92,255,0.12)] text-[#6d4aff]",
  plain: "bg-transparent text-foreground",
};

export function Badge({ status }: { status: string }) {
  const tone = STATUS_TONE[status] ?? "plain";
  return (
    <ShadcnBadge
      variant="outline"
      className={cn("border-transparent gap-[5px] px-2.5 py-[3px] text-[11.5px] font-bold capitalize", TONE_CLASSES[tone])}
    >
      {status.replace(/_/g, " ")}
    </ShadcnBadge>
  );
}

/**
 * Built on the shadcn/ui Card primitive for the outer wrapper only.
 * The header/title/action/children markup below is kept exactly as it
 * was (plain divs + a literal <h3>), not shadcn's CardHeader/CardTitle/
 * CardAction, for two concrete reasons found while auditing callers:
 *
 * 1. `.ta-followup-panel .ta-card-head { border: 0 }` in admin.css
 *    (used by the Sales follow-up panel, out of scope for this task)
 *    depends on the literal class name `ta-card-head` existing in the
 *    DOM — swapping it for a shadcn-generated class would silently
 *    break that Sales-specific override.
 * 2. `.ta-card-head h3 { font-size: 14.5px }` in admin.css selects an
 *    actual <h3> element — shadcn's CardTitle renders a <div>, which
 *    would drop both that font-size rule and the heading semantics.
 *
 * bg-card/border-border/text-card-foreground below are the approved
 * TERAS tokens for these exact values (--ta-white, --ta-line, --ta-ink).
 * admin.css's own `.ta-card`/`.ta-card-head` rules are unlayered plain
 * CSS, so they already win the cascade over any Tailwind utility here
 * regardless — these tokens are included anyway so the component reads
 * correctly on its own, not because they're doing the visual work today.
 */
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
    <ShadcnCard className="ta-card block gap-0 rounded-[var(--ta-radius)] border-border bg-card p-0 text-card-foreground shadow-[var(--ta-shadow)]">
      {title && (
        <div className="ta-card-head">
          <h3>{title}</h3>
          {action}
        </div>
      )}
      {children}
    </ShadcnCard>
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

/**
 * No shadcn/Radix primitive underneath this one, unlike Badge/Card —
 * decided against it after the audit found two real costs with no
 * visual benefit:
 *
 * 1. shadcn's Label primitive wraps Radix UI's Label, which requires
 *    "use client". Field is used 162 times across 19 files; 18 are
 *    already Client Components (form components using useActionState),
 *    but one — certificates/[id]/page.tsx — is a Server Component.
 *    Next.js allows a Server Component to render a Client Component
 *    leaf without becoming one itself, so this wouldn't have broken
 *    anything, but it would add a client-hydrated boundary to every
 *    Field label for zero visual difference.
 * 2. admin.css's `.ta-field label`, `.ta-field input/select/textarea`,
 *    and `.ta-field .ta-error` rules are unlayered plain CSS — they
 *    already win the cascade over any Tailwind utility for the same
 *    property (see the Card migration report for why). Swapping the
 *    label element wouldn't change how it looks, only how it's built.
 *
 * Given neither cost bought anything visible, the label stays a plain
 * <label>, exactly as before. Tailwind/token classes are added below
 * only where they're not simply redundant with admin.css:
 * - hint previously used an inline `style` (which always wins over any
 *   class); replacing it with `text-muted-foreground` is a real change
 *   in mechanism, not just documentation — verified --ta-muted (used by
 *   the old inline style) and the approved muted-foreground token are
 *   the same #667085, so the rendered color is unchanged.
 * - the outer grid/gap and label typography classes are added the same
 *   way Card's were: redundant under admin.css today, kept for a
 *   component that reads correctly on its own terms.
 */
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
  /** Renders the same literal " *" suffix callers previously baked into
   *  `label` by hand (e.g. `label="Course *"`) — purely visual/textual.
   *  Does not touch `children` and does not add/replace native `required`
   *  on the actual control; callers keep that on their own input/select. */
  required?: boolean;
  /** Opt-in accessibility wiring. Set this to the CHILD CONTROL'S actual
   *  `id` — not `name` — so hint/error get stable `{controlId}-hint`/
   *  `{controlId}-error` ids that the caller then references via the
   *  child's own `aria-describedby`/`aria-invalid` (see fieldA11y()), and
   *  so the label's `htmlFor` targets the real control instead of `name`.
   *  `name` is not a safe id seed: real pages (e.g. the sales opportunity
   *  actions panel) render two Fields with the same `name` but different
   *  child ids, so a `name`-derived id would collide — worse, `label
   *  htmlFor={name}` alone would silently target the OTHER Field's control
   *  instead of its own sibling. Omit to leave both the hint/error markup
   *  and the label targeting exactly as before — fully additive, opt-in. */
  controlId?: string;
  children: ReactNode;
}) {
  return (
    <div className="ta-field grid gap-1.5">
      <label htmlFor={controlId ?? name} className="text-[12.5px] font-bold text-primary">
        {label}
        {required && " *"}
      </label>
      {children}
      {hint && (
        <small id={controlId ? `${controlId}-hint` : undefined} className="text-muted-foreground">
          {hint}
        </small>
      )}
      {error && (
        <span
          id={controlId ? `${controlId}-error` : undefined}
          className="ta-error text-xs font-semibold text-destructive"
        >
          {error}
        </span>
      )}
    </div>
  );
}

/**
 * Pure helper pairing Field's `controlId` prop: computes the
 * `aria-describedby`/`aria-invalid` values a caller wires onto their own
 * control. Server-Component safe (no hook, no context) and does not touch
 * or inspect the child — the caller passes the same `controlId` to both
 * `Field` and this function, and to the control itself.
 */
export function fieldA11y(
  controlId: string,
  { hasHint, hasError }: { hasHint: boolean; hasError: boolean }
): { describedBy: string | undefined; invalid: true | undefined } {
  const ids = [hasHint && `${controlId}-hint`, hasError && `${controlId}-error`].filter(
    (id): id is string => Boolean(id)
  );
  return {
    describedBy: ids.length > 0 ? ids.join(" ") : undefined,
    invalid: hasError ? true : undefined,
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

/**
 * Native prop passthrough (`React.ComponentProps<"input">` + `ref`) — no
 * bespoke API. Works unchanged for both the uncontrolled name/defaultValue
 * Server Action forms (Course, Schedule) and the controlled value/onChange
 * forms (Sales Lead) since both are just standard HTML input props.
 *
 * Four overrides on top of the shadcn primitive, all deliberate:
 * - `shadow-none`: shadcn's Input adds a `shadow-xs` drop shadow that
 *   admin.css's `.ta-field input` rule never declares in its base state
 *   (it only adds a shadow on `:focus`) — with nothing unlayered to
 *   override it, this one *would* leak through and add a shadow that
 *   wasn't there before, so it's cancelled explicitly.
 * - `disabled:*`: shadcn's Input sets `disabled:opacity-50
 *   disabled:cursor-not-allowed disabled:pointer-events-none`. The form-
 *   control audit found no dedicated TERAS disabled visual state — disabled
 *   inputs today render however the browser natively renders them, nothing
 *   more. shadcn's opacity/cursor treatment is a real, new visual layer
 *   with no unlayered admin.css rule to suppress it, so it's neutralized
 *   here rather than silently becoming the new de facto disabled look.
 * - `h-auto self-start`: a real, measured layout bug found during
 *   verification, not a style preference. `.ta-field` is `display: grid`,
 *   whose default `align-items: stretch` inflates a grid item whose own
 *   `height` is `auto` — with shadcn's default `h-9` in play this measured
 *   53.7px instead of the original bare `<input>`'s 41.7px (a 12px
 *   regression, confirmed via getBoundingClientRect against an unmigrated
 *   control on the same running page, not assumed). `self-start` cancels
 *   the grid stretch; `h-auto` then lets the box size purely from its own
 *   content again. Together they reproduce the original 41.6875px exactly
 *   — verified bit-for-bit against the pre-migration control, see the
 *   Input migration report.
 *
 * Everything else (width, min-height, padding, border, radius, background,
 * font, color, the two TERAS focus layers) needs no override: admin.css's
 * `.ta-field input` rule is unlayered plain CSS and already wins the
 * cascade over shadcn's layered Tailwind utilities for every one of those
 * properties (same mechanism documented in the Card/Field reports) —
 * confirmed again for this migration in the verification report, not just
 * assumed. The token classes below are added anyway, for the same
 * "correct and self-explanatory on its own terms" reason Card/Field used
 * theirs, not because they're doing the visual work today.
 */
export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input(
  { className, ...props },
  ref
) {
  return (
    <ShadcnInput
      ref={ref}
      className={cn(
        "h-auto self-start min-h-10 rounded-[9px] border-border bg-card px-3 py-[9px] text-foreground shadow-none",
        "disabled:pointer-events-auto disabled:cursor-auto disabled:opacity-100",
        className
      )}
      {...props}
    />
  );
});

/**
 * Same native-prop-passthrough approach as Input. `.ta-field textarea`
 * shares its entire rule with `.ta-field input` in admin.css (identical
 * width/min-height/padding/border/radius/font/color/focus), so the same
 * cascade-layer reasoning applies — confirmed again for textarea
 * specifically in the migration report, not assumed from the Input result.
 *
 * Overrides on top of the shadcn primitive:
 * - `field-sizing-fixed`: shadcn's Textarea defaults to `field-sizing-
 *   content`, a CSS property that makes the box auto-grow to fit all of
 *   its content. No TERAS textarea does this today — height is driven by
 *   the `rows` attribute, with the browser's native resize handle for
 *   anything longer. `field-sizing-content` would be a real, new
 *   auto-grow behavior the task explicitly forbids inventing, so it's
 *   reset to the CSS-default `fixed` here.
 * - `resize`: explicit `resize: both`, matching the verified pre-existing
 *   native default (measured `resize:both` on every unmigrated textarea
 *   checked) — stated explicitly rather than assumed, since
 *   `field-sizing-content` is documented to interact with resize
 *   handling and there was no reason to leave that ambiguous.
 * - `shadow-none`, `disabled:*`: same reasoning as Input — shadcn's
 *   `shadow-xs` and `disabled:opacity-50/cursor-not-allowed` have no
 *   unlayered admin.css counterpart and would otherwise leak through.
 * - `h-auto self-start`: same grid-stretch fix proven necessary for
 *   Input (`.ta-field` is `display: grid`, default `align-items:
 *   stretch`) — re-verified empirically for Textarea specifically
 *   (measured height matched the pre-migration baseline exactly for
 *   every `rows` value tested, see the migration report), not carried
 *   over on faith from the Input fix.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(function Textarea(
  { className, ...props },
  ref
) {
  return (
    <ShadcnTextarea
      ref={ref}
      className={cn(
        "field-sizing-fixed resize h-auto self-start min-h-10 rounded-[9px] border-border bg-card px-3 py-[9px] text-foreground shadow-none",
        "disabled:pointer-events-auto disabled:cursor-auto disabled:opacity-100",
        className
      )}
      {...props}
    />
  );
});

/**
 * Deliberately NOT built on shadcn/Radix Select, unlike Badge/Card/Input/
 * Textarea — this is the migration decision, not an oversight. A Radix
 * Select is a controlled, JS-rendered popover: on mobile it replaces the
 * OS's own native picker (iOS wheel / Android dialog) with a web popup,
 * and it doesn't participate in native `name`/`defaultValue` FormData
 * submission the way a real `<select>` does, which every one of this
 * codebase's Server Action forms (Course, Schedule) and all 122 selects
 * audited across the app depend on. None of that is worth trading for
 * component-library symmetry, so the DOM here stays a genuine `<select>`.
 *
 * No Tailwind classes are added either, for the same reason: `.ta-field
 * select` in admin.css already provides the complete presentation
 * contract (verified identical to `.ta-field input`'s width/min-height/
 * padding/border/radius/background/font/color/focus — same combined
 * selector, `admin.css` lines 239/243), and there's no shadcn primitive
 * underneath this time introducing anything that needs overriding. This
 * component exists only so callers get the same `Select` import
 * symmetry as Input/Textarea — it is a plain native-prop pass-through.
 */
export const Select = forwardRef<HTMLSelectElement, ComponentProps<"select">>(function Select(
  { className, ...props },
  ref
) {
  return <select ref={ref} className={cn(className)} {...props} />;
});
