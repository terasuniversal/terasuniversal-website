/**
 * Public-First G-2 offline test: the generic, non-mutating ToyyibPay invoice return page.
 *
 * Standalone on purpose -- it imports only app/payments/toyyibpay/return/page.tsx and lib/payments/toyyibpay-return-view.ts
 * (plus the project's own TypeScript and React to render it), so it travels with those two files into a payment-disabled
 * release that does not contain the ToyyibPay R2/R4 modules. Global fetch throws on any request.
 *
 * Run: node --experimental-transform-types scripts/public-first-g2-return.test.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const PAGE = "app/payments/toyyibpay/return/page.tsx";
const VIEW = "lib/payments/toyyibpay-return-view.ts";
const outbound: string[] = [];
globalThis.fetch = (async (input: unknown) => { outbound.push(String(input)); throw new Error("unexpected outbound request"); }) as typeof fetch;

const ts = (await import("typescript")).default;
const { renderToStaticMarkup } = await import("react-dom/server");
const pageSource = readFileSync(path.join(root, PAGE), "utf8");
const viewSource = readFileSync(path.join(root, VIEW), "utf8");
const pageJs = ts.transpileModule(pageSource, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace(/from\s+["']\.\.\/\.\.\/\.\.\/\.\.\/lib\/payments\/toyyibpay-return-view["']/, `from ${JSON.stringify(pathToFileURL(path.join(root, VIEW)).href)}`)
  .replace(/from\s+["']react\/jsx-runtime["']/, `from ${JSON.stringify(pathToFileURL(path.join(root, "node_modules/react/jsx-runtime.js")).href)}`);
const pageModule = await import(`data:text/javascript;base64,${Buffer.from(pageJs).toString("base64")}`);
const ReturnPage = pageModule.default as (props?: unknown) => unknown;
const { GENERIC_RETURN_VIEW } = await import(pathToFileURL(path.join(root, VIEW)).href);

const A = "00000000-0000-4000-8000-000000000001";
const render = (params: Record<string, unknown>) => renderToStaticMarkup(ReturnPage({ searchParams: Promise.resolve(params) }) as never);
const visible = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const EXPECTED = "Your payment status cannot be confirmed on this page. If you have already made a payment, please contact TERAS for assistance. Do not assume that returning to this page confirms payment.";

const results: { id: string; name: string; ok: boolean; note?: string }[] = [];
function scenario(id: string, name: string, fn: () => void) {
  try { fn(); results.push({ id, name, ok: true }); } catch (error) { results.push({ id, name, ok: false, note: (error as Error).message.split("\n")[0] }); process.exitCode = 1; }
}
const baseline = render({});

scenario("G1", "Missing attempt UUID -> the generic page", () => assert.match(visible(baseline), /cannot be confirmed on this page/));
scenario("G2", "Invalid attempt UUID -> identical output", () => { for (const v of ["abc", `${A}' or 1=1`, "", " "]) assert.equal(render({ attempt: v }), baseline); });
scenario("G3", "Unknown attempt UUID -> identical output (existence not revealed)", () => assert.equal(render({ attempt: "11111111-1111-4111-8111-111111111111" }), baseline));
scenario("G4", "Valid-looking UUID (attempt or order_id, arrays) -> identical output", () => { for (const p of [{ attempt: A }, { order_id: A }, { attempt: [A, A] }]) assert.equal(render(p), baseline); });
scenario("G5", "Forged success parameters -> identical output, no success wording", () => {
  assert.equal(render({ attempt: A, status_id: "1", billcode: "forged", msg: "ok", transaction_id: "TP1" }), baseline);
  assert.doesNotMatch(visible(baseline), /success|successful|paid\b|received|verified and/i);
});
scenario("G6", "Forged failure parameters -> identical output, no failure wording", () => {
  assert.equal(render({ attempt: A, status_id: "3", reason: "failed" }), baseline);
  assert.doesNotMatch(visible(baseline), /fail|unsuccessful|declined|cancel/i);
});
scenario("G7", "Repeated GET renders are byte-identical", () => { for (let i = 0; i < 50; i++) assert.equal(render({ attempt: A, status_id: String(i % 4) }), baseline); });
scenario("G8", "No payment-status disclosure: the exact required message, nothing else about status", () => {
  assert.equal(GENERIC_RETURN_VIEW.message, EXPECTED);
  assert.ok(visible(baseline).includes(EXPECTED));
  assert.doesNotMatch(visible(baseline), /pending|being verified|in progress|confirmed\./i);
});
scenario("G9", "No invoice number, amount, attempt id or provider reference in the output", () => {
  const html = render({ attempt: A, order_id: A, refno: "TPX123", amount: "100.00" });
  assert.doesNotMatch(visible(html), /INV-|RM\s?\d|\d+\.\d{2}|TPX|Reference|Invoice\s+[A-Z]*[-\d]/i);
  assert.doesNotMatch(html, new RegExp(A));
});
scenario("G10-G12", "No database, provider or finalisation code reachable from the page (static + runtime)", () => {
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const pageImports = [...code(pageSource).matchAll(/^import .* from ["']([^"']+)["'];?$/gm)].map((m) => m[1]);
  assert.deepEqual(pageImports, ["../../../../lib/payments/toyyibpay-return-view"], "the page imports only the view module");
  assert.equal([...code(viewSource).matchAll(/^import /gm)].length, 0, "the view module imports nothing");
  for (const src of [code(pageSource), code(viewSource)]) assert.doesNotMatch(src, /supabase|\.rpc\(|fetch\(|getBillTransactions|finalize|mark_|transactions\[0\]|searchParams|params|cookies|headers\(|redirect\(/);
  assert.equal(outbound.length, 0);
  assert.equal(Object.keys(pageModule).filter((k) => !["default", "metadata"].includes(k)).length, 0, "no route config, loaders or server actions exported");
  assert.deepEqual(pageModule.metadata.robots, { index: false, follow: false });
});
scenario("G13", "Accessible structure: exactly one <main> landmark and one h1", () => {
  assert.equal((baseline.match(/<main\b/g) ?? []).length, 1);
  assert.equal((baseline.match(/<h1\b/g) ?? []).length, 1);
  assert.match(baseline, /href="\/contact"/);
});
scenario("G14", "Safe generic message regardless of viewport (no viewport-dependent content; browser smoke covers 390/1440)", () => {
  assert.doesNotMatch(code(pageSource), /useEffect|useState|window\.|matchMedia/);
  function code(s: string) { return s.replace(/\/\*[\s\S]*?\*\//g, ""); }
});

for (const r of results) console.log(`${r.ok ? "LULUS" : "GAGAL"} ${r.id} ${r.name}${r.note ? ` -> ${r.note}` : ""}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} lulus${passed === results.length ? "" : ` (${results.length - passed} gagal)`}`);
