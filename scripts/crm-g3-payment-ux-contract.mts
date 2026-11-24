// G3 contract: the manual-payment panel keeps what staff typed, never shows success for anything but a confirmed
// outcome, refreshes the invoice after a confirmed or unconfirmed result, and keeps G1's key rules.
// Behaviour of the outcome module and the action is covered by scripts/g3-manual-payment-feedback.test.mts; this file
// pins the client wiring that has no DOM test runner in this repo.
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
} as const;
type Files = Record<keyof typeof paths, string>;
const real = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, readFileSync(path.join(root, p), "utf8")])) as Files;

function between(s: string, start: string, end: string): string {
  const a = s.indexOf(start);
  const b = a < 0 ? -1 : s.indexOf(end, a + start.length);
  return a < 0 || b < 0 ? "" : s.slice(a, b);
}

function checks(f: Files): Array<[string, () => void]> {
  const effect = between(f.panel, "    if (paymentState.payment) {", "\n  }, [paymentState, router]);");
  const confirmed = between(effect, "    if (paymentState.payment) {", "      return;\n    }");
  const unconfirmed = between(effect, "    if (paymentState.unconfirmed) {", "      return;\n    }");
  const form = between(f.panel, "<form ref={paymentFormRef}", "</form>");
  return [
    ["G3-02: payment form submits through onSubmit (no React automatic form reset)", () => {
      assert.ok(form.startsWith('<form ref={paymentFormRef} onSubmit={submitPayment} method="post"'), "onSubmit, and POST (never a GET query string) if submitted before hydration");
      assert.ok(f.panel.includes("useEffect(() => setPaymentFormReady(true), []);"), "submit stays disabled until hydrated");
      assert.ok(!f.panel.includes("action={paymentAction}"), "payment form must not use <form action>");
      assert.ok(f.panel.includes("e.preventDefault();\n    // Repeated clicks"));
    }],
    ["G3-02: every payment field is controlled by state", () => {
      for (const field of ["payment_provider", "payment_method", "amount", "payment_date", "payment_reference", "notes"]) {
        assert.ok(form.includes(`value={values.${field}} onChange={setValue("${field}")}`), `${field} must be controlled`);
      }
      assert.ok(!/name="(?:payment_method|amount|payment_date|payment_reference|notes)"[^>]*defaultValue/.test(form), "no uncontrolled defaults");
    }],
    ["G3-02: values and key are cleared only after a confirmed outcome", () => {
      assert.equal(f.panel.split("setValues(emptyPayment())").length - 1, 1, "exactly one reset");
      assert.ok(confirmed.includes("setValues(emptyPayment())"), "reset lives in the confirmed branch");
      assert.ok(confirmed.includes("setPaymentKey(crypto.randomUUID());"), "new key only after a confirmed outcome");
      assert.ok(!unconfirmed.includes("setPaymentKey") && !unconfirmed.includes("setValues"), "unconfirmed keeps key and values");
    }],
    ["G1/G3: key is bound to the payment intent and sent explicitly", () => {
      assert.ok(f.panel.includes("keyForSubmission({ key: paymentKey, intent: keyIntent.current }, manualPaymentIntent(values), () => crypto.randomUUID())"));
      assert.ok(f.panel.includes('formData.set("idempotency_key", next.key);'));
      assert.ok(f.lib.includes("if (current.intent === null || current.intent === intent) return { key: current.key, intent };"));
      assert.ok(f.lib.includes("[values.payment_provider, Number.isFinite(amount) ? amount.toFixed(2) : values.amount.trim(), values.payment_reference.trim()]"), "intent = provider + amount + reference (the database replay identity)");
    }],
    ["G3-03: repeated clicks are blocked until the result arrives", () => {
      assert.ok(f.panel.includes("if (submitting.current || paymentPending || !paymentFormReady) return;\n    submitting.current = true;"));
      assert.ok(effect.includes("submitting.current = false;") || f.panel.includes("    submitting.current = false;\n    if (paymentState.payment) {"));
      assert.ok(form.includes("disabled={paymentBusy} aria-busy={paymentBusy}"));
      assert.ok(f.panel.includes("const paymentBusy = paymentPending || refreshingInvoice || !paymentFormReady;"));
    }],
    ["G3-01: confirmed and unconfirmed results refresh the page data", () => {
      assert.ok(confirmed.includes("startInvoiceRefresh(() => router.refresh());"));
      assert.ok(unconfirmed.includes("startInvoiceRefresh(() => router.refresh());"));
    }],
    ["G3-01: result banner sits outside the status-dependent cards and takes focus", () => {
      const banner = f.panel.indexOf("{paymentResult && (");
      assert.ok(banner > 0 && banner < f.panel.indexOf('{status === "draft" && ('), "banner must render before every status card");
      assert.ok(f.panel.includes('<div aria-live="polite" aria-atomic="true">\n        {paymentResult && ('));
      assert.ok(confirmed.includes("resultRef.current?.focus();"));
      assert.ok(f.panel.includes("ref={resultRef}\n            tabIndex={-1}"));
      assert.ok(f.css.includes(".ta-payment-result:focus-visible { outline: 2px solid var(--ta-navy);"));
    }],
    ["G3: success text comes only from a confirmed payment result", () => {
      assert.ok(f.panel.includes("const paymentResult = paymentState.payment ? describeManualPaymentResult(paymentState.payment) : null;"));
      assert.equal(f.lib.split('tone: "success"').length - 1, 1, "one success branch only");
      const success = between(f.lib, '    tone: "success",', "  };\n}");
      const replayAt = f.lib.indexOf('  if (result.outcome === "duplicate_ignored") {');
      const staleAt = f.lib.indexOf("  if (!result.refreshed) {");
      assert.ok(replayAt > 0 && replayAt < f.lib.indexOf('tone: "success"'), "replay handled before success");
      assert.ok(staleAt > 0 && staleAt < f.lib.indexOf('tone: "success"'), "refresh failure handled before success");
      assert.ok(between(f.lib, '  if (result.outcome === "duplicate_ignored") {', "\n  }\n").includes('tone: "info"'), "replay is info");
      assert.ok(between(f.lib, "  if (!result.refreshed) {", "\n  }\n").includes('tone: "warning"'), "refresh failure is warning");
      assert.ok(success.includes('title: "Payment recorded"'));
      assert.ok(f.lib.includes('if (row.outcome !== "recorded" && row.outcome !== "duplicate_ignored") return null;'));
    }],
    ["G3: lost or unrecognised responses are unconfirmed, never errors that invite re-entry", () => {
      assert.ok(f.panel.includes("useActionState(recordManualPaymentSafely.bind(null, invoiceId), INITIAL)"));
      assert.ok(f.lib.includes("if (isNavigationSignal(error)) throw error;\n      return unconfirmed();"));
      assert.ok(f.action.includes("if (RPC_ERROR_MESSAGES[code]) return { message: RPC_ERROR_MESSAGES[code] };\n    return { message: UNCONFIRMED_PAYMENT_MESSAGE, unconfirmed: true };"));
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
    ["G3-02: focus moves to the first field with an error, or to the form alert", () => {
      assert.ok(effect.includes("const field = firstErrorField(paymentState.errors);"));
      assert.ok(effect.includes('paymentFormRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();'));
      assert.ok(effect.includes("else if (paymentState.message) formAlertRef.current?.focus();"));
    }],
    ["G1/G2 untouched: guards, eight-argument RPC, reference rule, G2 refresh tones", () => {
      assert.ok(f.action.includes('  await requireRole("admin");\n  await requireModuleAccess("invoices", "edit");\n  const parsed = recordManualPaymentSchema.safeParse({'));
      assert.ok(f.action.includes("p_idempotency_key: d.idempotency_key,"));
      assert.ok(f.panel.includes('const referenceRequired = paymentProvider === "bank_transfer" || paymentProvider === "cheque";'));
      assert.ok(f.panel.includes("className={`ta-alert ${REFRESH_TONE_CLASS[refreshState.tone ?? \"error\"]}`}"));
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
    ["submit enabled before hydration", "panel", "const paymentBusy = paymentPending || refreshingInvoice || !paymentFormReady;", "const paymentBusy = paymentPending || refreshingInvoice;"],
    ["amount becomes uncontrolled", "panel", 'value={values.amount} onChange={setValue("amount")}', 'defaultValue=""'],
    ["values reset after every result", "panel", "    submitting.current = false;\n    if (paymentState.payment) {", "    submitting.current = false;\n    setValues(emptyPayment());\n    if (paymentState.payment) {"],
    ["unconfirmed result rotates the key", "panel", "    if (paymentState.unconfirmed) {\n", "    if (paymentState.unconfirmed) {\n      setPaymentKey(crypto.randomUUID());\n"],
    ["key ignores the intent", "lib", "if (current.intent === null || current.intent === intent) return { key: current.key, intent };", "return { key: current.key, intent };"],
    ["intent ignores the reference", "lib", ", values.payment_reference.trim()]", "]"],
    ["double-click guard removed", "panel", "if (submitting.current || paymentPending || !paymentFormReady) return;", "if (paymentPending || !paymentFormReady) return;"],
    ["button stays enabled while refreshing", "panel", "const paymentBusy = paymentPending || refreshingInvoice || !paymentFormReady;", "const paymentBusy = paymentPending || !paymentFormReady;"],
    ["no page refresh after a confirmed payment", "panel", "      setValues(emptyPayment());\n      startInvoiceRefresh(() => router.refresh());", "      setValues(emptyPayment());"],
    ["banner hidden once the invoice is paid", "panel", '      <div aria-live="polite" aria-atomic="true">\n        {paymentResult && (', '      <div aria-live="polite" aria-atomic="true">\n        {status !== "paid" && paymentResult && ('],
    ["focus not moved to the result", "panel", "      resultRef.current?.focus();\n      return;", "      return;"],
    ["replay shown as success", "lib", 'if (result.outcome === "duplicate_ignored") {', 'if (result.outcome === "never") {'],
    ["refresh failure shown as success", "lib", "if (!result.refreshed) {", "if (false) {"],
    ["unknown outcome accepted as recorded", "lib", 'if (row.outcome !== "recorded" && row.outcome !== "duplicate_ignored") return null;', 'if (row.outcome === "nope") return null;'],
    ["rejected action surfaces as an error boundary", "lib", "if (isNavigationSignal(error)) throw error;\n      return unconfirmed();", "throw error;"],
    ["unmapped DB error shown as a definite refusal", "action", "    return { message: UNCONFIRMED_PAYMENT_MESSAGE, unconfirmed: true };\n  }", '    return { message: "Could not complete this action." };\n  }'],
    ["stale balance kept when the read failed", "lib", "balanceDue: refreshed ? balanceDue : null,", "balanceDue,"],
    ["no focus on the first field error", "panel", 'paymentFormRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();', "void field;"],
    ["guard order changed", "action", '  await requireRole("admin");\n  await requireModuleAccess("invoices", "edit");\n  const parsed = recordManualPaymentSchema', '  await requireModuleAccess("invoices", "edit");\n  const parsed = recordManualPaymentSchema'],
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
