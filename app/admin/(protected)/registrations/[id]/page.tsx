import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "../../../../../lib/auth/session";
import { PageHead, Card, EmptyState } from "../../../../../components/admin/ui";
import { loadReconciliationDetail, type DetailAttempt, type ReconciliationDetail } from "../../../../../lib/registrations/reconciliationLoader";
import { evidenceReasons, isUuid } from "../../../../../lib/registrations/reconciliation";
import {
  PAYMENT_STATUS_LABELS,
  REGISTRATION_STATUS_LABELS,
  classifyRegistration,
  type PaymentInput,
  type RegistrationException,
} from "../../../../../lib/registrations/reviewQueue";
import { formatRm } from "../../../../../lib/finance/executiveKpis";
import { formatMalaysiaDate, formatMalaysiaDateTime } from "../../../../../lib/date-time";

export const metadata = { title: "Registration payments — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * Staff payment reconciliation detail (PKG-1d-B): read-only, Admin and Super Admin. Shows the registration, its
 * payment attempts with verified transaction references, schedule capacity, the reasons it needs reconciliation and
 * its audit history. It changes nothing: no form, no server action, no RPC.
 *
 * Manual bank-transfer verification is deliberately NOT available here. The approved RPC
 * (verify_public_registration_manual_payment) authenticates the registration with the PAYER's secret, which only the
 * payer holds (the database keeps a hash). A staff-keyed RPC needs its own reviewed migration first (PKG-1d-B-DB).
 */

const PROVIDER_LABELS: Record<string, string> = { toyyibpay: "Toyyibpay", bank_transfer: "Bank transfer", cash: "Cash", cheque: "Cheque", other: "Other" };
const ENTITY_LABELS = { registration: "Registration", attempt: "Payment attempt", other: "Other" } as const;

const statusLabel = (map: Record<string, string>, value: string) => map[value] ?? value;
const rm = (cents: number | null) => (cents === null ? "—" : formatRm(cents));

function Reasons({ items }: { items: RegistrationException[] }) {
  if (items.length === 0) {
    return <p className="ta-lead-sub">No reconciliation reason found from the recorded data.</p>;
  }
  return (
    <ul className="ta-reg-flags">
      {items.map((f) => (
        <li key={f.code} className={`ta-reg-flag ta-reg-flag-${f.severity}`}>
          <strong>{f.severity === "unknown" ? `UNKNOWN: ${f.label}` : f.label}</strong>
          <span>{f.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function EvidenceList({ attempt }: { attempt: DetailAttempt }) {
  const e = attempt.evidence;
  const items: string[] = [];
  if (e.lateSuccess) items.push(`Late success recorded${e.lateOriginalStatus ? ` (attempt was ${e.lateOriginalStatus})` : ""}`);
  for (const m of e.mismatches) items.push(`Amount mismatch: ${m.transactionId} reported ${rm(m.providerCents)}, expected ${rm(m.expectedCents)}`);
  for (const c of e.conflicts) items.push(`Transaction conflict: ${c.transactionId}${c.otherAttemptId ? " already belongs to another attempt" : ""}`);
  if (e.successAfterRefund) items.push("Provider success reported after refund (not re-paid)");
  if (items.length === 0) return <span className="ta-lead-sub">—</span>;
  return (
    <ul className="ta-recon-evidence">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

function AttemptTable({ attempts }: { attempts: DetailAttempt[] }) {
  if (attempts.length === 0) return <EmptyState icon="💳" kind="empty" title="No payment attempts" message="No bill or bank transfer has been recorded for this registration." />;
  return (
    <>
      <div className="ta-table-wrap ta-lead-table">
        <table className="ta-table ta-recon-attempts">
          <caption className="ta-sr-only">Payment attempts, oldest first</caption>
          <thead>
            <tr>
              <th scope="col">Method / status</th>
              <th scope="col">Amount</th>
              <th scope="col">Verified</th>
              <th scope="col">Transaction / bill reference</th>
              <th scope="col">Evidence</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.id}>
                <td>
                  <div>{statusLabel(PROVIDER_LABELS, a.provider)}</div>
                  <span className={`ta-recon-status ta-recon-status-${a.status}`}>{statusLabel(PAYMENT_STATUS_LABELS, a.status)}</span>
                  <div className="ta-lead-sub">Created {formatMalaysiaDateTime(a.createdAt)}</div>
                </td>
                <td>{rm(a.amountCents)}</td>
                <td>
                  <div>{rm(a.verifiedCents)}</div>
                  <div className="ta-lead-sub">{a.verifiedAt ? formatMalaysiaDateTime(a.verifiedAt) : "Not verified"}</div>
                </td>
                <td className="ta-recon-refs">
                  <div><span className="ta-lead-sub">Txn</span> <code>{a.transactionId ?? "—"}</code></div>
                  {a.billCode && <div><span className="ta-lead-sub">Bill</span> <code>{a.billCode}</code></div>}
                  {a.providerReference && <div><span className="ta-lead-sub">Ref</span> <code>{a.providerReference}</code></div>}
                  <div className="ta-lead-sub">
                    {a.callbackReceivedAt ? `Callback ${formatMalaysiaDateTime(a.callbackReceivedAt)}` : a.provider === "toyyibpay" ? "No callback received" : ""}
                    {a.provider === "toyyibpay" && a.billCreationState !== "attached" ? ` · bill ${a.billCreationState}` : ""}
                  </div>
                </td>
                <td><EvidenceList attempt={a} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="ta-lead-cards">
        {attempts.map((a) => (
          <li className="ta-card ta-reg-card" key={a.id}>
            <div className="ta-reg-grid">
              <span>Method</span>
              <span>{statusLabel(PROVIDER_LABELS, a.provider)}</span>
              <span>Status</span>
              <span><span className={`ta-recon-status ta-recon-status-${a.status}`}>{statusLabel(PAYMENT_STATUS_LABELS, a.status)}</span></span>
              <span>Amount</span>
              <span>{rm(a.amountCents)}</span>
              <span>Verified</span>
              <span>{rm(a.verifiedCents)}{a.verifiedAt ? ` · ${formatMalaysiaDateTime(a.verifiedAt)}` : ""}</span>
              <span>Txn</span>
              <span><code>{a.transactionId ?? "—"}</code></span>
              {a.billCode && (<><span>Bill</span><span><code>{a.billCode}</code></span></>)}
              {a.providerReference && (<><span>Ref</span><span><code>{a.providerReference}</code></span></>)}
              <span>Evidence</span>
              <span><EvidenceList attempt={a} /></span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function CapacityPanel({ d }: { d: ReconciliationDetail }) {
  const s = d.schedule;
  if (!s) return <p className="ta-lead-sub">Schedule unavailable.</p>;
  const start = formatMalaysiaDate(s.startDate);
  const end = formatMalaysiaDate(s.endDate);
  const capacityText =
    d.capacity.state === "unlimited"
      ? "No capacity limit"
      : d.capacity.state === "unknown"
        ? "UNKNOWN (enrolments or holds could not be counted)"
        : `${d.capacity.remaining} of ${s.capacity} seat${s.capacity === 1 ? "" : "s"} free`;
  return (
    <dl className="ta-recon-dl">
      <dt>Course</dt>
      <dd>{d.course ? `${d.course.title}${d.course.code ? ` (${d.course.code})` : ""}` : "Course unavailable"}</dd>
      <dt>Dates</dt>
      <dd>
        <Link href={`/admin/schedules/${s.id}`} className="ta-sales-record-link">{start && end && start !== end ? `${start} – ${end}` : start || "Date not set"}</Link>
      </dd>
      <dt>Venue</dt>
      <dd>{s.venue ?? "—"}</dd>
      <dt>Schedule status</dt>
      <dd>{s.status ?? "—"}{s.status === "cancelled" || s.status === "completed" ? " · seats cannot be allocated on this schedule" : ""}</dd>
      <dt>Capacity</dt>
      <dd>
        {capacityText}
        <div className="ta-lead-sub">
          Active enrolments {d.capacity.activeEnrolments ?? "UNKNOWN"} · other active holds {d.capacity.otherActiveHolds ?? "UNKNOWN"} · seats taken {s.seatsTaken ?? "—"}
        </div>
      </dd>
    </dl>
  );
}

function AuditHistory({ d }: { d: ReconciliationDetail }) {
  if (d.audit === null) return <div className="ta-alert ta-alert-error" role="alert">The audit history could not be loaded.</div>;
  return (
    <>
      <p className="ta-lead-sub">
        Newest first, up to 100 entries for this registration and its payment attempts. Audit entries are visible only to Admins with Audit, Automation, Backups or Reports module access; without it this list is empty.
      </p>
      {d.audit.length === 0 ? (
        <p className="ta-lead-sub">No audit entries visible to you.</p>
      ) : (
        <ol className="ta-recon-audit">
          {d.audit.map((e) => (
            <li key={e.id}>
              <div className="ta-recon-audit-head">
                <strong>{e.event ?? e.action}</strong>
                <span className="ta-lead-sub">{ENTITY_LABELS[e.entity]} · {formatMalaysiaDateTime(e.at)}</span>
              </div>
              {e.summary && <div>{e.summary}</div>}
              <div className="ta-lead-sub">
                {[
                  e.actorEmail ? `By ${e.actorEmail}` : null,
                  e.transactionId ? `Txn ${e.transactionId}` : null,
                  e.paymentReference ? `Ref ${e.paymentReference}` : null,
                  e.verifiedCents !== null ? `Verified ${rm(e.verifiedCents)}` : null,
                  e.providerCents !== null ? `Provider ${rm(e.providerCents)}` : null,
                  e.expectedCents !== null ? `Expected ${rm(e.expectedCents)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

export default async function RegistrationReconciliationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("admin");
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const result = await loadReconciliationDetail(id);
  if (!result.ok && result.reason === "not_found") notFound();
  if (!result.ok) {
    return (
      <div className="ta-sales ta-reg">
        <PageHead title="Registration payments" subtitle="This registration is unavailable." />
        <div className="ta-alert ta-alert-error" role="alert">
          {result.reason === "too_large"
            ? "This registration has more payment attempts than can be shown exactly. Nothing is shown rather than a partial list."
            : "The registration could not be loaded. Nothing is shown rather than partial data. Please try again."}
        </div>
        <Link href="/admin/registrations" className="ta-btn ta-btn-outline ta-btn-sm">← Back to registrations</Link>
      </div>
    );
  }

  const d = result.detail;
  const reg = d.registration;
  const payments: PaymentInput[] = d.attempts.map((a) => ({
    id: a.id,
    registration_id: reg.id,
    payment_provider: a.provider,
    status: a.status,
    amount_cents: a.amountCents,
    verified_cents: a.verifiedCents,
    bill_creation_state: a.billCreationState,
    has_transaction_id: a.transactionId !== null,
    callback_received: a.callbackReceivedAt !== null,
  }));
  const classified = classifyRegistration(
    {
      id: reg.id,
      registration_reference: reg.reference,
      created_at: reg.createdAt,
      schedule_id: reg.scheduleId,
      course_id: reg.courseId,
      attendee_count: reg.attendeeCount,
      amount_due_cents: reg.amountDueCents,
      registration_status: reg.registrationStatus,
      payment_status: reg.paymentStatus,
      hold_expires_at: reg.holdExpiresAt,
    },
    d.attendees.map((a) => ({ id: a.id, registration_id: reg.id, full_name: a.fullName, company: a.company, participant_id: a.participantId })),
    payments,
    { known: d.enrolledParticipantIds !== null, participantIds: new Set(d.enrolledParticipantIds ?? []) },
    new Date(),
    evidenceReasons(d.attempts.map((a) => a.evidence)),
  );
  const bankTransfers = d.attempts.filter((a) => a.provider === "bank_transfer");

  return (
    <div className="ta-sales ta-reg ta-recon">
      {/* A div with the navigation role: the public stylesheet hides bare <nav> elements on small screens. */}
      <div role="navigation" aria-label="Breadcrumb" className="ta-recon-breadcrumb">
        <Link href="/admin/registrations" className="ta-sales-record-link">← Registrations</Link>
      </div>
      <PageHead title={reg.reference} subtitle={`${classified.stageLabel} · ${statusLabel(PAYMENT_STATUS_LABELS, reg.paymentStatus)} · read-only reconciliation view`} />

      <div className="ta-recon-grid">
        <Card title="Why this needs attention">
          <div className="ta-card-pad">
            <Reasons items={classified.exceptions} />
          </div>
        </Card>

        <Card title="Registration">
          <div className="ta-card-pad">
          <dl className="ta-recon-dl">
            <dt>Status</dt>
            <dd>{statusLabel(REGISTRATION_STATUS_LABELS, reg.registrationStatus)}</dd>
            <dt>Payment</dt>
            <dd>{statusLabel(PAYMENT_STATUS_LABELS, reg.paymentStatus)}</dd>
            <dt>Amount due</dt>
            <dd>{rm(reg.amountDueCents)} {reg.currency !== "MYR" ? reg.currency : ""}</dd>
            <dt>Verified paid</dt>
            <dd>{rm(classified.paidCents)}</dd>
            <dt>Created</dt>
            <dd>{formatMalaysiaDateTime(reg.createdAt)}</dd>
            <dt>Hold until</dt>
            <dd>{reg.holdExpiresAt ? formatMalaysiaDateTime(reg.holdExpiresAt) : "—"}</dd>
            {reg.confirmedAt && (<><dt>Confirmed</dt><dd>{formatMalaysiaDateTime(reg.confirmedAt)}</dd></>)}
            {reg.cancelledAt && (<><dt>Cancelled</dt><dd>{formatMalaysiaDateTime(reg.cancelledAt)}</dd></>)}
            {reg.expiredAt && (<><dt>Expired</dt><dd>{formatMalaysiaDateTime(reg.expiredAt)}</dd></>)}
            <dt>Attendees</dt>
            <dd>
              {d.attendees.length === 0 ? (
                "No attendees"
              ) : (
                <ul className="ta-recon-attendees">
                  {d.attendees.map((a) => (
                    <li key={a.id}>
                      {a.participantId ? <Link href={`/admin/participants/${a.participantId}`} className="ta-sales-record-link">{a.fullName}</Link> : a.fullName}
                      {a.company && <span className="ta-lead-sub"> · {a.company}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </dl>
          </div>
        </Card>

        <Card title="Schedule and capacity">
          <div className="ta-card-pad">
            <CapacityPanel d={d} />
          </div>
        </Card>
      </div>

      <Card title="Payment attempts">
        <div className="ta-card-pad">
          <AttemptTable attempts={d.attempts} />
        </div>
      </Card>

      <Card title="Manual bank transfer">
        <div className="ta-card-pad">
        <div className="ta-recon-manual" role="note">
          <p>
            <strong>Staff verification is not available on this screen yet.</strong> {bankTransfers.length > 0 ? `${bankTransfers.length} bank transfer record${bankTransfers.length === 1 ? " is" : "s are"} listed under payment attempts above.` : "No bank transfer is recorded for this registration."}
          </p>
          <p className="ta-lead-sub">
            The approved verification function checks the payer&apos;s own registration secret, which staff do not hold. A staff verification function keyed by registration, with the same payment state machine,
            duplicate protection and audit trail, needs a reviewed database change before it can be offered here. Do not mark payments as paid outside the approved process.
          </p>
        </div>
        </div>
      </Card>

      <Card title="Audit history">
        <div className="ta-card-pad">
          <AuditHistory d={d} />
        </div>
      </Card>
    </div>
  );
}
