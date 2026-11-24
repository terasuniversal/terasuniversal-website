// CLOSEOUT-02 contract for the client wiring that has no DOM test runner in this repo:
// O-1  locked payment details cannot be changed through onChange (scripted events) and the locked
//      method travels from the unresolved attempt, not from editable state.
// O-2  payment actions opt in to a 44px touch target with a scoped class (no global resize).
// UX-04 the Opportunities summary cards use a real responsive grid rule.
// Behaviour in a real browser is covered by the local harness run recorded in the CLOSEOUT-02 evidence.
// Usage: node --experimental-strip-types scripts/closeout02-ui-contract.mts [--mutations]
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const withMutations = process.argv.includes("--mutations");
const root = process.cwd();
const paths = {
  panel: "app/admin/(protected)/invoices/[id]/InvoiceActionsPanel.tsx",
  css: "app/admin/admin.css",
  opps: "app/admin/(protected)/sales/opportunities/page.tsx",
} as const;
type Files = Record<keyof typeof paths, string>;
const real = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, readFileSync(path.join(root, p), "utf8")])) as Files;

function cssRule(css: string, selector: string): string {
  const i = css.indexOf(`${selector} {`);
  return i < 0 ? "" : css.slice(i, css.indexOf("}", i) + 1);
}

const checks: Array<[string, (f: Files) => void]> = [
  ["O-1: the three intent fields are listed as locked", (f) => {
    assert.match(f.panel, /LOCKED_PAYMENT_FIELDS: ReadonlySet<keyof PaymentValues> = new Set<keyof PaymentValues>\(\["payment_provider", "amount", "payment_reference"\]\)/);
  }],
  ["O-1: the setter refuses locked fields while an attempt is pending or blocked", (f) => {
    assert.match(f.panel, /if \(LOCKED_PAYMENT_FIELDS\.has\(field\) && \(pendingRef\.current !== null \|\| blockedRef\.current !== null\)\) return;\n\s*setValues\(/);
  }],
  ["O-1: every locked field is wired through setValue (no direct setValues bypass)", (f) => {
    for (const field of ["payment_provider", "amount", "payment_reference"]) {
      assert.match(f.panel, new RegExp(`onChange=\\{setValue\\("${field}"\\)\\}`), field);
    }
  }],
  ["O-1: locked method comes from the unresolved attempt for both the select and the hidden input", (f) => {
    assert.match(f.panel, /const lockedProvider = detailsLocked && pending \? pending\.provider : null;/);
    assert.match(f.panel, /<select name=\{detailsLocked \? undefined : "payment_provider"\} value=\{lockedProvider \?\? values\.payment_provider\}/);
    assert.match(f.panel, /\{detailsLocked && <input type="hidden" name="payment_provider" value=\{lockedProvider \?\? values\.payment_provider\} \/>\}/);
  }],
  ["O-1: R-1 submit guard is still present (defence in depth)", (f) => {
    assert.match(f.panel, /if \(unresolved && manualPaymentIntent\(values\) !== pendingIntent\(unresolved\)\) \{/);
  }],
  ["O-2: submit, retry and check buttons opt in to the touch target", (f) => {
    assert.match(f.panel, /<button type="submit" className="ta-btn ta-btn-primary ta-btn-sm ta-btn-touch" disabled=\{paymentBusy\} aria-busy=\{paymentBusy\}/);
    assert.match(f.panel, /className="ta-btn ta-btn-primary ta-btn-sm ta-btn-touch" disabled=\{paymentBusy\} onClick=\{\(\) => paymentFormRef\.current\?\.requestSubmit\(\)\}/);
    assert.match(f.panel, /className="ta-btn ta-btn-outline ta-btn-sm ta-btn-touch" disabled=\{checkingAttempt \|\| paymentPending\} aria-busy=\{checkingAttempt\}/);
  }],
  ["O-2: the touch rule is scoped and gives 44px in both directions", (f) => {
    const rule = cssRule(f.css, ".ta-btn.ta-btn-touch");
    assert.match(rule, /min-height: 44px;/);
    assert.match(rule, /min-width: 44px;/);
    assert.doesNotMatch(f.css, /^\.ta-btn \{[^}]*min-height/m, "the base .ta-btn rule must not be resized globally");
    assert.doesNotMatch(cssRule(f.css, ".ta-btn-sm"), /min-height/, ".ta-btn-sm stays unchanged");
  }],
  ["O-2: loading labels and disabled states are kept", (f) => {
    assert.match(f.panel, /\{paymentPending \? "Recording…" : checkingAttempt \? "Checking…" : refreshingInvoice \? "Updating invoice…" : detailsLocked \? "Retry original payment" : "Record Payment"\}/);
  }],
  ["UX-04: the stat grid has a responsive grid rule", (f) => {
    const rule = cssRule(f.css, ".ta-stat-grid");
    assert.match(rule, /display: grid;/);
    assert.match(rule, /grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 220px\), 1fr\)\);/);
  }],
  ["UX-04: the Opportunities page still renders the same three KPIs in that grid", (f) => {
    const block = f.opps.slice(f.opps.indexOf('<div className="ta-stat-grid">'), f.opps.indexOf("</div>}", f.opps.indexOf('<div className="ta-stat-grid">')));
    assert.match(block, /<StatCard label="Open Opportunities" value=\{summaryRows\.length\}/);
    assert.match(block, /<StatCard label="Overdue Close" value=\{overdueClose\}/);
    assert.match(block, /<StatCard label="Stalled" value=\{stalled\}/);
  }],
];

