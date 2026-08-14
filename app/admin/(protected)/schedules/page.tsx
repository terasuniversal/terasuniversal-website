import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { isAdmin } from "../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../components/admin/ui";
import { duplicateSchedule } from "./actions";

export const metadata = { title: "Training Schedule — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;
const SORTABLE: Record<string, string> = { start: "start_date", id: "schedule_code", created: "created_at" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STATUSES = ["open", "full", "in_progress", "completed", "cancelled"];

function durationDays(startDate: string, endDate: string) {
  return Math.floor((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
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
        subtitle="Manage training sessions and participant assignments."
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/schedules/calendar" className="ta-btn ta-btn-outline">📅 Calendar</Link>
            {canWrite && <Link href="/admin/schedules/new" className="ta-btn ta-btn-primary">+ New Schedule</Link>}
          </div>
        }
      />

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 240 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Course, trainer, venue, ID…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} style={sel} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="course" defaultValue={sp.course ?? ""} style={sel} aria-label="Course">
          <option value="">All courses</option>
          {courses.map((c) => <option key={c.id} value={c.id}>{c.course_name}</option>)}
        </select>
        <select name="trainer" defaultValue={sp.trainer ?? ""} style={sel} aria-label="Trainer">
          <option value="">All trainers</option>
          {trainers.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select name="month" defaultValue={sp.month ?? ""} style={sel} aria-label="Month">
          <option value="">Any month</option>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select name="year" defaultValue={sp.year ?? ""} style={sel} aria-label="Year">
          <option value="">Any year</option>
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {(sp.q || sp.status || sp.course || sp.trainer || sp.month || sp.year || sp.sort || sp.dir) && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/schedules">Reset filters</Link>}
        <div className="ta-spacer" />
        <a href={`/admin/schedules/export?format=csv${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ CSV</a>
        <a href={`/admin/schedules/export?format=excel${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ Excel</a>
        <a href={`/admin/schedules/export?format=print${exportQs ? "&" + exportQs : ""}`} target="_blank" className="ta-btn ta-btn-outline ta-btn-sm">🖨 Print</a>
      </form>

      <Card>
        {rows && rows.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr><th>Batch ID</th><th>Course</th><th>Trainer / Venue</th><th>Dates</th><th>Exam</th><th>Seats</th><th>Status</th><th></th></tr>
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
                    <td><code style={{ fontSize: 12 }}>{s.schedule_code}</code></td>
                    <td><strong>{courseName}</strong>{s.courses?.course_code ? <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{s.courses.course_code}</div> : null}</td>
                    <td>{s.trainer_name ?? "—"}<div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{s.venue ?? "No venue assigned"}</div></td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}
                      {s.end_date !== s.start_date ? ` – ${new Date(s.end_date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}` : ""}
                      <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{durationDays(s.start_date, s.end_date)} day(s)</div>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{s.exam_date ? new Date(s.exam_date).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                    <td style={{ minWidth: 132 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{registered}/{capacity || "—"}</span><span style={{ color: "var(--ta-muted)", fontSize: 11 }}>{seatsRemaining} left</span></div>
                      <div role="progressbar" aria-label={`Capacity for ${courseName}`} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={registered} style={{ height: 5, marginTop: 6, borderRadius: 99, background: "var(--ta-line)", overflow: "hidden" }}>
                        <div style={{ width: `${capacityPercent}%`, height: "100%", background: capacityColor, borderRadius: 99 }} />
                      </div>
                    </td>
                    <td><Badge status={s.status} /></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <Link href={`/admin/schedules/${s.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>{" "}
                      {canWrite && (
                        <form action={duplicateSchedule.bind(null, s.id)} style={{ display: "inline" }}>
                          <button className="ta-btn ta-btn-outline ta-btn-sm" title="Duplicate">⧉</button>
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
          <EmptyState icon="🗓" message="No schedules found. Create your first session." />
        )}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{count ?? 0} schedule(s)</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/schedules" query={qsBase} />
      </div>
    </>
  );
}

const sel = { padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)", maxWidth: 150 } as const;
