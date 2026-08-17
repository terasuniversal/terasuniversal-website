import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { isAdmin } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, StatCard } from "../../../../../components/admin/ui";
import { softDeleteTrainer, restoreTrainer } from "../actions";

export const metadata = { title: "Trainer Profile — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

function Detail({ label, value }: { label: string; value: any }) {
  return (<div style={{ display: "contents" }}><dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>{label}</dt><dd style={{ margin: 0, padding: "6px 0", fontWeight: 500 }}>{value || "—"}</dd></div>);
}

export default async function TrainerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("editor");
  await requireModuleAccess("trainers");
  const canWrite = isAdmin(profile.role);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: t } = await supabase.from("trainers").select("*").eq("id", id).single();
  if (!t) notFound();
  const isDeleted = !!t.deleted_at;
  const today = new Date().toISOString().slice(0, 10);

  // Integrations: assigned schedules + workload + certificates issued.
  const [{ data: schedules }, { count: upcomingCount }, { count: certsCount }] = await Promise.all([
    supabase.from("training_schedules").select("id, schedule_id, course_name, start_date, end_date, status").eq("trainer_id", id).is("deleted_at", null).order("start_date", { ascending: false }).limit(20),
    supabase.from("training_schedules").select("*", { count: "exact", head: true }).eq("trainer_id", id).is("deleted_at", null).gte("start_date", today).not("status", "in", "(cancelled,archived)"),
    supabase.from("certificates").select("*", { count: "exact", head: true }).is("deleted_at", null).in("schedule_id", (await supabase.from("training_schedules").select("id").eq("trainer_id", id)).data?.map((s: any) => s.id) ?? ["00000000-0000-0000-0000-000000000000"]),
  ]);

  const dl = { display: "grid", gridTemplateColumns: "160px 1fr", gap: 2, margin: 0 } as const;

  return (
    <>
      <PageHead
        title={t.full_name}
        subtitle={`${t.trainer_id}${t.position ? " · " + t.position : ""}`}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/trainers" className="ta-btn ta-btn-outline">← Back</Link>
            <a href={`/admin/trainers/export?format=profile&id=${id}`} target="_blank" rel="noreferrer" className="ta-btn ta-btn-outline">📄 Profile (PDF)</a>
            {canWrite && !isDeleted && <Link href={`/admin/trainers/${id}/edit`} className="ta-btn ta-btn-primary">Edit</Link>}
            {canWrite && !isDeleted && <form action={softDeleteTrainer.bind(null, id)}><button className="ta-btn ta-btn-danger" type="submit">Delete</button></form>}
            {canWrite && isDeleted && <form action={restoreTrainer.bind(null, id)}><button className="ta-btn ta-btn-gold" type="submit">Restore</button></form>}
          </div>
        }
      />

      {isDeleted && <div className="ta-alert ta-alert-error" style={{ marginBottom: 16 }}>This trainer is deleted. Restore to make them active again.</div>}

      <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
        {t.trainer_photo && <img src={t.trainer_photo} alt="" style={{ width: 64, height: 64, borderRadius: 12, objectFit: "cover", border: "1px solid var(--ta-line)" }} />}
        <Badge status={t.status} />
      </div>

      <div className="ta-grid cols-4" style={{ marginBottom: 20 }}>
        <StatCard icon="🗓" label="Upcoming sessions" value={upcomingCount ?? 0} />
        <StatCard icon="📚" label="Total assigned" value={schedules?.length ?? 0} />
        <StatCard icon="🏅" label="Certificates issued" value={certsCount ?? 0} />
        <StatCard icon="🧩" label="Competencies" value={(t.competencies ?? []).length} />
      </div>

      <div className="ta-grid cols-2" style={{ alignItems: "start" }}>
        <div style={{ display: "grid", gap: 18 }}>
          <Card title="Personal Details">
            <div className="ta-card-pad"><dl style={dl}>
              <Detail label="Trainer ID" value={<code>{t.trainer_id}</code>} />
              <Detail label="Full name" value={t.full_name} />
              <Detail label="IC / Passport" value={t.ic_passport_no} />
              <Detail label="Email" value={t.email ? <a href={`mailto:${t.email}`}>{t.email}</a> : null} />
              <Detail label="Phone" value={t.phone} />
            </dl></div>
          </Card>
          <Card title="Employment Details">
            <div className="ta-card-pad"><dl style={dl}>
              <Detail label="Staff No." value={t.staff_no} />
              <Detail label="Position" value={t.position} />
              <Detail label="Department" value={t.department} />
              <Detail label="Employment type" value={t.employment_type} />
              <Detail label="Joining date" value={t.joining_date ? new Date(t.joining_date).toLocaleDateString("en-MY") : null} />
            </dl></div>
          </Card>
          <Card title="Competencies & Qualifications">
            <div className="ta-card-pad">
              <p style={{ margin: "0 0 6px", color: "var(--ta-muted)", fontSize: 12, fontWeight: 700 }}>SPECIALISATION</p>
              <p style={{ margin: "0 0 12px" }}>{t.specialisation ?? "—"}</p>
              <p style={{ margin: "0 0 6px", color: "var(--ta-muted)", fontSize: 12, fontWeight: 700 }}>COMPETENCIES</p>
              {(t.competencies ?? []).length ? <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>{t.competencies.map((c: string) => <span key={c} className="ta-badge-pill pending_review">{c}</span>)}</div> : <p style={{ color: "var(--ta-muted)" }}>—</p>}
              <p style={{ margin: "0 0 6px", color: "var(--ta-muted)", fontSize: 12, fontWeight: 700 }}>QUALIFICATIONS</p>
              {(t.qualifications ?? []).length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{t.qualifications.map((q: string) => <li key={q}>{q}</li>)}</ul> : <p style={{ color: "var(--ta-muted)" }}>—</p>}
            </div>
          </Card>
          {t.signature_image && (
            <Card title="Signature (used on certificates)">
              <div className="ta-card-pad"><img src={t.signature_image} alt="Signature" style={{ maxHeight: 70, background: "#fff", padding: 6, border: "1px solid var(--ta-line)", borderRadius: 8 }} /></div>
            </Card>
          )}
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <Card title="Assigned Courses & Training History">
            <div className="ta-card-pad">
              {schedules && schedules.length > 0 ? (
                <div className="ta-table-wrap">
                  <table className="ta-table">
                    <tbody>
                      {schedules.map((s: any) => (
                        <tr key={s.id}>
                          <td><Link href={`/admin/schedules/${s.id}`}><strong>{s.course_name}</strong></Link><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{s.schedule_id} · {new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</div></td>
                          <td style={{ textAlign: "right" }}><Badge status={s.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState icon="🗓" message="No schedules assigned to this trainer yet." />
              )}
            </div>
          </Card>
          <Card title="Certificates Issued">
            <div className="ta-card-pad">
              <p style={{ margin: 0 }}>This trainer's sessions have issued <strong>{certsCount ?? 0}</strong> certificate(s). <Link href="/admin/certificates" style={{ color: "var(--ta-info)" }}>View certificates →</Link></p>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
