"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card, Field, Badge } from "../../../../../components/admin/ui";
import { issueInvoiceAction, recordManualPaymentAction, cancelInvoiceAction, checkManualPaymentAttemptAction, type InvoiceActionState } from "../actions";
import { generateToyyibpayPaymentLinkAction, refreshToyyibpayStatusAction, type ToyyibpayLinkState, type ToyyibpayRefreshState } from "../toyyibpayActions";
import { MANUAL_PAYMENT_PROVIDERS, PAYMENT_PROVIDER_LABELS, type InvoiceStatus, type InvoicePaymentRow } from "../../../../../lib/sales/invoices";
import {
  BLOCKED_CORRUPT_MESSAGE,
  BLOCKED_MISMATCH_MESSAGE,
  BLOCKED_TITLE,
  KEY_CONFLICT_CHECKING_MESSAGE,
  STORAGE_CLEAR_WARNING,
  STORAGE_READ_WARNING,
  STORAGE_WARNING,
  matchRecordedPayment,
  type RecordedPayment,
  LOOKUP_FAILED_MESSAGE,
  NOT_RECORDED_RESOLVED_NOTE,
  PENDING_LOCK_MESSAGE,
  PENDING_LOCK_TITLE,
  STALE_PENDING_NOTICE,
  UNCONFIRMED_PAYMENT_MESSAGE,
  describeManualPaymentResult,
  firstErrorField,
  isNavigationSignal,
  keyForSubmission,
  manualPaymentIntent,
  parsePending,
  pendingIntent,
  pendingStorageKey,
  resolveUnresolvedAttempt,
  serializePending,
  withUnconfirmedOnReject,
  type PendingAttempt,
} from "../../../../../lib/payments/manual-payment-outcome";

