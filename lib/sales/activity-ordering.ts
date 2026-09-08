import type { SalesActivityRow } from "./crm";

/**
 * Stable chronological ordering for activity timelines.
 *
 * The governed Won and reversal RPCs append paired events in business order,
 * but PostgreSQL timestamps can have identical precision for both inserts.
 * Keep timestamp ordering primary, then apply the domain precedence for those
 * pairs, with the row id as a deterministic final tie-breaker.
 */
const EQUAL_TIMESTAMP_BUSINESS_ORDER: Partial<Record<SalesActivityRow["type"], number>> = {
  quotation_accepted: 10,
  opportunity_won: 20,
  quotation_cancelled: 30,
  opportunity_reversed: 40,
};

export function compareSalesActivityRows(a: SalesActivityRow, b: SalesActivityRow): number {
  const timestampOrder = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (timestampOrder !== 0) return timestampOrder;

  const businessOrder =
    (EQUAL_TIMESTAMP_BUSINESS_ORDER[a.type] ?? 0) -
    (EQUAL_TIMESTAMP_BUSINESS_ORDER[b.type] ?? 0);
  if (businessOrder !== 0) return businessOrder;

  return a.id.localeCompare(b.id);
}
