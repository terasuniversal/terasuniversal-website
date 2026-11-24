"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card, Field, Badge } from "../../../../../components/admin/ui";
import { issueInvoiceAction, recordManualPaymentAction, cancelInvoiceAction, type InvoiceActionState } from "../actions";
import { generateToyyibpayPaymentLinkAction, refreshToyyibpayStatusAction, type ToyyibpayLinkState, type ToyyibpayRefreshState } from "../toyyibpayActions";
import { MANUAL_PAYMENT_PROVIDERS, PAYMENT_PROVIDER_LABELS, type InvoiceStatus, type InvoicePaymentRow } from "../../../../../lib/sales/invoices";
import {
  UNCONFIRMED_PAYMENT_MESSAGE,
  describeManualPaymentResult,
  firstErrorField,
  keyForSubmission,
  manualPaymentIntent,
  withUnconfirmedOnReject,
} from "../../../../../lib/payments/manual-payment-outcome";

const INITIAL: InvoiceActionState = {};
const TOYYIBPAY_INITIAL: ToyyibpayLinkState = {};
const REFRESH_INITIAL: ToyyibpayRefreshState = {};
const REFRESH_TONE_CLASS = { success: "ta-alert-success", info: "ta-alert-info", warning: "ta-alert-warning", error: "ta-alert-error" } as const;

type PaymentValues = { payment_provider: string; payment_method: string; amount: string; payment_date: string; payment_reference: string; notes: string };
const today = () => new Date().toISOString().slice(0, 10);
const emptyPayment = (): PaymentValues => ({ payment_provider: "bank_transfer", payment_method: "", amount: "", payment_date: today(), payment_reference: "", notes: "" });

/** G3: a dropped connection or crashed request becomes an "unconfirmed" result instead of the error boundary. */
const recordManualPaymentSafely = withUnconfirmedOnReject<[string], InvoiceActionState>(
  recordManualPaymentAction,
  () => ({ message: UNCONFIRMED_PAYMENT_MESSAGE, unconfirmed: true })
);