function runAll(f: Files): string[] {
  const failures: string[] = [];
  for (const [name, fn] of checks) { try { fn(f); } catch { failures.push(name); } }
  return failures;
}

const failures = runAll(real);
for (const [name] of checks) console.log(`${failures.includes(name) ? "not ok" : "ok"} - ${name}`);
assert.deepEqual(failures, [], "contract failures on the real files");

if (withMutations) {
  const mutations: Array<[string, keyof Files, string, string]> = [
    ["setter guard removed", "panel", "    if (LOCKED_PAYMENT_FIELDS.has(field) && (pendingRef.current !== null || blockedRef.current !== null)) return;\n", ""],
    ["guard ignores blocked", "panel", "(pendingRef.current !== null || blockedRef.current !== null)", "(pendingRef.current !== null)"],
    ["amount not locked", "panel", '["payment_provider", "amount", "payment_reference"]', '["payment_provider", "payment_reference"]'],
    ["method not locked", "panel", '["payment_provider", "amount", "payment_reference"]', '["amount", "payment_reference"]'],
    ["hidden input from editable state", "panel", 'name="payment_provider" value={lockedProvider ?? values.payment_provider} />', 'name="payment_provider" value={values.payment_provider} />'],
    ["select from editable state", "panel", 'value={lockedProvider ?? values.payment_provider} onChange', "value={values.payment_provider} onChange"],
    ["locked provider from values", "panel", "detailsLocked && pending ? pending.provider : null", "detailsLocked ? values.payment_provider : null"],
    ["method bypasses setter", "panel", 'onChange={setValue("payment_provider")}', 'onChange={(e) => setValues((v) => ({ ...v, payment_provider: e.target.value }))}'],
    ["R-1 submit guard removed", "panel", "if (unresolved && manualPaymentIntent(values) !== pendingIntent(unresolved)) {", "if (false) {"],
    ["submit button loses touch class", "panel", 'type="submit" className="ta-btn ta-btn-primary ta-btn-sm ta-btn-touch"', 'type="submit" className="ta-btn ta-btn-primary ta-btn-sm"'],
    ["retry loses touch class", "panel", 'className="ta-btn ta-btn-primary ta-btn-sm ta-btn-touch" disabled={paymentBusy} onClick', 'className="ta-btn ta-btn-primary ta-btn-sm" disabled={paymentBusy} onClick'],
    ["check loses touch class", "panel", 'className="ta-btn ta-btn-outline ta-btn-sm ta-btn-touch" disabled={checkingAttempt', 'className="ta-btn ta-btn-outline ta-btn-sm" disabled={checkingAttempt'],
    ["touch target 32px", "css", ".ta-btn.ta-btn-touch { min-height: 44px;", ".ta-btn.ta-btn-touch { min-height: 32px;"],
    ["touch width removed", "css", "min-width: 44px; padding-top: 10px", "padding-top: 10px"],
    ["global button resize", "css", ".ta-btn-sm { padding: 6px 11px; font-size: 12.5px; }", ".ta-btn-sm { padding: 6px 11px; font-size: 12.5px; min-height: 44px; }"],
    ["loading label removed", "panel", '{paymentPending ? "Recording…" : checkingAttempt', '{checkingAttempt'],
    ["stat grid rule removed", "css", ".ta-stat-grid { display: grid;", ".ta-stat-grid-x { display: grid;"],
    ["stat grid single column", "css", "repeat(auto-fit, minmax(min(100%, 220px), 1fr))", "1fr"],
    ["KPI dropped", "opps", '<StatCard label="Stalled" value={stalled}', '<StatCard label="Stuck" value={stalled}'],
  ];
  let killed = 0;
  for (const [name, file, from, to] of mutations) {
    assert.ok(real[file].includes(from), `mutation source not found: ${name}`);
    const mutated = { ...real, [file]: real[file].replace(from, to) };
    if (runAll(mutated).length > 0) { killed++; console.log(`ok - mutation killed: ${name}`); }
    else console.log(`not ok - mutation survived: ${name}`);
  }
  assert.equal(killed, mutations.length, "every mutation must be killed");
  console.log(`\n# closeout02-ui-contract: ${checks.length}/${checks.length} checks, mutations ${killed}/${mutations.length} killed`);
} else {
  console.log(`\n# closeout02-ui-contract: ${checks.length}/${checks.length} checks`);
}
