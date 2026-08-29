import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, StatCard, EmptyState, Pagination } from "../../../../../components/admin/ui";
import { sanitizeSearchTerm } from "../../../../../lib/sales/crm";
import { SOURCE_LABELS } from "../../../../../lib/marketing/contacts";
import { MARKETING_CONTACT_SOURCES, MARKETING_CONTACT_STATUSES } from "../../../../../lib/validation/schemas";
import type { MarketingContact } from "../../../../../lib/supabase/database.types";
import { ContactTable } from "./ContactTable";

export const metadata = { title: "Contacts — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; source?: string; owner?: string; followup?: string }>;
}) {
  await requireModuleAccess("marketing_contacts");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  // Each query is built (not awaited) here, then resolved together — no
  // `await` inside the Promise.all array literal (CLAUDE.md §5/§13).
  const totalQuery = supabase.from("marketing_contacts").select("id", { count: "exact", head: true });
  const newQuery = supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).eq("status", "new");
  const nurturingQuery = supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).eq("status", "nurturing");
  const salesReadyQuery = supabase.from("marketing_contacts").select("id", { count: "exact", head: true }).eq("status", "sales_ready");

  let listQuery = supabase
    .from("marketing_contacts")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (sp.q) {
    const term = sanitizeSearchTerm(sp.q);
    if (term) listQuery = listQuery.or(`contact_number.ilike.%${term}%,full_name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,company.ilike.%${term}%`);
  }
  const status = MARKETING_CONTACT_STATUSES.find((value) => value === sp.status);
  const source = MARKETING_CONTACT_SOURCES.find((value) => value === sp.source);
  if (status) listQuery = listQuery.eq("status", status);
  if (source) listQuery = listQuery.eq("source", source);
  if (sp.owner) listQuery = sp.owner === "unassigned" ? listQuery.is("owner_id", null) : listQuery.eq("owner_id", sp.owner);
  if (sp.followup === "due") {
    listQuery = listQuery
      .lte("next_follow_up_at", new Date().toISOString())
      .not("next_follow_up_at", "is", null)
      .not("status", "in", "(promoted,archived)");
  }

  const [
    { count: total, error: totalError },
    { count: newCount, error: newError },
    { count: nurturing, error: nurturingError },
    { count: salesReady, error: salesReadyError },
    { data: rows, count: filteredCount, error: listError },
  ] = await Promise.all([totalQuery, newQuery, nurturingQuery, salesReadyQuery, listQuery]);

  // A real query failure must not silently render as "0 Contacts" (CLAUDE.md §15/§24).
  const queryError = totalError || newError || nurturingError || salesReadyError || listError;
  if (queryError) {
    return (
      <>
        <PageHead title="Contacts" subtitle="Pre-sales nurture contacts." />
        <div className="ta-alert ta-alert-error">Could not load contacts. Please try again later.</div>
      </>
    );
  }

  const contacts = (rows ?? []) as MarketingContact[];
  const pageCount = Math.ceil((filteredCount ?? 0) / PAGE_SIZE);

  const { data: staffRows, error: staffError } = await supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name");
  if (staffError) console.error("marketing_contacts: failed to load staff options", { message: staffError.message });
  const staff = (staffRows ?? []) as { id: string; full_name: string }[];
  const staffNames = new Map(staff.map((s) => [s.id, s.full_name]));

  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status", "source", "owner", "followup"] as const) if (sp[k]) qsBase[k] = sp[k]!;

  return (
    <>
      <PageHead
        title="Contacts"
        subtitle="Pre-sales nurture contacts."
        action={
          <Link href="/admin/marketing/contacts/new" className="ta-btn ta-btn-primary">
            + Create Contact
          </Link>
        }
      />

      <div className="ta-grid cols-4" style={{ marginBottom: 20 }}>
        <StatCard label="Total Contacts" value={total ?? 0} icon="👥" />
        <StatCard label="New" value={newCount ?? 0} icon="🆕" />
        <StatCard label="Nurturing" value={nurturing ?? 0} icon="🌱" />
        <StatCard label="Sales Ready" value={salesReady ?? 0} icon="🎯" />
      </div>

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 280 }}>
          <span className="ta-search-ico" aria-hidden="true">
            ⌕
          </span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search contact no, name, email, phone, company…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} className="ta-filter-control" aria-label="Status filter">
          <option value="">All statuses</option>
          {MARKETING_CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1).replace("_", " ")}
            </option>
          ))}
        </select>
        <select name="source" defaultValue={sp.source ?? ""} className="ta-filter-control" aria-label="Source filter">
          <option value="">All sources</option>
          {MARKETING_CONTACT_SOURCES.map((s) => (
            <option key={s} value={s}>
              {SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <select name="owner" defaultValue={sp.owner ?? ""} className="ta-filter-control" aria-label="Owner filter">
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </select>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">
          Apply
        </button>
        {(sp.q || sp.status || sp.source || sp.owner || sp.followup) && (
          <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/marketing/contacts">
            Reset filters
          </Link>
        )}
      </form>

      <Card>
        {contacts.length > 0 ? (
          <ContactTable rows={contacts} staffNames={staffNames} />
        ) : (
          <EmptyState
            icon="👥"
            title="No marketing contacts yet."
            message="Add your first marketing contact to begin nurturing potential leads."
            action={
              <Link href="/admin/marketing/contacts/new" className="ta-btn ta-btn-primary">
                Add Contact
              </Link>
            }
          />
        )}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{filteredCount ?? 0} contact(s)</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/marketing/contacts" query={qsBase} />
      </div>
    </>
  );
}
