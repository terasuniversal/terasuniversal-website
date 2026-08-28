import { Card } from "../../../../../../components/admin/ui";
import { EVENT_TYPE_LABELS } from "../../../../../../lib/marketing/contacts";
import type { MarketingContactEvent } from "../../../../../../lib/supabase/database.types";

/**
 * Nurture timeline — adapted from Sales' LeadActivityTimeline (same
 * `.ta-timeline*` classes, same marker/meta/note/actor structure), not a
 * new generic timeline design. Newest-first (the one real difference from
 * LeadActivityTimeline's oldest→newest, per this phase's explicit
 * "newest-first" requirement) — the row order itself carries that, not CSS.
 */
export function ContactTimeline({
  events,
  actorNames,
}: {
  events: MarketingContactEvent[];
  actorNames: Map<string, string>;
}) {
  if (events.length === 0) {
    return (
      <Card title="Nurture Timeline">
        <div className="ta-card-pad" style={{ color: "var(--ta-muted)" }}>
          No activity recorded yet.
        </div>
      </Card>
    );
  }

  return (
    <Card title="Nurture Timeline">
      <div className="ta-card-pad">
        <ul className="ta-timeline">
          {events.map((event) => (
            <li className="ta-timeline-item" key={event.id}>
              <span className={`ta-timeline-marker type-${event.event_type}`} aria-hidden="true" />
              <div className="ta-timeline-body">
                <div className="ta-timeline-meta">
                  <span className="ta-timeline-title">{EVENT_TYPE_LABELS[event.event_type]}</span>
                  <time className="ta-timeline-when" dateTime={event.created_at}>
                    {new Date(event.created_at).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </div>
                {event.note && <div className="ta-timeline-note">{event.note}</div>}
                <div className="ta-timeline-actor">by {event.actor_id ? actorNames.get(event.actor_id) ?? "Staff" : "System"}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
