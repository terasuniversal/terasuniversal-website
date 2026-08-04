import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireAttendance } from "../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../components/admin/ui";

export const metadata = { title: "Attendance — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function AttendanceListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; trainer?: string; month?: string; year?: string }>;
}) {
  await requireAttendance(false); // editor+ or trainer may view
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  let query = (supabase
    .from("training_schedules") as any)
    .select("id, schedule_id, course_name, trainer, venue, start_date, end_date, status, registered_participants", { count: "exact" })
    .is("deleted_at", null)
    .not("status", "in", "(draft,cancelled)")
    .order("start_date", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.q) query = query.or(`course_name.ilike.%${sp.q}%,schedule_id.ilike.%${sp.q}%,trainer.ilike.%${sp.q}%,venue.ilike.%${sp.q}%`);
  if (sp.status) query = query.eq("status", sp.status as any);
  if (sp.trainer) query = query.eq("trainer", sp.trainer);
  if (sp.year) {
    const y = Number(sp.year);
    const m = sp.month ? Number(sp.month) : null;
    const from = m ? `${y}-${String(m).padStart(2, "0")}-01` : `${y}-01-01`;
    const to = m ? `${y}-${String(m).padStart(2, "0")}-31` : `${y}-12-31`;
    query = query.gte("start_date", from).lte("start_date", to);
  }

  const { data: schedules, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  // Attendance summary per schedule (present counts).
  const ids = (schedules ?? []).map((s: any) => s.id);
  const summary: Record<string, { present: number; total: number }> = {};
  if (ids.length) {
    const { data: att } = await (supabase.from("attendance") as any).select("schedule_id, attendance_status").in("schedule_id", ids).is("deleted_at", null);
    for (const a of att ?? []) {
      const s = (summary[a.schedule_id] ??= { present: 0, total: 0 });
      s.total++;
      if (a.attendance_status === "present") s.present++;
    }
  }

  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status", "trainer", "month", "year"] as const) if (sp[k]) qsBase[k] = sp[k]!;

  return (
    <>
      <PageHead title="Attendance" subtitle="Select a schedule to record participant attendance." />

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 260 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Course, trainer, venue, ID…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} style={sel} aria-label="Status">
          <option value="">All statuses</option>
          {["open", "full", "completed", "archived"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="month" defaultValue={sp.month ?? ""} style={sel} aria-label="Month">
          <option value="">Any month</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select name="year" defaultValue={sp.year ?? ""} style={sel} aria-label="Year">
          <option value="">Any year</option>
          {[2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
      </form>

      <Card>
        {schedules && schedules.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>Schedule</th><th>Trainer</th><th>Date</th><th>Attendance</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {schedules.map((s: any) => {
                  const sm = summary[s.id] ?? { present: 0, total: s.registered_participants };
                  return (
                    <tr key={s.id}>
                      <td><strong>{s.course_name}</strong><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{s.schedule_id}{s.venue ? ` · ${s.venue}` : ""}</div></td>
                      <td>{s.trainer ?? "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td>{sm.present}/{s.registered_participants} present</td>
                      <td><Badge status={s.status} /></td>
                      <td style={{ textAlign: "right" }}>
                        <Link href={`/admin/attendance/${s.id}`} className="ta-btn ta-btn-primary ta-btn-sm">Take Attendance</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="✅" message="No schedules to show. Create a schedule and assign participants first." />
        )}
      </Card>

      <Pagination page={page} pageCount={pageCount} basePath="/admin/attendance" query={qsBase} />
    </>
  );
}

const sel = { padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)", maxWidth: 140 } as const;
