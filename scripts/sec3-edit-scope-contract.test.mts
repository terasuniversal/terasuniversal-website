// SEC-3 contract (capability model after RBAC hardening): the "what Edit allows" text in Staff User Management must
// match the real server-side guards. Parses each Sales/Finance server-action file and compares every exported action's
// guard (requireRole + requireModuleAccess, requireModuleCapability, or an explicit Admin check) with
// lib/auth/edit-scope.ts. With --mutations, guard drift and wording drift injected into in-memory copies must fail.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { registerHooks } from "node:module";

// lib/ files use extensionless relative imports (resolved by Next/TypeScript); let Node resolve them to .ts here.
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});
const { EDIT_SCOPE, describeEditScope, summariseEditScope } = await import("../lib/auth/edit-scope.ts");
type Table = typeof EDIT_SCOPE;

const root = join(import.meta.dirname, "..", "app", "admin", "(protected)");
const FILES = ["sales/leads/actions.ts", "sales/opportunities/actions.ts", "sales/quotations/actions.ts", "sales/tasks/actions.ts", "invoices/actions.ts", "invoices/toyyibpayActions.ts"];
const FORM = join("users", "StaffUserForm.tsx");
type Sources = Record<string, string>;
const real: Sources = Object.fromEntries([...FILES, FORM].map((f) => [f, readFileSync(join(root, f), "utf8")]));

