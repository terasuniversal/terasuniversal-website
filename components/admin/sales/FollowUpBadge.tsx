import type { FollowUpState } from "../../../lib/sales/crm";
import { FOLLOW_UP_STATE_LABELS } from "../../../lib/sales/crm";

/**
 * Follow-up state pill (OVERDUE / TODAY / UPCOMING / NO FOLLOW-UP). Text label
 * plus colour so the state is never conveyed by colour alone. Overdue uses the
 * strong-but-professional danger treatment shared with the rest of the CMS.
 */
export function FollowUpBadge({ state }: { state: FollowUpState }) {
  const label = FOLLOW_UP_STATE_LABELS[state];
  return <span className={`ta-badge-pill ta-followup ${state}`} aria-label={`Follow-up status: ${label}`}>{label}</span>;
}
