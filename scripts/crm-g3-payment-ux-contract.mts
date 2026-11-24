// G3 contract: the manual-payment panel keeps what staff typed, never shows success for anything but a confirmed
// outcome, refreshes the invoice after a confirmed or unconfirmed result, and keeps G1's key rules.
// R-1: while an attempt is unresolved, the key and the payment details stay locked to it, it survives a refresh
// (sessionStorage scoped to user + invoice), and only database evidence settles it.
// R-1.1: age never unlocks; corrupt records are never dropped and block recording; storage failures keep the in-memory
// lock with a warning; a key conflict is settled only by an exact match with the recorded payment, a mismatch blocks.
// Behaviour of the outcome module and the actions is covered by scripts/g3-manual-payment-feedback.test.mts; this
// file pins the client wiring that has no DOM test runner in this repo.
// Usage: node --experimental-strip-types scripts/crm-g3-payment-ux-contract.mts [--mutations]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const withMutations = process.argv.includes("--mutations");
const root = process.cwd();
const paths = {
  panel: "app/admin/(protected)/invoices/[id]/InvoiceActionsPanel.tsx",
  action: "app/admin/(protected)/invoices/actions.ts",
  lib: "lib/payments/manual-payment-outcome.ts",
  css: "app/admin/admin.css",
  page: "app/admin/(protected)/invoices/[id]/page.tsx",
} as const;
type Files = Record<keyof typeof paths, string>;
const real = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, readFileSync(path.join(root, p), "utf8")])) as Files;

function between(s: string, start: string, end: string): string {
  const a = s.indexOf(start);
  const b = a < 0 ? -1 : s.indexOf(end, a + start.length);
  return a < 0 || b < 0 ? "" : s.slice(a, b);
}
const count = (s: string, needle: string) => s.split(needle).length - 1;

