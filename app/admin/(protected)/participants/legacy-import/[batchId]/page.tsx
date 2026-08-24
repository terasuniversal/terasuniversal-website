import Link from "next/link";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../../lib/auth/session";
import { PageHead, Card, Badge, EmptyState, StatCard, SvgIcon } from "../../../../../../components/admin/ui";
import { formatMalaysiaDate } from "../../../../../../lib/date-time";
import {
  linkParticipant,
  markAsNewParticipant,
  markRowReviewed,
  rejectRow,
  approveRow,
  approveCourseMapping,
  approveBatch,
} from "../actions";

export const dynamic = "force-dynamic";

const UNRESOLVED_MATCH = new Set(["conflict", "probable_duplicate"]);
const CLOSED_REVIEW = new Set(["approved", "rejected", "merged"]);

export default async function LegacyImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole("admin");
  await requireModuleAccess("legacy_import");
  const { batchId } = await params;
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();

  const { data: batch, error: batchError } = await supabase
    .from("legacy_import_batches")
    .select("*")
    .eq("id", batchId)
    .maybeSingle();
  if (batchError) console.error("LegacyImportBatchPage: batch lookup failed", { message: batchError.message, batchId });
  if (!batch) notFound();

  const { data: rows, error: rowsError } = await supabase
    .from("legacy_participant_staging")
    .select(
      "*, matched_participant:participants!legacy_participant_staging_matched_participant_id_fkey(id, full_name, identity_no, ic_passport_no), mapped_course:courses!legacy_participant_staging_mapped_course_id_fkey(id, title)"
    )
    .eq("batch_id", batchId)
    .order("source_row_number", { ascending: true });
  if (rowsError) console.error("LegacyImportBatchPage: staging rows query failed", { message: rowsError.message, batchId });

  const { data: courseMaps } = await supabase
    .from("legacy_course_map")
    .select("*")
    .eq("source_label", batch.source_label)
    .order("normalized_course_name", { ascending: true });

  const { data: courses } = await supabase
    .from("courses")
    .select("id, title")
    .is("deleted_at", null)
    .order("title", { ascending: true });

  // Bounded candidate list for the "link to a different participant"
  // <select> -- not a search-as-you-type combobox (Phase 2 scope note: the
  // per-row "Confirm link" button covers the already-computed candidate;
  // this select is the fallback for a genuinely different participant).
  const { data: participants } = await supabase
    .from("participants")
    .select("id, full_name, identity_no, ic_passport_no")
    .is("deleted_at", null)
    .order("full_name", { ascending: true })
    .limit(500);

  const rowList = (rows ?? []) as any[];
  const approvedRows = rowList.filter((r) => r.review_status === "approved").length;
  const rejectedRows = rowList.filter((r) => r.review_status === "rejected").length;
  const unresolvedRows = rowList.filter((r) => r.review_status === "pending" || r.review_status === "reviewed").length;
  const conflictsPending = rowList.filter((r) => UNRESOLVED_MATCH.has(r.match_status) && !CLOSED_REVIEW.has(r.review_status)).length;
  // Mirrors approveBatch()'s server-side readiness rule exactly (display
  // only -- the server re-derives this from fresh DB state and is
  // authoritative, this is not relied on for enforcement). Rejected rows
  // are exempt from the identity/course conditions since they never merge.
  const unresolvedIdentity = rowList.filter((r) => r.review_status !== "rejected" && UNRESOLVED_MATCH.has(r.match_status)).length;
  const unresolvedCourse = rowList.filter((r) => r.review_status !== "rejected" && r.raw_course_name && !r.mapped_course_id).length;
  const pendingCourseMaps = (courseMaps ?? []).filter((c: any) => c.status === "pending");
  const canApproveBatch = batch.status === "review" && unresolvedRows === 0 && unresolvedIdentity === 0 && unresolvedCourse === 0;

  return (
    <>
      <PageHead
        title={`Legacy Import — ${batch.original_filename}`}
        subtitle={`Source: ${batch.source_label} · Batch status: ${batch.status}`}
        action={<Link href="/admin/participants/legacy-import" className="ta-btn ta-btn-outline">Back to Legacy Import</Link>}
      />

      {sp.error && (
        <p className="ta-card ta-card-pad" role="alert" style={{ color: "var(--ta-danger)" }}>
          {sp.error}
        </p>
      )}

      <div className="ta-kpi-grid">
        <StatCard label="Approved" value={approvedRows} icon={<SvgIcon><path d="M9 11.5 11 13.5 15.5 9" /><rect x="3.5" y="4.5" width="17" height="16" rx="2" /></SvgIcon>} />
        <StatCard label="Rejected" value={rejectedRows} icon={<SvgIcon><path d="M6 6l12 12M18 6 6 18" /></SvgIcon>} />
        <StatCard label="Unresolved" value={unresolvedRows} icon={<SvgIcon><circle cx="12" cy="12" r="8.5" /><path d="M12 8v5M12 16v.01" /></SvgIcon>} />
        <StatCard label="Conflicts pending" value={conflictsPending} icon={<SvgIcon><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17v.01" /></SvgIcon>} />
      </div>

      <Card title="Batch readiness">
        <p style={{ marginTop: 0 }}>
          {canApproveBatch
            ? "Every row has a final decision, no unresolved identity conflicts, and no required course mapping is missing. This batch can be marked Approved."
            : `${unresolvedRows} row(s) still need an approve/reject decision. ${unresolvedIdentity} unresolved identity conflict(s) and ${unresolvedCourse} row(s) missing a required course mapping (rejected rows are exempt from both).`}
          {pendingCourseMaps.length > 0 && ` ${pendingCourseMaps.length} course name(s) still need canonical mapping.`}
        </p>
        <form action={approveBatch.bind(null, batchId)}>
          <button className="ta-btn ta-btn-primary" type="submit" disabled={!canApproveBatch}>
            Approve Batch
          </button>
        </form>
        <p className="ta-cell-sub" style={{ marginTop: 10 }}>
          Approving a batch does not merge any data into the Participant Master. Merge execution is a separate, not-yet-built phase.
        </p>
      </Card>

      {pendingCourseMaps.length > 0 && (
        <Card title="Course Mapping">
          {pendingCourseMaps.map((cm: any) => (
            <form
              key={cm.id}
              action={approveCourseMapping.bind(null, batchId)}
              style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "10px 0", borderBottom: "1px solid var(--ta-line)" }}
            >
              <input type="hidden" name="course_map_id" value={cm.id} />
              <div style={{ minWidth: 220 }}>
                <strong>{cm.raw_course_name}</strong>
                <div className="ta-cell-sub">Normalized: {cm.normalized_course_name}</div>
              </div>
              <Badge status={cm.status} />
              <select name="course_id" className="ta-select" required aria-label={`Canonical course for ${cm.raw_course_name}`}>
                <option value="">Select canonical course…</option>
                {(courses ?? []).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
              </select>
              <button type="submit" className="ta-btn ta-btn-gold ta-btn-sm">Approve Mapping</button>
            </form>
          ))}
          <p className="ta-cell-sub" style={{ marginTop: 10 }}>
            No automatic matching — a candidate title may look obvious, but the canonical course must be explicitly selected and approved here.
          </p>
        </Card>
      )}

      <Card title={`Staging Rows (${rowList.length})`}>
        {rowList.length === 0 ? (
          <EmptyState message="No staging rows in this batch." />
        ) : (
          <div className="ta-table-wrap">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>IC/Passport</th>
                  <th>Company</th>
                  <th>Course</th>
                  <th>Training Date</th>
                  <th>Cert No.</th>
                  <th>Match</th>
                  <th>Linked Participant</th>
                  <th>Mapped Course</th>
                  <th>Issue</th>
                  <th>Review</th>
                  <th className="ta-row-actions"><span className="ta-sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rowList.map((r) => {
                  const identityUnresolved = UNRESOLVED_MATCH.has(r.match_status);
                  const rowClosed = CLOSED_REVIEW.has(r.review_status);
                  const courseRequired = Boolean(r.raw_course_name);
                  const canRowApprove =
                    !rowClosed && !r.validation_error && !identityUnresolved && (!courseRequired || r.mapped_course_id);
                  const rowIsProblem = identityUnresolved || Boolean(r.validation_error);
                  return (
                    <tr key={r.id} className={rowIsProblem ? "ta-row-conflict" : undefined}>
                      <td>{r.source_row_number}</td>
                      <td>{r.raw_name || <span className="ta-cell-sub">—</span>}</td>
                      <td>{r.raw_ic_passport || <span className="ta-cell-sub">—</span>}</td>
                      <td>{r.raw_company || <span className="ta-cell-sub">—</span>}</td>
                      <td>{r.raw_course_name || <span className="ta-cell-sub">—</span>}</td>
                      <td className="ta-nowrap">{r.training_start_date || <span className="ta-cell-sub">—</span>}</td>
                      <td>{r.raw_certificate_number || <span className="ta-cell-sub">—</span>}</td>
                      <td><Badge status={r.match_status ?? "unknown"} /></td>
                      <td>
                        {r.matched_participant ? (
                          <div className="ta-cell-sub">
                            {r.matched_participant.full_name}
                            <br />
                            {r.matched_participant.identity_no ?? r.matched_participant.ic_passport_no ?? "—"}
                          </div>
                        ) : (
                          <span className="ta-cell-sub">—</span>
                        )}
                      </td>
                      <td>{r.mapped_course?.title ?? <span className="ta-cell-sub">—</span>}</td>
                      <td>
                        {r.validation_error || r.duplicate_conflict_reason ? (
                          <span style={{ color: "var(--ta-danger)", fontSize: 12.5 }}>
                            {r.validation_error || r.duplicate_conflict_reason}
                          </span>
                        ) : (
                          <span className="ta-cell-sub">—</span>
                        )}
                      </td>
                      <td><Badge status={r.review_status} /></td>
                      <td className="ta-row-actions">
                        <details>
                          <summary className="ta-cell-sub" style={{ cursor: "pointer" }}>Raw data</summary>
                          <pre style={{ fontSize: 11, maxWidth: 320, overflow: "auto", background: "var(--ta-bg-alt, #f6f6f8)", padding: 8, borderRadius: 6 }}>
                            {JSON.stringify(r.raw_data, null, 2)}
                          </pre>
                        </details>

                        {identityUnresolved && !rowClosed && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8, minWidth: 220 }}>
                            {r.matched_participant_id && (
                              <form action={linkParticipant.bind(null, batchId)}>
                                <input type="hidden" name="row_id" value={r.id} />
                                <input type="hidden" name="participant_id" value={r.matched_participant_id} />
                                <button type="submit" className="ta-btn ta-btn-gold ta-btn-sm" style={{ width: "100%" }}>
                                  Confirm link → {r.matched_participant?.full_name}
                                </button>
                              </form>
                            )}
                            <form action={linkParticipant.bind(null, batchId)} style={{ display: "flex", gap: 4 }}>
                              <input type="hidden" name="row_id" value={r.id} />
                              <select name="participant_id" className="ta-select" required aria-label="Link to a different participant">
                                <option value="">Link to different…</option>
                                {(participants ?? []).map((p: any) => (
                                  <option key={p.id} value={p.id}>
                                    {p.full_name} ({(p.identity_no ?? p.ic_passport_no ?? "").slice(-4) || "—"})
                                  </option>
                                ))}
                              </select>
                              <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Link</button>
                            </form>
                            <form action={markAsNewParticipant.bind(null, batchId, r.id)}>
                              <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" style={{ width: "100%" }}>
                                Not a match — New Participant
                              </button>
                            </form>
                            <form action={rejectRow.bind(null, batchId)} style={{ display: "flex", gap: 4 }}>
                              <input type="hidden" name="row_id" value={r.id} />
                              <input type="text" name="reason" placeholder="Reason (optional)" style={{ flex: 1, minWidth: 0 }} />
                              <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" style={{ color: "var(--ta-danger)" }}>
                                Reject
                              </button>
                            </form>
                          </div>
                        )}

                        {!rowClosed && !identityUnresolved && (
                          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                            {r.review_status === "pending" && (
                              <form action={markRowReviewed.bind(null, batchId, r.id)}>
                                <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Mark Reviewed</button>
                              </form>
                            )}
                            <form action={approveRow.bind(null, batchId, r.id)}>
                              <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={!canRowApprove}>
                                Approve
                              </button>
                            </form>
                            <form action={rejectRow.bind(null, batchId)}>
                              <input type="hidden" name="row_id" value={r.id} />
                              <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" style={{ color: "var(--ta-danger)" }}>
                                Reject
                              </button>
                            </form>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
