import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// M-S5 contract (a: privileges, b: finance reads, c: companies writes, d: audit reads, q: quotation invoice summary RPC).
// Static only: no database.
// Each migration keeps the previous expression and only adds a module condition, fails closed on an unexpected
// definition, and its module set matches what the application readers/writers already require.
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const a = strip(read("supabase/migrations/20261122091000_crm_table_privilege_hardening.sql"));
const b = strip(read("supabase/migrations/20261122092000_finance_read_module_authorization.sql"));
const c = strip(read("supabase/migrations/20261122093000_companies_write_module_authorization.sql"));
const d = strip(read("supabase/migrations/20261122094000_audit_logs_read_module_authorization.sql"));
const q = strip(read("supabase/migrations/20261122095000_quotation_invoice_summary_rpc.sql"));
let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n  ${(e as Error).message.split("\n")[0]}`); }
}

const files: string[] = [];
const walk = (dir: string) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n)) files.push(p); } };
for (const d0 of ["app", "lib", "components"]) walk(join(root, d0));
const text = new Map(files.map((f) => [f, readFileSync(f, "utf8").replace(/\r\n/g, "\n")]));
const guards = (t: string) => new Set([...t.matchAll(/(?:requireModuleAccess|hasModuleAccess|requireModuleCapability|hasModuleCapability)\("([a-z_]+)"/g)].map((m) => m[1]));
const readersOf = (table: string) => files.filter((f) => new RegExp(`\\.from\\("${table}"\\)`).test(text.get(f)!));
const usesServiceRole = (t: string) => /createSupabaseServiceClient\(\)/.test(t);
const superAdminOnly = (t: string) => /requireRole\("super_admin"\)/.test(t);

check("M-S5a: fail-closed table list, revokes only client roles, keeps authenticated DML, adjusts postgres defaults", () => {
  assert.match(a, /raise exception 'ms5a: tables not found/);
  assert.match(a, /revoke all on table public\.%I from anon/);
  assert.match(a, /revoke truncate, trigger, references on table public\.%I from authenticated/);
  assert.doesNotMatch(a, /service_role|from postgres/);
  assert.doesNotMatch(a, /revoke (all|select|insert|update|delete)[^;]*from authenticated/);
  assert.match(a, /alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from anon, authenticated/);
  assert.match(a, /server_version_num'\)::int >= 170000/);
  for (const t of ["sales_activity", "sales_lead_metadata", "sales_opportunities", "sales_quotations", "sales_quotation_items", "sales_tasks", "invoices", "invoice_payments", "receipts", "companies", "staff_module_access", "audit_logs"]) {
    assert.match(a, new RegExp(`'${t}'`), t);
  }
});
check("M-S5a: no anon reader of the CRM tables exists in the application", () => {
  for (const f of files) {
    const t = text.get(f)!;
    if (!/createSupabaseBrowserClient|createSupabaseAnonClient/.test(t)) continue;
    for (const table of ["sales_", "invoices", "invoice_payments", "receipts", "companies", "staff_module_access", "audit_logs"]) {
      // Browser clients run with the staff session (authenticated), never anon, inside /admin.
      if (new RegExp(`\\.from\\("${table}`).test(t)) assert.match(relative(root, f).replace(/\\/g, "/"), /^(app\/admin|components\/admin)\//, f);
    }
  }
});

