import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// M-S5 contract (a: privileges, b: finance reads, c: companies writes, d: audit reads). Static only: no database.
// Each migration keeps the previous expression and only adds a module condition, fails closed on an unexpected
// definition, and its module set matches what the application readers/writers already require.
const root = fileURLToPath(new URL("../", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8").replace(/\r\n/g, "\n");
const strip = (s: string) => s.replace(/--[^\n]*/g, "");
const a = strip(read("supabase/migrations/20261122091000_crm_table_privilege_hardening.sql"));
const b = strip(read("supabase/migrations/20261122092000_finance_read_module_authorization.sql"));
const c = strip(read("supabase/migrations/20261122093000_companies_write_module_authorization.sql"));
const d = strip(read("supabase/migrations/20261122094000_audit_logs_read_module_authorization.sql"));
let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n  ${(e as Error).message.split("\n")[0]}`); }
}

const files: string[] = [];
const walk = (dir: string) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(n)) files.push(p); } };
for (const d0 of ["app", "lib", "components"]) walk(join(root, d0));
const text = new Map(files.map((f) => [f, readFileSync(f, "utf8").replace(/\r\n/g, "\n")]));
const guards = (t: string) => new Set([...t.matchAll(/(?:requireModuleAccess|hasModuleAccess)\("([a-z_]+)"/g)].map((m) => m[1]));
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

const finance: Array<[string, string, string[]]> = [
  ["invoices", "invoices_select", ["invoices", "hrdf_claims", "sales_quotations"]],
  ["invoice_payments", "invoice_payments_select", ["invoices", "sales_quotations"]],
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
  for (const s of [a, b, c, d]) assert.doesNotMatch(s, /drop (table|column)|truncate public|delete from/i);
});

console.log(`${passed} check(s) passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed) process.exit(1);
