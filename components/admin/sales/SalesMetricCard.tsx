import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

// The dashboard's countValue() yields this string when a metric's query
// failed; render it as an error state rather than as a figure.
const UNAVAILABLE = "Unavailable";

/**
 * Presentational KPI tile for the Sales dashboard. It only formats a
 * count the page already computed — no data access or business rules.
 * `attention` highlights a non-zero count of overdue/due work.
 */
export function SalesMetricCard({
  label,
  value,
  href,
  context,
  attention = false,
}: {
  label: string;
  value: ReactNode;
  href: string;
  /** Optional context line — only pass real data, never fabricated trends. */
  context?: string;
  attention?: boolean;
}) {
  const unavailable = value === UNAVAILABLE;
  const needsAction = attention && typeof value === "number" && value > 0;

  return (
    <Link
      href={href}
      data-slot="metric-link"
      className="group block h-full rounded-xl text-inherit no-underline"
      // Explicit name: the card's nested layout otherwise reaches some
      // assistive tech as an unnamed link. Starts with the visible label.
      aria-label={[`${label}: ${unavailable ? "unavailable" : value}`, needsAction && "needs action", context].filter(Boolean).join(", ")}
    >
      <Card
        className={cn(
          "h-full gap-2 px-5 py-4 transition-[box-shadow,border-color] group-hover:border-primary/30 group-hover:shadow-[var(--ta-shadow-hover)]",
          needsAction && "border-l-4 border-l-accent",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[13px] font-semibold leading-snug text-muted-foreground">{label}</span>
          {needsAction && <Badge variant="accent">Needs action</Badge>}
        </div>
        {unavailable ? (
          <Badge variant="destructive" className="mt-1">Unavailable</Badge>
        ) : (
          <span className="font-heading text-3xl font-bold leading-none tabular-nums text-primary">{value}</span>
        )}
        {context && <span className="text-xs text-muted-foreground">{context}</span>}
      </Card>
    </Link>
  );
}