function fmtRM(n: number) {
  return `RM ${Number(n).toLocaleString("en-MY", { minimumFractionDigits: 2 })}`;
}
function fmtDateTime(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function InvoiceActionsPanel({
  invoiceId,
  invoiceNo,
  status,
  balanceDue,
  amountPaid,
  canManage,
  toyyibpayEnabled,
  toyyibpayIsSandbox,
  latestToyyibpayAttempt,
  initialPaymentKey,
}: {
  invoiceId: string;
  invoiceNo: string;
  status: InvoiceStatus;
  balanceDue: number;
  amountPaid: number;
  canManage: boolean;
  /** Server-derived capability flag (TOYYIBPAY_ENV is "sandbox" or "production") -- never a raw env var or secret, just this one boolean. A deployment with TOYYIBPAY_ENV unset/invalid renders no ToyyibPay card at all. */
  toyyibpayEnabled: boolean;
  /** Server-derived, from the same capability check -- true only when TOYYIBPAY_ENV === "sandbox". Controls the SANDBOX/TEST PAYMENT badge and copy only; never the actual request routing (that's lib/payments/toyyibpay.ts's own resolver). */
  toyyibpayIsSandbox: boolean;
  /** Most recent invoice_payments row for payment_provider='toyyibpay', or null -- persisted server state, so the card reflects reality on first load, not just right after a Generate click. */
  latestToyyibpayAttempt: InvoicePaymentRow | null;
  /** G1: server-generated idempotency key for the first manual payment on this page load (no hydration mismatch). */
  initialPaymentKey: string;
}) {
  const [issueState, issueAction, issuePending] = useActionState(issueInvoiceAction.bind(null, invoiceId), INITIAL);
  const [paymentState, paymentAction, paymentPending] = useActionState(recordManualPaymentSafely.bind(null, invoiceId), INITIAL);
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelInvoiceAction.bind(null, invoiceId), INITIAL);
  const [toyyibpayState, toyyibpayAction, toyyibpayPending] = useActionState(
    generateToyyibpayPaymentLinkAction.bind(null, invoiceId),
    TOYYIBPAY_INITIAL
  );
  const [refreshState, refreshAction, refreshPending] = useActionState(
    refreshToyyibpayStatusAction.bind(null, latestToyyibpayAttempt?.id ?? ""),
    REFRESH_INITIAL
  );
  // G1: one key per payment. It survives a failed or retried submission (so a retry is recognised as the same payment)
  // and is replaced only after the server reports the payment as recorded (or as an already-recorded replay).
  // G3-02: it is also replaced when staff change the amount, method or reference -- that is a different payment.
  const [paymentKey, setPaymentKey] = useState(initialPaymentKey);
  const keyIntent = useRef<string | null>(null);
  // G3-02: controlled values, and submission through onSubmit instead of <form action>, so React's automatic form
  // reset never wipes what staff typed. Values are cleared only after a confirmed outcome.
  const [values, setValues] = useState<PaymentValues>(emptyPayment);
  const setValue = (field: keyof PaymentValues) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [field]: e.target.value }));
  const paymentProvider = values.payment_provider;
  const submitting = useRef(false);
  const paymentFormRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const formAlertRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [refreshingInvoice, startInvoiceRefresh] = useTransition();
  const [, startPaymentSubmit] = useTransition();
  // onSubmit only exists after hydration. Until then the button stays disabled, so a native submit can never send
  // the payment details as a GET query string (method="post" is the second line of defence).
  const [paymentFormReady, setPaymentFormReady] = useState(false);
  useEffect(() => setPaymentFormReady(true), []);
  const lastPaymentState = useRef(paymentState);
  useEffect(() => {
    if (paymentState === lastPaymentState.current) return;
    lastPaymentState.current = paymentState;
    submitting.current = false;
    if (paymentState.payment) {
      // Confirmed (recorded or replay): this payment is finished. Fresh key, empty form, re-render the page from the
      // server so status, balance, history and receipt buttons are current, and move focus to the result because
      // the payment card itself may disappear once the invoice is paid.
      setPaymentKey(crypto.randomUUID());
      keyIntent.current = null;
      setValues(emptyPayment());
      startInvoiceRefresh(() => router.refresh());
      resultRef.current?.focus();
      return;
    }
    if (paymentState.unconfirmed) {
      // Same key, same values: retrying can only replay. Reload the page data so the history shows whether it landed.
      startInvoiceRefresh(() => router.refresh());
      formAlertRef.current?.focus();
      return;
    }
    const field = firstErrorField(paymentState.errors);
    if (field) paymentFormRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
    else if (paymentState.message) formAlertRef.current?.focus();
  }, [paymentState, router]);

  function submitPayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Repeated clicks: the first submission wins until its result arrives. G1's key still protects the server side.
    if (submitting.current || paymentPending || !paymentFormReady) return;
    submitting.current = true;
    const next = keyForSubmission({ key: paymentKey, intent: keyIntent.current }, manualPaymentIntent(values), () => crypto.randomUUID());
    keyIntent.current = next.intent;
    if (next.key !== paymentKey) setPaymentKey(next.key);
    const formData = new FormData(e.currentTarget);
    formData.set("idempotency_key", next.key);
    startPaymentSubmit(() => paymentAction(formData));
  }
  const paymentBusy = paymentPending || refreshingInvoice || !paymentFormReady;
  const paymentResult = paymentState.payment ? describeManualPaymentResult(paymentState.payment) : null;
  const referenceRequired = paymentProvider === "bank_transfer" || paymentProvider === "cheque";
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedWhatsapp, setCopiedWhatsapp] = useState(false);

  function copyToClipboard(text: string, setCopied: (v: boolean) => void) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!canManage) {
    return (
      <Card title="Manage Invoice">
        <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>
          Issuing, recording payments, and cancelling require Admin access. You can view this invoice's status and payment history.
        </div>
      </Card>
    );
  }

  const hasActiveToyyibpayAttempt = latestToyyibpayAttempt?.status === "pending";
  const attempt = latestToyyibpayAttempt;

  return (
    <>
      {/* G3: rendered outside the payment card, which unmounts when the invoice becomes fully paid. */}
      <div aria-live="polite" aria-atomic="true">
        {paymentResult && (
          <div
            ref={resultRef}
            tabIndex={-1}
            className={`ta-alert ta-alert-${paymentResult.tone} ta-payment-result`}
            role={paymentResult.tone === "warning" ? "alert" : "status"}
            data-outcome={paymentState.payment?.outcome}
          >
            <strong className="ta-payment-result-title">{paymentResult.title}</strong>
            <span>{paymentResult.detail}</span>
            {paymentResult.next && <span className="ta-payment-result-next">{paymentResult.next}</span>}
            {refreshingInvoice && <span className="ta-payment-result-next" aria-busy="true">Updating invoice details…</span>}
          </div>
        )}
      </div>

      {status === "draft" && (
        <Card title="Issue">
          <form action={issueAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {issueState.message && <div className="ta-alert ta-alert-error">{issueState.message}</div>}
            <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
              Freezes this invoice's items and totals and makes it payable. Edit the billing details and due date before issuing — they cannot be changed afterward.
            </p>
            <button
              type="submit"
              className="ta-btn ta-btn-primary ta-btn-sm"
              disabled={issuePending}
              onClick={(e) => { if (!confirm("Issue this invoice? Commercial fields and items will be frozen.")) e.preventDefault(); }}
            >
              {issuePending ? "Issuing…" : "📤 Issue Invoice"}
            </button>
          </form>
        </Card>
      )}

      {(status === "issued" || status === "partially_paid") && (
        <Card title="Record Manual Payment">
          <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {hasActiveToyyibpayAttempt && (
              <div className="ta-alert ta-alert-info">
                A ToyyibPay payment link is currently active for this invoice. Resolve or deactivate that attempt before recording a manual payment.
              </div>
            )}
            <form ref={paymentFormRef} onSubmit={submitPayment} method="post" aria-busy={paymentBusy} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div aria-live="polite" ref={formAlertRef} tabIndex={-1} style={{ outline: "none" }}>
                {paymentState.message && (
                  <div className={`ta-alert ${paymentState.unconfirmed ? "ta-alert-warning" : "ta-alert-error"}`} role="alert">
                    {paymentState.unconfirmed && <strong className="ta-payment-result-title">Payment not confirmed</strong>}
                    {paymentState.message}
                  </div>
                )}
                {paymentState.errors && !paymentState.message && (
                  <div className="ta-alert ta-alert-error" role="alert">Nothing was recorded. Correct the highlighted fields and submit again.</div>
                )}
              </div>
              <input type="hidden" name="idempotency_key" value={paymentKey} />
              <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
                Outstanding balance: <strong>{fmtRM(balanceDue)}</strong>
                {amountPaid > 0 && <> ({fmtRM(amountPaid)} already paid)</>}
              </p>
              <Field label="Payment method" name="payment_provider" error={paymentState.errors?.payment_provider} required>
                <select name="payment_provider" value={values.payment_provider} onChange={setValue("payment_provider")} required>
                  {MANUAL_PAYMENT_PROVIDERS.map((p) => <option key={p} value={p}>{PAYMENT_PROVIDER_LABELS[p]}</option>)}
                </select>
              </Field>
              <Field label="Bank / reference detail" name="payment_method" error={paymentState.errors?.payment_method} hint="e.g. bank name, cheque no.">
                <input type="text" name="payment_method" maxLength={100} value={values.payment_method} onChange={setValue("payment_method")} />
              </Field>
              <Field label="Amount (RM)" name="amount" error={paymentState.errors?.amount} required>
                <input type="number" name="amount" step="0.01" min="0.01" max={balanceDue} required inputMode="decimal" value={values.amount} onChange={setValue("amount")} />
              </Field>
              <Field label="Payment date" name="payment_date" error={paymentState.errors?.payment_date} required>
                <input type="date" name="payment_date" required value={values.payment_date} onChange={setValue("payment_date")} />
              </Field>
              <Field
                label={paymentProvider === "cheque" ? "Cheque number" : "Payment reference"}
                name="payment_reference"
                error={paymentState.errors?.payment_reference}
                hint={referenceRequired ? "Required. Exactly as shown on the bank statement or cheque." : "Transaction/reference number, if any"}
                required={referenceRequired}
              >
                <input type="text" name="payment_reference" maxLength={200} value={values.payment_reference} onChange={setValue("payment_reference")} required={referenceRequired} />
              </Field>
              <Field label="Notes" name="notes" error={paymentState.errors?.notes}>
                <textarea name="notes" rows={2} maxLength={1000} value={values.notes} onChange={setValue("notes")} />
              </Field>
              <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={paymentBusy} aria-busy={paymentBusy} style={{ alignSelf: "flex-start" }}>
                {paymentPending ? "Recording…" : refreshingInvoice ? "Updating invoice…" : "Record Payment"}
              </button>
            </form>
          </div>
        </Card>
      )}

      {(status === "issued" || status === "partially_paid") && toyyibpayEnabled && (
        <Card title="ToyyibPay Payment Link">
          <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {toyyibpayIsSandbox && (
              <span
                style={{
                  alignSelf: "flex-start",
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  color: "#92400e",
                  background: "#fef3c7",
                  border: "1px solid #fde68a",
                  borderRadius: 4,
                  padding: "2px 6px",
                }}
              >
                SANDBOX / TEST PAYMENT
              </span>
            )}
            {toyyibpayState.message && <div className="ta-alert ta-alert-error">{toyyibpayState.message}</div>}
            {/* G2: every refresh outcome is announced; only a finalized payment uses the success tone. */}
            <div aria-live="polite">
              {refreshState.message && (
                <div
                  className={`ta-alert ${REFRESH_TONE_CLASS[refreshState.tone ?? "error"]}`}
                  role={refreshState.tone === "warning" || refreshState.tone === "error" ? "alert" : "status"}
                >
                  {refreshState.message}
                </div>
              )}
            </div>

            {/* State A -- no attempt at all yet */}
            {!attempt && (
              <>
                <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
                  {toyyibpayIsSandbox
                    ? "Creates a secure payment link for the current outstanding balance. This is a test payment link only — it does not connect to any real bank account and no real money moves."
                    : "Creates a secure payment link for the current outstanding balance. This is a real ToyyibPay payment link — completing it moves real money."}
                </p>
                <p style={{ margin: 0, fontSize: 13 }}>
                  Balance due: <strong>{fmtRM(balanceDue)}</strong>
                </p>
                <form action={toyyibpayAction}>
                  <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={toyyibpayPending}>
                    {toyyibpayPending ? "Generating…" : "🧪 Generate ToyyibPay Payment Link"}
                  </button>
                </form>
              </>
            )}

            {/* State B -- pending attempt */}
            {attempt?.status === "pending" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>Payment Pending</strong>
                  <Badge status={attempt.status} />
                </div>
                <div>
                  BillCode: <code style={{ wordBreak: "break-all" }}>{attempt.provider_bill_code}</code>
                </div>
                <div>
                  Amount requested: <strong>{fmtRM(attempt.amount)}</strong>
                </div>
                <div style={{ color: "var(--ta-muted)" }}>Requested {fmtDateTime(attempt.created_at)}</div>
                {attempt.payment_url && (
                  <div style={{ wordBreak: "break-all", fontSize: 12, color: "var(--ta-muted)" }}>{attempt.payment_url}</div>
                )}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {attempt.payment_url && (
                    <>
                      <button
                        type="button"
                        className="ta-btn ta-btn-outline ta-btn-sm"
                        onClick={() => copyToClipboard(attempt.payment_url!, setCopiedLink)}
                      >
                        {copiedLink ? "Copied" : "Copy Payment Link"}
                      </button>
                      <a href={attempt.payment_url} target="_blank" rel="noreferrer" className="ta-btn ta-btn-outline ta-btn-sm">
                        Open Payment Page ↗
                      </a>
                      <button
                        type="button"
                        className="ta-btn ta-btn-outline ta-btn-sm"
                        onClick={() =>
                          copyToClipboard(
                            `Assalamualaikum / Hi,\nPlease use the secure ToyyibPay payment link below for Invoice ${invoiceNo}.\n\nAmount Due: ${fmtRM(attempt.amount)}\nPayment Link: ${attempt.payment_url}\n\nTERAS UNIVERSAL SDN. BHD.`,
                            setCopiedWhatsapp
                          )
                        }
                      >
                        {copiedWhatsapp ? "Copied" : "Copy WhatsApp Message"}
                      </button>
                    </>
                  )}
                </div>
                <form action={refreshAction}>
                  <button type="submit" className="ta-btn ta-btn-outline ta-btn-sm" disabled={refreshPending} aria-busy={refreshPending} style={{ alignSelf: "flex-start" }}>
                    {refreshPending ? "Checking with ToyyibPay…" : "Refresh / Re-check Status"}
                  </button>
                </form>
              </div>
            )}

            {/* State C -- successful */}
            {attempt?.status === "successful" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>Payment Successful</strong>
                  <Badge status={attempt.status} />
                </div>
                {(attempt.provider_transaction_id ?? attempt.provider_bill_code) && (
                  <div>Reference: <code style={{ wordBreak: "break-all" }}>{attempt.provider_transaction_id ?? attempt.provider_bill_code}</code></div>
                )}
                {attempt.verified_amount !== null && <div>Verified amount: <strong>{fmtRM(attempt.verified_amount)}</strong></div>}
                <div style={{ color: "var(--ta-muted)" }}>Paid {fmtDateTime(attempt.paid_at)}</div>
              </div>
            )}

            {/* State D -- failed (also covers cancelled/refunded as a generic terminal-but-not-active fallback) */}
            {attempt && (attempt.status === "failed" || attempt.status === "cancelled" || attempt.status === "refunded") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>Previous Payment Attempt Failed</strong>
                  <Badge status={attempt.status} />
                </div>
                {attempt.provider_bill_code && <div>BillCode: <code style={{ wordBreak: "break-all" }}>{attempt.provider_bill_code}</code></div>}
                {balanceDue > 0 && (
                  <form action={toyyibpayAction}>
                    <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={toyyibpayPending}>
                      {toyyibpayPending ? "Generating…" : "Generate New Payment Link"}
                    </button>
                  </form>
                )}
              </div>
            )}

            {/* State E -- superseded */}
            {attempt?.status === "superseded" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <strong>Payment Link Superseded</strong>
                  <Badge status={attempt.status} />
                </div>
                <p style={{ margin: 0, color: "var(--ta-muted)" }}>
                  This payment link is no longer the active TERAS payment attempt for this invoice.
                </p>
                {balanceDue > 0 && (
                  <form action={toyyibpayAction}>
                    <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm" disabled={toyyibpayPending}>
                      {toyyibpayPending ? "Generating…" : "Generate New Payment Link"}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      {(status === "draft" || (status === "issued" && amountPaid === 0)) && (
        <Card title="Cancel">
          <form action={cancelAction} className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {cancelState.message && <div className="ta-alert ta-alert-error">{cancelState.message}</div>}
            <Field label="Reason (optional)" name="reason" error={cancelState.errors?.reason}>
              <textarea name="reason" rows={2} maxLength={500} />
            </Field>
            <button
              type="submit"
              className="ta-btn ta-btn-outline ta-btn-sm"
              disabled={cancelPending}
              onClick={(e) => { if (!confirm("Cancel this invoice? This cannot be undone.")) e.preventDefault(); }}
            >
              {cancelPending ? "Cancelling…" : "Cancel Invoice"}
            </button>
          </form>
        </Card>
      )}

      {status === "paid" && (
        <Card title="Status">
          <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>This invoice is fully paid — no further changes possible.</div>
        </Card>
      )}
      {status === "cancelled" && (
        <Card title="Status">
          <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>This invoice was cancelled.</div>
        </Card>
      )}
      {status === "issued" && amountPaid > 0 && (
        <Card title="Cancellation">
          <div className="ta-card-pad" style={{ color: "var(--ta-muted)", fontSize: 13 }}>This invoice has received a payment and can no longer be cancelled directly.</div>
        </Card>
      )}
    </>
  );
}
