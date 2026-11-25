import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// M-S6 contract. Static only: no database is contacted.
// 1. The migration keeps app.is_admin() and only adds the Invoices edit module check (no widening), fails closed
//    on an unexpected existing definition, and touches no other policy, table or function.
// 2. Every application writer of public.invoices rows is guarded by Admin + Invoices edit, so RLS matches the app.
const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const raw = read("supabase/migrations/20261122090000_invoices_update_module_authorization.sql");
const sql = raw.replace(/--[^\n]*/g, "");
let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.log(`FAIL ${name}\n  ${(e as Error).message.split("\n")[0]}`); }
}

check("policy keeps app.is_admin() and adds only the Invoices edit check, for USING and WITH CHECK", () => {
  const using = sql.match(/using \(([^;]*?)\)\s*\n\s*with check/)?.[1] ?? "";
  const withCheck = sql.match(/with check \(([^;]*?)\);/)?.[1] ?? "";
  for (const expr of [using, withCheck]) {
    assert.equal(expr.replace(/\s+/g, " ").trim(), "app.is_admin() and (select public.has_module_access_level('invoices', 'edit'))");
  }
});
check("fails closed on any unexpected existing definition and is idempotent", () => {
  assert.match(sql, /if v_qual <> 'app\.is_admin\(\)' or v_check is distinct from 'app\.is_admin\(\)' or v_roles <> '\{public\}' then\s*raise exception/);
  assert.match(sql, /already requires Invoices edit - no change/);
  assert.match(sql, /not found - nothing changed/);
});
check("touches only invoices_update (no other DDL, grants or data changes)", () => {
  assert.deepEqual([...sql.matchAll(/\b(drop|create) policy (\w+)/g)].map((m) => `${m[1]}:${m[2]}`), ["drop:invoices_update", "create:invoices_update"]);
  assert.doesNotMatch(sql, /\b(grant|revoke|alter table|create (or replace )?function|insert into|update public\.|delete from|truncate)\b/i);
});
check("every application writer of invoices rows holds Admin + Invoices edit", () => {
  const files: string[] = [];
  const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) && files.push(p); } };
  walk(new URL("app", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  walk(new URL("lib", root).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  let writers = 0;
  for (const f of files) {
    const t = readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    for (const m of t.matchAll(/\.from\("invoices"\)\s*\.(update|insert|upsert|delete)\(/g)) {
      writers++;
      const fnStart = t.lastIndexOf("export async function", m.index);
      const body = t.slice(fnStart, m.index);
      // RBAC: admin, or Finance Staff (Custom-access editor), with Invoices edit - the same rule as app.can_module in invoices_update.
      assert.match(body, /requireModuleCapability\("invoices", "edit"\)/, `${f}: requireModuleCapability("invoices", "edit")`);
    }
  }
  assert.ok(writers >= 1, "found the invoice draft writer");
});

console.log(`${passed} check(s) passed${failed ? `, ${failed} FAILED` : ""}.`);
if (failed) process.exit(1);