// Owner decision 2026-11-21 (Option B): full finance rows are Invoices-module only.
const finance: Array<[string, string, string[]]> = [
  ["invoices", "invoices_select", ["invoices"]],
  ["invoice_payments", "invoice_payments_select", ["invoices"]],
  ["receipts", "receipts_select", ["invoices"]],
];
check("M-S5b: keeps has_min_role('editor') and adds exactly the reviewed read set, fail-closed", () => {
  assert.match(b, /raise exception 'ms5b: %\.% is not the reviewed definition/);
  assert.match(b, /app\.has_min_role\(''editor''::public\.user_role\) and \(select app\.has_any_module_access\(%L::text\[\], ''view''\)\)/);
  for (const [tbl, pol, mods] of finance) {
    assert.match(b, new RegExp(`\\('${tbl}', '${pol}', array\\[${mods.map((m) => `'${m}'`).join(", ")}\\]\\)`), tbl);
  }
});
check("M-S5b: every application reader of a finance table holds a module of its read set (or is super_admin / service role)", () => {
  for (const [tbl, , mods] of finance) {
    for (const f of readersOf(tbl)) {
      const t = text.get(f)!;
      if (usesServiceRole(t) || superAdminOnly(t)) continue;
      const g = guards(t);
      assert.ok(mods.some((m) => g.has(m)), `${relative(root, f)} reads ${tbl} without ${mods.join("/")}`);
    }
  }
});
check("M-S5b: neither sales_quotations nor hrdf_claims grants full finance rows", () => {
  assert.doesNotMatch(b, /array\[[^\]]*'(sales_quotations|hrdf_claims)'/);
});
check("Summary RPC: SECURITY DEFINER, pinned search_path, editor + Quotations/Invoices view, forbidden otherwise", () => {
  assert.match(q, /create or replace function public\.get_quotation_invoice_summaries\(p_quotation_ids uuid\[\]\)/);
  assert.match(q, /security definer\s+set search_path = public, pg_temp/);
  assert.match(q, /auth\.uid\(\) is null\s+or not app\.has_min_role\('editor'::public\.user_role\)\s+or not app\.has_any_module_access\(array\['sales_quotations', 'invoices'\]::text\[\], 'view'\)/);
  assert.match(q, /raise exception 'forbidden' using errcode = '42501'/);
  assert.match(q, /cardinality\(p_quotation_ids\) > 200/);
  assert.match(q, /raise exception 'ms5q: sales_quotations_select is not the expected M-S4 definition/);
  // Per-quotation authorization equals the gate only while quotation visibility has no row predicate.
  assert.match(q, /p\.qual not like '%auth\.uid\(\)%'/);
  assert.match(q, /p\.cmd in \('SELECT', 'ALL'\)\) <> 1/);
  assert.match(q, /p\.permissive = 'RESTRICTIVE'/);
  const ms4 = read("supabase/migrations/20261121120000_sales_crm_module_rls_hardening.sql");
  const start = ms4.indexOf("create policy sales_quotations_select");
  const pol = ms4.slice(start, ms4.indexOf(");", start));
  assert.ok(start > 0 && pol.length > 0, "M-S4 sales_quotations_select not found");
  assert.doesNotMatch(pol, /auth\.uid\(\)|created_by|assigned_to|owner/);
});
check("Summary RPC: explicit columns only, invoice UUID withheld without Invoices view, payments reduced to status/provider", () => {
  const body = q.slice(q.indexOf("return query"), q.indexOf("$fn$;"));
  assert.doesNotMatch(body, /select \*|\b[a-z]\.\*/);
  assert.match(body, /select i\.quotation_id, case when v_can_open_invoice then i\.id end, i\.invoice_no, i\.status, i\.grand_total, i\.amount_paid, i\.balance_due, i\.invoice_date, i\.due_date,/);
  assert.match(q, /v_can_open_invoice := app\.has_any_module_access\(array\['invoices'\]::text\[\], 'view'\)/);
  assert.match(body, /jsonb_build_object\('status', p\.status, 'payment_provider', p\.payment_provider\)/);
  assert.doesNotMatch(body, /billing|notes|reference|bill_code|receipt|p\.amount|payer/i);
  assert.match(body, /where i\.quotation_id = any \(p_quotation_ids\)/);
});
check("Summary RPC: EXECUTE revoked from public and anon, granted to authenticated only", () => {
  assert.match(q, /revoke all on function public\.get_quotation_invoice_summaries\(uuid\[\]\) from public;/);
  assert.match(q, /revoke all on function public\.get_quotation_invoice_summaries\(uuid\[\]\) from anon;/);
  assert.match(q, /grant execute on function public\.get_quotation_invoice_summaries\(uuid\[\]\) to authenticated;/);
  assert.doesNotMatch(q, /to (anon|public|service_role)\b/);
});
check("Quotation and HRDF pages read no finance table; links to invoices only with Invoices view", () => {
  const list = read("app/admin/(protected)/sales/quotations/page.tsx");
  const detail = read("app/admin/(protected)/sales/quotations/[id]/page.tsx");
  const panel = read("app/admin/(protected)/sales/quotations/[id]/QuotationActionsPanel.tsx");
  const hrdf = read("app/admin/(protected)/hrdf-claims/page.tsx");
  for (const s of [list, detail, panel, hrdf]) assert.doesNotMatch(s, /\.from\("(invoices|invoice_payments|receipts)"\)/);
  assert.match(list, /getQuotationInvoiceSummaries\(supabase, quotationIds\)/);
  assert.match(detail, /getQuotationInvoiceSummaries\(supabase, \[id\]\)/);
  assert.doesNotMatch(detail, /existingInvoice\.id\b|existingInvoice\?\.id\b/);
  assert.match(panel, /\{existingInvoiceId && <Link href=\{`\/admin\/invoices\/\$\{existingInvoiceId\}`\}/);
  assert.match(hrdf, /invoice_number_snapshot/);
  assert.match(hrdf, /const canOpenInvoices = await hasModuleAccess\("invoices"\)/);
  assert.match(hrdf, /\{canOpenInvoices && <Link[^>]*href=\{`\/admin\/invoices\/\$\{claim\.invoice_id\}`\}>Open invoice<\/Link>\}/);
  assert.doesNotMatch(hrdf, /\{invoice \? invoice\.invoice_no : claim\.invoice_id\}/);
  const helper = read("lib/sales/invoice-summary.ts");
  assert.match(helper, /supabase\.rpc\("get_quotation_invoice_summaries", \{ p_quotation_ids: quotationIds \}\)/);
  assert.match(helper, /if \(error\) return \{ data: \[\], error \};/);
});
check("M-S5c: keeps app.is_admin() and adds Companies edit for insert/update/delete; read unchanged", () => {
  for (const pol of ["companies_admin_insert", "companies_admin_update", "companies_admin_delete"]) assert.match(c, new RegExp(`create policy ${pol} on public\\.companies`));
  assert.equal((c.match(/app\.is_admin\(\) and \(select public\.has_module_access_level\('companies', 'edit'\)\)/g) ?? []).length, 4);
  assert.doesNotMatch(c, /companies_staff_read/);
  assert.match(c, /is not the reviewed definition/);
});
check("M-S5c: every application writer of companies holds Admin + Companies edit", () => {
  let writers = 0;
  for (const f of files) {
    const t = text.get(f)!;
    for (const m of t.matchAll(/\.from\("companies"\)\s*\.(insert|update|upsert|delete)\(/g)) {
      writers++;
      const body = t.slice(t.lastIndexOf("export async function", m.index), m.index);
      assert.match(body, /requireRole\("admin"\)/, `${relative(root, f)}: admin`);
      assert.match(body, /requireModuleAccess\("companies", "edit"\)/, `${relative(root, f)}: companies edit`);
    }
  }
  assert.ok(writers >= 4, `found ${writers} companies writers`);
});
check("M-S5d: keeps app.is_admin() and adds the audit-reader module set; every reader holds one", () => {
  assert.match(d, /app\.is_admin\(\) and \(select app\.has_any_module_access\(array\['audit', 'automation', 'backups', 'reports'\]::text\[\], 'view'\)\)/);
  assert.match(d, /is not the reviewed definition/);
  const set = ["audit", "automation", "backups", "reports"];
  for (const f of readersOf("audit_logs")) {
    const t = text.get(f)!;
    if (usesServiceRole(t)) continue;
    assert.ok(set.some((m) => guards(t).has(m)), `${relative(root, f)} reads audit_logs without ${set.join("/")}`);
  }
});
check("M-S5 migrations are ordered after M-S4/M-S4b/M-S6 and none drops a table or column", () => {
  const names = readdirSync(join(root, "supabase/migrations")).filter((n) => n.endsWith(".sql")).sort();
  const at = (n: string) => names.indexOf(n);
  assert.ok(at("20261121130000_sales_finance_rpc_module_authorization.sql") < at("20261122090000_invoices_update_module_authorization.sql"));
  assert.ok(at("20261122090000_invoices_update_module_authorization.sql") < at("20261122091000_crm_table_privilege_hardening.sql"));
  assert.ok(at("20261122094000_audit_logs_read_module_authorization.sql") < at("20261122095000_quotation_invoice_summary_rpc.sql"));
  for (const s of [a, b, c, d, q]) assert.doesNotMatch(s, /drop (table|column)|truncate public|delete from/i);
});

console.log(`${passed} check(s) passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed) process.exit(1);