const INITIAL: InvoiceActionState = {};
/** The fields that define a manual payment's intent; frozen while an attempt is unresolved (R-1, O-1). */
const LOCKED_PAYMENT_FIELDS: ReadonlySet<keyof PaymentValues> = new Set<keyof PaymentValues>(["payment_provider", "amount", "payment_reference"]);
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
  currentUserId,
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
  /** R-1: scopes the stored unresolved attempt to the signed-in staff member (profile id; not a credential). */
  currentUserId: string;
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
  // R-1: except while an earlier attempt is unresolved; then the key and the payment details stay locked to it.
  const [paymentKey, setPaymentKey] = useState(initialPaymentKey);
  const keyIntent = useRef<string | null>(null);
  // G3-02: controlled values, and submission through onSubmit instead of <form action>, so React's automatic form
  // reset never wipes what staff typed. Values are cleared only after a confirmed outcome.
  const [values, setValues] = useState<PaymentValues>(emptyPayment);
  // O-1: while an attempt is unresolved (or blocked), the amount, method and reference belong to that attempt.
  // The controls are disabled/read-only for people, but a scripted change event still reaches onChange, so the
  // setter itself refuses those fields. The refs are read at event time, after this render has assigned them.
  const setValue = (field: keyof PaymentValues) => (e: { target: { value: string } }) => {
    if (LOCKED_PAYMENT_FIELDS.has(field) && (pendingRef.current !== null || blockedRef.current !== null)) return;
    setValues((v) => ({ ...v, [field]: e.target.value }));
  };
  const paymentProvider = values.payment_provider;
  const submitting = useRef(false);
  const paymentFormRef = useRef<HTMLFormElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const formAlertRef = useRef<HTMLDivElement>(null);
  const pendingRefEl = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [refreshingInvoice, startInvoiceRefresh] = useTransition();
  const [, startPaymentSubmit] = useTransition();
  const [checkingAttempt, startAttemptCheck] = useTransition();
  // The result currently on screen: from a submission or from an attempt look-up.
  const [shown, setShown] = useState<InvoiceActionState>(INITIAL);
  const [focusTarget, setFocusTarget] = useState<{ kind: "result" | "alert" | "pending" | "field"; field?: string; n: number } | null>(null);
  const focusSeq = useRef(0);
  const focusOn = (kind: "result" | "alert" | "pending" | "field", field?: string) => setFocusTarget({ kind, field, n: ++focusSeq.current });

  // R-1: an attempt whose outcome was never confirmed. Kept in sessionStorage (scoped to this staff member and this
  // invoice) so a refresh restores the same key and locked details instead of issuing a new key.
  const [pending, setPending] = useState<PendingAttempt | null>(null);
  const pendingRef = useRef<PendingAttempt | null>(null);
  const lastSubmission = useRef<{ key: string; values: PaymentValues } | null>(null);
  const storageKey = pendingStorageKey(currentUserId, invoiceId);
  // R-1.1: recording is blocked when a stored attempt cannot be trusted (corrupt) or when its key belongs to a recorded
  // payment with different details (mismatch). Nothing in this panel lifts the block; the Finance administrator
  // reconciles the payment history.
  const [blocked, setBlocked] = useState<{ reason: "corrupt" | "mismatch"; recorded?: RecordedPayment } | null>(null);
  const blockedRef = useRef<{ reason: "corrupt" | "mismatch"; recorded?: RecordedPayment } | null>(null);
  function blockRecording(block: { reason: "corrupt" | "mismatch"; recorded?: RecordedPayment }) {
    blockedRef.current = block;
    setBlocked(block);
  }
  // R-1.1: storage read/write/remove failures never change what is allowed; the lock stays in memory and staff are told
  // that a refresh may lose it.
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  // R-1.1: an old restored attempt is shown as old, and stays exactly as locked as a new one.
  const [pendingStale, setPendingStale] = useState(false);
  function beginPending(attempt: PendingAttempt) {
    pendingRef.current = attempt;
    setPending(attempt);
    try { window.sessionStorage.setItem(storageKey, serializePending(currentUserId, invoiceId, attempt)); } catch { setStorageWarning(STORAGE_WARNING); }
  }
  // Only ever called on database evidence: a confirmed payment, an exactly matching recorded payment, or a refusal
  // raised after the key check.
  function settlePending() {
    pendingRef.current = null;
    setPending(null);
    setPendingStale(false);
    try { window.sessionStorage.removeItem(storageKey); } catch { setStorageWarning(STORAGE_CLEAR_WARNING); }
  }

  // onSubmit only exists after hydration. Until then the button stays disabled, so a native submit can never send
  // the payment details as a GET query string (method="post" is the second line of defence). Restoring an unresolved
  // attempt happens before the form is enabled, so the server-issued key is never used in its place.
  const [paymentFormReady, setPaymentFormReady] = useState(false);
  useEffect(() => {
    let restored: PendingAttempt | null = null;
    let stale = false;
    // Only staff who can record payments can have an attempt to restore (and may call the look-up).
    if (canManage) {
      let raw: string | null = null;
      try { raw = window.sessionStorage.getItem(storageKey); } catch { setStorageWarning(STORAGE_READ_WARNING); }
      const parsed = parsePending(raw, currentUserId, invoiceId, Date.now());
      if (parsed.state === "ok") {
        restored = parsed.attempt;
        stale = parsed.stale;
      } else if (parsed.state === "corrupt") {
        // Never dropped, never retried: the details it would have to match are unknown. A readable key is only used
        // for a read-only check so the administrator can see what was recorded.
        blockRecording({ reason: "corrupt" });
        if (parsed.key) checkAttempt(parsed.key, "corrupt");
      }
    }
    if (restored) {
      const attempt = restored;
      pendingRef.current = attempt;
      setPending(attempt);
      setPaymentKey(attempt.key);
      keyIntent.current = pendingIntent(attempt);
      setValues((v) => ({ ...v, payment_provider: attempt.provider, amount: attempt.amount, payment_reference: attempt.reference, payment_date: attempt.paymentDate || v.payment_date }));
      if (stale) setPendingStale(true);
      checkAttempt(attempt.key, "pending");
    }
    setPaymentFormReady(true);
    // Mount-only: restoration must run once, before the form is enabled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the page while an attempt is unresolved gets the browser's generic "leave site?" prompt.
  useEffect(() => {
    if (!pending && !blocked) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending, blocked]);

  useEffect(() => {
    if (!focusTarget) return;
    if (focusTarget.kind === "result") resultRef.current?.focus();
    else if (focusTarget.kind === "pending") (pendingRefEl.current ?? formAlertRef.current)?.focus();
    else if (focusTarget.kind === "field" && focusTarget.field) paymentFormRef.current?.querySelector<HTMLElement>(`[name="${focusTarget.field}"]`)?.focus();
    else formAlertRef.current?.focus();
  }, [focusTarget]);

  function applyOutcome(state: InvoiceActionState, source: "submit" | "lookup") {
    submitting.current = false;
    if (state.payment) {
      // Confirmed (recorded, replay or found by look-up): this payment is finished. Fresh key, empty form, re-render
      // the page from the server so status, balance, history and receipt buttons are current, and move focus to the
      // result because the payment card itself may disappear once the invoice is paid.
      settlePending();
      setShown(state);
      setPaymentKey(crypto.randomUUID());
      keyIntent.current = null;
      setValues(emptyPayment());
      startInvoiceRefresh(() => router.refresh());
      focusOn("result");
      return;
    }
    if (pendingRef.current) {
      const resolution = resolveUnresolvedAttempt(state);
      if (resolution === "not_recorded") {
        // A refusal raised after the key check: the earlier attempt never committed. Unlock, keep what was typed.
        settlePending();
        setPaymentKey(crypto.randomUUID());
        keyIntent.current = null;
        setShown({ message: state.message, notice: NOT_RECORDED_RESOLVED_NOTE });
        focusOn("alert");
        return;
      }
      if (resolution === "key_used") {
        // R-1.1: a key conflict is not a confirmed payment. Check the recorded payment and compare it with the locked
        // attempt; the attempt stays locked (same key) until that comparison settles it.
        setShown({ message: KEY_CONFLICT_CHECKING_MESSAGE, unconfirmed: true });
        focusOn("pending");
        checkAttempt(pendingRef.current.key, "pending");
        return;
      }
      // Still unresolved: lost response, validation error, a refusal before the key check, or "not found".
      setShown(state);
      if (state.unconfirmed && source === "submit") startInvoiceRefresh(() => router.refresh());
      const field = firstErrorField(state.errors);
      if (field) focusOn("field", field);
      else focusOn("pending");
      return;
    }
    if (state.unconfirmed && source === "submit" && lastSubmission.current) {
      // Same key, same values: retrying can only replay. Lock the details to this attempt until the database settles
      // it, and reload the page data so the history shows whether it landed.
      const s = lastSubmission.current;
      beginPending({
        key: s.key,
        provider: s.values.payment_provider,
        amount: Number(s.values.amount).toFixed(2),
        reference: s.values.payment_reference.trim(),
        paymentDate: s.values.payment_date,
        createdAt: Date.now(),
      });
      setShown(state);
      startInvoiceRefresh(() => router.refresh());
      focusOn("pending");
      return;
    }
    setShown(state);
    const field = firstErrorField(state.errors);
    if (field) focusOn("field", field);
    else if (state.message || state.notice) focusOn("alert");
  }

  const lastPaymentState = useRef(paymentState);
  useEffect(() => {
    if (paymentState === lastPaymentState.current) return;
    lastPaymentState.current = paymentState;
    applyOutcome(paymentState, "submit");
    // applyOutcome reads refs and stable setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentState]);

  // R-1.1: a read-only check by key. Only an exact match with the locked attempt settles it; a mismatch blocks
  // recording; "not found", a failed check or a corrupt record (nothing to match) leave everything as it is.
  function checkAttempt(key: string, mode: "pending" | "corrupt") {
    startAttemptCheck(async () => {
      let result: InvoiceActionState;
      try {
        result = await checkManualPaymentAttemptAction(invoiceId, key);
      } catch (error) {
        if (isNavigationSignal(error)) throw error;
        result = { message: LOOKUP_FAILED_MESSAGE, unconfirmed: true, lookup: "failed" };
      }
      if (mode === "corrupt") {
        if (result.lookup === "found" && result.recordedPayment) blockRecording({ reason: "corrupt", recorded: result.recordedPayment });
        return;
      }
      const attempt = pendingRef.current;
      if (!attempt) return;
      if (result.lookup === "found" && result.recordedPayment && result.recordedResult) {
        if (matchRecordedPayment(result.recordedPayment, { invoiceId, attempt }) === "match") {
          applyOutcome({ payment: result.recordedResult, notice: "This payment was already recorded. No second payment was created." }, "lookup");
        } else {
          blockRecording({ reason: "mismatch", recorded: result.recordedPayment });
          setShown({});
          focusOn("pending");
        }
        return;
      }
      applyOutcome({ message: result.message ?? LOOKUP_FAILED_MESSAGE, unconfirmed: true }, "lookup");
    });
  }

  function submitPayment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Repeated clicks: the first submission wins until its result arrives. G1's key still protects the server side.
    if (submitting.current || paymentPending || checkingAttempt || !paymentFormReady) return;
    if (blockedRef.current) {
      focusOn("pending");
      return;
    }
    const unresolved = pendingRef.current;
    // R-1: while an attempt is unresolved, only that exact payment may be sent (the fields are locked as well).
    if (unresolved && manualPaymentIntent(values) !== pendingIntent(unresolved)) {
      // Put the locked details back; the banner already explains why they cannot change.
      setValues((v) => ({ ...v, payment_provider: unresolved.provider, amount: unresolved.amount, payment_reference: unresolved.reference }));
      focusOn("pending");
      return;
    }
    submitting.current = true;
    const next = keyForSubmission({ key: paymentKey, intent: keyIntent.current }, manualPaymentIntent(values), () => crypto.randomUUID(), Boolean(unresolved));
    keyIntent.current = next.intent;
    if (next.key !== paymentKey) setPaymentKey(next.key);
    const formData = new FormData(e.currentTarget);
    formData.set("idempotency_key", next.key);
    lastSubmission.current = { key: next.key, values };
    startPaymentSubmit(() => paymentAction(formData));
  }
  const paymentBusy = paymentPending || refreshingInvoice || checkingAttempt || !paymentFormReady || blocked !== null;
  const paymentResult = shown.payment ? describeManualPaymentResult(shown.payment) : null;
  const detailsLocked = pending !== null || blocked !== null;
  // O-1: the locked method always comes from the unresolved attempt itself, never from editable state.
  const lockedProvider = detailsLocked && pending ? pending.provider : null;
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
        {/* R-1.1: recording blocked (corrupt record or mismatched key). No action here lifts it. */}
        {blocked && (
          <div ref={pendingRefEl} tabIndex={-1} className="ta-alert ta-alert-error ta-payment-result" role="alert" data-blocked={blocked.reason}>
            <strong className="ta-payment-result-title">{BLOCKED_TITLE}</strong>
            <span>{blocked.reason === "corrupt" ? BLOCKED_CORRUPT_MESSAGE : BLOCKED_MISMATCH_MESSAGE}</span>
            {pending && (
              <span className="ta-payment-result-next">
                Unconfirmed attempt: {fmtRM(Number(pending.amount))} by {PAYMENT_PROVIDER_LABELS[pending.provider as keyof typeof PAYMENT_PROVIDER_LABELS] ?? pending.provider}
                {pending.reference ? `, reference ${pending.reference}` : ""}.
              </span>
            )}
            {blocked.recorded && (
              <span className="ta-payment-result-next">
                Recorded payment with this key: {fmtRM(blocked.recorded.amount)} by {PAYMENT_PROVIDER_LABELS[blocked.recorded.provider as keyof typeof PAYMENT_PROVIDER_LABELS] ?? blocked.recorded.provider}
                {blocked.recorded.reference ? `, reference ${blocked.recorded.reference}` : ""}.
              </span>
            )}
          </div>
        )}
        {storageWarning && (
          <div className="ta-alert ta-alert-warning ta-payment-result" role="alert" data-storage-warning="true">{storageWarning}</div>
        )}
        {/* R-1: shown while an attempt is unresolved, whatever the invoice status, until database evidence settles it. */}
        {pending && !blocked && (
          <div ref={pendingRefEl} tabIndex={-1} className="ta-alert ta-alert-warning ta-payment-result" role="alert" data-pending="true">
            <strong className="ta-payment-result-title">{PENDING_LOCK_TITLE}</strong>
            <span>{PENDING_LOCK_MESSAGE}</span>
            <span className="ta-payment-result-next">
              Locked attempt: {fmtRM(Number(pending.amount))} by {PAYMENT_PROVIDER_LABELS[pending.provider as keyof typeof PAYMENT_PROVIDER_LABELS] ?? pending.provider}
              {pending.reference ? `, reference ${pending.reference}` : ""}.
            </span>
            {pendingStale && <span className="ta-payment-result-next" data-stale="true">{STALE_PENDING_NOTICE}</span>}
            {/* Look-up or refusal detail only; the generic "not confirmed" text would repeat the banner. */}
            {shown.message && shown.message !== UNCONFIRMED_PAYMENT_MESSAGE && <span className="ta-payment-result-next">{shown.message}</span>}
            <span className="ta-payment-actions">
              {(status === "issued" || status === "partially_paid") && (
                <button type="button" className="ta-btn ta-btn-primary ta-btn-sm ta-btn-touch" disabled={paymentBusy} onClick={() => paymentFormRef.current?.requestSubmit()}>
                  {paymentPending ? "Recording…" : "Retry original payment"}
                </button>
              )}
              <button type="button" className="ta-btn ta-btn-outline ta-btn-sm ta-btn-touch" disabled={checkingAttempt || paymentPending} aria-busy={checkingAttempt} onClick={() => checkAttempt(pending.key, "pending")}>
                {checkingAttempt ? "Checking…" : "Check payment status"}
              </button>
            </span>
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
            <form ref={paymentFormRef} onSubmit={submitPayment} method="post" aria-busy={paymentBusy} data-locked={detailsLocked ? "true" : undefined} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div aria-live="polite" ref={formAlertRef} tabIndex={-1} style={{ outline: "none" }}>
                {shown.message && !detailsLocked && (
                  <div className={`ta-alert ${shown.unconfirmed ? "ta-alert-warning" : "ta-alert-error"}`} role="alert">
                    {shown.unconfirmed && <strong className="ta-payment-result-title">Payment not confirmed</strong>}
                    {shown.message}
                  </div>
                )}
                {shown.notice && !shown.payment && (
                  <div className="ta-alert ta-alert-info" role="status">{shown.notice}</div>
                )}
                {shown.errors && !shown.message && (
                  <div className="ta-alert ta-alert-error" role="alert">Nothing was recorded. Correct the highlighted fields and submit again.</div>
                )}
              </div>
              <input type="hidden" name="idempotency_key" value={paymentKey} />
              <p style={{ margin: 0, fontSize: 13, color: "var(--ta-muted)" }}>
                Outstanding balance: <strong>{fmtRM(balanceDue)}</strong>
                {amountPaid > 0 && <> ({fmtRM(amountPaid)} already paid)</>}
              </p>
              <Field label="Payment method" name="payment_provider" error={shown.errors?.payment_provider} required>
                {/* R-1: a disabled select is not submitted, so the locked value travels in a hidden input instead. */}
                <select name={detailsLocked ? undefined : "payment_provider"} value={lockedProvider ?? values.payment_provider} onChange={setValue("payment_provider")} required disabled={detailsLocked} aria-describedby={detailsLocked ? "payment-locked-note" : undefined}>
                  {MANUAL_PAYMENT_PROVIDERS.map((p) => <option key={p} value={p}>{PAYMENT_PROVIDER_LABELS[p]}</option>)}
                </select>
              </Field>
              {detailsLocked && <input type="hidden" name="payment_provider" value={lockedProvider ?? values.payment_provider} />}
              <Field label="Bank / reference detail" name="payment_method" error={shown.errors?.payment_method} hint="e.g. bank name, cheque no.">
                <input type="text" name="payment_method" maxLength={100} value={values.payment_method} onChange={setValue("payment_method")} />
              </Field>
              <Field label="Amount (RM)" name="amount" error={shown.errors?.amount} required>
                <input type="number" name="amount" step="0.01" min="0.01" max={balanceDue} required inputMode="decimal" value={values.amount} onChange={setValue("amount")} readOnly={detailsLocked} aria-readonly={detailsLocked || undefined} aria-describedby={detailsLocked ? "payment-locked-note" : undefined} />
              </Field>
              <Field label="Payment date" name="payment_date" error={shown.errors?.payment_date} required>
                <input type="date" name="payment_date" required value={values.payment_date} onChange={setValue("payment_date")} />
              </Field>
              <Field
                label={paymentProvider === "cheque" ? "Cheque number" : "Payment reference"}
                name="payment_reference"
                error={shown.errors?.payment_reference}
                hint={referenceRequired ? "Required. Exactly as shown on the bank statement or cheque." : "Transaction/reference number, if any"}
                required={referenceRequired}
              >
                <input type="text" name="payment_reference" maxLength={200} value={values.payment_reference} onChange={setValue("payment_reference")} required={referenceRequired} readOnly={detailsLocked} aria-readonly={detailsLocked || undefined} aria-describedby={detailsLocked ? "payment-locked-note" : undefined} />
              </Field>
              {detailsLocked && (
                <p id="payment-locked-note" className="ta-payment-locked-note">Method, amount and reference are locked to the unconfirmed attempt.</p>
              )}
              <Field label="Notes" name="notes" error={shown.errors?.notes}>
                <textarea name="notes" rows={2} maxLength={1000} value={values.notes} onChange={setValue("notes")} />
              </Field>
              <button type="submit" className="ta-btn ta-btn-primary ta-btn-sm ta-btn-touch" disabled={paymentBusy} aria-busy={paymentBusy} style={{ alignSelf: "flex-start" }}>
                {paymentPending ? "Recording…" : checkingAttempt ? "Checking…" : refreshingInvoice ? "Updating invoice…" : detailsLocked ? "Retry original payment" : "Record Payment"}
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
