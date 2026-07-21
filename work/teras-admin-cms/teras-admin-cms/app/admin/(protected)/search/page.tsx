import Link from "next/link";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { PageHead, Card, EmptyState } from "../../../../components/admin/ui";

export const metadata = { title: "Search — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

const HREF: Record<string, (id: string) => string> = {
  course: (id) => `/admin/courses/${id}`,
  news: (id) => `/admin/news/${id}`,
  participant: (id) => `/admin/participants/${id}`,
  media: () => `/admin/media`,
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireRole("editor");
  const { q } = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: results } = q
    ? await supabase.rpc("global_search", { q, max_rows: 40 })
    : { data: [] as any[] };

  return (
    <>
      <PageHead title="Search" subtitle={q ? `Results for “${q}”` : "Search across all content."} />
      <Card>
        {results && results.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead><tr><th>Type</th><th>Title</th><th>Detail</th><th></th></tr></thead>
              <tbody>
                {results.map((r: any, i: number) => (
                  <tr key={i}>
                    <td style={{ textTransform: "capitalize" }}>{r.entity_type}</td>
                    <td><strong>{r.title}</strong></td>
                    <td style={{ color: "var(--ta-muted)" }}>{r.subtitle ?? "—"}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link className="ta-btn ta-btn-outline ta-btn-sm" href={(HREF[r.entity_type] ?? (() => "#"))(r.entity_id)}>Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="🔍" message={q ? "No matches found." : "Type a query in the top search bar."} />
        )}
      </Card>
    </>
  );
}
