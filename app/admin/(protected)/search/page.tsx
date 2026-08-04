import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { PageHead, Card, EmptyState } from "../../../../components/admin/ui";

export const metadata = { title: "Search — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

type Result = { entity_type: string; entity_id: string; title: string; subtitle: string };
const HREF: Record<string, (id: string) => string> = {
  course: (id) => `/admin/courses/${id}`, participant: (id) => `/admin/participants/${id}`,
  company: (id) => `/admin/companies/${id}`, schedule: (id) => `/admin/schedules/${id}`,
  certificate: (id) => `/admin/certificates/${id}`, trainer: (id) => `/admin/trainers/${id}`,
  news: (id) => `/admin/news/${id}`, download: (id) => `/admin/downloads/${id}`, media: () => "/admin/media",
};

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireRole("editor");
  const { q: raw } = await searchParams;
  const q = raw?.trim().slice(0, 80) ?? "";
  const supabase = await createSupabaseServerClient();
  const term = `%${q.replace(/[%_,()]/g, " ")}%`;
  const source = (table: string) => supabase.from(table) as any;
  const results: Result[] = [];

  if (q) {
    const [courses, participants, companies, schedules, certificates, trainers, news, downloads] = await Promise.all([
      source("courses").select("id, title, category").ilike("title", term).is("deleted_at", null).limit(8),
      source("participants").select("id, full_name, participant_id, company").or(`full_name.ilike.${term},participant_id.ilike.${term},company.ilike.${term}`).is("deleted_at", null).limit(8),
      source("companies").select("id, company_name, company_id, industry").or(`company_name.ilike.${term},company_id.ilike.${term}`).is("deleted_at", null).limit(8),
      source("training_schedules").select("id, course_name, schedule_id, start_date").or(`course_name.ilike.${term},schedule_id.ilike.${term}`).is("deleted_at", null).limit(8),
      source("certificates").select("id, certificate_number, participant_name, course_name").or(`certificate_number.ilike.${term},participant_name.ilike.${term},course_name.ilike.${term}`).is("deleted_at", null).limit(8),
      source("trainers").select("id, full_name, trainer_id, specialisation").or(`full_name.ilike.${term},trainer_id.ilike.${term}`).is("deleted_at", null).limit(8),
      source("news_posts").select("id, title, status").ilike("title", term).is("deleted_at", null).limit(8),
      source("downloads").select("id, title, category").ilike("title", term).is("deleted_at", null).limit(8),
    ]);
    const add = (type: string, rows: any[] | null, map: (row: any) => Omit<Result, "entity_type">) => rows?.forEach((row) => results.push({ entity_type: type, ...map(row) }));
    add("course", courses.data, (r) => ({ entity_id: r.id, title: r.title, subtitle: r.category ?? "Course" }));
    add("participant", participants.data, (r) => ({ entity_id: r.id, title: r.full_name, subtitle: [r.participant_id, r.company].filter(Boolean).join(" · ") }));
    add("company", companies.data, (r) => ({ entity_id: r.id, title: r.company_name, subtitle: [r.company_id, r.industry].filter(Boolean).join(" · ") }));
    add("schedule", schedules.data, (r) => ({ entity_id: r.id, title: r.course_name ?? r.schedule_id, subtitle: [r.schedule_id, r.start_date].filter(Boolean).join(" · ") }));
    add("certificate", certificates.data, (r) => ({ entity_id: r.id, title: r.certificate_number, subtitle: [r.participant_name, r.course_name].filter(Boolean).join(" · ") }));
    add("trainer", trainers.data, (r) => ({ entity_id: r.id, title: r.full_name, subtitle: [r.trainer_id, r.specialisation].filter(Boolean).join(" · ") }));
    add("news", news.data, (r) => ({ entity_id: r.id, title: r.title, subtitle: r.status ?? "News" }));
    add("download", downloads.data, (r) => ({ entity_id: r.id, title: r.title, subtitle: r.category ?? "Download" }));
  }

  return <>
    <PageHead title="Global Search" subtitle={q ? `Results for “${q}” across all admin records.` : "Search participants, companies, training, certificates and website content."} />
    <Card>{results.length ? <div className="ta-table-wrap"><table className="ta-table"><thead><tr><th>Type</th><th>Title</th><th>Detail</th><th></th></tr></thead><tbody>{results.map((result) => <tr key={`${result.entity_type}-${result.entity_id}`}><td style={{ textTransform: "capitalize" }}>{result.entity_type}</td><td><strong>{result.title}</strong></td><td style={{ color: "var(--ta-muted)" }}>{result.subtitle || "—"}</td><td style={{ textAlign: "right" }}><Link className="ta-btn ta-btn-outline ta-btn-sm" href={HREF[result.entity_type](result.entity_id)}>Open</Link></td></tr>)}</tbody></table></div> : <EmptyState icon="🔍" message={q ? "No matches found. Try a different name, ID or keyword." : "Type a query in the top search bar."} />}</Card>
  </>;
}
