// SEC-3 contract: the "what Edit allows" text in Staff User Management must match the real
// server-side guards. Parses each Sales/Finance server-action file and compares every exported
// action's requireRole(...) and requireModuleAccess(...) with lib/auth/edit-scope.ts.
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

const root = join(import.meta.dirname, "..", "app", "admin", "(protected)");
let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`ok - ${name}`); };

type Guard = { role: string | null; modules: Array<{ key: string; level: string }> };
function parseGuards(file: string): Map<string, Guard> {
  const src = readFileSync(join(root, file), "utf8");
  const out = new Map<string, Guard>();
  const re = /export async function (\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const body = src.slice(m.index, m.index + 1200);
    const next = body.indexOf("\nexport ", 10);
    const head = next > 0 ? body.slice(0, next) : body;
    const role = /requireRole\("(\w+)"\)/.exec(head)?.[1] ?? null;
    const modules = [...head.matchAll(/requireModuleAccess\("(\w+)"(?:,\s*"(\w+)")?\)/g)].map((x) => ({ key: x[1], level: x[2] ?? "view" }));
    out.set(m[1], { role, modules });
  }
  return out;
}

const FILES = ["sales/leads/actions.ts", "sales/opportunities/actions.ts", "sales/quotations/actions.ts", "sales/tasks/actions.ts", "invoices/actions.ts", "invoices/toyyibpayActions.ts"];
const guards = new Map(FILES.map((f) => [f, parseGuards(f)]));

// Exported actions intentionally not listed as "Edit allows" items: read-only checks or
// follow-up steps of an action that is already listed.
const UNLISTED = new Set([
  "sales/opportunities/actions.ts#searchCompaniesForLink", // read-only search, needs View only
  "invoices/actions.ts#checkManualPaymentAttemptAction", // read-only status check after an unconfirmed payment
  "invoices/toyyibpayActions.ts#refreshToyyibpayStatusAction", // covered by the ToyyibPay entry
]);

for (const [moduleKey, actions] of Object.entries(EDIT_SCOPE)) {
  for (const action of actions) {
    check(`${moduleKey}: "${action.label}" mirrors ${action.source.file}#${action.source.fn}`, () => {
      const g = guards.get(action.source.file)?.get(action.source.fn);
      assert.ok(g, `exported action ${action.source.fn} not found in ${action.source.file}`);
      assert.equal(g.role, action.minRole, `requireRole mismatch for ${action.source.fn}`);
      const moduleGuard = g.modules.find((x) => x.key === moduleKey);
      assert.ok(moduleGuard, `${action.source.fn} does not call requireModuleAccess("${moduleKey}", ...)`);
      assert.equal(moduleGuard.level, "edit", `${action.source.fn} should require ${moduleKey} edit`);
    });
  }
}

check("every exported write action in the audited files is described (no silent gaps)", () => {
  const listed = new Set(Object.values(EDIT_SCOPE).flat().map((a) => `${a.source.file}#${a.source.fn}`));
  const missing: string[] = [];
  for (const [file, map] of guards) for (const fn of map.keys()) {
    const id = `${file}#${fn}`;
    if (!listed.has(id) && !UNLISTED.has(id)) missing.push(id);
  }
  assert.deepEqual(missing, []);
});

check("every exported action in the audited files has a role guard", () => {
  for (const [file, map] of guards) for (const [fn, g] of map) assert.ok(g.role, `${file}#${fn} has no requireRole`);
});

// Role behaviour of the description (Super Admin, Admin, Editor, restricted roles).
check("Super Admin is unrestricted and gets no caveat", () => {
  assert.deepEqual(summariseEditScope("super_admin", "sales_quotations"), { kind: "unrestricted" });
  assert.equal(describeEditScope("super_admin", "sales_leads"), null);
});
check("Admin: every listed action is allowed, nothing Admin-only", () => {
  for (const key of ["sales_leads", "sales_opportunities", "sales_quotations", "sales_tasks", "invoices"]) {
    const s = summariseEditScope("admin", key);
    assert.equal(s.kind, "scoped");
    if (s.kind === "scoped") assert.equal(s.adminOnly.length, 0, key);
  }
});
check("Editor + Edit Quotations: no actions, every quotation action Admin-only", () => {
  const s = summariseEditScope("editor", "sales_quotations");
  assert.equal(s.kind, "scoped");
  if (s.kind === "scoped") { assert.equal(s.allowed.length, 0); assert.ok(s.adminOnly.includes("Accept quotations")); }
  assert.match(describeEditScope("editor", "sales_quotations") ?? "", /^Edit gives this role no actions here/);
});
check("Editor + Edit Leads: everyday actions allowed, conversion Admin-only", () => {
  const s = summariseEditScope("editor", "sales_leads");
  assert.equal(s.kind, "scoped");
  if (s.kind === "scoped") {
    assert.deepEqual(s.allowed, ["Create leads", "Set marketing attribution", "Add notes", "Correct contact details"]);
    assert.ok(s.adminOnly.includes("Convert to opportunity"));
    assert.ok(s.adminOnly.includes("Change pipeline status"));
  }
});
check("Editor + Edit Invoices: nothing allowed (Finance actions need Admin)", () => {
  const s = summariseEditScope("editor", "invoices");
  assert.ok(s.kind === "scoped" && s.allowed.length === 0 && s.adminOnly.includes("Record manual payments"));
});
check("restricted roles (trainer, client, participant, null) are never described as allowed", () => {
  for (const role of ["trainer", "client", "participant", null] as const) {
    for (const key of Object.keys(EDIT_SCOPE)) {
      const s = summariseEditScope(role, key);
      if (s.kind === "scoped") assert.equal(s.allowed.length, 0, `${role} ${key}`);
    }
  }
});
check("read-only modules say Edit adds nothing; unknown modules stay silent", () => {
  assert.equal(describeEditScope("editor", "sales_reports"), "Read-only module: Edit gives no extra actions.");
  assert.equal(describeEditScope("editor", "sales_followups"), "Read-only module: Edit gives no extra actions.");
  assert.equal(describeEditScope("editor", "courses"), null);
});
check("the Sales Staff preset form text no longer implies Editor can run quotation actions", () => {
  const form = readFileSync(join(root, "users", "StaffUserForm.tsx"), "utf8");
  assert.match(form, /every quotation action still need an Admin/);
  assert.match(form, /describeEditScope\(role, module\.key\)/);
  assert.match(form, /aria-describedby=\{scopeNote \? scopeId : undefined\}/);
});

console.log(`\n# sec3-edit-scope: pass ${passed} fail 0`);
