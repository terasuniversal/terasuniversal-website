import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve as resolvePath } from "node:path";

// M-S4b contract. Static only: no database is contacted.
// 1. Each of the nine RPCs keeps its original (renamed *_unguarded, no client EXECUTE) and gets a same-signature
//    SECURITY DEFINER wrapper whose module requirement equals EXACTLY the edit guards of its calling Server Action,
//    and which raises the original's own authorization error before calling it.
// 2. The three tables' policies keep their previous expression, add only a module condition, and use the read set
//    that M-S4 gave the table they belong to (quotations for items; lead metadata for the inbox-joined tables).
// 3. Application readers/writers of the three tables hold a module in the corresponding set.
// Usage: node --experimental-strip-types <this> <ms4b.sql> <ms4.sql> <app-repo-root>

const [ms4bPath, ms4Path, repoRootArg] = process.argv.slice(2);
const repoRoot = repoRootArg ? resolvePath(repoRootArg) : repoRootArg;
if (!ms4bPath || !ms4Path || !repoRoot) throw new Error("usage: <ms4b.sql> <ms4.sql> <app-repo-root>");
const strip = (s: string) => s.replace(/\r\n/g, "\n").replace(/--[^\n]*/g, "");
const raw = readFileSync(ms4bPath, "utf8").replace(/\r\n/g, "\n");
const sql = strip(raw);
const ms4 = strip(readFileSync(ms4Path, "utf8"));
let failures = 0, passed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; } catch (e) { failures++; console.error(`FAIL ${name}\n  ${(e as Error).message}`); }
}
const norm = (s: string) => s.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim().toLowerCase();

// ---- App guards per RPC ------------------------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules" && !n.startsWith(".")) walk(p, out); }
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}
const files = [...walk(join(repoRoot, "app")), ...walk(join(repoRoot, "lib"))];
const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
// Edit guards in the exported function that contains position `at`.
function enclosingEditGuards(t: string, at: number): Set<string> {
  const start = t.lastIndexOf("\nexport ", at);
  const body = t.slice(start, at);
  return new Set([...body.matchAll(/requireModuleAccess\("([a-z_]+)", "edit"\)/g)].map((m) => m[1]));
}
function rpcGuards(fn: string): Set<string>[] {
  const out: Set<string>[] = [];
  for (const [f, t] of text) {
    for (const m of t.matchAll(new RegExp(`rpc\\("${fn}"`, "g"))) {
      let g = enclosingEditGuards(t, m.index!);
      if (!g.size && /[\\/]lib[\\/]/.test(f)) {
        // library helper: use the guards of the Server Actions that call the exported helper
        const helper = t.slice(t.lastIndexOf("\nexport ", m.index!)).match(/^\nexport (?:async )?function (\w+)/)![1];
        for (const [g2, t2] of text) {
          if (g2 === f) continue;
          for (const c of t2.matchAll(new RegExp(`\\b${helper}\\(`, "g"))) {
            const gg = enclosingEditGuards(t2, c.index!);
            if (gg.size) out.push(gg);
          }
        }
        continue;
      }
      out.push(g);
    }
  }
  return out;
}

