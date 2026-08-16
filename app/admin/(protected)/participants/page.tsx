import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../lib/auth/session";
import { isAdmin } from "../../../../lib/auth/rbac";
import { PageHead, Card, EmptyState, Pagination } from "../../../../components/admin/ui";
import { ParticipantTable, type Row } from "./ParticipantTable";

export const metadata = { title: "Participants — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;
const SORTABLE: Record<string, string> = {
  created: "created_at",
  name: "full_name",
  company: "company",
  id: "participant_id",
};

export default async function ParticipantsPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string; q?: string; status?: string; company?: string;
    sort?: string; dir?: string; deleted?: string;
  }>;
}) {
  const profile = await requireRole("editor"); // read allowed for all staff
  await requireModuleAccess("participants");
  const canWrite = isAdmin(profile.role);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const deletedView = sp.deleted === "1";
  const sortCol = SORTABLE[sp.sort ?? "created"] ?? "created_at";
  const ascending = sp.dir === "asc";
  const supabase = await createSupabaseServerClient();

  // Distinct companies for the company filter (from live rows).
  const { data: companyRows } = await supabase
    .from("participants")
    .select("company")
    .is("deleted_at", null)
    .not("company", "is", null)
    .limit(1000);
  const companies = Array.from(new Set<string>(((companyRows ?? []) as any[]).map((r) => r.company).filter((value): value is string => typeof value === "string" && Boolean(value)))).sort();

  let query = supabase
    .from("participants")
    .select("id, participant_id, full_name, ic_passport_no, company, position, phone, status, created_at", { count: "exact" })
    .order(sortCol, { ascending })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  query = deletedView ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);
  if (sp.q) query = query.or(`full_name.ilike.%${sp.q}%,participant_id.ilike.%${sp.q}%,ic_passport_no.ilike.%${sp.q}%,company.ilike.%${sp.q}%`);
  if (sp.status) query = query.eq("status", sp.status as any);
  if (sp.company) query = query.eq("company", sp.company);

  const { data: rows, count } = await query;
  const pageCount = Math.ceil((count ?? 0) / PAGE_SIZE);

  // Preserve current filters for pagination + export links.
  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status", "company", "sort", "dir", "deleted"] as const) if (sp[k]) qsBase[k] = sp[k]!;
  const exportQs = new URLSearchParams(qsBase).toString();

  return (
    <>
      <PageHead
        title="Participants"
        subtitle={deletedView ? "Deleted participants (restore available)." : "Internal register of training participants."}
        action={
          canWrite && !deletedView ? (
            <div style={{ display: "flex", gap: 8 }}>
              <Link href="/admin/participants/import" className="ta-btn ta-btn-outline">⬆ Import</Link>
              <Link href="/admin/participants/new" className="ta-btn ta-btn-primary">+ Add Participant</Link>
            </div>
          ) : undefined
        }
      />

      {/* Toolbar: search, filters, sort, export, deleted toggle */}
      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 260 }}>
          <span className="ta-search-ico" aria-hidden="true">⌕</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search ID, name, IC, company…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)" }} aria-label="Status filter">
          <option value="">All statuses</option>
          {["registered", "confirmed", "attended", "no_show", "cancelled"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <select name="company" defaultValue={sp.company ?? ""} style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)", maxWidth: 180 }} aria-label="Company filter">
          <option value="">All companies</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="sort" defaultValue={sp.sort ?? "created"} style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)" }} aria-label="Sort by">
          <option value="created">Newest</option>
          <option value="name">Name</option>
          <option value="company">Company</option>
          <option value="id">Participant ID</option>
        </select>
        <select name="dir" defaultValue={sp.dir ?? "desc"} style={{ padding: "9px 10px", borderRadius: 9, border: "1px solid var(--ta-line)" }} aria-label="Sort direction">
          <option value="desc">↓ Desc</option>
          <option value="asc">↑ Asc</option>
        </select>
        {deletedView && <input type="hidden" name="deleted" value="1" />}
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
        {(sp.q || sp.status || sp.company || sp.sort || sp.dir || deletedView) && <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/participants">Reset filters</Link>}
        <div className="ta-spacer" />
        <a href={`/admin/participants/export?format=csv${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ CSV</a>
        <a href={`/admin/participants/export?format=excel${exportQs ? "&" + exportQs : ""}`} className="ta-btn ta-btn-outline ta-btn-sm">⬇ Excel</a>
        <Link href={deletedView ? "/admin/participants" : "/admin/participants?deleted=1"} className="ta-btn ta-btn-outline ta-btn-sm">
          {deletedView ? "← Active" : "🗑 Deleted"}
        </Link>
      </form>

      <Card>
        {rows && rows.length > 0 ? (
          <ParticipantTable rows={rows as Row[]} canWrite={canWrite} deletedView={deletedView} />
        ) : (
          <EmptyState icon="👥" message={deletedView ? "No deleted participants." : "No participants found. Add or import to get started."} />
        )}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{count ?? 0} participant(s)</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/participants" query={qsBase} />
      </div>
    </>
  );
}
