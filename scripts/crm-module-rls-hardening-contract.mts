import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, basename, relative, resolve as resolvePath } from "node:path";

// M-S4 contract. Static only: no database is contacted.
// 1. Every new policy keeps its previous expression and only adds a module condition (no widening).
// 2. The module read/write sets in the migration cover every application route that reads/writes each table,
//    re-derived from the application code (requireModuleAccess / hasModuleAccess guards).
// 3. The F4 wrappers check the intended module and the original functions are no longer client-callable.
// Usage: node --experimental-strip-types crm-module-rls-hardening-contract.mts <migration.sql> <app-repo-root>

const [migrationPath, repoRootArg] = process.argv.slice(2);
const repoRoot = repoRootArg ? resolvePath(repoRootArg) : repoRootArg;
if (!migrationPath || !repoRoot) throw new Error("usage: <migration.sql> <app-repo-root>");
const raw = readFileSync(migrationPath, "utf8").replace(/\r\n/g, "\n");
const sql = raw.replace(/--[^\n]*/g, "");

let failures = 0;
let passed = 0;
const notes: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}\n  ${(error as Error).message}`);
  }
}
const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim().toLowerCase();

// ---- Parse policies ----------------------------------------------------------------------------------------------
type Policy = { name: string; table: string; cmd: string; using: string; check: string };
const policies = new Map<string, Policy>();
for (const m of sql.matchAll(/create policy (\w+) on public\.(\w+)\s+for (select|insert|update|delete) to (\w+)([\s\S]*?);/g)) {
  const body = m[5];
  const using = body.match(/using\s*\(([\s\S]*?)\)\s*(with check|$)/)?.[1] ?? "";
  const chk = body.match(/with check\s*\(([\s\S]*)\)\s*$/)?.[1] ?? "";
  assert.equal(m[4], "authenticated", `${m[1]} must target authenticated`);
  policies.set(m[1], { name: m[1], table: m[2], cmd: m[3], using: norm(using), check: norm(chk) });
}
function modulesOf(expr: string, level: "view" | "edit"): string[] {
  const out = new Set<string>();
  for (const m of expr.matchAll(/has_any_module_access\(array\[([^\]]*)\]::text\[\], '(view|edit)'\)/g)) {
    if (m[2] === level) for (const k of m[1].matchAll(/'([a-z_]+)'/g)) out.add(k[1]);
  }
  for (const m of expr.matchAll(/has_module_access_level\('([a-z_]+)', '(view|edit)'\)/g)) if (m[2] === level) out.add(m[1]);
  return [...out].sort();
}

// ---- 1. Previous expressions are preserved -----------------------------------------------------------------------
const previous: Record<string, { using?: string[]; check?: string[] }> = {
  sales_lead_metadata_select: { using: ["app.has_min_role('editor'::public.user_role)"] },
  sales_lead_metadata_update: { using: ["app.is_admin()"], check: ["app.is_admin()"] },
  sales_opportunities_select: { using: ["app.has_min_role('editor'::public.user_role)"] },
  sales_opportunities_insert: { check: ["app.is_admin()", "stage <> all (array['won'::text, 'cancelled'::text])"] },
  sales_opportunities_update: {
    using: ["app.is_admin()", "stage <> all (array['won'::text, 'cancelled'::text])"],
    check: ["app.is_admin()", "stage <> all (array['won'::text, 'cancelled'::text])"],
  },
  sales_quotations_select: { using: ["app.has_min_role('editor'::public.user_role)"] },
  sales_quotations_insert: { check: ["app.is_admin()", "status <> all (array['accepted'::text, 'cancelled'::text])"] },
  sales_quotations_update: {
    using: ["app.is_admin()", "status <> all (array['accepted'::text, 'cancelled'::text])"],
    check: ["app.is_admin()", "status <> all (array['accepted'::text, 'cancelled'::text])"],
  },
  sales_tasks_select: { using: ["app.has_min_role('editor'::public.user_role)"] },
  sales_tasks_insert: { check: ["app.has_min_role('editor'::public.user_role)"] },
  sales_tasks_update: {
    using: ["(app.is_admin() or assigned_to = auth.uid() or created_by = auth.uid())"],
    check: ["(app.is_admin() or assigned_to = auth.uid() or created_by = auth.uid())"],
  },
  sales_tasks_delete: { using: ["app.is_admin()"] },
  sales_activity_select: { using: ["app.has_min_role('editor'::public.user_role)"] },
  sales_lead_attributions_select: { using: ["app.has_min_role('editor'::public.user_role)"] },
};
check("exactly the 14 expected policies are re-created", () => {
  assert.deepEqual([...policies.keys()].sort(), Object.keys(previous).sort());
});
for (const [name, prev] of Object.entries(previous)) {
  check(`${name}: previous expression kept and a module condition added`, () => {
    const p = policies.get(name);
    assert.ok(p, "policy missing");
    for (const part of ["using", "check"] as const) {
      for (const frag of prev[part] ?? []) assert.ok(p[part].includes(norm(frag)), `${part} lost: ${frag}`);
      if (prev[part]) assert.ok(/has_(any_)?module_access(_level)?\(/.test(p[part]), `${part} has no module condition`);
      if (prev[part]) assert.ok(p[part].includes(" and "), `${part} must AND the module condition`);
    }
    assert.ok(!/\bor\s+\(select (public\.has_module|app\.has_any)/.test(p.using + p.check), "module condition must not be OR-ed");
  });
}
check("every replaced policy is asserted in the fail-closed precondition block", () => {
  const pre = raw.slice(0, raw.indexOf("create or replace function app.has_any_module_access"));
  for (const name of Object.keys(previous)) assert.ok(pre.includes(`'${name}'`), name);
  assert.ok(/raise exception 'ms4_precondition_failed/.test(pre));
});
check("no permissive shortcuts", () => {
  assert.ok(!/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i.test(sql));
  assert.ok(!/\bto\s+anon\b/i.test(sql.replace(/from public, anon[^;]*;/g, "")));
  assert.ok(!/grant[^;]*\bto\s+(anon|public)\b/i.test(sql));
});
check("has_any_module_access is invoker with an empty search_path", () => {
  const fn = sql.match(/create or replace function app\.has_any_module_access[\s\S]*?\$\$;/)?.[0] ?? "";
  assert.ok(/security invoker/.test(fn) && /set search_path = ''/.test(fn) && /public\.has_module_access_level\(m, p_level\)/.test(fn));
});

// ---- 2. Module sets cover the application --------------------------------------------------------------------------
const readSet = (table: string) => modulesOf(policies.get(`${table}_select`)!.using, "view");
const writeSets: Record<string, string[]> = {
  sales_tasks: modulesOf(policies.get("sales_tasks_insert")!.check, "edit"),
  sales_opportunities: modulesOf(policies.get("sales_opportunities_update")!.using, "edit"),
  sales_quotations: modulesOf(policies.get("sales_quotations_update")!.using, "edit"),
  sales_lead_metadata: modulesOf(policies.get("sales_lead_metadata_update")!.using, "edit"),
};
check("write sets are the intended modules", () => {
  assert.deepEqual(writeSets.sales_tasks, ["sales_tasks"]);
  assert.deepEqual(writeSets.sales_opportunities, ["sales_opportunities", "sales_quotations"]);
  assert.deepEqual(writeSets.sales_quotations, ["sales_quotations"]);
  assert.deepEqual(writeSets.sales_lead_metadata, ["sales_leads"]);
  assert.deepEqual(modulesOf(policies.get("sales_opportunities_insert")!.check, "edit"), ["sales_opportunities"]);
  assert.deepEqual(modulesOf(policies.get("sales_quotations_insert")!.check, "edit"), ["sales_quotations"]);
  assert.deepEqual(modulesOf(policies.get("sales_tasks_update")!.using, "edit"), ["sales_tasks"]);
  assert.deepEqual(modulesOf(policies.get("sales_tasks_delete")!.using, "edit"), ["sales_tasks"]);
});
check("every module key used is in the precondition catalog list", () => {
  const listed = new Set([...raw.matchAll(/unnest\(array\[([\s\S]*?)\]\) k/g)].flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])));
  const used = new Set([...policies.values()].flatMap((p) => [...modulesOf(p.using + " " + p.check, "view"), ...modulesOf(p.using + " " + p.check, "edit")]));
  for (const k of ["sales_leads", "marketing_contacts"]) used.add(k);
  for (const k of used) assert.ok(listed.has(k), k);
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== "node_modules" && !name.startsWith(".")) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const files = [...walk(join(repoRoot, "app")), ...walk(join(repoRoot, "lib")), ...walk(join(repoRoot, "components"))];
const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
const IGNORE = /lib[\\/](validation[\\/]schemas|supabase[\\/]database\.types|admin-nav|auth[\\/]rbac)\.ts$/;
type Guard = { module: string; level: string };
function guardsIn(f: string): Guard[] {
  const out: Guard[] = [];
  const t = text.get(f) ?? (existsSync(f) ? readFileSync(f, "utf8") : "");
  for (const m of t.matchAll(/(?:requireModuleAccess|hasModuleAccess)\(\s*"([a-z_]+)"(?:\s*,\s*"([a-z]+)")?/g)) out.push({ module: m[1], level: m[2] ?? "view" });
  return out;
}
function routeGuards(f: string): Guard[] {
  const d = dirname(f);
  return [...guardsIn(f), ...guardsIn(join(d, "page.tsx")), ...guardsIn(join(d, "layout.tsx"))];
}
const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
// A real reference is a query on the relation: from("x"), or an embedded relation inside a select string (x( / x!).
function queriesRelation(t: string, names: string[]): boolean {
  const code = stripComments(t);
  return names.some((n) => new RegExp(`from\\("${n}"\\)|["'\`,\\s]${n}(\\(|!)`).test(code));
}
// Exported functions of a library file that query one of the relations.
function queryingExports(t: string, names: string[]): string[] {
  const code = stripComments(t);
  const parts = code.split(/\n(?=export )/);
  return parts.filter((p) => queriesRelation(p, names)).map((p) => p.match(/^export (?:async )?(?:function|const) (\w+)/)?.[1]).filter(Boolean) as string[];
}
// Library files carry no guard: use the guards of the application files that import a querying function (one level).
function effectiveGuards(f: string, names: string[]): Guard[][] {
  const own = routeGuards(f);
  if (own.length) return [own];
  const spec = relative(repoRoot, f).replace(/\\/g, "/").replace(/\.(ts|tsx)$/, "").replace(/^lib\//, "lib/");
  const fns = queryingExports(text.get(f)!, names);
  const importers = files.filter((g) => {
    if (g === f || !/[\\/]app[\\/]/.test(g)) return false;
    const t = text.get(g)!;
    for (const m of t.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']([^"']+)["']/g)) {
      if (m[1] || !m[3].endsWith(spec.split("/").slice(-2).join("/"))) continue;
      const imported = m[2].split(",").map((s) => s.replace(/^\s*type\s+/, "").trim().split(/\s+as\s+/)[0]);
      if (imported.some((i) => fns.includes(i))) return true;
    }
    return false;
  });
  return importers.map(routeGuards).filter((g) => g.length);
}
const VIEW_ALIASES: Record<string, string> = { v_sales_lead_inbox: "sales_lead_metadata" };
const unresolved: string[] = [];
for (const table of ["sales_lead_metadata", "sales_opportunities", "sales_quotations", "sales_tasks", "sales_activity", "sales_lead_attributions"]) {
  const allowed = new Set(readSet(table));
  const names = [table, ...Object.entries(VIEW_ALIASES).filter(([, t]) => t === table).map(([v]) => v)];
  for (const f of files) {
    if (IGNORE.test(f)) continue;
    const t = text.get(f)!;
    if (!queriesRelation(t, names)) continue;
    const sets = effectiveGuards(f, names);
    const rel = relative(repoRoot, f);
    if (!sets.length) { unresolved.push(`${table}: ${rel}`); continue; }
    check(`read set of ${table} covers ${rel}`, () => {
      for (const guards of sets) {
        const mods = guards.map((g) => g.module);
        if (mods.includes("system") || mods.includes("users")) continue;
        assert.ok(mods.some((m) => allowed.has(m)), `guards [${[...new Set(mods)].join(", ")}] not in read set [${[...allowed].join(", ")}]`);
      }
    });
  }
}
for (const [table, allowedList] of Object.entries(writeSets)) {
  const allowed = new Set(allowedList);
  for (const f of files) {
    if (IGNORE.test(f)) continue;
    const t = text.get(f)!;
    const writes = [...t.matchAll(new RegExp(`from\\("${table}"\\)[\\s\\S]{0,160}?\\.(insert|update|upsert|delete)\\(`, "g"))]
      .filter((m) => !/from\("/.test(m[0].slice(8 + table.length)));
    if (!writes.length) continue;
    const rel = relative(repoRoot, f);
    check(`write set of ${table} covers ${rel}`, () => {
      const sets = effectiveGuards(f, [table]);
      assert.ok(sets.length, "writer has no module guard");
      for (const guards of sets) {
        assert.ok(guards.some((g) => g.level === "edit" && allowed.has(g.module)),
          `edit guards [${guards.filter((g) => g.level === "edit").map((g) => g.module).join(", ")}] not in write set [${allowedList.join(", ")}]`);
      }
    });
  }
}

// ---- 3. F4 wrappers ------------------------------------------------------------------------------------------------
const wrappers: Record<string, { sig: string; module: string; args: string }> = {
  create_internal_sales_lead: { sig: "text, text, text, text, text, text, text, uuid, text", module: "sales_leads", args: "p_contact_name, p_email, p_phone, p_company_name, p_course_interest, p_notes, p_source_channel, p_campaign_id, p_attribution_notes" },
  promote_marketing_contact_to_sales: { sig: "uuid", module: "marketing_contacts", args: "p_contact_id" },
};
for (const [fn, w] of Object.entries(wrappers)) {
  check(`${fn}: original renamed, revoked from every client role, wrapper checks ${w.module} edit first`, () => {
    assert.ok(sql.includes(`alter function public.${fn}(${w.sig})`) && sql.includes(`rename to ${fn}_unguarded`));
    assert.ok(new RegExp(`revoke all on function public\\.${fn}_unguarded\\(${w.sig.replace(/[(),]/g, "\\$&")}\\)\\s+from public, anon, authenticated, service_role;`).test(sql));
    const body = sql.match(new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\$\\$;`))?.[0] ?? "";
    assert.ok(/security definer/.test(body) && /set search_path = ''/.test(body));
    const guardAt = body.indexOf(`public.has_module_access_level('${w.module}', 'edit')`);
    const callAt = body.indexOf(`public.${fn}_unguarded(`);
    assert.ok(guardAt > 0 && callAt > guardAt, "module check must precede the call");
    assert.ok(/raise exception 'forbidden' using errcode = '42501'/.test(body));
    assert.equal(norm(body.slice(callAt + `public.${fn}_unguarded(`.length, body.indexOf(")", callAt))), norm(w.args));
    assert.ok(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated;`).test(sql));
  });
}
check("promote keeps the locked decision: marketing_contacts edit only, not sales_leads", () => {
  const body = sql.match(/create or replace function public\.promote_marketing_contact_to_sales\([\s\S]*?\$\$;/)?.[0] ?? "";
  assert.ok(!body.includes("sales_leads"));
});
check("application callers already hold the module the wrappers require", () => {
  const leads = readFileSync(join(repoRoot, "app/admin/(protected)/sales/leads/actions.ts"), "utf8");
  const mk = readFileSync(join(repoRoot, "app/admin/(protected)/marketing/contacts/actions.ts"), "utf8");
  const before = (t: string, rpc: string) => t.slice(Math.max(0, t.indexOf(`rpc("${rpc}"`) - 900), t.indexOf(`rpc("${rpc}"`));
  assert.ok(/requireModuleAccess\("sales_leads", "edit"\)/.test(before(leads, "create_internal_sales_lead")));
  assert.ok(/requireModuleAccess\("marketing_contacts", "edit"\)/.test(before(mk, "promote_marketing_contact_to_sales")));
});

if (unresolved.length) notes.push(`files referencing a table with no resolvable guard (review manually): ${unresolved.length}`, ...unresolved.map((u) => `  ${u}`));
for (const n of notes) console.log(`NOTE ${n}`);
console.log(failures ? `${failures} check(s) FAILED, ${passed} passed.` : `${passed} check(s) passed.`);
process.exit(failures ? 1 : 0);