// ---- 1. RPC wrappers ---------------------------------------------------------------------------------------------
const rpcs: Record<string, { sig: string; params: string; result: string; err: string; code: string }> = {
  accept_quotation: { sig: "uuid", params: "p_quotation_id", result: "void", err: "forbidden", code: "42501" },
  reject_quotation: { sig: "uuid, text", params: "p_quotation_id, p_reason", result: "void", err: "forbidden", code: "42501" },
  convert_lead_to_opportunity: { sig: "uuid, text, date, numeric", params: "p_lead_metadata_id, p_title, p_expected_close_date, p_estimated_value", result: "uuid", err: "forbidden", code: "42501" },
  mark_opportunity_lost: { sig: "uuid, text", params: "p_opportunity_id, p_reason", result: "void", err: "forbidden", code: "42501" },
  mark_lead_test: { sig: "uuid, boolean", params: "p_lead_metadata_id, p_is_test", result: "void", err: "forbidden", code: "42501" },
  create_invoice_from_quotation: { sig: "uuid", params: "p_quotation_id", result: "uuid", err: "not_authorized", code: "P0001" },
  issue_invoice: { sig: "uuid", params: "p_invoice_id", result: "jsonb", err: "not_authorized", code: "P0001" },
  cancel_invoice: { sig: "uuid, text", params: "p_invoice_id, p_reason", result: "jsonb", err: "not_authorized", code: "P0001" },
  create_hrdf_claim_for_invoice: { sig: "uuid", params: "p_invoice_id", result: "uuid", err: "not_authorized", code: "P0001" },
};
// Original authorization error, read from the repository's latest definition of each RPC.
const migDir = join(repoRoot, "supabase", "migrations");
const migFiles = readdirSync(migDir).filter((n) => n.endsWith(".sql")).sort();
function latestBody(fn: string): string {
  let body = "";
  for (const n of migFiles) {
    const t = readFileSync(join(migDir, n), "utf8");
    const i = t.search(new RegExp(`create (or replace )?function public\\.${fn}\\(`));
    if (i >= 0) {
      const end = t.slice(i).search(/\n\$(function)?\$;/);
      body = t.slice(i, end > 0 ? i + end : i + 6000);
    }
  }
  return body;
}
for (const [fn, r] of Object.entries(rpcs)) {
  check(`${fn}: original authorization error is '${r.err}' / ${r.code}`, () => {
    const body = latestBody(fn);
    assert.ok(body, "no repository definition found");
    assert.ok(new RegExp(`raise exception '${r.err}' using errcode = '${r.code}'`).test(body));
  });
  check(`${fn}: renamed, revoked from every client role, wrapper first checks exactly the Server Action modules`, () => {
    assert.ok(sql.includes(`alter function public.${fn}(${r.sig}) rename to ${fn}_unguarded;`));
    assert.ok(sql.includes(`revoke all on function public.${fn}_unguarded(${r.sig}) from public, anon, authenticated, service_role;`));
    const body = sql.match(new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\$\\$;`))?.[0] ?? "";
    assert.ok(/security definer set search_path = ''/.test(norm(body)), "definer + empty search_path");
    assert.ok(new RegExp(`returns ${r.result} `).test(norm(body)), `returns ${r.result}`);
    const mods = new Set([...body.matchAll(/public\.has_module_access_level\('([a-z_]+)', 'edit'\)/g)].map((m) => m[1]));
    const guards = rpcGuards(fn);
    assert.ok(guards.length, "no application caller found");
    for (const g of guards) assert.deepEqual([...mods].sort(), [...g].sort(), "wrapper modules must equal the Server Action edit guards");
    const guardAt = body.indexOf("has_module_access_level");
    const callAt = body.indexOf(`public.${fn}_unguarded(`);
    assert.ok(guardAt > 0 && callAt > guardAt, "module check must precede the call");
    assert.ok(body.includes(`raise exception '${r.err}' using errcode = '${r.code}'`), "same error as the original");
    if (mods.size > 1) assert.ok(/has_module_access_level\('[a-z_]+', 'edit'\) and public\.has_module_access_level/.test(body), "multiple modules must be AND-ed");
    const args = body.slice(callAt + `public.${fn}_unguarded(`.length, body.indexOf(")", callAt));
    assert.equal(norm(args), norm(r.params));
    assert.ok(r.result === "void" ? body.includes(`perform public.${fn}_unguarded(`) : body.includes(`return public.${fn}_unguarded(`));
  });
}
check("wrapper grants: authenticated only; postcondition verifies originals are not client-callable", () => {
  assert.ok(/execute format\('revoke all on function %s from public, anon, service_role', s\)/.test(sql));
  assert.ok(/execute format\('grant execute on function %s to authenticated', s\)/.test(sql));
  assert.ok(/has_function_privilege\('service_role', s, 'EXECUTE'\)/.test(sql));
  assert.ok(!/grant[^;]*\bto\s+(anon|public|service_role)\b/i.test(sql));
});
check("HRDF requires invoices edit AND hrdf_claims edit and grants nothing", () => {
  const body = sql.match(/create or replace function public\.create_hrdf_claim_for_invoice\([\s\S]*?\$\$;/)![0];
  assert.ok(/has_module_access_level\('invoices', 'edit'\) and public\.has_module_access_level\('hrdf_claims', 'edit'\)/.test(body));
  assert.ok(!/insert into public\.staff_module_access|update public\.staff_module_access/i.test(sql));
});
check("fail-closed precondition covers M-S4 presence, all nine signatures/results and all six policies", () => {
  const pre = raw.slice(0, raw.indexOf("-- ---- A."));
  assert.ok(pre.includes("app.has_any_module_access(text[],text)"));
  for (const fn of Object.keys(rpcs)) assert.ok(pre.includes(`'public.${fn}(`), fn);
  for (const p of ["sales_quotation_items_select", "sales_quotation_items_insert", "sales_quotation_items_update",
                   "sales_quotation_items_delete", "sales_internal_lead_sources_select", "sales_lead_contact_overrides_select"])
    assert.ok(pre.includes(`'${p}'`), p);
});

// ---- 2. Policies -------------------------------------------------------------------------------------------------
function policy(src: string, name: string) {
  const m = src.match(new RegExp(`create policy ${name} on public\\.\\w+\\s+for (\\w+) to (\\w+)([\\s\\S]*?);`));
  assert.ok(m, `${name} missing`);
  return { cmd: m![1], to: m![2], body: norm(m![3]) };
}
function readSet(body: string): string[] {
  const m = body.match(/has_any_module_access\(array\[([^\]]*)\]::text\[\], 'view'\)/);
  return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort() : [];
}
const quotationsRead = readSet(policy(ms4, "sales_quotations_select").body);
const leadRead = readSet(policy(ms4, "sales_lead_metadata_select").body);
check("sales_quotation_items SELECT uses the M-S4 sales_quotations read set and keeps the editor floor", () => {
  const p = policy(sql, "sales_quotation_items_select");
  assert.equal(p.to, "authenticated");
  assert.ok(p.body.includes("app.has_min_role('editor'::public.user_role) and"));
  assert.deepEqual(readSet(p.body), quotationsRead);
});
for (const name of ["sales_quotation_items_insert", "sales_quotation_items_update", "sales_quotation_items_delete"]) {
  check(`${name}: keeps app.is_admin() and ANDs Quotations edit`, () => {
    const p = policy(sql, name);
    assert.equal(p.to, "authenticated");
    for (const part of p.body.split(/\bwith check\b/).filter((s) => s.trim())) {
      assert.ok(part.includes("app.is_admin() and (select public.has_module_access_level('sales_quotations', 'edit'))"), part);
    }
  });
}
for (const name of ["sales_internal_lead_sources_select", "sales_lead_contact_overrides_select"]) {
  check(`${name}: uses the M-S4 sales_lead_metadata read set (Lead Inbox join)`, () => {
    const p = policy(sql, name);
    assert.ok(p.body.includes("app.has_min_role('editor'::public.user_role) and"));
    assert.deepEqual(readSet(p.body), leadRead);
  });
}
check("no permissive shortcuts", () => {
  assert.ok(!/using\s*\(\s*true\s*\)|with check\s*\(\s*true\s*\)/i.test(sql));
  assert.ok(!/for \w+ to (anon|public)\b/i.test(sql));
});

// ---- 3. Application coverage for the three tables ----------------------------------------------------------------
function guardsOf(f: string): { module: string; level: string }[] {
  const out: { module: string; level: string }[] = [];
  for (const p of [f, join(dirname(f), "page.tsx")]) {
    const t = text.get(p) ?? "";
    for (const m of t.matchAll(/(?:requireModuleAccess|hasModuleAccess)\(\s*"([a-z_]+)"(?:\s*,\s*"([a-z]+)")?/g)) out.push({ module: m[1], level: m[2] ?? "view" });
  }
  return out;
}
const tables: Record<string, { read: string[]; write?: string[] }> = {
  sales_quotation_items: { read: quotationsRead, write: ["sales_quotations"] },
  sales_internal_lead_sources: { read: leadRead },
  sales_lead_contact_overrides: { read: leadRead },
};
for (const [table, sets] of Object.entries(tables)) {
  for (const [f, t] of text) {
    const code = t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    if (!new RegExp(`from\\("${table}"\\)|["'\`,\\s]${table}(\\(|!)`).test(code)) continue;
    const rel = relative(repoRoot, f);
    let g = guardsOf(f);
    if (!g.length && /[\\/]lib[\\/]/.test(f)) {
      const stem = rel.replace(/\\/g, "/").replace(/\.(ts|tsx)$/, "").split("/").slice(-2).join("/");
      for (const [g2, t2] of text) if (g2 !== f && t2.includes(`${stem}"`)) g = g.concat(guardsOf(g2));
    }
    check(`${table}: ${rel} is covered`, () => {
      assert.ok(g.length, "no module guard found");
      assert.ok(g.some((x) => sets.read.includes(x.module)), `guards [${g.map((x) => x.module).join(", ")}] not in read set`);
      if (sets.write && new RegExp(`from\\("${table}"\\)[\\s\\S]{0,160}?\\.(insert|update|upsert|delete)\\(`).test(code)) {
        assert.ok(g.some((x) => x.level === "edit" && sets.write!.includes(x.module)), "writer lacks Quotations edit guard");
      }
    });
  }
}

console.log(failures ? `${failures} check(s) FAILED, ${passed} passed.` : `${passed} check(s) passed.`);
process.exit(failures ? 1 : 0);