type Guard = { requires: "editor" | "capability" | "admin" | null; modules: Array<{ key: string; level: string }> };
function parseGuards(src: string): Map<string, Guard> {
  const out = new Map<string, Guard>();
  const re = /export async function (\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = src.slice(m.index, m.index + 1400);
    const next = body.indexOf("\nexport ", 10);
    const head = next > 0 ? body.slice(0, next) : body;
    const capability = [...head.matchAll(/requireModuleCapability\("(\w+)"(?:,\s*"(\w+)")?\)/g)].map((x) => ({ key: x[1], level: x[2] ?? "edit" }));
    const access = [...head.matchAll(/requireModuleAccess\("(\w+)"(?:,\s*"(\w+)")?\)/g)].map((x) => ({ key: x[1], level: x[2] ?? "view" }));
    const role = /requireRole\("(\w+)"\)/.exec(head)?.[1] ?? null;
    // The first guard in the action decides; an explicit "Admin (or module admin) or no-access" check counts as admin.
    const capAt = head.search(/requireModuleCapability\(/);
    const roleAt = head.search(/requireRole\(/);
    let requires: Guard["requires"] = null;
    if (capAt >= 0 && (roleAt < 0 || capAt < roleAt)) requires = "capability";
    else if (role === "admin" || role === "super_admin") requires = "admin";
    else if (role === "editor") {
      // Only an Admin check in the guard prelude (before the first DB client or blank line) gates the whole action;
      // later checks belong to branches (e.g. acting on someone else's task).
      const stops = [head.indexOf("createSupabaseServerClient"), head.indexOf("\n\n")].filter((i) => i > 0);
      const prelude = stops.length ? head.slice(0, Math.min(...stops)) : head;
      requires = /if \(!\(isAdmin\(profile\.role\)/.test(prelude) ? "admin" : "editor";
    }
    out.set(m[1], { requires, modules: [...capability, ...access] });
  }
  return out;
}

// Exported actions intentionally not listed as "Edit allows" items: read-only checks or follow-up steps of an action
// that is already listed.
const UNLISTED = new Set([
  "sales/opportunities/actions.ts#searchCompaniesForLink", // read-only search, needs View only
  "invoices/actions.ts#checkManualPaymentAttemptAction", // read-only status check after an unconfirmed payment
  "invoices/toyyibpayActions.ts#refreshToyyibpayStatusAction", // covered by the ToyyibPay entry
]);

function runAll(src: Sources, table: Table): string[] {
  const failures: string[] = [];
  let passed = 0;
  const check = (name: string, fn: () => void) => { try { fn(); passed++; } catch (e) { failures.push(`${name}: ${(e as Error).message.split("\n")[0]}`); } };
  const guards = new Map(FILES.map((f) => [f, parseGuards(src[f])]));
  for (const [moduleKey, actions] of Object.entries(table)) {
    for (const action of actions) {
      check(`${moduleKey}: "${action.label}" mirrors ${action.source.file}#${action.source.fn}`, () => {
        const g = guards.get(action.source.file)?.get(action.source.fn);
        assert.ok(g, `exported action ${action.source.fn} not found in ${action.source.file}`);
        assert.equal(g.requires, action.requires, `guard mismatch for ${action.source.fn}`);
        const moduleGuard = g.modules.find((x) => x.key === moduleKey);
        assert.ok(moduleGuard, `${action.source.fn} has no module guard for ${moduleKey}`);
        assert.equal(moduleGuard.level, "edit", `${action.source.fn} should require ${moduleKey} edit`);
      });
    }
  }
  check("every exported write action in the audited files is described (no silent gaps)", () => {
    const listed = new Set(Object.values(table).flat().map((a) => `${a.source.file}#${a.source.fn}`));
    const missing: string[] = [];
    for (const [file, map] of guards) for (const fn of map.keys()) {
      const id = `${file}#${fn}`;
      if (!listed.has(id) && !UNLISTED.has(id)) missing.push(id);
    }
    assert.deepEqual(missing, []);
  });
  check("every exported action in the audited files has a guard", () => {
    for (const [file, map] of guards) for (const [fn, g] of map) assert.ok(g.requires, `${file}#${fn} has no guard`);
  });
  check("the Staff User form passes the access mode and makes no Admin-only quotation claim", () => {
    const form = src[FORM];
    assert.doesNotMatch(form, /every quotation action still need an Admin/);
    assert.doesNotMatch(form, /only Admins can accept quotations/);
    assert.match(form, /describeEditScope\(role, module\.key, mode === "custom"\)/);
    assert.match(form, /aria-describedby=\{scopeNote \? scopeId : undefined\}/);
    assert.match(form, /View is strictly read-only; Edit allows changes within the role&apos;s own limits/);
  });
  return failures.length ? failures : [`__passed:${passed}`];
}

// Behaviour of the description itself (fixed table; no mutation needed).
let behaviour = 0;
const b = (name: string, fn: () => void) => { fn(); behaviour++; console.log(`ok - ${name}`); };
b("Super Admin is unrestricted and gets no caveat", () => {
  assert.deepEqual(summariseEditScope("super_admin", "sales_quotations"), { kind: "unrestricted" });
  assert.equal(describeEditScope("super_admin", "sales_leads"), null);
});
b("Admin: every listed action is allowed, nothing Admin-only or pending Custom access", () => {
  for (const key of ["sales_leads", "sales_opportunities", "sales_quotations", "sales_tasks", "invoices"]) {
    const s = summariseEditScope("admin", key);
    assert.ok(s.kind === "scoped" && s.adminOnly.length === 0 && s.needsCustomAccess.length === 0, key);
  }
});
b("Editor with Custom Module Access + Edit Quotations: quotation actions allowed (capability)", () => {
  const s = summariseEditScope("editor", "sales_quotations", true);
  assert.ok(s.kind === "scoped" && s.allowed.includes("Accept quotations") && s.adminOnly.length === 0);
});
b("Editor on Role Default: no capability action is described as allowed", () => {
  const s = summariseEditScope("editor", "sales_quotations", false);
  assert.ok(s.kind === "scoped" && s.allowed.length === 0 && s.needsCustomAccess.includes("Accept quotations"));
  assert.match(describeEditScope("editor", "invoices", false) ?? "", /^Edit gives this role no actions here\. Needs Custom Module Access: /);
});
b("Editor + Custom + Edit Leads: everyday and capability actions allowed, Test/Demo Admin-only", () => {
  const s = summariseEditScope("editor", "sales_leads", true);
  assert.ok(s.kind === "scoped");
  if (s.kind === "scoped") {
    assert.ok(s.allowed.includes("Create leads") && s.allowed.includes("Convert to opportunity"));
    assert.deepEqual(s.adminOnly, ["Mark as Test/Demo"]);
  }
});
b("Finance Staff shape (Editor + Custom + Edit Invoices): every invoice action allowed", () => {
  const s = summariseEditScope("editor", "invoices", true);
  assert.ok(s.kind === "scoped" && s.allowed.includes("Record manual payments") && s.adminOnly.length === 0 && s.needsCustomAccess.length === 0);
});
b("Sales Tasks: own tasks for Editor, Delete stays Admin-only (F-01, no DELETE grant)", () => {
  const s = summariseEditScope("editor", "sales_tasks", true);
  assert.ok(s.kind === "scoped" && s.adminOnly.length === 1 && s.adminOnly[0] === "Delete tasks");
});
b("restricted roles (trainer, client, participant, null) are never described as allowed", () => {
  for (const role of ["trainer", "client", "participant", null] as const) for (const key of Object.keys(EDIT_SCOPE)) {
    const s = summariseEditScope(role, key, true);
    if (s.kind === "scoped") assert.equal(s.allowed.length, 0, `${role} ${key}`);
  }
});
b("read-only modules say Edit adds nothing; unknown modules stay silent", () => {
  assert.equal(describeEditScope("editor", "sales_reports"), "Read-only module: Edit gives no extra actions.");
  assert.equal(describeEditScope("editor", "sales_followups"), "Read-only module: Edit gives no extra actions.");
  assert.equal(describeEditScope("editor", "courses"), null);
});

const result = runAll(real, EDIT_SCOPE);
for (const f of result.filter((x) => !x.startsWith("__passed"))) console.log(`not ok - ${f}`);
assert.ok(result[0].startsWith("__passed"), `${result.length} contract check(s) failed`);
const contract = Number(result[0].split(":")[1]);
console.log(`ok - ${contract} guard/table/form contract checks`);
console.log(`\n# sec3-edit-scope: pass ${contract + behaviour} fail 0`);

if (process.argv.includes("--mutations")) {
  const Q = "sales/quotations/actions.ts", T = "sales/tasks/actions.ts", I = "invoices/actions.ts";
  const retag = (key: string, fn: string, requires: "editor" | "capability" | "admin"): Table =>
    ({ ...EDIT_SCOPE, [key]: EDIT_SCOPE[key].map((a) => (a.source.fn === fn ? { ...a, requires } : a)) });
  const mutations: Array<[string, Sources, Table]> = [
    ["quotation accept back to requireRole(admin)", { ...real, [Q]: real[Q].replace(/(export async function acceptQuotationAction[\s\S]*?)requireModuleCapability\("sales_quotations", "edit"\)/, '$1requireRole("admin")') }, EDIT_SCOPE],
    ["payment guard weakened to requireRole(editor)", { ...real, [I]: real[I].replace(/(export async function recordManualPaymentAction[\s\S]*?)requireModuleCapability\("invoices", "edit"\)/, '$1requireRole("editor")') }, EDIT_SCOPE],
    ["delete task loses the Admin check", { ...real, [T]: real[T].replace(/(export async function deleteTask[\s\S]*?)if \(!\(isAdmin\(profile\.role\) \|\|/, "$1if (!(true ||") }, EDIT_SCOPE],
    ["table claims Delete tasks is everyday Editor work", real, retag("sales_tasks", "deleteTask", "editor")],
    ["table claims invoice cancel is Admin-only", real, retag("invoices", "cancelInvoiceAction", "admin")],
    ["table claims convert lead is everyday Editor work", real, retag("sales_leads", "convertLeadToOpportunity", "editor")],
    ["form reverts to the old Admin-only quotation claim", { ...real, [FORM]: real[FORM].replace("only Admins can delete tasks", "only Admins can accept quotations") }, EDIT_SCOPE],
    ["form stops passing the access mode", { ...real, [FORM]: real[FORM].replace('describeEditScope(role, module.key, mode === "custom")', "describeEditScope(role, module.key)") }, EDIT_SCOPE],
  ];
  let killed = 0;
  for (const [name, src, table] of mutations) {
    const r = runAll(src, table);
    const dead = !r[0].startsWith("__passed");
    if (dead) killed++;
    console.log(`${dead ? "ok" : "not ok"} - mutation ${dead ? "killed" : "survived"}: ${name}`);
  }
  console.log(`# sec3-edit-scope mutations: ${killed}/${mutations.length} killed`);
  assert.equal(killed, mutations.length, "every mutation must be killed");
}
