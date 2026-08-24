import Link from "next/link";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState } from "../../../../../components/admin/ui";
import { formatMalaysiaDate } from "../../../../../lib/date-time";

export const metadata = { title: "Legacy Import — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

interface BatchRow {
  id: string;
  source_label: string;
  original_filename: string;
  status: string;
  created_at: string;
  total_row_count: number;
  valid_count: number;
  invalid_count: number;
}

export default async function LegacyImportListPage() {
  await requireRole("admin");
  await requireModuleAccess("legacy_import");
  const supabase = await createSupabaseServerClient();

  const { data: batches, error } = await supabase
    .from("legacy_import_batches")
    .select("id, source_label, original_filename, status, created_at, total_row_count, valid_count, invalid_count")
    .order("created_at", { ascending: false });
  if (error) console.error("LegacyImportListPage: batch list query failed", { message: error.message });

  // Bounded by realistic import-batch sizes (human-reviewed source files,
  // not a scaling production table) -- aggregated here in one pass rather
  // than a per-batch query. Revisit with a DB view/RPC if batch volumes grow
  // materially beyond what a single admin review workflow implies.
  const { data: allRows } = await supabase
    .from("legacy_participant_staging")
    .select("batch_id, match_status, mapped_course_id, normalized_course_name");
  const { data: courseMaps } = await supabase
    .from("legacy_course_map")
    .select("source_label, normalized_course_name, status");

  const mapStatus = new Map<string, string>();
  for (const cm of courseMaps ?? []) {
    mapStatus.set(`${cm.source_label}::${cm.normalized_course_name}`, cm.status);
  }

  type Summary = {
    exact_match: number;
    probable_duplicate: number;
    new_participant: number;
    conflict: number;
    mappedCourses: number;
    unmappedCourses: number;
  };
  const summaries = new Map<string, Summary>();
  const batchSourceLabel = new Map<string, string>();
  for (const b of batches ?? []) batchSourceLabel.set(b.id, b.source_label);

  for (const row of allRows ?? []) {
    const s = summaries.get(row.batch_id) ?? {
      exact_match: 0,
      probable_duplicate: 0,
      new_participant: 0,
      conflict: 0,
      mappedCourses: 0,
      unmappedCourses: 0,
    };
    if (row.match_status && row.match_status in s) (s as any)[row.match_status] += 1;
    summaries.set(row.batch_id, s);
  }
  // Distinct-course mapped/unmapped counts, computed per batch separately
  // from the row loop above since it needs a distinct-name set, not a
  // per-row tally.
  const seenCourseNames = new Map<string, Set<string>>();
  for (const row of allRows ?? []) {
    if (!row.normalized_course_name) continue;
    const set = seenCourseNames.get(row.batch_id) ?? new Set<string>();
    set.add(row.normalized_course_name);
    seenCourseNames.set(row.batch_id, set);
  }
  for (const [batchId, names] of seenCourseNames) {
    const s = summaries.get(batchId) ?? { exact_match: 0, probable_duplicate: 0, new_participant: 0, conflict: 0, mappedCourses: 0, unmappedCourses: 0 };
    const sourceLabel = batchSourceLabel.get(batchId) ?? "";
    for (const name of names) {
      if (mapStatus.get(`${sourceLabel}::${name}`) === "mapped") s.mappedCourses += 1;
      else s.unmappedCourses += 1;
    }
    summaries.set(batchId, s);
  }

  return (
    <>
      <PageHead
        title="Legacy Import"
        subtitle="Review legacy participant import batches before any Approved Merge. Staging only — no Participant Master writes happen here."
      />
      <Card>
        {batches && batches.length > 0 ? (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Filename</th>
                  <th>Status</th>
                  <th>Uploaded</th>
                  <th>Rows</th>
                  <th>Valid / Invalid</th>
                  <th>Matches</th>
                  <th>Courses</th>
                  <th className="ta-row-actions"><span className="ta-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {(batches as BatchRow[]).map((b) => {
                  const s = summaries.get(b.id) ?? { exact_match: 0, probable_duplicate: 0, new_participant: 0, conflict: 0, mappedCourses: 0, unmappedCourses: 0 };
                  return (
                    <tr key={b.id}>
                      <td>{b.source_label}</td>
                      <td>{b.original_filename}</td>
                      <td><Badge status={b.status} /></td>
                      <td className="ta-nowrap"><span className="ta-cell-sub">{formatMalaysiaDate(b.created_at)}</span></td>
                      <td>{b.total_row_count}</td>
                      <td>
                        <span style={{ color: "var(--ta-success)" }}>{b.valid_count}</span>
                        {" / "}
                        <span style={{ color: b.invalid_count > 0 ? "var(--ta-danger)" : "var(--ta-muted)" }}>{b.invalid_count}</span>
                      </td>
                      <td>
                        <div className="ta-cell-sub">
                          {s.new_participant} new · {s.exact_match} exact
                          {(s.conflict > 0 || s.probable_duplicate > 0) && (
                            <>
                              {" · "}
                              <strong style={{ color: "var(--ta-danger)" }}>
                                {s.conflict + s.probable_duplicate} need review
                              </strong>
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <span className="ta-cell-sub">
                          {s.mappedCourses} mapped
                          {s.unmappedCourses > 0 && (
                            <>
                              {" · "}
                              <strong style={{ color: "#a9791a" }}>{s.unmappedCourses} pending</strong>
                            </>
                          )}
                        </span>
                      </td>
                      <td className="ta-row-actions">
                        <Link href={`/admin/participants/legacy-import/${b.id}`} className="ta-btn ta-btn-outline ta-btn-sm">
                          Review
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No legacy import batches yet." />
        )}
      </Card>
    </>
  );
}
