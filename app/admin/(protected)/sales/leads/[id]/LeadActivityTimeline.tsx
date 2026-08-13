import { Card } from "../../../../../../components/admin/ui";
import { CRM_ACTIVITY_ICONS, CRM_ACTIVITY_LABELS, type SalesActivityRow } from "../../../../../../lib/sales/crm";

/**
 * Reusable activity timeline for the Sales CRM (real data). Oldest → newest,
 * matching components/admin/sales/SalesActivityTimeline.tsx's ordering
 * convention for the demo Opportunities/Quotations module — kept as a
 * separate component since the real sales_activity row shape (actor_id +
 * resolved name, DB type enum) differs from that component's mock
 * SalesActivity shape (actor as a plain name string).
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
        <ol className="ta-timeline">
          {activities.map((activity) => (
            <li className="ta-timeline-item" key={activity.id}>
              <span className="ta-timeline-dot" aria-hidden="true">{CRM_ACTIVITY_ICONS[activity.type]}</span>
              <div className="ta-timeline-body">
                <div className="ta-timeline-when">
                  {new Date(activity.created_at).toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}
                </div>
                <div className="ta-timeline-title">{CRM_ACTIVITY_LABELS[activity.type]}</div>
                {activity.note && <div className="ta-timeline-note">{activity.note}</div>}
                <div className="ta-timeline-actor">by {activity.actor_id ? actorNames.get(activity.actor_id) ?? "Staff" : "System"}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}
