import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { isAdmin } from "../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, Pagination, StatCard, SvgIcon } from "../../../../components/admin/ui";
import { duplicateSchedule } from "./actions";

export const metadata = { title: "Training Schedule — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;
const SORTABLE: Record<string, string> = { start: "start_date", id: "schedule_code", created: "created_at" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUSES = ["open", "full", "in_progress", "completed", "cancelled"];

function fmt(d: Date, opts?: Intl.DateTimeFormatOptions) {
  return d.toLocaleDateString("en-MY", opts);
}

/** "12 Aug 2026" for single-day, "12–14 Aug 2026" for a same-month range,
 *  "28 Jul – 2 Aug 2026" otherwise. Safe for the server's locale — uses the
 *  same toLocaleDateString path the previous table already relied on. */
function formatRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  if (end === start) return fmt(s, { day: "numeric", month: "short", year: "numeric" });
  if (start.slice(0, 7) === end.slice(0, 7)) {
    return `${fmt(s, { day: "numeric" })} – ${fmt(e, { day: "numeric", month: "short", year: "numeric" })}`;
  }
  return `${fmt(s, { day: "numeric", month: "short" })} – ${fmt(e, { day: "numeric", month: "short", year: "numeric" })}`;
}

export default async function SchedulesPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string; q?: string; status?: string; course?: string; trainer?: string;
    month?: string; year?: string; sort?: string; dir?: string;
  }>;
}) {
  const profile = await requireRole("editor");
  const canWrite = isAdmin(profile.role);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();
  const sortCol = SORTABLE[sp.sort ?? "start"] ?? "start_date";
  const ascending = sp.dir !== "desc";

  // Filter option sources. Course options come from the courses table itself
  // (not distinct values on course_schedules) so every course is selectable
  // even before it has any schedule yet.
  const { data: courseOpts } = await supabase.from("courses").select("id, course_name").is("deleted_at", null).order("course_name");
  const { data: trainerOpts } = await supabase.from("course_schedules").select("trainer_name").is("deleted_at", null).not("trainer_name", "is", null).limit(1000);
  const courses = (courseOpts ?? []) as { id: string; course_name: string }[];
  const trainers = Array.from(new Set<string>(((trainerOpts ?? []) as any[]).map((r) => r.trainer_name).filter((value): value is string => typeof value === "string"))).sort();

  // KPI summary — counts derived from the same live course_schedules rows the
  // table lists. "Upcoming" = starts today or later and isn't finished/cancelled.
  // postgrest-js v2 builders MUTATE in place (`.eq()` returns `this`), so every
  // count query must be built from a fresh `.from()` chain — sharing one builder
  // folds all filters into a single impossible query and reports 0 for every card.
  // A failed count logs a sanitized message and omits that card (never 0).
  const today = new Date().toISOString().slice(0, 10);
  const kpiBase = () => supabase.from("course_schedules").select("*", { count: "exact", head: true }).is("deleted_at", null);
  const [upcoming, inProgress, completed, cancelled] = await Promise.all([
    kpiBase().gte("start_date", today).not("status", "in", "(completed,cancelled)"),
    kpiBase().eq("status", "in_progress"),
    kpiBase().eq("status", "completed"),
    kpiBase().eq("status", "cancelled"),
  ]);
  const kpiCount = (r: { count: number | null; error: { message: string } | null }, label: string): number | null => {
    if (r.error) {
      console.error(`KPI count "${label}" failed: ${r.error.message}`);
      return null;
    }
    return r.count ?? null;
  };
  const kpis = [
    { label: "Upcoming", value: kpiCount(upcoming, "upcoming"), icon: <SvgIcon><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18" /><path d="M8 2.5v4M16 2.5v4" /></SvgIcon>, href: "/admin/schedules" },
    { label: "In Progress", value: kpiCount(inProgress, "in_progress"), icon: <SvgIcon><path d="M12 3v12" /><path d="M8 7 12 3l4 4" /><path d="M4 17v2a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-2" /></SvgIcon>, href: "/admin/schedules?status=in_progress" },
    { label: "Completed", value: kpiCount(completed, "completed"), icon: <SvgIcon><path d="M9 11.5 11 13.5 15.5 9" /><rect x="3.5" y="4.5" width="17" height="16" rx="2" /></SvgIcon>, href: "/admin/schedules?status=completed" },
    { label: "Cancelled", value: kpiCount(cancelled, "cancelled"), icon: <SvgIcon><circle cx="12" cy="12" r="8.5" /><path d="m9 9 6 6M15 9l-6 6" /></SvgIcon>, href: "/admin/schedules?status=cancelled" },
  ];

  let query = supabase
    .from("course_schedules")
    .select("id, schedule_code, course_id, courses(course_code, course_name), trainer_name, venue, start_date, end_date, exam_date, status, capacity, seats_taken", { count: "exact" })
    .is("deleted_at", null)
    .order(sortCol, { ascending })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (sp.q) {
    const safe = sp.q.replace(/[%_,()]/g, " ").trim();
    if (safe) {
      // Also match related course title/course_name: resolve matching course
      // IDs first (single batched query — no N+1, same strategy as
      // /admin/search), then OR course_id.in(...) into the same filter so a
      // schedule matching code/trainer/venue OR course is found without dupes.
      const { data: courseHits } = await supabase.from("courses").select("id").or(`title.ilike.%${safe}%,course_name.ilike.%${safe}%`).is("deleted_at", null).limit(500);
      const courseIds = (courseHits ?? []).map((c: any) => c.id as string);
      const or = courseIds.length > 0
        ? `schedule_code.ilike.%${safe}%,trainer_name.ilike.%${safe}%,venue.ilike.%${safe}%,course_id.in.(${courseIds.join(",")})`
        : `schedule_code.ilike.%${safe}%,trainer_name.ilike.%${safe}%,venue.ilike.%${safe}%`;
      query = query.or(or);
    }
  }
  if (sp.status) query = query.eq("status", sp.status as any);
  if (sp.course) query = query.eq("course_id", sp.course);
  if (sp.trainer) query = query.eq("trainer_name", sp.trainer);
  if (sp.year) {
    const y = Number(sp.year);
    const m = sp.month ? Number(sp.month) : null;
    const from = m ? `${y}-${String(m).padStart(2, "0")}-01` : `${y}-01-01`;
    const to = m ? `${y}-${String(m).padStart(2, "0")}-31` : `${y}-12-31`;
    query = query.lte("start_date", to).gte("end_date", from);
  }

  const { data: rows, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status", "course", "trainer", "month", "year", "sort", "dir"] as const) if (sp[k]) qsBase[k] = sp[k]!;
  const exportQs = new URLSearchParams(qsBase).toString();
  const thisYear = new Date().getFullYear();

  return (
    <>
      <PageHead
        title="Training Schedule"
        subtitle="Plan and manage upcoming TERAS training sessions."
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/schedules/calendar" className="ta-btn ta-btn-outline">Calendar</Link>
            {canWrite && <Link href="/admin/schedules/new" className="ta-btn ta-btn-primary">+ New Schedule</Link>}
          </div>
        }
      />

      {kpis.filter((k) => k.value != null).length > 0 && (
        <div className="ta-kpi-grid">
          {kpis.filter((k) => k.value != null).map((k) => (
            <StatCard key={k.label} label={k.label} value={k.value} icon={k.icon} href={k.href} />
          ))}
        </div>
      )}

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 240 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Course, trainer, venue, ID…" aria-label="Search schedules" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} className="ta-select" aria-label="Filter by status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="course" defaultValue={sp.course ?? ""} className="ta-select" aria-label="Filter by course">
          <option value="">All courses</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.course_name}</option>)}
        </select>
        <select name="trainer" defaultValue={sp.trainer ?? ""} className="ta-select" aria-label="Filter by trainer">
          <option value="">All trainers</option>
          {trainers.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select name="month" defaultValue={sp.month ?? ""} className="ta-select" aria-label="Filter by month">
          <option value="">Any month</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select name="year" defaultValue={sp.year ?? ""} className="ta-select" aria-label="Filter by year">
          <option value="">Any year</option>
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select name="sort" defaultValue={sp.sort ?? "start"} className="ta-select" aria-label="Sort schedules">
          <option value="start">Sort: Date</option>
          <option value="id">Sort: Schedule ID</option>
          <option value="created">Sort: Created</option>
        </select>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {(sp.q || sp.status || sp.course || sp.trainer || sp.month || sp.year || sp.sort || sp.dir) && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/schedules">Reset filters</Link>}
        <div className="ta-spacer" />
        <a href={`/admin/schedules/export?format=csv${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">CSV</a>
        <a href={`/admin/schedules/export?format=excel${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">Excel</a>
        <a href={`/admin/schedules/export?format=print${exportQs ? "&" + exportQs : ""}`} target="_blank" className="ta-btn ta-btn-outline ta-btn-sm">Print</a>
      </form>

      <Card>
        {rows && rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Course / Programme</th>
                  <th>Date</th>
                  <th>Exam</th>
                  <th>Venue</th>
                  <th>Trainer</th>
                  <th>Seats</th>
                  <th>Status</th>
                  <th className="ta-row-actions"><span className="ta-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s: any) => {
                  const capacity = Math.max(Number(s.capacity) || 0, 0);
                  const registered = Math.max(Number(s.seats_taken) || 0, 0);
                  const seatsRemaining = Math.max(capacity - registered, 0);
                  const capacityPercent = capacity > 0 ? Math.min(100, Math.round((registered / capacity) * 100)) : 0;
                  const capacityColor = capacityPercent >= 100 ? "var(--ta-danger)" : capacityPercent >= 80 ? "#a9791a" : "var(--ta-success)";
                  const courseName = s.courses?.course_name ?? "—";
                  return (
                    <tr key={s.id}>
                      <td>
                        <strong>{courseName}</strong>
                        <div className="ta-cell-sub">{s.schedule_code}</div>
                      </td>
                      <td className="ta-nowrap"><span className="ta-date-range">{formatRange(s.start_date, s.end_date)}</span></td>
                      <td className="ta-nowrap">{s.exam_date ? fmt(new Date(s.exam_date), { day: "numeric", month: "short", year: "numeric" }) : <span className="ta-cell-sub">—</span>}</td>
                      <td>{s.venue ?? <span className="ta-cell-sub">Not set</span>}</td>
                      <td>{s.trainer_name ?? <span className="ta-cell-sub">Unassigned</span>}</td>
                      <td style={{ minWidth: 132 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{registered}/{capacity || "—"}</span><span style={{ color: "var(--ta-muted)", fontSize: 11 }}>{seatsRemaining} left</span></div>
                        {capacity > 0 && (
                          <div role="progressbar" aria-label={`Capacity for ${courseName}`} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={registered} style={{ height: 5, marginTop: 6, borderRadius: 99, background: "var(--ta-line)", overflow: "hidden" }}>
                            <div style={{ width: `${capacityPercent}%`, height: "100%", background: capacityColor, borderRadius: 99 }} />
                          </div>
                        )}
                      </td>
                      <td><Badge status={s.status} /></td>
                      <td className="ta-row-actions">
                        <Link href={`/admin/schedules/${s.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>{" "}
                        {canWrite && (
                          <form action={duplicateSchedule.bind(null, s.id)} style={{ display: "inline" }}>
                            <button className="ta-btn ta-btn-outline ta-btn-sm" title="Duplicate">Duplicate</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon="🗓"
            title="No schedules found"
            message="No training sessions match the current view. Create your first session to get started."
            action={canWrite ? <Link href="/admin/schedules/new" className="ta-btn ta-btn-primary">+ New Schedule</Link> : undefined}
          />
        )}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{count ?? 0} schedule(s)</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/schedules" query={qsBase} />
      </div>
    </>
  );
}
