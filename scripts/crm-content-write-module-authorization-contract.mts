import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";

// R1 contract. Static only: no database is contacted.
// 1. The migration's fail-closed preflight lists exactly the 30 captured pre-R1 policies (manifest), verbatim.
// 2. Every replacement keeps the previous expression and only adds the module "edit" condition (or super_admin for cms_*).
// 3. FOR ALL policies are split; their SELECT rule is the previous USING verbatim; nothing else is dropped.
// 4. No grants, functions, tables or non-targeted policies are touched.
// 5. The rollback re-creates the 30 originals verbatim and drops every R1 policy name.
// 6. Each table's module matches the module guarding the application code that writes it.
// 7. A synthetic persona matrix (super_admin / role-default / Custom view-only / Custom edit / trainer / inactive)
//    evaluates the new write rule with the live helper semantics captured on 2026-11-22.
// Usage: node --experimental-strip-types scripts/crm-content-write-module-authorization-contract.mts [repo-root]

const repoRoot = resolvePath(process.argv[2] ?? ".");
const read = (p: string) => readFileSync(join(repoRoot, p), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261126120000_crm_content_write_module_authorization.sql";
const ROLLBACK = "docs/security/crm-rls-r1/20261126120000_crm_content_write_module_authorization.rollback.sql";
const MANIFEST = "docs/security/crm-rls-r1/r1-original-policy-manifest.json";

type Target = { table: string; policy: string; cmd: string; roles: string[]; using: string | null; check: string | null; module: string };
const manifest = JSON.parse(read(MANIFEST)) as { targeted: Target[] };
const targets = manifest.targeted;
const migrationRaw = read(MIGRATION);
const migration = migrationRaw.replace(/--[^\n]*/g, "");
const rollback = read(ROLLBACK).replace(/--[^\n]*/g, "");

let passed = 0;
let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}\n  ${(error as Error).message}`);
  }
}

// Canonical form: lower case, single spaces, "( SELECT f() AS x)" and "(select f())" -> "f()", schema-qualified
// helper names and types unqualified, outer parentheses removed.
function canon(expr: string | null | undefined): string {
  if (!expr) return "";
  let s = expr.toLowerCase().replace(/\s+/g, " ").trim();
  s = s.replace(/::public\.user_role/g, "::user_role").replace(/public\.has_module_access_level/g, "has_module_access_level");
  s = s.replace(/'(\w+)'::text/g, "'$1'");
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\(\s*select ([a-z_.]+\([^()]*\)) as \w+\s*\)/g, "$1").replace(/\(\s*select ([a-z_.]+\([^()]*\))\s*\)/g, "$1");
  }
  s = s.replace(/\(\s*/g, "(").replace(/\s*\)/g, ")");
  while (s.startsWith("(") && s.endsWith(")") && balanced(s.slice(1, -1))) s = s.slice(1, -1).trim();
  return s;
}
function balanced(s: string) {
  let d = 0;
  for (const c of s) {
    if (c === "(") d++;
    if (c === ")") d--;
    if (d < 0) return false;
  }
  return d === 0;
}
const conjuncts = (expr: string) => canon(expr).split(/ and /).map((p) => canon(p));

type Created = { name: string; table: string; cmd: string; role: string; using: string; check: string };
function parseCreates(sql: string): Map<string, Created> {
  const out = new Map<string, Created>();
  for (const m of sql.matchAll(/create policy (\w+) on public\.(\w+)\s+for (select|insert|update|delete|all) to (\w+)([\s\S]*?);/g)) {
    const body = m[5];
    const using = body.match(/using\s*\(([\s\S]*?)\)\s*(?=with check|$)/)?.[1] ?? "";
    const chk = body.match(/with check\s*\(([\s\S]*)\)\s*$/)?.[1] ?? "";
    out.set(m[1], { name: m[1], table: m[2], cmd: m[3].toUpperCase(), role: m[4], using, check: chk });
  }
  return out;
}
const created = parseCreates(migration);
const moduleCond = (mod: string) => (mod === "super_admin" ? "app.is_super_admin()" : `has_module_access_level('${mod}', 'edit')`);
const splitNames = (t: Target) => {
  const base = t.policy.replace(/_all$/, "");
  return { select: `${base}_select`, insert: `${base}_insert`, update: `${base}_update`, delete: `${base}_delete` };
};

// ---- 1. Preflight == manifest ----------------------------------------------------------------------------------------
check("manifest has 30 targeted policies on 19 tables", () => {
  assert.equal(targets.length, 30);
  assert.equal(new Set(targets.map((t) => t.table)).size, 19);
});
check("preflight lists every captured policy verbatim (cmd, role, USING, WITH CHECK)", () => {
  const rows = [...migrationRaw.matchAll(/\('(\w+)', '(\w+)', '(ALL|INSERT|UPDATE|DELETE)', '(\w+)', (null(?:::text)?|\$q\$[\s\S]*?\$q\$), (null|\$q\$[\s\S]*?\$q\$)\)/g)];
  assert.equal(rows.length, 30, "30 preflight rows");
  const unq = (v: string) => (v.startsWith("null") ? null : v.slice(3, -3));
  for (const t of targets) {
    const row = rows.find((r) => r[2] === t.policy);
    assert.ok(row, `${t.policy} missing from preflight`);
    assert.equal(row![1], t.table);
    assert.equal(row![3], t.cmd);
    assert.equal(row![4], t.roles[0]);
    assert.equal(unq(row![5]), t.using, `${t.policy} USING`);
    assert.equal(unq(row![6]), t.check, `${t.policy} WITH CHECK`);
  }
  assert.match(migrationRaw, /raise exception 'r1_precondition_failed/);
});

// ---- 2./3. Replacements -------------------------------------------------------------------------------------------
for (const t of targets) {
  check(`${t.policy}: replacement keeps the previous rule and adds ${t.module}`, () => {
    const prev = canon(t.check ?? t.using);
    if (t.cmd === "ALL") {
      const n = splitNames(t);
      const sel = created.get(n.select);
      assert.ok(sel && sel.cmd === "SELECT" && sel.table === t.table, `${n.select} SELECT`);
      assert.equal(sel!.role, t.roles[0]);
      assert.equal(canon(sel!.using), canon(t.using), "SELECT rule unchanged");
      assert.equal(sel!.check, "", "SELECT has no WITH CHECK");
      for (const cmd of ["insert", "update", "delete"] as const) {
        const p = created.get(n[cmd]);
        assert.ok(p && p.cmd === cmd.toUpperCase() && p.table === t.table, `${n[cmd]} ${cmd}`);
        assert.equal(p!.role, t.roles[0]);
        for (const expr of [p!.using, p!.check].filter((e) => e !== "")) {
          const parts = conjuncts(expr);
          assert.ok(parts.includes(prev), `${n[cmd]} keeps ${prev}: ${parts.join(" & ")}`);
          assert.ok(parts.includes(canon(moduleCond(t.module))), `${n[cmd]} adds ${t.module}`);
          assert.equal(parts.length, 2, `${n[cmd]} has exactly two conditions`);
        }
        if (cmd === "insert") assert.equal(p!.using, "");
        if (cmd === "delete") assert.equal(p!.check, "");
        if (cmd === "update") assert.ok(p!.using && p!.check);
      }
    } else {
      const p = created.get(t.policy);
      assert.ok(p, `${t.policy} re-created`);
      assert.equal(p!.cmd, t.cmd);
      assert.equal(p!.table, t.table);
      assert.equal(p!.role, t.roles[0], "roles unchanged");
      for (const [label, before, after] of [["USING", t.using, p!.using], ["WITH CHECK", t.check, p!.check]] as const) {
        if (before === null) {
          assert.equal(after, "", `${label} stays absent`);
          continue;
        }
        const parts = conjuncts(after);
        assert.ok(parts.includes(canon(before)), `${label} keeps ${canon(before)}: ${parts.join(" & ")}`);
        assert.ok(parts.includes(canon(moduleCond(t.module))), `${label} adds ${t.module}`);
        assert.equal(parts.length, 2, `${label} exactly two conditions`);
      }
    }
  });
}

check("drop policy statements touch only the 30 targeted policies", () => {
  const drops = [...migration.matchAll(/drop policy if exists (\w+) on public\.(\w+)/g)].map((m) => `${m[2]}.${m[1]}`);
  assert.deepEqual(new Set(drops), new Set(targets.map((t) => `${t.table}.${t.policy}`)));
  assert.equal(drops.length, 30);
});
check("every created policy belongs to a targeted table and to the expected name set", () => {
  const expected = new Set<string>();
  for (const t of targets) {
    if (t.cmd === "ALL") Object.values(splitNames(t)).forEach((n) => expected.add(n));
    else expected.add(t.policy);
  }
  assert.deepEqual(new Set(created.keys()), expected);
  assert.equal(created.size, 24 + 24);
  assert.ok([...created.values()].every((p) => p.cmd !== "ALL"), "no FOR ALL policy created");
});
check("no grant, revoke, function, table, trigger, role or data change in R1", () => {
  assert.doesNotMatch(migration, /\b(grant|revoke)\b/i);
  assert.doesNotMatch(migration, /create (or replace )?function|alter (table|function|role)|create (table|trigger|role)|security definer/i);
  assert.doesNotMatch(migration, /\b(insert into|update public\.|delete from|truncate)\b/i);
  assert.doesNotMatch(migration, /public_registration|i3e_certificate_executor/);
  const touched = [...migration.matchAll(/(?:drop|create) policy (?:if exists )?(\w+)/g)].map((m) => m[1]);
  for (const name of touched) assert.doesNotMatch(name, /_admin_delete$|^courses_delete$|^courses_select$|_public_read$|_editor_read$/, name);
});
check("postconditions: untouched policies unchanged, no FOR ALL left, no role-only writes left", () => {
  assert.match(migrationRaw, /r1_untouched_before/);
  assert.match(migrationRaw, /r1_postcondition_failed: % non-targeted policy\(ies\) changed/);
  assert.match(migrationRaw, /r1_postcondition_failed: % FOR ALL policy\(ies\) remain/);
  assert.match(migrationRaw, /r1_postcondition_failed: % role-only write policy\(ies\) remain/);
});
check("public published-content read policies are not referenced", () => {
  for (const name of ["downloads_public_read", "faqs_public_read", "gallery_images_public_read", "media_public_read", "news_posts_public_read", "company_profile_public_read"]) {
    assert.ok(!migration.includes(name), name);
  }
});

// ---- 5. Rollback -------------------------------------------------------------------------------------------------------
check("rollback re-creates the 30 originals verbatim and drops every R1 name", () => {
  const rb = parseCreates(rollback);
  assert.equal(rb.size, 30);
  for (const t of targets) {
    const p = rb.get(t.policy);
    assert.ok(p, `${t.policy} re-created by rollback`);
    assert.equal(p!.cmd, t.cmd);
    assert.equal(p!.table, t.table);
    assert.equal(p!.role, t.roles[0]);
    assert.equal(canon(p!.using), canon(t.using), `${t.policy} USING`);
    assert.equal(canon(p!.check), canon(t.check), `${t.policy} WITH CHECK`);
  }
  const drops = new Set([...rollback.matchAll(/drop policy if exists (\w+) on public\.(\w+)/g)].map((m) => m[1]));
  for (const name of created.keys()) assert.ok(drops.has(name), `rollback drops ${name}`);
  assert.doesNotMatch(rollback, /^\s*(begin|commit)\s*;/im);
  assert.match(rollback, /A1 is applied - roll back A1 first/);
  assert.match(rollback, /r1_rollback_precondition_failed/);
});

// ---- 6. Module mapping matches the application -----------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(repoRoot, dir))) {
    const rel = join(dir, e);
    if (e === "node_modules" || e.startsWith(".")) continue;
    if (statSync(join(repoRoot, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(e)) out.push(rel);
  }
  return out;
}
const sources = ["app", "lib", "components"].flatMap((d) => walk(d)).map((f) => ({ f, src: read(f) }));
const expectedWriters: Record<string, string> = {};
for (const t of targets) expectedWriters[t.table] = t.module;
check("module catalog (lib/auth/rbac.ts) knows every R1 module", () => {
  const rbac = read("lib/auth/rbac.ts");
  for (const mod of new Set(targets.map((t) => t.module).filter((m) => m !== "super_admin"))) {
    assert.ok(rbac.includes(`key: "${mod}"`) || rbac.includes(`["${mod}", `), `${mod} in MODULE_CATALOG`);
  }
});
const appWriters: Array<{ table: string; file: string; ok: boolean; guards: string[] }> = [];
for (const [table, mod] of Object.entries(expectedWriters)) {
  for (const { f, src } of sources) {
    const writes = new RegExp(`from\\("${table}"\\)[\\s\\S]{0,120}?\\.(insert|update|upsert|delete)\\(`).test(src);
    if (!writes) continue;
    const guards = [...src.matchAll(/requireModuleAccess\("([a-z_]+)"(?:, "(view|edit|admin)")?\)/g)].map((m) => `${m[1]}:${m[2] ?? "view"}`);
    appWriters.push({ table, file: f, ok: mod !== "super_admin" && guards.some((g) => g.startsWith(`${mod}:`)), guards });
  }
}
check("every application writer of an R1 table is guarded by the same module R1 enforces", () => {
  const known = new Set(["app/api/admin/certificates/route.js"]); // legacy certificate import (has_module_access_level('certificates')): documented R1 impact
  const bad = appWriters.filter((w) => !w.ok && !known.has(w.file.replace(/\\/g, "/")));
  assert.deepEqual(bad, [], JSON.stringify(bad));
  assert.ok(!appWriters.some((w) => w.table === "cms_content" || w.table === "cms_media"), "cms_* have no application writer");
  assert.ok(!appWriters.some((w) => w.table === "proposal_requests"), "proposal_requests has no application writer");
});

// ---- 7. Synthetic persona matrix ---------------------------------------------------------------------------------------
// Helper semantics captured read-only on 2026-11-22 (Staging = Production):
//   has_module_access_level(m, l): inactive -> false; module not accessible -> false; super_admin -> true;
//     access_control_enabled = false -> true (catalog min_role decides access); Custom -> rank(grant) >= rank(l).
//   has_module_access(m): Role Default -> catalog.min_role <= role; Custom -> explicit grant row exists.
//   is_editor()/has_min_role('editor') -> active and role in (super_admin, admin, editor).  is_super_admin -> active super_admin.
type Persona = { name: string; role: "super_admin" | "admin" | "editor" | "trainer"; active: boolean; custom: boolean; grants: Record<string, "view" | "edit" | "admin"> };
const rank = { none: 0, view: 1, edit: 2, admin: 3 } as const;
const ROLE_ORDER = ["super_admin", "admin", "editor", "trainer"] as const;
const minRoleOf = (m: string) => (["company", "courses", "downloads", "faq", "gallery", "media", "news", "marketing_campaigns", "marketing_contacts", "feedback_issues", "feedback_actions", "sales_leads"].includes(m) ? "editor" : "admin");
const atLeast = (role: string, min: string) => ROLE_ORDER.indexOf(role as never) <= ROLE_ORDER.indexOf(min as never);
function hml(p: Persona, m: string, l: "view" | "edit") {
  if (!p.active) return false;
  const access = p.role === "super_admin" || (!p.custom ? atLeast(p.role, minRoleOf(m)) : m in p.grants);
  if (!access) return false;
  if (p.role === "super_admin" || !p.custom) return true;
  return rank[p.grants[m] ?? "none"] >= rank[l];
}
const isEditor = (p: Persona) => p.active && atLeast(p.role, "editor");
const canWrite = (p: Persona, t: Target) => isEditor(p) && (t.module === "super_admin" ? p.active && p.role === "super_admin" : hml(p, t.module, "edit"));
const canWriteBefore = (p: Persona) => isEditor(p);
const salesViewGrants = Object.fromEntries(["sales", "sales_leads", "sales_opportunities", "sales_quotations", "invoices", "hrdf_claims", "sales_followups", "sales_tasks", "sales_reports"].map((k) => [k, "view" as const]));
const personas: Persona[] = [
  { name: "super_admin", role: "super_admin", active: true, custom: false, grants: {} },
  { name: "admin role-default", role: "admin", active: true, custom: false, grants: {} },
  { name: "editor role-default", role: "editor", active: true, custom: false, grants: {} },
  { name: "admin custom sales-only (Production pattern)", role: "admin", active: true, custom: true, grants: { sales: "view", sales_leads: "edit" } },
  { name: "editor custom Sales view-only (UAT 151d54b3)", role: "editor", active: true, custom: true, grants: salesViewGrants },
  { name: "editor custom news edit", role: "editor", active: true, custom: true, grants: { news: "edit", faq: "view" } },
  { name: "trainer", role: "trainer", active: true, custom: false, grants: {} },
  { name: "inactive editor", role: "editor", active: false, custom: false, grants: {} },
];
check("persona matrix: no persona gains write access (R1 only narrows)", () => {
  for (const p of personas) for (const t of targets) if (canWrite(p, t)) assert.ok(canWriteBefore(p), `${p.name} ${t.policy} widened`);
});
check("persona matrix: super_admin and role-default editors/admins keep every write they had (except cms_* for non-super)", () => {
  for (const p of personas.slice(0, 3)) {
    for (const t of targets) {
      if (t.module === "super_admin" && p.role !== "super_admin") assert.equal(canWrite(p, t), false);
      else assert.equal(canWrite(p, t), true, `${p.name} ${t.policy}`);
    }
  }
});
check("persona matrix: Custom view-only Sales editor loses every R1 write; proposal_requests needs sales_leads edit", () => {
  const p = personas[4];
  for (const t of targets) assert.equal(canWrite(p, t), false, t.policy);
  const admin = personas[3];
  for (const t of targets) assert.equal(canWrite(admin, t), t.module === "sales_leads", `${admin.name} ${t.policy}`);
});
check("persona matrix: Custom news:edit editor can write news only; faq:view cannot write faq", () => {
  const p = personas[5];
  for (const t of targets) assert.equal(canWrite(p, t), t.module === "news", t.policy);
});
check("persona matrix: trainer and inactive users write nothing (unchanged)", () => {
  for (const p of personas.slice(6)) for (const t of targets) assert.equal(canWrite(p, t), false, `${p.name} ${t.policy}`);
});

console.log(`R1 application writers checked: ${appWriters.length} (${appWriters.map((w) => `${w.table}<-${w.file.replace(/\\/g, "/").split("/").slice(-3).join("/")}`).join(", ")})`);
console.log(`${passed} check(s) passed.`);
if (failures) {
  console.error(`${failures} check(s) FAILED.`);
  process.exit(1);
}
