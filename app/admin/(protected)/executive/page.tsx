import Link from "next/link";
import { requireRole } from "../../../../lib/auth/session";
import { PageHead, Card, StatCard } from "../../../../components/admin/ui";
import { loadExecutiveKpis } from "../../../../lib/finance/executiveKpisLoader";
import { formatRm } from "../../../../lib/finance/executiveKpis";
import { REPORT_RANGE_KEYS, REPORT_RANGE_LABELS, type ReportRangeKey } from "../../../../lib/sales/reports";

export const metadata = { title: "CEO Dashboard — TERAS UNIVERSAL Admin" };
export const dynamic = "force-dynamic";

/**
 * CEO Dashboard: Booked, Billed, Collected and Outstanding, read-only.
 * Super Admin only. RLS alone lets editors read these tables, so the role is
 * enforced here and again inside loadExecutiveKpis(); hiding the nav link is
 * not the boundary. Definitions live in lib/finance/executiveKpis.ts.
 */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="ta-exec-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export default async function ExecutivePage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string }> }) {
  await requireRole("super_admin");
  const sp = await searchParams;
  const rangeKey: ReportRangeKey = (REPORT_RANGE_KEYS as readonly string[]).includes(sp.range ?? "") ? (sp.range as ReportRangeKey) : "this_month";
  const result = await loadExecutiveKpis(rangeKey, { from: sp.from, to: sp.to });

  if (!result.ok) {
    return (
      <div className="ta-sales ta-sales-reports ta-exec">
        <PageHead title="CEO Dashboard" subtitle="Figures are unavailable." />
        <div className="ta-alert ta-alert-error" role="alert">
          {result.reason === "too_large"
            ? "This period has too many records to total exactly. Choose a shorter period."
            : "The financial figures could not be loaded. No partial figures are shown. Please try again."}
        </div>
      </div>
    );
  }

  const { range, kpis } = result;
  const q = kpis.dataQuality;
  const rangeQs = (extra: Record<string, string> = {}) => new URLSearchParams({ range: rangeKey, ...(rangeKey === "custom" ? { from: sp.from ?? "", to: sp.to ?? "" } : {}), ...extra }).toString();
  const issues: string[] = [];
  if (q.staleStatusInvoices > 0) issues.push(`${q.staleStatusInvoices} invoice(s) still labelled Paid after a refund, with ${formatRm(q.staleStatusCents)} balance due. The balance is counted in Outstanding.`);
  if (q.bookedExcludedReversedOrLost > 0) issues.push(`${q.bookedExcludedReversedOrLost} accepted quotation(s) excluded because the opportunity was reversed or lost.`);
  if (q.unverifiedToyyibpay > 0) issues.push(`${q.unverifiedToyyibpay} Toyyibpay payment(s) without a verified amount were not counted.`);
  const unlinked = q.bookedUnlinked + q.billedUnlinked + q.collectedUnlinked;
  if (unlinked > 0) issues.push(`${unlinked} record(s) could not be linked to a quotation and were left out.`);

  return (
    <div className="ta-sales ta-sales-reports ta-exec">
      <PageHead title="CEO Dashboard" subtitle={`${range.startDateLabel} to ${range.endDateLabel} (Malaysia time) — read-only, Super Admin.`} />

      <div className="ta-sales-report-intro">
        <strong>Period figures and a current balance</strong>
        <p>Booked, Billed and Collected are for the selected period. Outstanding is the current balance as of {kpis.asOfDate} and does not change with the period. All amounts are gross, including SST.</p>
      </div>

      <form className="ta-toolbar" style={{ flexWrap: "wrap", marginBottom: 18 }}>
        {REPORT_RANGE_KEYS.filter((k) => k !== "custom").map((k) => (
          <Link key={k} href={`/admin/executive?${rangeQs({ range: k })}`} className={`ta-btn ta-btn-sm ${rangeKey === k ? "ta-btn-primary" : "ta-btn-outline"}`}>
            {REPORT_RANGE_LABELS[k]}
          </Link>
        ))}
        {rangeKey === "custom" ? (
          <>
            <label className="ta-filter-date-group">
              From
              <input type="date" name="from" defaultValue={sp.from ?? ""} className="ta-filter-date" />
            </label>
            <label className="ta-filter-date-group">
              To
              <input type="date" name="to" defaultValue={sp.to ?? ""} className="ta-filter-date" />
            </label>
            <input type="hidden" name="range" value="custom" />
            <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm">Apply</button>
          </>
        ) : (
          <Link href={`/admin/executive?${rangeQs({ range: "custom" })}`} className="ta-btn ta-btn-outline ta-btn-sm">
            Custom Range…
          </Link>
        )}
      </form>

      <div className="ta-sales-report-kpis">
        <StatCard label="Booked (period)" value={formatRm(kpis.booked.grossCents)} icon="📌" context={`${kpis.booked.count} accepted quotation(s)`} />
        <StatCard label="Billed (period)" value={formatRm(kpis.billed.grossCents)} icon="🧾" context={`${kpis.billed.count} invoice(s) issued`} />
        <StatCard label="Collected (period)" value={formatRm(kpis.collected.grossCents)} icon="💵" context={`${kpis.collected.count} payment(s) received`} />
        <StatCard label={`Outstanding (current, ${kpis.asOfDate})`} value={formatRm(kpis.outstanding.balanceCents)} icon="⏳" context={`${kpis.outstanding.count} invoice(s) with a balance`} />
      </div>

      <div className="ta-grid cols-2" style={{ alignItems: "start", gap: 20 }}>
        <Card title="Period figures">
          <div className="ta-card-pad">
            <dl className="ta-exec-dl">
              <Row label="Booked, incl. SST" value={formatRm(kpis.booked.grossCents)} />
              <Row label="of which SST" value={formatRm(kpis.booked.sstCents)} />
              <Row label="Billed, incl. SST" value={formatRm(kpis.billed.grossCents)} />
              <Row label="of which SST" value={formatRm(kpis.billed.sstCents)} />
              <Row label="Collected" value={formatRm(kpis.collected.grossCents)} />
              <Row label="of which HRDF (counted once)" value={`${formatRm(kpis.collected.hrdfCents)} · ${kpis.collected.hrdfCount}`} />
              <Row label="Refunded (not in Collected)" value={`${formatRm(kpis.refunded.cents)} · ${kpis.refunded.count}`} />
            </dl>
            <p className="ta-sales-report-note" style={{ marginTop: 12 }}>SST is not split out of Collected because payments do not record a tax portion.</p>
          </div>
        </Card>

        <Card title={`Outstanding balance (current, ${kpis.asOfDate})`}>
          <div className="ta-card-pad">
            <dl className="ta-exec-dl">
              <Row label="Total outstanding" value={formatRm(kpis.outstanding.balanceCents)} />
              <Row label="Overdue" value={`${formatRm(kpis.outstanding.overdueCents)} · ${kpis.outstanding.overdueCount}`} />
              <Row label="Not yet due" value={`${formatRm(kpis.outstanding.notYetDueCents)} · ${kpis.outstanding.notYetDueCount}`} />
            </dl>
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 20 }}>
        <Card title="Data checks">
          <div className="ta-card-pad">
            {issues.length === 0 ? (
              <p className="ta-sales-report-note" style={{ margin: 0 }}>No data issues found for this view.</p>
            ) : (
              <ul className="ta-exec-issues">
                {issues.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 20 }}>
        <Card title="How these figures are counted">
          <div className="ta-card-pad">
            <ul className="ta-exec-defs">
              <li><strong>Booked</strong>: accepted quotations by acceptance date. Superseded, cancelled, reversed and test quotations are excluded; each opportunity counts once.</li>
              <li><strong>Billed</strong>: issued, partially paid and paid invoices by issue date. Draft and cancelled invoices are excluded.</li>
              <li><strong>Collected</strong>: successful payments by payment date. Refunded, failed, pending and superseded payments are excluded. HRDF payments are counted once.</li>
              <li><strong>Outstanding</strong>: balance due on issued invoices right now, after payments and refunds.</li>
            </ul>
          </div>
        </Card>
      </div>
    </div>
  );
}
