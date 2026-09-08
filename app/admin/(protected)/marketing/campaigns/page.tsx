import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, StatCard, EmptyState, Pagination } from "../../../../../components/admin/ui";
import { sanitizeSearchTerm } from "../../../../../lib/sales/crm";
import { CHANNEL_LABELS } from "../../../../../lib/marketing/campaigns";
import { MARKETING_CAMPAIGN_CHANNELS, MARKETING_CAMPAIGN_STATUSES } from "../../../../../lib/validation/schemas";
import type { MarketingCampaign } from "../../../../../lib/supabase/database.types";
import { CampaignTable } from "./CampaignTable";

export const metadata = { title: "Campaigns — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string; channel?: string }>;
}) {
  await requireModuleAccess("marketing_campaigns");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const supabase = await createSupabaseServerClient();

  // Each query is built (not awaited) here, then resolved together — no
  // `await` inside the Promise.all array literal (CLAUDE.md §5/§13).
  const totalQuery = supabase.from("marketing_campaigns").select("id", { count: "exact", head: true });
  const activeQuery = supabase.from("marketing_campaigns").select("id", { count: "exact", head: true }).eq("status", "active");
  const draftQuery = supabase.from("marketing_campaigns").select("id", { count: "exact", head: true }).eq("status", "draft");
  const completedQuery = supabase.from("marketing_campaigns").select("id", { count: "exact", head: true }).eq("status", "completed");

  let listQuery = supabase
    .from("marketing_campaigns")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (sp.q) {
    const term = sanitizeSearchTerm(sp.q);
    if (term) listQuery = listQuery.or(`campaign_number.ilike.%${term}%,name.ilike.%${term}%,utm_campaign.ilike.%${term}%`);
  }
  const status = MARKETING_CAMPAIGN_STATUSES.find((value) => value === sp.status);
  const channel = MARKETING_CAMPAIGN_CHANNELS.find((value) => value === sp.channel);
  if (status) listQuery = listQuery.eq("status", status);
  if (channel) listQuery = listQuery.eq("channel", channel);

  const [
    { count: total, error: totalError },
    { count: active, error: activeError },
    { count: draft, error: draftError },
    { count: completed, error: completedError },
    { data: rows, count: filteredCount, error: listError },
  ] = await Promise.all([totalQuery, activeQuery, draftQuery, completedQuery, listQuery]);

  // A real query failure must not silently render as "0 Campaigns" (CLAUDE.md §15/§24).
  const queryError = totalError || activeError || draftError || completedError || listError;
  if (queryError) {
    return (
      <>
        <PageHead title="Campaigns" subtitle="Marketing campaigns across channels." />
        <div className="ta-alert ta-alert-error">Could not load campaigns: {queryError.message}</div>
      </>
    );
  }

  const campaigns = (rows ?? []) as MarketingCampaign[];
  const pageCount = Math.ceil((filteredCount ?? 0) / PAGE_SIZE);

  const ownerIds = Array.from(new Set(campaigns.map((c) => c.owner_id).filter((id): id is string => Boolean(id))));
  const courseIds = Array.from(new Set(campaigns.map((c) => c.course_id).filter((id): id is string => Boolean(id))));

  const [{ data: staffRows, error: staffError }, { data: courseRows, error: courseError }] = await Promise.all([
    ownerIds.length > 0
      ? supabase.from("profiles").select("id, full_name").in("id", ownerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string }[], error: null }),
    courseIds.length > 0
      ? supabase.from("courses").select("id, title").in("id", courseIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[], error: null }),
  ]);
  // Non-critical lookups (owner/course display names) — a failure here
  // shouldn't block the list itself, but must not be silently dropped either.
  if (staffError) console.error("marketing_campaigns: failed to load owner names", { message: staffError.message });
  if (courseError) console.error("marketing_campaigns: failed to load course titles", { message: courseError.message });

  const staffNames = new Map(((staffRows ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, s.full_name]));
  const courseTitles = new Map(((courseRows ?? []) as { id: string; title: string }[]).map((c) => [c.id, c.title]));

  const qsBase: Record<string, string> = {};
  for (const k of ["q", "status", "channel"] as const) if (sp[k]) qsBase[k] = sp[k]!;

  return (
    <>
      <PageHead
        title="Campaigns"
        subtitle="Marketing campaigns across channels."
        action={
          <Link href="/admin/marketing/campaigns/new" className="ta-btn ta-btn-primary">
            + Create Campaign
          </Link>
        }
      />

      <div className="ta-grid cols-4" style={{ marginBottom: 20 }}>
        <StatCard label="Total Campaigns" value={total ?? 0} icon="📣" />
        <StatCard label="Active" value={active ?? 0} icon="🟢" />
        <StatCard label="Draft" value={draft ?? 0} icon="📝" />
        <StatCard label="Completed" value={completed ?? 0} icon="✅" />
      </div>

      <form className="ta-toolbar" style={{ alignItems: "flex-end" }}>
        <div className="ta-search" style={{ maxWidth: 280 }}>
          <span className="ta-search-ico" aria-hidden="true">
            ⌕
          </span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Search campaign no, name, UTM…" />
        </div>
        <select name="status" defaultValue={sp.status ?? ""} className="ta-filter-control" aria-label="Status filter">
          <option value="">All statuses</option>
          {MARKETING_CAMPAIGN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <select name="channel" defaultValue={sp.channel ?? ""} className="ta-filter-control" aria-label="Channel filter">
          <option value="">All channels</option>
          {MARKETING_CAMPAIGN_CHANNELS.map((c) => (
            <option key={c} value={c}>
              {CHANNEL_LABELS[c]}
            </option>
          ))}
        </select>
        <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">
          Apply
        </button>
        {(sp.q || sp.status || sp.channel) && (
          <Link className="ta-btn ta-btn-outline ta-btn-sm" href="/admin/marketing/campaigns">
            Reset filters
          </Link>
        )}
      </form>

      <Card>
        {campaigns.length > 0 ? (
          <CampaignTable rows={campaigns} staffNames={staffNames} courseTitles={courseTitles} />
        ) : (
          <EmptyState
            icon="📣"
            title="No marketing campaigns yet."
            message="Create your first campaign to begin tracking marketing activity."
            action={
              <Link href="/admin/marketing/campaigns/new" className="ta-btn ta-btn-primary">
                Create Campaign
              </Link>
            }
          />
        )}
      </Card>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--ta-muted)", fontSize: 13, paddingTop: 14 }}>{filteredCount ?? 0} campaign(s)</span>
        <Pagination page={page} pageCount={pageCount} basePath="/admin/marketing/campaigns" query={qsBase} />
      </div>
    </>
  );
}
