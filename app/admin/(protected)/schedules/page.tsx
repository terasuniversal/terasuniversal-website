import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { isAdmin } from "../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../components/admin/ui";
import { duplicateSchedule, archiveSchedule } from "./actions";

export const metadata = { title: "Training Schedule — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;
const SORTABLE: Record<string, string> = { start: "start_date", course: "course_name", id: "schedule_id", created: "created_at" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

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

  // Filter option sources.
  const { data: courseOpts } = await supabase.from("training_schedules").select("course_name").is("deleted_at", null).not("course_name", "is", null).limit(1000);
  const { data: trainerOpts } = await supabase.from("training_schedules").select("trainer").is("deleted_at", null).not("trainer", "is", null).limit(1000);
  const courses = Array.from(new Set<string>(((courseOpts ?? []) as any[]).map((r) => r.course_name).filter((value): value is string => typeof value === "string"))).sort();
  const trainers = Array.from(new Set<string>(((trainerOpts ?? []) as any[]).map((r) => r.trainer).filter((value): value is string => typeof value === "string"))).sort();

  let query = supabase
    .from("training_schedules")
    .select("id, schedule_id, course_name, trainer, venue, start_date, end_date, status, max_participants, registered_participants, seats_remaining", { count: "exact" })
    .is("deleted_at", null)
    .order(sortCol, { ascending })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (sp.q) query = query.or(`schedule_id.ilike.%${sp.q}%,course_name.ilike.%${sp.q}%,trainer.ilike.%${sp.q}%,venue.ilike.%${sp.q}%`);
  if (sp.status) query = query.eq("status", sp.status as any);
  if (sp.course) query = query.eq("course_name", sp.course);
  if (sp.trainer) query = query.eq("trainer", sp.trainer);
  if (sp.year) {
    const y = Number(sp.year);
    const m = sp.month ? Number(sp.month) : null;
    const from = m ? `${y}-${String(m).padStart(2, "0")}-01` : `${y}-01-01`;
    const to = m ? `${y}-${String(m).padStart(2, "0")}-31` : `${y}-12-31`;
    query = query.gte("start_date", from).lte("start_date", to);
  }

  const { data: rows, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status", "course", "trainer", "month", "year", "sort", "dir"] as const) if (sp[k]) qsBase[k] = sp[k]!;
  const exportQs = new URLSearchParams(qsBase).toString();
  const thisYear = 2026;

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
          {["draft", "open", "full", "completed", "cancelled", "archived"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select name="course" defaultValue={sp.course ?? ""} style={sel} aria-label="Course">
          <option value="">All courses</option>
          {courses.map((c) => <option key={c} value={c}>{c}</option>)}
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
                <tr><th>Schedule ID</th><th>Course</th><th>Trainer</th><th>Dates</th><th>Seats</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((s: any) => {
                  const capacity = Math.max(Number(s.max_participants) || 0, 0);
                  const registered = Math.max(Number(s.registered_participants) || 0, 0);
                  const capacityPercent = capacity > 0 ? Math.min(100, Math.round((registered / capacity) * 100)) : 0;
                  const capacityColor = capacityPercent >= 100 ? "var(--ta-danger)" : capacityPercent >= 80 ? "#a9791a" : "var(--ta-success)";
                  return (
                  <tr key={s.id}>
                    <td><code style={{ fontSize: 12 }}>{s.schedule_id}</code></td>
                    <td><strong>{s.course_name}</strong>{s.venue ? <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{s.venue}</div> : null}</td>
                    <td>{s.trainer ?? "—"}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}
                      {s.end_date !== s.start_date ? ` – ${new Date(s.end_date).toLocaleDateString("en-MY", { day: "numeric", month: "short" })}` : ""}
                    </td>
                    <td style={{ minWidth: 132 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><span>{registered}/{capacity || "—"}</span><span style={{ color: "var(--ta-muted)", fontSize: 11 }}>{s.seats_remaining} left</span></div>
                      <div role="progressbar" aria-label={`Capacity for ${s.course_name}`} aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={registered} style={{ height: 5, marginTop: 6, borderRadius: 99, background: "var(--ta-line)", overflow: "hidden" }}>
                        <div style={{ width: `${capacityPercent}%`, height: "100%", background: capacityColor, borderRadius: 99 }} />
                      </div>
                    </td>
                    <td><Badge status={s.status} /></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <Link href={`/admin/schedules/${s.id}`} className="ta-btn ta-btn-outline ta-btn-sm">View</Link>{" "}
                      {canWrite && (
                        <>
                          <form action={duplicateSchedule.bind(null, s.id)} style={{ display: "inline" }}>
                            <button className="ta-btn ta-btn-outline ta-btn-sm" title="Duplicate">⧉</button>
                          </form>{" "}
                          {s.status !== "archived" && (
                            <form action={archiveSchedule.bind(null, s.id)} style={{ display: "inline" }}>
                              <button className="ta-btn ta-btn-outline ta-btn-sm" title="Archive">🗄</button>
                            </form>
                          )}
                        </>
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
