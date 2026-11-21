import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// M-S2 contract: the sales_activity INSERT policy and its helper must enforce actor = caller, module "edit" access,
// the application's role floors and record-to-lead consistency, and must reject every RPC-only activity type.
// Static only: no database is contacted. The helper body is split on its "-- context:" markers and each branch is
// modelled from its guard line, so positive and negative cases are decided the same way PostgreSQL would branch.

const MIGRATION = "supabase/migrations/20261119180000_sales_activity_insert_authorization.sql";
const root = new URL("../", import.meta.url);
const raw = readFileSync(new URL(MIGRATION, root), "utf8").replace(/\r\n/g, "\n");
// Comments are stripped so the rollback notes and prose never count as executable SQL.
const sql = raw.replace(/--[^\n]*/g, "");

let failures = 0;
let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}\n  ${(error as Error).message}`);
  }
}

// ---- Parse the helper into branches ---------------------------------------------------------------------------
const fnMatch = raw.match(/create or replace function app\.can_insert_sales_activity\([\s\S]*?\nas \$\$\n([\s\S]*?)\n\$\$;/);
const helperRaw = fnMatch?.[1] ?? "";
const helperHeader = raw.match(/create or replace function app\.can_insert_sales_activity\([\s\S]*?\nas \$\$/)?.[0] ?? "";

type Ctx = "null" | "notnull" | "any";
interface Branch {
  name: string;
  types: string[];
  opp: Ctx;
  quot: Ctx;
  body: string;
}

const branches: Branch[] = helperRaw
  .split(/\n\s*-- context: /)
  .slice(1)
  .map((chunk) => {
    const name = chunk.split("\n")[0].trim();
    const body = chunk.split(/\n\s*-- default deny/)[0].replace(/--[^\n]*/g, "");
    const guard = body.match(/if (p_type in \([^)]*\)[^\n]*) then/)?.[1] ?? "";
    const types = [...(guard.match(/p_type in \(([^)]*)\)/)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const ctx = (col: string): Ctx =>
      new RegExp(`${col} is not null`).test(guard) ? "notnull" : new RegExp(`${col} is null`).test(guard) ? "null" : "any";
    return { name, types, opp: ctx("p_opportunity_id"), quot: ctx("p_quotation_id"), body };
  });

const fits = (c: Ctx, value: boolean) => c === "any" || (c === "notnull") === value;
// PostgreSQL evaluates the branches in order and the first matching guard decides.
function branchFor(type: string, hasOpp: boolean, hasQuot: boolean): Branch | null {
  return branches.find((b) => b.types.includes(type) && fits(b.opp, hasOpp) && fits(b.quot, hasQuot)) ?? null;
}
const moduleChecks = (body: string) => [...body.matchAll(/has_module_access_level\('([a-z_]+)', '([a-z]+)'\)/g)].map((m) => `${m[1]}:${m[2]}`);
const floorOf = (b: Branch, type: string): "admin" | "editor" | "none" => {
  // A type-specific "if p_type = 'x'" sub-branch overrides the branch default.
  const specific = new RegExp(`p_type = '${type}' then\\s*\\n\\s*(?:return|if not) (app\\.[a-z_]+\\([^)]*\\))`).exec(b.body)?.[1];
  const general = /(?:elsif not|if not|return) app\.is_admin\(\)/.test(b.body) ? "admin" : /app\.has_min_role\('editor'/.test(b.body) ? "editor" : "none";
  if (specific?.includes("has_min_role('editor'")) return "editor";
  if (specific?.includes("is_admin")) return "admin";
  return general;
};

// ---- Expected model ---------------------------------------------------------------------------------------------
// Every direct application writer, with the context columns it fills and the server-side guard it runs (PR #227).
const APP_WRITERS: Array<{ writer: string; type: string; opp: boolean; quot: boolean; modules: string[]; floor: "admin" | "editor" }> = [
  { writer: "addLeadNote / setLeadAttribution", type: "note_added", opp: false, quot: false, modules: ["sales_leads"], floor: "editor" },
  { writer: "updateLeadStatus", type: "status_changed", opp: false, quot: false, modules: ["sales_leads"], floor: "admin" },
  { writer: "updateLeadStatus (won)", type: "won", opp: false, quot: false, modules: ["sales_leads"], floor: "admin" },
  { writer: "updateLeadStatus (lost)", type: "lost", opp: false, quot: false, modules: ["sales_leads"], floor: "admin" },
  { writer: "assignLead", type: "assigned", opp: false, quot: false, modules: ["sales_leads"], floor: "admin" },
  { writer: "setLeadFollowUp", type: "followup_scheduled", opp: false, quot: false, modules: ["sales_leads"], floor: "admin" },
  { writer: "setLeadFollowUp (priority)", type: "priority_changed", opp: false, quot: false, modules: ["sales_leads"], floor: "admin" },
  { writer: "updateLeadQualification", type: "qualification_changed", opp: false, quot: false, modules: ["sales_leads"], floor: "admin" },
  { writer: "updateLeadTemperature", type: "temperature_changed", opp: false, quot: false, modules: ["sales_leads"], floor: "admin" },
  { writer: "addOpportunityNote", type: "note_added", opp: true, quot: false, modules: ["sales_opportunities"], floor: "editor" },
  { writer: "updateOpportunityStage", type: "status_changed", opp: true, quot: false, modules: ["sales_opportunities"], floor: "admin" },
  { writer: "assignOpportunity", type: "assigned", opp: true, quot: false, modules: ["sales_opportunities"], floor: "admin" },
  { writer: "linkCompany", type: "company_linked", opp: true, quot: false, modules: ["sales_opportunities"], floor: "admin" },
  { writer: "createCompany (opportunity handoff)", type: "company_created", opp: true, quot: false, modules: ["sales_opportunities", "companies"], floor: "admin" },
  { writer: "createQuotation", type: "quotation_created", opp: true, quot: true, modules: ["sales_quotations"], floor: "admin" },
  { writer: "markQuotationSent", type: "quotation_sent", opp: true, quot: true, modules: ["sales_quotations"], floor: "admin" },
  { writer: "createRevision", type: "quotation_revised", opp: true, quot: true, modules: ["sales_quotations"], floor: "admin" },
  { writer: "createTask (lead only)", type: "task_created", opp: false, quot: false, modules: ["sales_tasks"], floor: "editor" },
  { writer: "createTask (opportunity)", type: "task_created", opp: true, quot: false, modules: ["sales_tasks"], floor: "editor" },
  { writer: "createTask (quotation only)", type: "task_created", opp: false, quot: true, modules: ["sales_tasks"], floor: "editor" },
  { writer: "setTaskStatus (completed)", type: "task_completed", opp: true, quot: true, modules: ["sales_tasks"], floor: "editor" },
  { writer: "setTaskStatus (reopened)", type: "task_reopened", opp: false, quot: false, modules: ["sales_tasks"], floor: "editor" },
  { writer: "setTaskStatus (cancelled)", type: "task_cancelled", opp: true, quot: false, modules: ["sales_tasks"], floor: "editor" },
  { writer: "createSchedule handoff (with quotation)", type: "training_handoff_created", opp: true, quot: true, modules: ["schedules"], floor: "admin" },
  { writer: "createSchedule handoff (no quotation)", type: "training_handoff_created", opp: true, quot: false, modules: ["schedules"], floor: "admin" },
];

// Written only by SECURITY DEFINER RPCs, triggers or service_role (they bypass RLS); never directly by a client.
const RPC_ONLY = [
  "lead_created", "opportunity_created", "quotation_accepted", "quotation_rejected", "quotation_cancelled",
  "opportunity_won", "opportunity_lost", "opportunity_reversed", "invoice_created", "invoice_issued",
  "invoice_partially_paid", "invoice_paid", "invoice_cancelled", "payment_recorded", "receipt_issued",
  "registration_completed", "contact_details_updated", "proposal_sent",
];

// ---- Structure ----------------------------------------------------------------------------------------------------
check("helper exists and was parsed into the five expected branches", () => {
  assert.ok(helperRaw.length > 0, "app.can_insert_sales_activity body not found");
  assert.deepEqual(branches.map((b) => b.name), ["lead", "opportunity", "quotation", "task", "training_handoff"]);
  for (const b of branches) assert.ok(b.types.length > 0, `branch ${b.name} has no type list`);
});

check("helper is hardened: SECURITY DEFINER, STABLE, empty search_path, fully qualified references", () => {
  assert.match(helperHeader, /\nsecurity definer\n/);
  assert.match(helperHeader, /\nstable\n/);
  assert.match(helperHeader, /\nset search_path = ''\n/);
  assert.match(helperHeader, /p_type text,\s*p_lead_metadata_id uuid,\s*p_opportunity_id uuid,\s*p_quotation_id uuid\s*\)/);
  const unqualified = helperRaw.replace(/--[^\n]*/g, "").match(/\b(?:from|join)\s+(?!public\.)[a-z_]+/g);
  assert.equal(unqualified, null, `unqualified relation in helper: ${unqualified}`);
  for (const call of helperRaw.match(/\b[a-z_]+\.[a-z_]+\(/g) ?? []) {
    assert.ok(/^(public|app)\./.test(call), `unexpected schema in call ${call}`);
  }
});

check("helper EXECUTE is limited to authenticated, with an ownership statement and an ACL postcondition", () => {
  assert.match(sql, /alter function app\.can_insert_sales_activity\(text, uuid, uuid, uuid\) owner to postgres;/);
  assert.match(sql, /revoke all on function app\.can_insert_sales_activity\(text, uuid, uuid, uuid\) from public, anon, service_role;/);
  const grants = [...sql.matchAll(/grant execute on function app\.can_insert_sales_activity\([^)]*\) to ([a-z_, ]+);/g)].map((m) => m[1].trim());
  assert.deepEqual(grants, ["authenticated"]);
  assert.match(sql, /has_function_privilege\('anon', 'app\.can_insert_sales_activity\(text,uuid,uuid,uuid\)', 'EXECUTE'\)/);
});

check("missing type or lead returns false before any branch, and the helper ends in default deny", () => {
  assert.match(helperRaw, /^begin\n\s*if p_type is null or p_lead_metadata_id is null then\n\s*return false;/);
  assert.match(helperRaw, /return false;\nend;$/);
});

// ---- 1. Forged actor_id -----------------------------------------------------------------------------------------
check("1. sales_activity INSERT policy requires actor_id = auth.uid() AND the helper", () => {
  const policies = [...sql.matchAll(/create policy (\w+) on public\.sales_activity\s+for (\w+) to (\w+)\s+with check \(([\s\S]*?)\);/g)];
  assert.equal(policies.length, 1, "exactly one sales_activity policy is (re)created");
  const [, name, cmd, role, body] = policies[0];
  assert.equal(name, "sales_activity_insert");
  assert.equal(cmd, "insert");
  assert.equal(role, "authenticated");
  assert.match(body, /^\s*actor_id = \(select auth\.uid\(\)\)\s+and app\.can_insert_sales_activity\(type, lead_metadata_id, opportunity_id, quotation_id\)\s*$/);
  assert.doesNotMatch(body, /\bor\b/i, "no OR may widen the INSERT policy");
  assert.match(sql, /drop policy if exists sales_activity_insert on public\.sales_activity;/);
});

// ---- 2. View / None -------------------------------------------------------------------------------------------
check("2. every module check asks for 'edit' and runs before any branch can return true", () => {
  const all = moduleChecks(helperRaw);
  assert.ok(all.length > 0);
  for (const m of all) assert.ok(m.endsWith(":edit"), `module check below edit: ${m}`);
  for (const b of branches) {
    const firstModule = b.body.search(/has_module_access_level\(/);
    const firstTrue = b.body.search(/return (?:true|exists|app\.)/);
    assert.ok(firstModule >= 0, `branch ${b.name} has no module check`);
    assert.ok(firstModule < firstTrue, `branch ${b.name} can return before its module check`);
    assert.match(b.body.slice(firstModule - "if not public.".length, firstModule + 80), /^if not public\.has_module_access_level\('[a-z_]+', 'edit'\) then\s*\n\s*return false;/);
  }
});

// ---- 3. Cross-module -------------------------------------------------------------------------------------------
check("3. each branch checks only its own module(s); no module check is OR-ed with another", () => {
  const expected: Record<string, string[]> = {
    lead: ["sales_leads:edit"],
    opportunity: ["companies:edit", "sales_opportunities:edit"],
    quotation: ["sales_quotations:edit"],
    task: ["sales_tasks:edit"],
    training_handoff: ["schedules:edit"],
  };
  for (const b of branches) assert.deepEqual([...new Set(moduleChecks(b.body))].sort(), expected[b.name], `branch ${b.name}`);
  assert.doesNotMatch(helperRaw, /\bor\s+(?:not\s+)?public\.has_module_access_level/i);
  // companies edit is an extra requirement for company_created only, never an alternative to opportunities edit.
  const opp = branches.find((b) => b.name === "opportunity")!;
  assert.match(opp.body, /if p_type = 'company_created' and not public\.has_module_access_level\('companies', 'edit'\) then\s*\n\s*return false;/);
});

check("3. overlapping types are decided by context, never by a cross-module fallback", () => {
  for (const type of ["note_added", "status_changed", "assigned"]) {
    assert.equal(branchFor(type, false, false)?.name, "lead", `${type} without opportunity -> Leads`);
    assert.equal(branchFor(type, true, false)?.name, "opportunity", `${type} with opportunity -> Opportunities`);
    assert.equal(branchFor(type, true, true), null, `${type} with a quotation has no branch`);
    assert.equal(branchFor(type, false, true), null, `${type} with only a quotation has no branch`);
  }
  // Leads edit must not authorize Opportunity, Quotation or Task activity.
  const lead = branches.find((b) => b.name === "lead")!;
  for (const t of lead.types) {
    assert.ok(!t.startsWith("quotation_") && !t.startsWith("task_") && !t.startsWith("company_"), `lead branch admits ${t}`);
  }
  assert.equal(lead.opp, "null");
  assert.equal(lead.quot, "null");
});

// ---- 4. Mismatched relationships ----------------------------------------------------------------------------------
check("4. opportunity and quotation context must belong to the same lead", () => {
  const sameLeadOpp = /from public\.sales_opportunities o\s+where o\.id = p_opportunity_id\s+and o\.lead_metadata_id = p_lead_metadata_id/;
  const sameLeadQuote = /from public\.sales_quotations q\s+join public\.sales_opportunities o on o\.id = q\.opportunity_id\s+where q\.id = p_quotation_id\s+and (?:\(p_opportunity_id is null or )?q\.opportunity_id = p_opportunity_id\)?\s+and o\.lead_metadata_id = p_lead_metadata_id/;
  const byName = Object.fromEntries(branches.map((b) => [b.name, b.body]));
  assert.match(byName.opportunity, sameLeadOpp);
  assert.match(byName.quotation, sameLeadQuote);
  assert.match(byName.task, sameLeadQuote);
  assert.match(byName.task, sameLeadOpp);
  assert.match(byName.training_handoff, sameLeadQuote);
  assert.match(byName.training_handoff, sameLeadOpp);
  // Every "return exists" is one of the two consistency queries; nothing else returns a record lookup.
  for (const b of branches) {
    for (const ret of b.body.match(/return exists \([\s\S]*?\n\s*\);/g) ?? []) {
      assert.ok(sameLeadOpp.test(ret) || sameLeadQuote.test(ret), `branch ${b.name} returns an unchecked lookup`);
    }
  }
  // The only unconditional "return true" is a task tied to the lead alone.
  const trues = branches.filter((b) => /return true;/.test(b.body)).map((b) => b.name);
  assert.deepEqual(trues, ["task"]);
  const task = byName.task;
  assert.ok(task.indexOf("return true;") > task.lastIndexOf("if p_opportunity_id is not null then"), "task lead-only return comes after the context checks");
});

// ---- 5. RPC-only types ------------------------------------------------------------------------------------------
check("5. RPC-only activity types have no branch and are rejected", () => {
  const allowed = new Set(branches.flatMap((b) => b.types));
  for (const type of RPC_ONLY) {
    assert.ok(!allowed.has(type), `${type} is in the direct-write allow-list`);
    assert.ok(!helperRaw.includes(`'${type}'`), `${type} appears in the helper`);
    for (const [o, q] of [[false, false], [true, false], [true, true], [false, true]] as const) {
      assert.equal(branchFor(type, o, q), null, `${type} must not match a branch`);
    }
  }
  assert.equal(branchFor("made_up_type", false, false), null);
});

// ---- 6. Attribution -------------------------------------------------------------------------------------------
check("6. attribution INSERT and UPDATE require editor + Leads edit (USING and WITH CHECK)", () => {
  const need = /^\s*app\.has_min_role\('editor'::public\.user_role\)\s+and public\.has_module_access_level\('sales_leads', 'edit'\)\s*$/;
  const ins = sql.match(/create policy sales_lead_attributions_insert on public\.sales_lead_attributions\s+for insert to authenticated\s+with check \(([\s\S]*?)\);/);
  assert.ok(ins, "insert policy missing");
  assert.match(ins![1], need);
  const upd = sql.match(/create policy sales_lead_attributions_update on public\.sales_lead_attributions\s+for update to authenticated\s+using \(([\s\S]*?)\)\s+with check \(([\s\S]*?)\);/);
  assert.ok(upd, "update policy missing");
  assert.match(upd![1], need);
  assert.match(upd![2], need);
  assert.equal([...sql.matchAll(/create policy (\w+) on public\.sales_lead_attributions/g)].length, 2, "only INSERT and UPDATE are replaced");
  assert.doesNotMatch(sql, /sales_lead_attributions_select|sales_activity_select/, "SELECT policies are out of scope");
});

// ---- 7. Role floors ---------------------------------------------------------------------------------------------
check("7. each application writer's role floor is enforced", () => {
  for (const w of APP_WRITERS) {
    const b = branchFor(w.type, w.opp, w.quot);
    assert.ok(b, `${w.writer}: no branch`);
    assert.equal(floorOf(b!, w.type), w.floor, `${w.writer}: floor`);
  }
  // Admin-only lead types must not fall through to the editor floor.
  const lead = branches.find((b) => b.name === "lead")!;
  assert.match(lead.body, /if p_type = 'note_added' then\s*\n\s*return app\.has_min_role\('editor'::public\.user_role\);\s*\n\s*end if;\s*\n\s*return app\.is_admin\(\);/);
});

// ---- 8. Missing or unsupported context --------------------------------------------------------------------------
check("8. activity without its required context is rejected", () => {
  for (const type of ["quotation_created", "quotation_sent", "quotation_revised"]) {
    assert.equal(branchFor(type, false, false), null, `${type} without opportunity/quotation`);
    assert.equal(branchFor(type, true, false), null, `${type} without quotation`);
    assert.equal(branchFor(type, false, true), null, `${type} without opportunity`);
  }
  for (const type of ["company_linked", "company_created"]) {
    assert.equal(branchFor(type, false, false), null, `${type} without opportunity`);
    assert.equal(branchFor(type, true, true), null, `${type} with a quotation`);
  }
  assert.equal(branchFor("training_handoff_created", false, false), null);
  assert.equal(branchFor("training_handoff_created", false, true), null);
  for (const type of ["won", "lost", "followup_scheduled", "priority_changed", "qualification_changed", "temperature_changed"]) {
    assert.equal(branchFor(type, true, false), null, `${type} with an opportunity`);
  }
});

// ---- Positive compatibility -------------------------------------------------------------------------------------
check("legitimate application writers each match exactly one branch with the right module(s)", () => {
  for (const w of APP_WRITERS) {
    const matches = branches.filter((b) => b.types.includes(w.type) && fits(b.opp, w.opp) && fits(b.quot, w.quot));
    assert.ok(matches.length >= 1, `${w.writer}: no branch`);
    const b = matches[0];
    const mods = [...new Set(moduleChecks(b.body).map((m) => m.split(":")[0]))];
    for (const m of w.modules) assert.ok(mods.includes(m), `${w.writer}: branch ${b.name} does not check ${m}`);
    if (w.modules.length === 1) {
      // A single-module writer may only depend on the companies check when it is company_created.
      const extra = mods.filter((m) => !w.modules.includes(m));
      assert.ok(extra.every((m) => m === "companies"), `${w.writer}: unexpected module ${extra}`);
    }
  }
});

// ---- Scope guard ------------------------------------------------------------------------------------------------
check("scope: only verified columns, no CHECK/table/trigger/privilege/data changes", () => {
  assert.doesNotMatch(sql, /participant_id|schedule_id|task_id/, "unverified column referenced");
  assert.doesNotMatch(sql, /sales_activity_type_check|add constraint|drop constraint/i);
  assert.doesNotMatch(sql, /\b(?:create|alter|drop)\s+table\b/i);
  assert.doesNotMatch(sql, /\btrigger\b/i);
  assert.doesNotMatch(sql, /\b(?:grant|revoke)\b[^;]*\bon\s+(?:table\s+)?public\.[a-z_]+/i, "table privileges are out of scope");
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i, "no data change");
  assert.doesNotMatch(sql, /force row level security/i);
  assert.match(sql, /raise exception 'ms2_precondition_failed/);
});

console.log(failures ? `\n${failures} check(s) failed, ${passed} passed.` : `${passed} check(s) passed.`);
if (failures) process.exit(1);