function checks(f: Files): Array<[string, () => void]> {
  const apply = between(f.panel, "  function applyOutcome(state: InvoiceActionState", "\n  const lastPaymentState = useRef(paymentState);");
  const confirmed = between(apply, "    if (state.payment) {", "      return;\n    }");
  const notRecorded = between(apply, '      if (resolution === "not_recorded") {', "        return;\n      }");
  const keyUsed = between(apply, '      if (resolution === "key_used") {', "        return;\n      }");
  const stillUnresolved = between(apply, "      // Still unresolved:", "      return;\n    }");
  const newPending = between(apply, '    if (state.unconfirmed && source === "submit" && lastSubmission.current) {', "      return;\n    }");
  const mount = between(f.panel, "  const [paymentFormReady, setPaymentFormReady] = useState(false);", "  }, []);");
  const check = between(f.panel, '  function checkAttempt(key: string, mode: "pending" | "corrupt") {', "\n  function submitPayment(");
  const form = between(f.panel, "<form ref={paymentFormRef}", "</form>");
  const lookup = between(f.action, "export async function checkManualPaymentAttemptAction", "\n}\n");
  const parse = between(f.lib, "export function parsePending(", "\n}\n");
  const match = between(f.lib, "export function matchRecordedPayment(", "\n}\n");
  return [
    ["G3-02: payment form submits through onSubmit and POST; enabled only after hydration and restoration", () => {
      assert.ok(form.startsWith('<form ref={paymentFormRef} onSubmit={submitPayment} method="post"'), "onSubmit, and POST (never a GET query string) if submitted before hydration");
      assert.ok(!f.panel.includes("action={paymentAction}"), "payment form must not use <form action>");
      assert.ok(mount.includes("setPaymentFormReady(true);"), "submit stays disabled until hydrated");
      assert.ok(mount.indexOf("setPaymentKey(attempt.key);") > 0 && mount.indexOf("setPaymentKey(attempt.key);") < mount.indexOf("setPaymentFormReady(true);"), "R-1: restoration happens before the form is enabled");
    }],
    ["G3-02: every payment field is controlled by state", () => {
      for (const field of ["payment_provider", "payment_method", "amount", "payment_date", "payment_reference", "notes"]) {
        assert.ok(form.includes(`value={values.${field}} onChange={setValue("${field}")}`), `${field} must be controlled`);
      }
      assert.ok(!/name="(?:payment_method|amount|payment_date|payment_reference|notes)"[^>]*defaultValue/.test(form), "no uncontrolled defaults");
    }],
    ["G3-02/R-1: values are cleared only after a confirmed payment", () => {
      assert.equal(count(f.panel, "setValues(emptyPayment())"), 1, "exactly one reset: confirmed payment");
      assert.ok(confirmed.includes("setValues(emptyPayment())"));
      for (const [name, block] of [["not_recorded", notRecorded], ["key conflict", keyUsed], ["still unresolved", stillUnresolved], ["new unresolved", newPending]] as const) {
        assert.ok(block.length > 0, `${name} block present`);
        assert.ok(!block.includes("setValues(emptyPayment())"), `${name} keeps what staff typed`);
      }
      assert.ok(confirmed.includes("setPaymentKey(crypto.randomUUID());"), "new key only after a confirmed outcome");
      assert.ok(!stillUnresolved.includes("setPaymentKey") && !newPending.includes("setPaymentKey") && !keyUsed.includes("setPaymentKey"), "unresolved and conflict keep the key");
    }],
    ["G1/G3/R-1: key is bound to the intent, never rotated while unresolved, and sent explicitly", () => {
      assert.ok(f.panel.includes("keyForSubmission({ key: paymentKey, intent: keyIntent.current }, manualPaymentIntent(values), () => crypto.randomUUID(), Boolean(unresolved))"));
      assert.ok(f.panel.includes('formData.set("idempotency_key", next.key);'));
      assert.ok(f.lib.includes("  if (unresolved) return { key: current.key, intent: current.intent ?? intent };\n  if (current.intent === null || current.intent === intent) return { key: current.key, intent };"), "unresolved check comes first");
      assert.ok(f.lib.includes("[values.payment_provider, Number.isFinite(amount) ? amount.toFixed(2) : values.amount.trim(), values.payment_reference.trim()]"), "intent = provider + amount + reference (the database replay identity)");
    }],
    ["G3-03: repeated clicks are blocked until the result arrives", () => {
      assert.ok(f.panel.includes("if (submitting.current || paymentPending || checkingAttempt || !paymentFormReady) return;"));
      assert.ok(f.panel.includes("submitting.current = true;\n    const next = keyForSubmission("));
      assert.ok(apply.startsWith('  function applyOutcome(state: InvoiceActionState, source: "submit" | "lookup") {\n    submitting.current = false;'));
      assert.ok(form.includes("disabled={paymentBusy} aria-busy={paymentBusy}"));
      assert.ok(f.panel.includes("const paymentBusy = paymentPending || refreshingInvoice || checkingAttempt || !paymentFormReady || blocked !== null;"));
    }],
    ["G3-01: confirmed and newly unresolved results refresh the page data", () => {
      assert.ok(confirmed.includes("startInvoiceRefresh(() => router.refresh());"));
      assert.ok(newPending.includes("startInvoiceRefresh(() => router.refresh());"));
    }],
    ["G3-01: result banner sits outside the status-dependent cards and takes focus", () => {
      const banner = f.panel.indexOf("{paymentResult && (");
      assert.ok(banner > 0 && banner < f.panel.indexOf('{status === "draft" && ('), "banner must render before every status card");
      assert.ok(f.panel.includes('<div aria-live="polite" aria-atomic="true">\n        {paymentResult && ('));
      assert.ok(confirmed.includes('focusOn("result");'));
      assert.ok(f.panel.includes('if (focusTarget.kind === "result") resultRef.current?.focus();'));
      assert.ok(f.panel.includes("ref={resultRef}\n            tabIndex={-1}"));
      assert.ok(f.css.includes(".ta-payment-result:focus-visible { outline: 2px solid var(--ta-navy);"));
    }],
    ["G3: success text comes only from a confirmed payment result", () => {
      assert.ok(f.panel.includes("const paymentResult = shown.payment ? describeManualPaymentResult(shown.payment) : null;"));
      assert.equal(count(f.lib, 'tone: "success"'), 1, "one success branch only");
      const replayAt = f.lib.indexOf('  if (result.outcome === "duplicate_ignored") {');
      const staleAt = f.lib.indexOf("  if (!result.refreshed) {");
      assert.ok(replayAt > 0 && replayAt < f.lib.indexOf('tone: "success"'), "replay handled before success");
      assert.ok(staleAt > 0 && staleAt < f.lib.indexOf('tone: "success"'), "refresh failure handled before success");
      assert.ok(between(f.lib, '  if (result.outcome === "duplicate_ignored") {', "\n  }\n").includes('tone: "info"'), "replay is info");
      assert.ok(between(f.lib, "  if (!result.refreshed) {", "\n  }\n").includes('tone: "warning"'), "refresh failure is warning");
      assert.ok(f.lib.includes('if (row.outcome !== "recorded" && row.outcome !== "duplicate_ignored") return null;'));
    }],
    ["G3: lost or unrecognised responses are unconfirmed, never errors that invite re-entry", () => {
      assert.ok(f.panel.includes("useActionState(recordManualPaymentSafely.bind(null, invoiceId), INITIAL)"));
      assert.ok(f.lib.includes("if (isNavigationSignal(error)) throw error;\n      return unconfirmed();"));
      assert.ok(f.action.includes("    return { message: UNCONFIRMED_PAYMENT_MESSAGE, unconfirmed: true };\n  }\n\n  revalidateInvoice("));
      assert.ok(f.action.includes("if (!confirmed) return { message: UNCONFIRMED_PAYMENT_MESSAGE, unconfirmed: true };"));
      assert.ok(f.lib.includes("Submitting this same form again is safe: it cannot create a second payment."));
    }],
    ["G3-01: invoice is read back after the RPC and a failed read never becomes an error", () => {
      const tail = f.action.slice(f.action.indexOf('const { data, error } = await supabase.rpc("record_manual_payment"'));
      assert.ok(tail.indexOf('.select("status, amount_paid, balance_due")') > tail.indexOf("const confirmed = parseRecordManualPaymentResponse(data);"));
      assert.ok(tail.includes("freshError ? null : fresh"));
      assert.ok(f.lib.includes('const refreshed = balanceDue !== null && typeof invoice?.status === "string";'));
      assert.ok(f.lib.includes("balanceDue: refreshed ? balanceDue : null,"), "no stale balance when the read failed");
    }],
    ["G3-02: focus moves to the first field with an error, or to the alert", () => {
      assert.ok(apply.includes("const field = firstErrorField(state.errors);"));
      assert.ok(apply.includes('if (field) focusOn("field", field);'));
      assert.ok(f.panel.includes('paymentFormRef.current?.querySelector<HTMLElement>(`[name="${focusTarget.field}"]`)?.focus();'));
    }],
    ["G1/G2 untouched: guards, eight-argument RPC, reference rule, G2 refresh tones", () => {
      assert.ok(f.action.includes('  await requireRole("admin");\n  await requireModuleAccess("invoices", "edit");\n  const parsed = recordManualPaymentSchema.safeParse({'));
      assert.ok(f.action.includes("p_idempotency_key: d.idempotency_key,"));
      assert.ok(f.panel.includes('const referenceRequired = paymentProvider === "bank_transfer" || paymentProvider === "cheque";'));
      assert.ok(f.panel.includes("className={`ta-alert ${REFRESH_TONE_CLASS[refreshState.tone ?? \"error\"]}`}"));
    }],
    // ---- R-1 ----------------------------------------------------------------------------------------------------------
    ["R-1: an unconfirmed result locks the attempt (key + replay identity) and stores it", () => {
      assert.ok(newPending.includes("beginPending({\n        key: s.key,"));
      assert.ok(newPending.includes("amount: Number(s.values.amount).toFixed(2),"));
      assert.ok(f.panel.includes("try { window.sessionStorage.setItem(storageKey, serializePending(currentUserId, invoiceId, attempt)); } catch { setStorageWarning(STORAGE_WARNING); }"));
      assert.ok(f.panel.includes("lastSubmission.current = { key: next.key, values };"));
    }],
    ["R-1/R-1.1: only database evidence settles an unresolved attempt", () => {
      assert.equal(count(apply, "settlePending();"), 2, "confirmed and not_recorded only");
      assert.ok(confirmed.includes("settlePending();") && notRecorded.includes("settlePending();"));
      assert.ok(!stillUnresolved.includes("settlePending") && !newPending.includes("settlePending") && !keyUsed.includes("settlePending"));
      assert.ok(apply.includes("const resolution = resolveUnresolvedAttempt(state);"));
      assert.ok(f.lib.includes('export const KEY_NOT_RECORDED_CODES = ["invoice_not_payable", "payment_exceeds_balance", "duplicate_payment_reference"] as const;'), "only codes raised after the key check");
      assert.ok(f.lib.includes('if (state.payment) return "confirmed";\n  if (state.keyStatus === "not_recorded") return "not_recorded";\n  if (state.keyStatus === "used") return "key_used";\n  return "unresolved";'));
      assert.ok(f.action.includes("      const keyStatus = keyStatusForCode(code);\n      return keyStatus ? { message: RPC_ERROR_MESSAGES[code], keyStatus } : { message: RPC_ERROR_MESSAGES[code] };"));
    }],
    ["R-1/R-1.1: the status look-up is guarded, read-only, keyed, and returns evidence only", () => {
      assert.ok(lookup.includes('  await requireRole("admin");\n  await requireModuleAccess("invoices", "edit");\n  if (!IDEMPOTENCY_KEY_RE.test(invoiceId) || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {'));
      assert.ok(lookup.includes('.from("invoice_payments")') && lookup.includes('.eq("invoice_id", invoiceId)') && lookup.includes('.eq("idempotency_key", idempotencyKey)'));
      assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(lookup), "no writes or RPCs");
      assert.ok(lookup.includes('if (!row || row.status !== "successful") return { message: LOOKUP_NOT_FOUND_MESSAGE, unconfirmed: true, lookup: "not_found" };'));
      assert.ok(lookup.includes('if (error) return { message: LOOKUP_FAILED_MESSAGE, unconfirmed: true, lookup: "failed" };'));
      assert.ok(lookup.includes('return { unconfirmed: true, lookup: "found", recordedPayment, recordedResult };'), "found = evidence, not a payment");
      assert.ok(!/\bpayment(:|,| })/.test(lookup.slice(lookup.indexOf("const recordedPayment"))), "no `payment` field from the look-up");
      assert.ok(f.lib.includes("That does not prove it failed."));
    }],
    ["R-1: method, amount and reference are locked; a different intent cannot be submitted", () => {
      assert.ok(form.includes('<select name={detailsLocked ? undefined : "payment_provider"} value={values.payment_provider} onChange={setValue("payment_provider")} required disabled={detailsLocked}'));
      assert.ok(form.includes('{detailsLocked && <input type="hidden" name="payment_provider" value={values.payment_provider} />}'));
      assert.ok(form.includes('inputMode="decimal" value={values.amount} onChange={setValue("amount")} readOnly={detailsLocked}'));
      assert.ok(form.includes('value={values.payment_reference} onChange={setValue("payment_reference")} required={referenceRequired} readOnly={detailsLocked}'));
      assert.ok(f.panel.includes("if (unresolved && manualPaymentIntent(values) !== pendingIntent(unresolved)) {"));
      assert.ok(f.panel.includes("const detailsLocked = pending !== null || blocked !== null;"));
    }],
    ["R-1: storage is scoped to user + invoice, restored before use, and checked against the database", () => {
      assert.ok(f.lib.includes("return `teras:crm:pending-manual-payment:v${PENDING_STORAGE_VERSION}:${userId}:${invoiceId}`;"));
      assert.ok(parse.includes("o.u === userId &&") && parse.includes("o.i === invoiceId &&"));
      assert.ok(parse.includes('const key = typeof o.k === "string" && UUID_RE.test(o.k) ? o.k : null;'));
      const ser = f.lib.slice(f.lib.indexOf("export function serializePending"), f.lib.indexOf("export type ParsedPending"));
      assert.ok(ser.length > 0 && !/(notes|payment_method|password|token)/.test(ser), "minimum data only");
      assert.ok(mount.includes("    if (canManage) {"), "only staff who can record payments restore");
      assert.ok(mount.includes('checkAttempt(attempt.key, "pending");'), "restored attempt is checked against the database");
      assert.ok(f.page.includes("currentUserId={profile.id}"));
    }],
    ["R-1: leaving the page while unresolved or blocked is warned", () => {
      assert.ok(f.panel.includes('window.addEventListener("beforeunload", warn);'));
      assert.ok(f.panel.includes("if (!pending && !blocked) return;\n    const warn ="));
    }],
    // ---- R-1.1 Gate A -------------------------------------------------------------------------------------------------
    ["R-1.1 A: age never unlocks; an old record is restored, locked and checked", () => {
      assert.ok(parse.includes("stale: now - createdAt > PENDING_TTL_MS,"), "age is a flag only");
      assert.ok(!/return \{ state: "stale"/.test(parse), "no separate 'stale' state that could be dropped");
      assert.equal(count(parse, 'return { state: "none" }'), 1, "'none' only when nothing is stored");
      assert.ok(parse.includes('  if (raw === null) return { state: "none" };'));
      assert.ok(mount.includes("        restored = parsed.attempt;\n        stale = parsed.stale;"));
      assert.ok(mount.includes("if (stale) setPendingStale(true);"));
      assert.ok(!mount.includes("removeItem"), "nothing stored is removed on restore");
    }],
    ["R-1.1 A: corrupt records are never dropped, block recording, and a readable key is only used read-only", () => {
      assert.ok(parse.includes('if (!identityIntact) return { state: "corrupt", key };'));
      assert.ok(mount.includes('      } else if (parsed.state === "corrupt") {'));
      assert.ok(mount.includes('blockRecording({ reason: "corrupt" });'));
      assert.ok(mount.includes('if (parsed.key) checkAttempt(parsed.key, "corrupt");'));
      const corruptBranch = between(check, '      if (mode === "corrupt") {', "        return;\n      }");
      assert.ok(corruptBranch.includes('blockRecording({ reason: "corrupt", recorded: result.recordedPayment });'), "found row is shown, block stays");
      assert.ok(!/settlePending|applyOutcome|setBlocked\(null\)|blockedRef\.current = null/.test(corruptBranch), "corrupt never settles or unblocks");
      assert.ok(!/setBlocked\(null\)|blockedRef\.current = null/.test(f.panel), "nothing in the panel lifts a block");
    }],
    ["R-1.1 A: blocked recording cannot be submitted and is explained", () => {
      assert.ok(f.panel.includes("    if (blockedRef.current) {\n      focusOn(\"pending\");\n      return;\n    }"));
      assert.ok(f.panel.includes("{blocked.reason === \"corrupt\" ? BLOCKED_CORRUPT_MESSAGE : BLOCKED_MISMATCH_MESSAGE}"));
      assert.ok(f.lib.includes("Contact the Finance administrator"));
      assert.ok(!/another tab|new tab/i.test(f.lib + f.panel), "no 'open another tab' recovery advice");
      assert.ok(!/I have checked|Saya telah menyemak/i.test(f.panel), "no acknowledgement-only unlock");
    }],
    ["R-1.1 A: storage read, write and removal failures keep the in-memory lock and warn", () => {
      assert.ok(mount.includes("try { raw = window.sessionStorage.getItem(storageKey); } catch { setStorageWarning(STORAGE_READ_WARNING); }"));
      assert.ok(f.panel.includes("try { window.sessionStorage.removeItem(storageKey); } catch { setStorageWarning(STORAGE_CLEAR_WARNING); }"));
      assert.ok(f.panel.includes("{storageWarning && ("));
    }],
    // ---- R-1.1 Gate B -------------------------------------------------------------------------------------------------
    ["R-1.1 B: a key conflict is checked against the recorded payment, never shown as success", () => {
      assert.ok(keyUsed.includes('checkAttempt(pendingRef.current.key, "pending");'));
      assert.ok(!keyUsed.includes("settlePending") && !keyUsed.includes("router.refresh"));
      assert.ok(!f.lib.includes("KEY_USED_MESSAGE"), "old 'already recorded with its original details' message removed");
    }],
    ["R-1.1 B: only an exact match settles; a mismatch blocks; not found and failures stay unresolved", () => {
      assert.ok(check.includes('if (matchRecordedPayment(result.recordedPayment, { invoiceId, attempt }) === "match") {\n          applyOutcome({ payment: result.recordedResult,'));
      assert.ok(check.includes('blockRecording({ reason: "mismatch", recorded: result.recordedPayment });'));
      assert.ok(check.includes("applyOutcome({ message: result.message ?? LOOKUP_FAILED_MESSAGE, unconfirmed: true }, \"lookup\");"));
      for (const s of ["recorded.invoiceId === expected.invoiceId", "recorded.idempotencyKey.toLowerCase() === a.key.toLowerCase()", 'recorded.status === "successful"',
                       "recorded.provider === a.provider", "recorded.amount.toFixed(2) === Number(a.amount).toFixed(2)", "normalizeReference(recorded.reference) === normalizeReference(a.reference)"]) {
        assert.ok(match.includes(s), `match compares ${s}`);
      }
      assert.ok(f.lib.includes('return String(reference ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");'), "G1 reference normalisation");
    }],
  ];
}

