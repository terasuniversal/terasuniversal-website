import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireAssessment } from "../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, Pagination } from "../../../../components/admin/ui";

export const metadata = { title: "Assessment — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 15;

export default async function AssessmentListPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; result?: string; competency?: string; trainer?: string }>;
}) {
  await requireAssessment(false);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("course_schedules")
    .select("id, schedule_code, trainer_name, venue, start_date, status, capacity, seats_taken, courses(course_name)", { count: "exact" })
    .is("deleted_at", null)
    .not("status", "in", "(cancelled)")
    .order("start_date", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (sp.q) {
    const safe = sp.q.replace(/[%_,()]/g, " ").trim();
    if (safe) query = query.or(`schedule_code.ilike.%${safe}%,trainer_name.ilike.%${safe}%`);
  }
  if (sp.trainer) query = query.eq("trainer_name", sp.trainer);

  const { data: schedulesRaw, count } = await query;
  const schedules = (schedulesRaw ?? []).map((s: any) => ({
    ...s,
    course_name: s.courses?.course_name ?? "—",
    trainer: s.trainer_name,
    schedule_id: s.schedule_code,
    registered_participants: s.seats_taken,
  }));
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  // Assessment summary per schedule.
  const ids = (schedules ?? []).map((s: any) => s.id);
  const summary: Record<string, { competent: number; pending: number; total: number }> = {};
  if (ids.length) {
    let aq = (supabase.from("assessments") as any).select("schedule_id, result, competency_status").in("schedule_id", ids).is("deleted_at", null);
    const { data: asm } = await aq;
    for (const a of asm ?? []) {
      const s = (summary[a.schedule_id] ??= { competent: 0, pending: 0, total: 0 });
      s.total++;
      if (a.competency_status === "competent") s.competent++;
      if (a.result === "pending") s.pending++;
    }
  }

  const qsBase: Record<string, string> = {};
  for (const k of ["q", "result", "competency", "trainer"] as const) if (sp[k]) qsBase[k] = sp[k]!;

  return (
    <>
      <PageHead title="Assessment" subtitle="Select a schedule to record participant assessment results." />

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 300 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Course, trainer, schedule ID…" />
        </div>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
      </form>

      <Card>
        {schedules && schedules.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>Schedule</th><th>Trainer</th><th>Date</th><th>Competent</th><th>Pending</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {schedules.map((s: any) => {
                  const sm = summary[s.id] ?? { competent: 0, pending: s.registered_participants, total: s.registered_participants };
                  return (
                    <tr key={s.id}>
                      <td><strong>{s.course_name}</strong><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{s.schedule_id}</div></td>
                      <td>{s.trainer ?? "—"}</td>
                      <td style={{ whiteSpace: "nowrap" }}>{new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td>{sm.competent}/{s.registered_participants}</td>
                      <td>{sm.pending}</td>
                      <td><Badge status={s.status} /></td>
                      <td style={{ textAlign: "right" }}>
                        <Link href={`/admin/assessment/${s.id}`} className="ta-btn ta-btn-primary ta-btn-sm">Assess</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="📝" message="No schedules to assess yet. Assign participants to a schedule first." />
        )}
      </Card>

      <Pagination page={page} pageCount={pageCount} basePath="/admin/assessment" query={qsBase} />
    </>
  );
}
