import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole } from "../../../../../lib/auth/session";
import { isAdmin } from "../../../../../lib/auth/rbac";
import { PageHead, Card, Badge, EmptyState, StatCard } from "../../../../../components/admin/ui";
import { softDeleteCompany, restoreCompany } from "../actions";

export const metadata = { title: "Company Profile — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

function D({ label, value }: { label: string; value: any }) {
  return (<div style={{ display: "contents" }}><dt style={{ color: "var(--ta-muted)", padding: "6px 0" }}>{label}</dt><dd style={{ margin: 0, padding: "6px 0", fontWeight: 500 }}>{value || "—"}</dd></div>);
}

export default async function CompanyProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireRole("editor");
  const canWrite = isAdmin(profile.role);
  const { id } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: c } = await supabase.from("companies").select("*").eq("id", id).single();
  if (!c) notFound();
  const isDeleted = !!c.deleted_at;

  // Integration: participants of this company + their schedules/certs.
  const { data: participants } = await supabase
    .from("participants")
    .select("id, participant_id, full_name, status, schedule_id")
    .eq("company_id", id).is("deleted_at", null).order("full_name").limit(200);
  const pIds = (participants ?? []).map((p: any) => p.id);
  const [{ count: certCount }, { data: certRows }] = await Promise.all([
    pIds.length ? supabase.from("certificates").select("*", { count: "exact", head: true }).in("participant_id", pIds).is("deleted_at", null) : Promise.resolve({ count: 0 } as any),
    pIds.length ? supabase.from("certificates").select("id, certificate_number, holder_name, status, issue_date").in("participant_id", pIds).is("deleted_at", null).order("issue_date", { ascending: false }).limit(10) : Promise.resolve({ data: [] } as any),
  ]);
  // Distinct schedules the company's participants attended.
  const { data: sp } = pIds.length
    ? await supabase.from("schedule_participants").select("training_schedules(id, schedule_id, course_name, start_date, status)").in("participant_id", pIds)
    : { data: [] as any };
  const scheduleMap = new Map<string, any>();
  for (const row of sp ?? []) { const s = (row as any).training_schedules; if (s) scheduleMap.set(s.id, s); }
  const schedules = Array.from(scheduleMap.values()).sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

  const current = (participants ?? []).filter((p: any) => ["registered", "confirmed", "attended"].includes(p.status));
  const dl = { display: "grid", gridTemplateColumns: "160px 1fr", gap: 2, margin: 0 } as const;

  return (
    <>
      <PageHead
        title={c.company_name}
        subtitle={`${c.company_id}${c.industry ? " · " + c.industry : ""}`}
        action={
          <div style={{ display: "flex", gap: 8 }}>
            <Link href="/admin/companies" className="ta-btn ta-btn-outline">← Back</Link>
            <a href={`/admin/companies/export?format=profile&id=${id}`} target="_blank" rel="noreferrer" className="ta-btn ta-btn-outline">📄 Report (PDF)</a>
            {canWrite && !isDeleted && <Link href={`/admin/companies/${id}/edit`} className="ta-btn ta-btn-primary">Edit</Link>}
            {canWrite && !isDeleted && <form action={softDeleteCompany.bind(null, id)}><button className="ta-btn ta-btn-danger" type="submit">Delete</button></form>}
            {canWrite && isDeleted && <form action={restoreCompany.bind(null, id)}><button className="ta-btn ta-btn-gold" type="submit">Restore</button></form>}
          </div>
        }
      />
      {isDeleted && <div className="ta-alert ta-alert-error" style={{ marginBottom: 16 }}>This company is deleted. Restore to make it active again.</div>}
      <div style={{ marginBottom: 16 }}><Badge status={c.status} /></div>

      <div className="ta-grid cols-4" style={{ marginBottom: 20 }}>
        <StatCard icon="👥" label="Total participants" value={participants?.length ?? 0} />
        <StatCard icon="🟢" label="Current" value={current.length} />
        <StatCard icon="🗓" label="Schedules" value={schedules.length} />
        <StatCard icon="🏅" label="Certificates" value={certCount ?? 0} />
      </div>

      <div className="ta-grid cols-2" style={{ alignItems: "start" }}>
        <div style={{ display: "grid", gap: 18 }}>
          <Card title="Company Details">
            <div className="ta-card-pad"><dl style={dl}>
              <D label="Company ID" value={<code>{c.company_id}</code>} />
              <D label="Registration No." value={c.registration_no} />
              <D label="Industry" value={c.industry} />
              <D label="Type" value={c.company_type} />
              <D label="Phone" value={c.phone} />
              <D label="Email" value={c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : null} />
              <D label="Website" value={c.website ? <a href={c.website} target="_blank" rel="noreferrer">{c.website}</a> : null} />
              <D label="Address" value={[c.address, c.city, c.postcode, c.state, c.country].filter(Boolean).join(", ")} />
            </dl></div>
          </Card>
          <Card title="PIC Information">
            <div className="ta-card-pad"><dl style={dl}>
              <D label="Name" value={c.person_in_charge} />
              <D label="Position" value={c.pic_position} />
              <D label="Phone" value={c.pic_phone} />
              <D label="Email" value={c.pic_email ? <a href={`mailto:${c.pic_email}`}>{c.pic_email}</a> : null} />
            </dl>{c.remarks && <p style={{ marginTop: 12, color: "var(--ta-muted)" }}>{c.remarks}</p>}</div>
          </Card>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <Card title={`Participants (${participants?.length ?? 0})`}>
            <div className="ta-card-pad">
              {participants && participants.length > 0 ? (
                <div className="ta-table-wrap"><table className="ta-table"><tbody>
                  {participants.slice(0, 15).map((p: any) => (
                    <tr key={p.id}><td><Link href={`/admin/participants/${p.id}`}><strong>{p.full_name}</strong></Link><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{p.participant_id}</div></td><td style={{ textAlign: "right" }}><Badge status={p.status} /></td></tr>
                  ))}
                </tbody></table></div>
              ) : <EmptyState icon="👥" message="No participants linked to this company yet." />}
            </div>
          </Card>
          <Card title="Training Schedules">
            <div className="ta-card-pad">
              {schedules.length > 0 ? (
                <div className="ta-table-wrap"><table className="ta-table"><tbody>
                  {schedules.slice(0, 10).map((s: any) => (
                    <tr key={s.id}><td><Link href={`/admin/schedules/${s.id}`}><strong>{s.course_name}</strong></Link><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{s.schedule_id} · {new Date(s.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric" })}</div></td><td style={{ textAlign: "right" }}><Badge status={s.status} /></td></tr>
                  ))}
                </tbody></table></div>
              ) : <EmptyState icon="🗓" message="No training history yet." />}
            </div>
          </Card>
          <Card title="Certificates">
            <div className="ta-card-pad">
              {certRows && certRows.length > 0 ? (
                <div className="ta-table-wrap"><table className="ta-table"><tbody>
                  {certRows.map((ct: any) => (
                    <tr key={ct.id}><td><Link href={`/admin/certificates/${ct.id}`}><code style={{ fontSize: 12 }}>{ct.certificate_number}</code></Link><div style={{ color: "var(--ta-muted)", fontSize: 12 }}>{ct.holder_name}</div></td><td style={{ textAlign: "right" }}><Badge status={ct.status} /></td></tr>
                  ))}
                </tbody></table></div>
              ) : <EmptyState icon="🏅" message="No certificates issued yet." />}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
