import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";

export const metadata = { title: "Schedule Calendar — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  await requireRole("editor");
  const sp = await searchParams;
  const view = (sp.view as "month" | "week" | "list") ?? "month";
  const anchor = sp.date ? new Date(sp.date + "T00:00:00") : new Date();

  // Compute visible date window per view.
  let windowStart: Date, windowEnd: Date;
  if (view === "week") {
    windowStart = addDays(anchor, -anchor.getDay());
    windowEnd = addDays(windowStart, 6);
  } else if (view === "list") {
    windowStart = anchor;
    windowEnd = addDays(anchor, 60);
  } else {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    windowStart = addDays(first, -first.getDay());
    windowEnd = addDays(windowStart, 41); // 6 weeks
  }

  const supabase = await createSupabaseServerClient();
  const { data: rows } = await supabase
    .from("training_schedules")
    .select("id, schedule_id, course_name, trainer, status, start_date, end_date, start_time")
    .is("deleted_at", null)
    .gte("start_date", ymd(windowStart))
    .lte("start_date", ymd(windowEnd))
    .order("start_date", { ascending: true });

  // Bucket by start day.
  const byDay: Record<string, any[]> = {};
  for (const r of rows ?? []) (byDay[r.start_date] ??= []).push(r);

  const prev = view === "week" ? addDays(anchor, -7) : view === "list" ? addDays(anchor, -30) : new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
  const next = view === "week" ? addDays(anchor, 7) : view === "list" ? addDays(anchor, 30) : new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  const title = view === "month" ? `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}` : view === "week" ? `Week of ${windowStart.toLocaleDateString("en-MY", { day: "numeric", month: "short" })}` : "Upcoming";

  const viewLink = (v: string) => `/admin/schedules/calendar?view=${v}&date=${ymd(anchor)}`;
  const navLink = (d: Date) => `/admin/schedules/calendar?view=${view}&date=${ymd(d)}`;

  return (
    <>
      <PageHead
        title="Schedule Calendar"
        subtitle="Monthly, weekly and list views."
        action={<Link href="/admin/schedules" className="ta-btn ta-btn-outline">← Table view</Link>}
      />

      <div className="ta-toolbar">
        <div style={{ display: "flex", gap: 4 }}>
          {(["month", "week", "list"] as const).map((v) => (
            <Link key={v} href={viewLink(v)} className={`ta-btn ta-btn-sm ${view === v ? "ta-btn-primary" : "ta-btn-outline"}`} style={{ textTransform: "capitalize" }}>{v}</Link>
          ))}
        </div>
        <div className="ta-spacer" />
        <Link href={navLink(prev)} className="ta-btn ta-btn-outline ta-btn-sm">←</Link>
        <strong style={{ minWidth: 160, textAlign: "center" }}>{title}</strong>
        <Link href={navLink(next)} className="ta-btn ta-btn-outline ta-btn-sm">→</Link>
      </div>

      {view === "month" && (
        <Card>
          <div className="ta-table-wrap">
            <table className="ta-table" style={{ tableLayout: "fixed" }}>
              <thead><tr>{WD.map((d) => <th key={d}>{d}</th>)}</tr></thead>
              <tbody>
                {Array.from({ length: 6 }).map((_, w) => (
                  <tr key={w}>
                    {Array.from({ length: 7 }).map((_, dow) => {
                      const day = addDays(windowStart, w * 7 + dow);
                      const key = ymd(day);
                      const inMonth = day.getMonth() === anchor.getMonth();
                      const events = byDay[key] ?? [];
                      return (
                        <td key={dow} style={{ verticalAlign: "top", height: 96, background: inMonth ? "#fff" : "var(--ta-soft)", opacity: inMonth ? 1 : 0.6 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ta-muted)", marginBottom: 4 }}>{day.getDate()}</div>
                          {events.slice(0, 3).map((ev) => (
                            <Link key={ev.id} href={`/admin/schedules/${ev.id}`} title={ev.course_name}
                              style={{ display: "block", fontSize: 11, padding: "2px 5px", marginBottom: 2, borderRadius: 5, background: "rgba(11,44,86,.08)", color: "var(--ta-navy)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {ev.start_time ? ev.start_time.slice(0, 5) + " " : ""}{ev.course_name}
                            </Link>
                          ))}
                          {events.length > 3 && <div style={{ fontSize: 10, color: "var(--ta-muted)" }}>+{events.length - 3} more</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {view === "week" && (
        <div className="ta-grid" style={{ gridTemplateColumns: "repeat(7, 1fr)", gap: 10 }}>
          {Array.from({ length: 7 }).map((_, i) => {
            const day = addDays(windowStart, i);
            const events = byDay[ymd(day)] ?? [];
            return (
              <div key={i} className="ta-card ta-card-pad" style={{ minHeight: 160 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>{WD[day.getDay()]} {day.getDate()}</div>
                {events.length === 0 ? <span style={{ color: "var(--ta-muted)", fontSize: 12 }}>—</span> : events.map((ev) => (
                  <Link key={ev.id} href={`/admin/schedules/${ev.id}`} style={{ display: "block", fontSize: 12, marginBottom: 6 }}>
                    <Badge status={ev.status} /><div>{ev.course_name}</div>
                  </Link>
                ))}
              </div>
            );
          })}
        </div>
      )}

      {view === "list" && (
        <Card>
          {rows && rows.length > 0 ? (
            <div className="ta-table-wrap">
              <table className="ta-table">
                <thead><tr><th>Date</th><th>Course</th><th>Trainer</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.map((ev: any) => (
                    <tr key={ev.id}>
                      <td style={{ whiteSpace: "nowrap" }}>{new Date(ev.start_date).toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short" })}</td>
                      <td><Link href={`/admin/schedules/${ev.id}`}><strong>{ev.course_name}</strong></Link></td>
                      <td>{ev.trainer ?? "—"}</td>
                      <td><Badge status={ev.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon="🗓" message="No sessions in this range." />
          )}
        </Card>
      )}
    </>
  );
}
