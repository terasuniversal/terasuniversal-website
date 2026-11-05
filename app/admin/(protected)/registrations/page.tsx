import Link from "next/link";
import { requireRole } from "../../../../lib/auth/session";
import { PageHead, Card, StatCard, EmptyState, Pagination } from "../../../../components/admin/ui";
import { loadRegistrationQueue, type QueueRow } from "../../../../lib/registrations/reviewQueueLoader";
import {
  ATTENTION_FILTERS,
  ATTENTION_FILTER_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  REGISTRATION_STATUSES,
  REGISTRATION_STATUS_LABELS,
  PAGE_SIZE,
  parseQueueParams,
} from "../../../../lib/registrations/reviewQueue";
import { formatRm } from "../../../../lib/finance/executiveKpis";
import { formatMalaysiaDate, formatMalaysiaDateTime } from "../../../../lib/date-time";

export const metadata = { title: "Registrations — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Public Registration Review Queue (V1): read-only, Admin and Super Admin.
 * RLS grants these tables to Admin and above only, and the role is enforced
 * here and again inside loadRegistrationQueue(). There are no retry, finalize,
 * refund, repair or manual-verification controls and no export.
 */
const CRM_LABELS = { not_applicable: "—", complete: "Complete", incomplete: "Incomplete", unknown: "UNKNOWN" } as const;

function scheduleLine(row: QueueRow): string {
  const s = row.schedule;
  if (!s) return "Schedule unavailable";
  const start = formatMalaysiaDate(s.startDate);
  const end = formatMalaysiaDate(s.endDate);
  return start && end && start !== end ? `${start} – ${end}` : start || "Date not set";
}

function registrationStatusLabel(row: QueueRow): string {
  return REGISTRATION_STATUS_LABELS[row.registrationStatus as keyof typeof REGISTRATION_STATUS_LABELS] ?? row.registrationStatus;
}

function paymentLine(row: QueueRow): string {
  const { paidCents, dueCents } = row.classified;
  if (paidCents !== null && dueCents !== null) return `Verified ${formatRm(paidCents)} of ${formatRm(dueCents)}`;
  if (dueCents !== null) return `Due ${formatRm(dueCents)}`;
  return "Amount unavailable";
}

function crmLine(row: QueueRow): string {
  const { crm } = row.classified;
  if (crm.state === "not_applicable") return "Not confirmed yet";
  const enrolled = crm.enrolled === null ? "not checked" : `${crm.enrolled}/${crm.attendees}`;
  return `Linked ${crm.linked}/${crm.attendees} · Enrolled ${enrolled}`;
}

function Flags({ row }: { row: QueueRow }) {
  const flags = row.classified.exceptions;
  if (flags.length === 0) return <span className="ta-lead-sub">None found</span>;
  return (
    <ul className="ta-reg-flags">
      {flags.map((f) => (
        <li key={f.code} className={`ta-reg-flag ta-reg-flag-${f.severity}`}>
          <strong>{f.severity === "unknown" ? `UNKNOWN: ${f.label}` : f.label}</strong>
          <span>{f.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function AttendeeLinks({ row }: { row: QueueRow }) {
  const shown = row.attendees.slice(0, 3);
  const more = row.attendees.length - shown.length;
  if (row.attendees.length === 0) return <span className="ta-lead-sub">No attendees</span>;
  return (
    <>
      {shown.map((a) => (
        <div key={a.id}>
          {a.participantId ? <Link href={`/admin/participants/${a.participantId}`} className="ta-sales-record-link">{a.fullName}</Link> : <span>{a.fullName}</span>}
        </div>
      ))}
      {more > 0 && <div className="ta-lead-sub">+{more} more</div>}
    </>
  );
}

export default async function RegistrationsPage({ searchParams }: { searchParams: Promise<{ page?: string; status?: string; payment?: string; attention?: string }> }) {
  await requireRole("admin");
  const params = parseQueueParams(await searchParams);
  const result = await loadRegistrationQueue(params);

  if (!result.ok) {
    return (
      <div className="ta-sales ta-reg">
        <PageHead title="Registrations" subtitle="Registrations are unavailable." />
        <div className="ta-alert ta-alert-error" role="alert">
          {result.reason === "too_large"
            ? "This page has too much related data to show exactly. Try again or narrow the filters."
            : "The registrations could not be loaded. Nothing is shown rather than a partial list. Please try again."}
        </div>
      </div>
    );
  }

  const { rows, page, totalPages, filteredTotal, summary } = result;
  const query: Record<string, string> = {};
  if (params.status) query.status = params.status;
  if (params.payment) query.payment = params.payment;
  if (params.attention) query.attention = params.attention;
  const filtered = Boolean(params.status || params.payment || params.attention);
  const first = filteredTotal === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const last = (page - 1) * PAGE_SIZE + rows.length;

  return (
    <div className="ta-sales ta-sales-reports ta-reg">
      <PageHead title="Registrations" subtitle="Public registrations from the website, newest first. Read-only. Admin and Super Admin." />

      <div className="ta-sales-report-intro">
        <strong>What these indicators cover</strong>
        <p>
          The three totals below count every registration. Every other indicator is checked only on the {PAGE_SIZE} rows shown, so it is not a total. Payment recorded at Toyyibpay is not treated as a completed registration: a charge whose
          CRM finalization failed leaves no trace here and is UNKNOWN.
        </p>
      </div>

      <div className="ta-sales-report-kpis ta-reg-kpis">
        <StatCard label="Registrations (all)" value={summary.total} icon="🧾" />
        <StatCard label="Hold expired, still open (all)" value={summary.expiredHolds} icon="⏱️" context="Should have expired on their own" />
        <StatCard label="Paid, not confirmed (all)" value={summary.paidUnconfirmed} icon="⚠️" context="Should not occur from the normal path" />
      </div>

      <form className="ta-toolbar" method="get" style={{ flexWrap: "wrap", marginBottom: 18 }} action="/admin/registrations">
        <label className="ta-filter-date-group">
          Registration
          <select name="status" defaultValue={params.status ?? ""} className="ta-filter-date" aria-label="Registration status">
            <option value="">All statuses</option>
            {REGISTRATION_STATUSES.map((s) => (
              <option key={s} value={s}>{REGISTRATION_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="ta-filter-date-group">
          Payment
          <select name="payment" defaultValue={params.payment ?? ""} className="ta-filter-date" aria-label="Payment status">
            <option value="">All payments</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <label className="ta-filter-date-group">
          Needs attention
          <select name="attention" defaultValue={params.attention ?? ""} className="ta-filter-date" aria-label="Needs attention filter">
            <option value="">Any</option>
            {ATTENTION_FILTERS.map((a) => (
              <option key={a} value={a}>{ATTENTION_FILTER_LABELS[a]}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm">Apply</button>
        {filtered && <Link href="/admin/registrations" className="ta-btn ta-btn-outline ta-btn-sm">Reset</Link>}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon="🗂️"
          kind={filtered ? "no-results" : "empty"}
          title={filtered ? "No matching registrations" : "No public registrations yet"}
          message={filtered ? "No registrations match these filters. Reset the filters to see all registrations." : "Registrations made through the public website will appear here."}
        />
      ) : (
        <>
          <p className="ta-sales-report-note" aria-live="polite">
            Showing {first}–{last} of {filteredTotal}{filtered ? " matching" : ""} registration{filteredTotal === 1 ? "" : "s"}.
          </p>

          <div className="ta-table-wrap ta-lead-table">
            <table className="ta-table">
              <thead>
                <tr>
                  <th>Registration</th>
                  <th>Attendee / Company</th>
                  <th>Course / Schedule</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>CRM</th>
                  <th>Needs attention</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.reference}</strong>
                      <div className="ta-lead-sub">{formatMalaysiaDateTime(r.createdAt)}</div>
                    </td>
                    <td>
                      <AttendeeLinks row={r} />
                      {r.classified.company && <div className="ta-lead-sub">{r.classified.company}</div>}
                      <div className="ta-lead-sub">{r.attendeeCount} attendee{r.attendeeCount === 1 ? "" : "s"}</div>
                    </td>
                    <td>
                      <div>{r.course?.title ?? "Course unavailable"}</div>
                      <div className="ta-lead-sub">
                        {r.schedule ? <Link href={`/admin/schedules/${r.schedule.id}`} className="ta-sales-record-link">{scheduleLine(r)}</Link> : scheduleLine(r)}
                      </div>
                    </td>
                    <td>
                      <div>{r.classified.stageLabel}</div>
                      {registrationStatusLabel(r) !== r.classified.stageLabel && <div className="ta-lead-sub">{registrationStatusLabel(r)}</div>}
                    </td>
                    <td>
                      <div>{PAYMENT_STATUS_LABELS[r.paymentStatus as keyof typeof PAYMENT_STATUS_LABELS] ?? r.paymentStatus}</div>
                      <div className="ta-lead-sub">{paymentLine(r)}</div>
                    </td>
                    <td>
                      <div>{CRM_LABELS[r.classified.crm.state]}</div>
                      <div className="ta-lead-sub">{crmLine(r)}</div>
                    </td>
                    <td><Flags row={r} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="ta-lead-cards">
            {rows.map((r) => (
              <li className="ta-card ta-lead-card ta-reg-card" key={r.id}>
                <div className="ta-reg-id">
                  <strong>{r.reference}</strong>
                  <div className="ta-lead-sub">{formatMalaysiaDateTime(r.createdAt)}</div>
                </div>
                <div className="ta-reg-grid">
                  <span>Attendee</span>
                  <span>
                    <AttendeeLinks row={r} />
                    {r.classified.company && <div className="ta-lead-sub">{r.classified.company}</div>}
                  </span>
                  <span>Course</span>
                  <span>{r.course?.title ?? "Course unavailable"}</span>
                  <span>Schedule</span>
                  <span>{r.schedule ? <Link href={`/admin/schedules/${r.schedule.id}`}>{scheduleLine(r)}</Link> : scheduleLine(r)}</span>
                  <span>Status</span>
                  <span>{r.classified.stageLabel}</span>
                  <span>Payment</span>
                  <span>
                    {PAYMENT_STATUS_LABELS[r.paymentStatus as keyof typeof PAYMENT_STATUS_LABELS] ?? r.paymentStatus}
                    <div className="ta-lead-sub">{paymentLine(r)}</div>
                  </span>
                  <span>CRM</span>
                  <span>
                    {CRM_LABELS[r.classified.crm.state]}
                    <div className="ta-lead-sub">{crmLine(r)}</div>
                  </span>
                </div>
                <div className="ta-reg-attention">
                  <span className="ta-reg-attention-label">Needs attention</span>
                  <Flags row={r} />
                </div>
                {r.schedule && (
                  <div className="ta-lead-card-action">
                    <Link href={`/admin/schedules/${r.schedule.id}`} className="ta-btn ta-btn-outline ta-btn-sm" aria-label={`View schedule for ${r.reference}`}>View schedule →</Link>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <Pagination page={page} pageCount={totalPages} basePath="/admin/registrations" query={query} />
        </>
      )}
    </div>
  );
}
