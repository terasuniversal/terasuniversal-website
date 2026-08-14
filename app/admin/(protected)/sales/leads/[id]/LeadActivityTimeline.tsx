import { Card } from "../../../../../../components/admin/ui";
import { CRM_ACTIVITY_LABELS, type SalesActivityRow } from "../../../../../../lib/sales/crm";

/**
 * Reusable activity timeline for the Sales CRM (real data). Oldest G�� newest.
 * Each event renders a colour-coded marker (restrained admin palette, no
 * emoji), a vertical connector, a title + timestamp row, the optional note
 * and the actor. Rendered as an unnumbered list so no ordered numbering can
 * ever appear, regardless of CSS. All logged information is preserved.
 */
export function LeadActivityTimeline({
  activities,
  actorNames,
}: {
  activities: SalesActivityRow[];
  actorNames: Map<string, string>;
}) {
  if (activities.length === 0) {
    return (
      <Card title="Activity Timeline">
        <div className="ta-card-pad" style={{ color: "var(--ta-muted)" }}>No activity recorded yet.</div>
      </Card>
    );
  }

  return (
    <Card title="Activity Timeline">
      <div className="ta-card-pad">
        <ul className="ta-timeline">
          {activities.map((activity) => (
            <li className="ta-timeline-item" key={activity.id}>
              <span className={`ta-timeline-marker type-${activity.type}`} aria-hidden="true" />
              <div className="ta-timeline-body">
                <div className="ta-timeline-meta">
                  <span className="ta-timeline-title">{CRM_ACTIVITY_LABELS[activity.type]}</span>
                  <time className="ta-timeline-when" dateTime={activity.created_at}>
                    {new Date(activity.created_at).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}
                  </time>
                </div>
                {activity.note && <div className="ta-timeline-note">{activity.note}</div>}
                <div className="ta-timeline-actor">by {activity.actor_id ? actorNames.get(activity.actor_id) ?? "Staff" : "System"}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