function run(f: Files): { failed: string[] } {
  const failed: string[] = [];
  for (const [name, fn] of checks(f)) {
    try { fn(); } catch (e) { failed.push(`${name}: ${(e as Error).message.split("\n")[0]}`); }
  }
  return { failed };
}

const base = run(real);
for (const m of base.failed) console.error(`FAIL ${m}`);
if (base.failed.length) { console.error(`${base.failed.length} check(s) FAILED, ${checks(real).length - base.failed.length} passed.`); process.exit(1); }

if (withMutations) {
  const mutations: Array<[string, keyof Files, string, string]> = [
    ["form goes back to <form action> (auto reset wipes values)", "panel", "<form ref={paymentFormRef} onSubmit={submitPayment}", "<form ref={paymentFormRef} action={paymentAction}"],
    ["pre-hydration native submit falls back to GET", "panel", 'onSubmit={submitPayment} method="post"', "onSubmit={submitPayment}"],
    ["submit enabled before hydration", "panel", "const paymentBusy = paymentPending || refreshingInvoice || checkingAttempt || !paymentFormReady || blocked !== null;", "const paymentBusy = paymentPending || refreshingInvoice || checkingAttempt || blocked !== null;"],
    ["amount becomes uncontrolled", "panel", 'value={values.amount} onChange={setValue("amount")}', 'defaultValue=""'],
    ["values reset on a still-unresolved result", "panel", "      // Still unresolved: lost response", "      setValues(emptyPayment());\n      // Still unresolved: lost response"],
    ["key ignores the intent", "lib", "  if (current.intent === null || current.intent === intent) return { key: current.key, intent };\n  return { key: newKey(), intent };", "  return { key: current.key, intent };"],
    ["intent ignores the reference", "lib", ", values.payment_reference.trim()]", "]"],
    ["double-click guard removed", "panel", "if (submitting.current || paymentPending || checkingAttempt || !paymentFormReady) return;", "if (paymentPending || checkingAttempt || !paymentFormReady) return;"],
    ["button stays enabled while refreshing", "panel", "const paymentBusy = paymentPending || refreshingInvoice || checkingAttempt || !paymentFormReady || blocked !== null;", "const paymentBusy = paymentPending || checkingAttempt || !paymentFormReady || blocked !== null;"],
    ["no page refresh after a confirmed payment", "panel", '      setValues(emptyPayment());\n      startInvoiceRefresh(() => router.refresh());\n      focusOn("result");', '      setValues(emptyPayment());\n      focusOn("result");'],
    ["banner hidden once the invoice is paid", "panel", '      <div aria-live="polite" aria-atomic="true">\n        {paymentResult && (', '      <div aria-live="polite" aria-atomic="true">\n        {status !== "paid" && paymentResult && ('],
    ["focus not moved to the result", "panel", '      focusOn("result");', ""],
    ["replay shown as success", "lib", 'if (result.outcome === "duplicate_ignored") {', 'if (result.outcome === "never") {'],
    ["refresh failure shown as success", "lib", "if (!result.refreshed) {", "if (false) {"],
    ["unknown outcome accepted as recorded", "lib", 'if (row.outcome !== "recorded" && row.outcome !== "duplicate_ignored") return null;', 'if (row.outcome === "nope") return null;'],
    ["rejected action surfaces as an error boundary", "lib", "if (isNavigationSignal(error)) throw error;\n      return unconfirmed();", "throw error;"],
    ["unmapped DB error shown as a definite refusal", "action", "    return { message: UNCONFIRMED_PAYMENT_MESSAGE, unconfirmed: true };\n  }\n\n  revalidateInvoice(", '    return { message: "Could not complete this action." };\n  }\n\n  revalidateInvoice('],
    ["stale balance kept when the read failed", "lib", "balanceDue: refreshed ? balanceDue : null,", "balanceDue,"],
    ["no focus on the first field error", "panel", 'paymentFormRef.current?.querySelector<HTMLElement>(`[name="${focusTarget.field}"]`)?.focus();', "void 0;"],
    ["guard order changed", "action", '  await requireRole("admin");\n  await requireModuleAccess("invoices", "edit");\n  const parsed = recordManualPaymentSchema', '  await requireModuleAccess("invoices", "edit");\n  const parsed = recordManualPaymentSchema'],
    // R-1
    ["R-1: key rotates while unresolved", "lib", "  if (unresolved) return { key: current.key, intent: current.intent ?? intent };\n", ""],
    ["R-1: unresolved flag not passed", "panel", "() => crypto.randomUUID(), Boolean(unresolved))", "() => crypto.randomUUID())"],
    ["R-1: still-unresolved result settles the attempt", "panel", "      // Still unresolved: lost response", "      settlePending();\n      // Still unresolved: lost response"],
    ["R-1: unconfirmed result is not locked", "panel", "      beginPending({\n        key: s.key,", "      void ({\n        key: s.key,"],
    ["R-1: pre-check refusal treated as not recorded", "lib", '["invoice_not_payable", "payment_exceeds_balance", "duplicate_payment_reference"]', '["invoice_not_payable", "payment_exceeds_balance", "duplicate_payment_reference", "payment_reference_required"]'],
    ["R-1: look-up 'not found' settles as not recorded", "action", 'return { message: LOOKUP_NOT_FOUND_MESSAGE, unconfirmed: true, lookup: "not_found" };', 'return { message: LOOKUP_NOT_FOUND_MESSAGE, keyStatus: "not_recorded", lookup: "not_found" };'],
    ["R-1: look-up loses its guard", "action", '  await requireRole("admin");\n  await requireModuleAccess("invoices", "edit");\n  if (!IDEMPOTENCY_KEY_RE', "  if (!IDEMPOTENCY_KEY_RE"],
    ["R-1: method stays editable while locked", "panel", "required disabled={detailsLocked}", "required disabled={false}"],
    ["R-1: amount stays editable while locked", "panel", 'inputMode="decimal" value={values.amount} onChange={setValue("amount")} readOnly={detailsLocked}', 'inputMode="decimal" value={values.amount} onChange={setValue("amount")} readOnly={false}'],
    ["R-1: different intent can be submitted", "panel", "if (unresolved && manualPaymentIntent(values) !== pendingIntent(unresolved)) {", "if (false) {"],
    ["R-1: storage not scoped to the user", "lib", ":${userId}:${invoiceId}`;", ":${invoiceId}`;"],
    ["R-1: stored attempt of another user accepted", "lib", "o.u === userId &&", "true &&"],
    ["R-1: form enabled before restoration", "panel", "    let restored: PendingAttempt | null = null;", "    setPaymentFormReady(true);\n    let restored: PendingAttempt | null = null;"],
    ["R-1: restored attempt not checked", "panel", '      checkAttempt(attempt.key, "pending");\n', ""],
    ["R-1: no leave-page warning", "panel", 'window.addEventListener("beforeunload", warn);', ""],
    ["R-1: restoration for any viewer", "panel", "    if (canManage) {\n      let raw", "    {\n      let raw"],
    // R-1.1 Gate A
    ["R-1.1: old records are dropped", "lib", "  return {\n    state: \"ok\",\n    stale:", "  if (now - createdAt > PENDING_TTL_MS) return { state: \"none\" };\n  return {\n    state: \"ok\",\n    stale:"],
    ["R-1.1: restore removes the stored record", "panel", "    let restored: PendingAttempt | null = null;\n    let stale = false;", "    let restored: PendingAttempt | null = null;\n    let stale = false;\n    try { window.sessionStorage.removeItem(storageKey); } catch { /* x */ }"],
    ["R-1.1: corrupt record does not block", "panel", '        blockRecording({ reason: "corrupt" });\n', ""],
    ["R-1.1: corrupt key settles on a found row", "panel", '        if (result.lookup === "found" && result.recordedPayment) blockRecording({ reason: "corrupt", recorded: result.recordedPayment });', '        if (result.lookup === "found" && result.recordedPayment) settlePending();'],
    ["R-1.1: corrupt key never checked", "panel", '        if (parsed.key) checkAttempt(parsed.key, "corrupt");\n', ""],
    ["R-1.1: blocked submit allowed", "panel", "    if (blockedRef.current) {\n      focusOn(\"pending\");\n      return;\n    }\n", ""],
    ["R-1.1: storage read failure silent", "panel", "catch { setStorageWarning(STORAGE_READ_WARNING); }", "catch { /* ignore */ }"],
    ["R-1.1: storage removal failure silent", "panel", "catch { setStorageWarning(STORAGE_CLEAR_WARNING); }", "catch { /* ignore */ }"],
    ["R-1.1: lookup returns a payment directly", "action", 'return { unconfirmed: true, lookup: "found", recordedPayment, recordedResult };', 'return { unconfirmed: true, lookup: "found", recordedPayment, recordedResult, payment: recordedResult };'],
    // R-1.1 Gate B
    ["R-1.1: key conflict settles immediately", "panel", '        checkAttempt(pendingRef.current.key, "pending");\n', '        settlePending();\n'],
    ["R-1.1: any found row settles (no comparison)", "panel", 'if (matchRecordedPayment(result.recordedPayment, { invoiceId, attempt }) === "match") {', "if (true) {"],
    ["R-1.1: mismatch does not block", "panel", '          blockRecording({ reason: "mismatch", recorded: result.recordedPayment });\n', ""],
    ["R-1.1: match ignores amount", "lib", "Number.isFinite(recorded.amount) && recorded.amount.toFixed(2) === Number(a.amount).toFixed(2) &&", "Number.isFinite(recorded.amount) &&"],
    ["R-1.1: match ignores reference", "lib", " &&\n    normalizeReference(recorded.reference) === normalizeReference(a.reference);", ";"],
    ["R-1.1: match ignores invoice", "lib", "recorded.invoiceId === expected.invoiceId &&", "true &&"],
    ["R-1.1: match ignores method", "lib", "recorded.provider === a.provider &&", "true &&"],
  ];
  let killed = 0;
  let survived = 0;
  for (const [label, file, from, to] of mutations) {
    assert.equal(real[file].split(from).length - 1, 1, `mutation anchor not unique: ${label}`);
    const r = run({ ...real, [file]: real[file].replace(from, to) });
    if (r.failed.length) killed++; else { survived++; console.error(`FAIL mutation survived: ${label}`); }
  }
  console.log(`mutations: ${killed}/${mutations.length} killed`);
  if (survived) process.exit(1);
}
console.log(`${checks(real).length} check(s) passed.`);
