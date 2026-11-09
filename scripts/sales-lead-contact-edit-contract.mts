import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// Static and pure-logic contract for the Sales lead contact correction (overlay) feature.
// No database, network or browser: database behaviour is verified only in the Staging UAT (G3),
// and mobile UI / accessibility only by real browser testing.
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8").replace(/\r\n/g, "\n");
let failures = 0;
let total = 0;
const check = (name: string, fn: () => void) => {
  total += 1;
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const noComments = (sql: string) => sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
// Comment-only and blank lines removed: what is left is the executable SQL, which must stay identical
// to the reviewed version that was applied to Custom Staging.
const raw_executable = (sql: string) => sql.split("\n").filter((line) => !line.trimStart().startsWith("--") && line.trim() !== "").join("\n");
const before = (haystack: string, a: string, b: string) => {
  const i = haystack.indexOf(a); const j = haystack.indexOf(b);
  assert.ok(i >= 0, `missing: ${a}`); assert.ok(j >= 0, `missing: ${b}`); assert.ok(i < j, `${a} must come before ${b}`);
};

// ---- Migrations -------------------------------------------------------------
const files = {
  table: "supabase/migrations/20261108100000_sales_lead_contact_overrides.sql",
  type: "supabase/migrations/20261108100100_sales_activity_contact_details_updated_type.sql",
  rpc: "supabase/migrations/20261108100200_update_sales_lead_contact_rpc.sql",
  view: "supabase/migrations/20261108100300_v_sales_lead_inbox_apply_contact_overrides.sql",
  fix: "supabase/migrations/20261108100400_fix_sales_lead_contact_array_append.sql",
};
const table = noComments(read(files.table));
const typeSql = noComments(read(files.type));
const rpc = noComments(read(files.rpc));
const view = noComments(read(files.view));
const fixSql = noComments(read(files.fix));

check("migrations: five files, ordered after every earlier migration", () => {
  const names = readdirSync(new URL("supabase/migrations/", root)).filter((n) => n.endsWith(".sql")).sort();
  const tail = names.slice(-5);
  assert.deepEqual(tail, Object.values(files).map((f) => f.split("/").pop()));
});
check("migrations: forward-only (no drop table/column, truncate, delete)", () => {
  for (const sql of [table, typeSql, rpc, view, fixSql]) assert.doesNotMatch(sql, /^\s*(drop\s+(table|column)\b|truncate\b|delete\s+from\b)/im);
});
check("table: complete-record columns, version, actor and timestamp columns", () => {
  for (const col of ["lead_metadata_id uuid not null unique", "contact_name text not null", "company text", "email text", "phone text", "version integer not null default 1", "created_by uuid not null", "updated_by uuid", "created_at timestamptz not null default now()", "updated_at timestamptz not null default now()"]) assert.ok(table.includes(col), col);
  assert.match(table, /check \(email is not null or phone is not null\)/);
  assert.match(table, /char_length\(btrim\(contact_name\)\) between 1 and 120/);
});
check("table: RLS on, select for editor+, DML revoked from authenticated and anon", () => {
  assert.match(table, /enable row level security/);
  assert.match(table, /using \(app\.has_min_role\('editor'::public\.user_role\)\)/);
  assert.match(table, /revoke all on public\.sales_lead_contact_overrides from public, anon, authenticated;/);
  assert.match(table, /grant select on public\.sales_lead_contact_overrides to authenticated;/);
  assert.equal((table.match(/^grant\b/gim) ?? []).length, 1);
  assert.doesNotMatch(table, /grant (insert|update|delete|all)/i);
});
check("table: updated_at, actor stamp and audit triggers attached", () => {
  assert.match(table, /before update on public\.sales_lead_contact_overrides[\s\S]*app\.set_updated_at\(\)/);
  assert.match(table, /before insert or update on public\.sales_lead_contact_overrides[\s\S]*app\.stamp_actor\(\)/);
  assert.match(table, /after insert or update or delete on public\.sales_lead_contact_overrides[\s\S]*app\.audit_trigger\(\)/);
});
check("table: post-condition aborts on unexpected privileges", () => {
  assert.match(table, /lead_contact_postcondition_failed/);
  assert.match(table, /has_table_privilege\('anon'/);
});

const ORIGINAL_TYPES = ["assigned", "company_created", "company_linked", "followup_scheduled", "invoice_cancelled", "invoice_created", "invoice_issued", "invoice_paid", "invoice_partially_paid", "lead_created", "lost", "note_added", "opportunity_created", "opportunity_lost", "opportunity_reversed", "opportunity_won", "payment_recorded", "priority_changed", "proposal_sent", "qualification_changed", "quotation_accepted", "quotation_cancelled", "quotation_created", "quotation_rejected", "quotation_revised", "quotation_sent", "receipt_issued", "registration_completed", "status_changed", "task_cancelled", "task_completed", "task_created", "task_reopened", "temperature_changed", "training_handoff_created", "won"];
check("type migration: keeps all 36 existing activity types and adds exactly one", () => {
  const listed = [...(/array\[([\s\S]*?)\]::text\[\]/.exec(typeSql)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.equal(listed.length, 37);
  assert.deepEqual(listed.filter((t) => !ORIGINAL_TYPES.includes(t)), ["contact_details_updated"]);
  for (const t of ORIGINAL_TYPES) assert.ok(listed.includes(t), `lost type ${t}`);
});
check("type migration: refuses to overwrite a drifted constraint definition", () => {
  assert.match(typeSql, /4f5a287306dfc57f6b3ae5be23c73579/);
  assert.match(typeSql, /lead_contact_precondition_failed/);
});

check("rpc: security definer with a pinned search_path", () => {
  assert.match(rpc, /security definer/);
  assert.match(rpc, /set search_path = pg_catalog, public/);
});
check("rpc: authorization is checked before any read or write", () => {
  const auth = rpc.indexOf("raise exception 'forbidden'");
  assert.ok(auth > 0);
  assert.ok(auth < rpc.indexOf("from public.sales_lead_metadata"));
  assert.ok(auth < rpc.indexOf("insert into"));
  assert.ok(auth < rpc.indexOf("update public."));
  const guard = rpc.slice(rpc.indexOf("begin") , auth);
  assert.match(guard, /v_actor is null/);
  assert.match(guard, /app\.has_min_role\('editor'::public\.user_role\)/);
  assert.match(guard, /public\.has_module_access_level\('sales_leads', 'edit'\)/);
});
check("rpc: actor and time come from the database, never from parameters", () => {
  assert.match(rpc, /v_actor uuid := auth\.uid\(\)/);
  const signature = /create or replace function[\s\S]*?\) returns integer/.exec(rpc)?.[0] ?? "";
  assert.doesNotMatch(signature, /actor|created|updated|_at|timestamp|user_id/i);
});
check("rpc: serialises per lead and checks the optimistic version (first edit uses NULL)", () => {
  assert.match(rpc, /from public\.sales_lead_metadata\s+where id = p_lead_metadata_id\s+for update/);
  assert.match(rpc, /p_expected_version is distinct from v_ovr\.version/);
  assert.match(rpc, /elsif p_expected_version is not null then\s+raise exception 'stale_update'/);
  assert.match(rpc, /version = version \+ 1/);
  before(rpc, "for update", "insert into public.sales_lead_contact_overrides");
});
check("rpc: only enquiry, proposal_request and internal leads are supported", () => {
  assert.match(rpc, /v_source not in \('enquiry', 'proposal_request', 'internal'\)/);
  assert.match(rpc, /source_not_supported/);
});
check("rpc: timeline metadata holds field names and version only, no personal values", () => {
  const insert = /insert into public\.sales_activity[\s\S]*?\);/.exec(rpc)?.[0] ?? "";
  assert.match(insert, /jsonb_build_object\('fields', to_jsonb\(v_fields\), 'version', v_version\)/);
  assert.match(insert, /'Contact details corrected'/);
  assert.doesNotMatch(insert, /v_name|v_email|v_phone|v_company|v_cur_|p_contact_name|p_email|p_phone|p_company/);
});
check("rpc: error messages are fixed codes (no value interpolation)", () => {
  for (const m of rpc.matchAll(/raise exception ([^;]*);/g)) assert.doesNotMatch(m[1], /%|format\(|\|\|/);
});
check("rpc: explicit EXECUTE grant to authenticated only; anon and PUBLIC revoked; service_role never granted by the migration", () => {
  assert.match(rpc, /revoke all on function public\.update_sales_lead_contact\(uuid, integer, text, text, text, text\)\s+from public, anon, authenticated;/);
  assert.match(rpc, /grant execute on function public\.update_sales_lead_contact\(uuid, integer, text, text, text, text\)\s+to authenticated;/);
  assert.doesNotMatch(rpc, /to [^;]*service_role/);
});
check("rpc: documents the observed service_role platform-default EXECUTE and that a grant alone authorizes nothing", () => {
  const raw = read(files.rpc);
  const header = raw.slice(0, raw.indexOf("create or replace function"));
  assert.match(header, /authenticated is the intended application caller/);
  assert.match(header, /anon and PUBLIC are denied EXECUTE/);
  assert.match(header, /service_role ALSO holds EXECUTE because Supabase default\n-- privileges/);
  assert.match(header, /An EXECUTE grant alone authorizes nothing/);
  assert.match(header, /denial was observed without an authenticated user identity/);
  assert.match(header, /other privileged execution\n-- contexts were not tested/);
  assert.doesNotMatch(header, /service_role have none|authenticated only; anon, PUBLIC and service_role/);
});
check("rpc: the authorization guard is unchanged by the documentation correction (role AND module edit before any access)", () => {
  const guard = rpc.slice(rpc.indexOf("begin"), rpc.indexOf("raise exception 'forbidden'"));
  assert.match(guard, /v_actor is null\s+or not app\.has_min_role\('editor'::public\.user_role\)\s+or not public\.has_module_access_level\('sales_leads', 'edit'\)/);
  // The executable statements (comment-only and blank lines removed) match the reviewed Staging-applied migration.
  const executable = raw_executable(read(files.rpc));
  assert.equal(sha256(executable), "812edb8336949b35210908890a9923fff6c23a7fdfaf611e419ccf0613fe44e4");
});
check("rpc: normalises the compared values so untouched fields are not reported", () => {
  assert.match(rpc, /v_cur_email := nullif\(lower\(btrim\(coalesce\(v_cur_email/);
  assert.match(rpc, /cardinality\(v_fields\) = 0[\s\S]*no_changes/);
});

// ---- Remediation migration 5: explicit array_append (the original 22P02 failure) ------------------
const fnText = (sql: string) => {
  const start = sql.indexOf("create or replace function public.update_sales_lead_contact(");
  const endMarker = "end;\n$$;\n";
  return sql.slice(start, sql.indexOf(endMarker, start) + endMarker.length);
};
const fnRaw3 = fnText(read(files.rpc));
const fnRaw5 = fnText(read(files.fix));
const FIELD_APPENDS = ["contact_name", "company", "email", "phone"];
check("fix: no ambiguous v_fields || 'literal' remains, and nothing else concatenates a bare literal onto the list", () => {
  assert.doesNotMatch(fnRaw5, /v_fields\s*\|\|/);
  // The postcondition DO block names the forbidden pattern as a string literal on purpose.
  assert.equal((fixSql.match(/v_fields\s*\|\|/g) ?? []).length, 1);
  assert.match(fixSql, /position\('v_fields \|\|' in v_def\) > 0/);
  assert.equal((fnRaw5.match(/v_fields\s*:=/g) ?? []).length, 4, "exactly the four appends assign to the list after its declaration");
});
check("fix: every editable field uses an explicitly typed array_append", () => {
  for (const f of FIELD_APPENDS) assert.ok(fnRaw5.includes(`v_fields := array_append(v_fields, '${f}'::text);`), f);
  assert.equal((fnRaw5.match(/array_append\(v_fields, '[a-z_]+'::text\)/g) ?? []).length, 4);
});
check("fix: the original migration 3 is untouched (it still holds the historical defect, only its header comments changed)", () => {
  assert.equal((fnRaw3.match(/v_fields := v_fields \|\| '[a-z_]+';/g) ?? []).length, 4);
});
check("fix: the function body equals migration 3 except for the four appends (guard, lock, version, validation, audit unchanged)", () => {
  let reverted = fnRaw5;
  for (const f of FIELD_APPENDS) reverted = reverted.replace(`array_append(v_fields, '${f}'::text)`, `v_fields || '${f}'`);
  assert.equal(raw_executable(reverted), raw_executable(fnRaw3));
});
check("fix: signature, return type, SECURITY DEFINER and pinned search_path are preserved", () => {
  const head = (t: string) => t.slice(0, t.indexOf("as $$"));
  assert.equal(head(fnRaw5), head(fnRaw3));
  assert.match(fnRaw5, /\) returns integer\nlanguage plpgsql\nsecurity definer\nset search_path = pg_catalog, public\nas \$\$/);
});
check("fix: the three authorization requirements stay mandatory and first (auth.uid, editor role, sales_leads edit)", () => {
  assert.match(fnRaw5, /v_actor uuid := auth\.uid\(\)/);
  const body = fnRaw5.slice(fnRaw5.indexOf("begin\n"));
  const guard = body.slice(0, body.indexOf("raise exception 'forbidden'"));
  assert.match(guard, /v_actor is null\s+or not app\.has_min_role\('editor'::public\.user_role\)\s+or not public\.has_module_access_level\('sales_leads', 'edit'\)/);
  assert.ok(body.indexOf("raise exception 'forbidden'") < body.indexOf("from public.sales_lead_metadata"));
  assert.ok(body.indexOf("raise exception 'forbidden'") < body.indexOf("insert into"));
});
check("fix: concurrency stays unchanged (per-lead lock, NULL first version, stale rejection, version + 1)", () => {
  for (const s2 of ["for update;", "p_expected_version is distinct from v_ovr.version", "elsif p_expected_version is not null then", "version = version + 1", "raise exception 'stale_update'", "raise exception 'no_changes'"]) assert.ok(fnRaw5.includes(s2), s2);
});
check("fix: timeline metadata is still field names and version only (no contact values)", () => {
  const insert = /insert into public\.sales_activity[\s\S]*?\);/.exec(fnRaw5)?.[0] ?? "";
  assert.match(insert, /jsonb_build_object\('fields', to_jsonb\(v_fields\), 'version', v_version\)/);
  assert.doesNotMatch(insert, /v_name|v_email|v_phone|v_company|v_cur_|p_contact_name|p_email|p_phone|p_company/);
});
check("fix: privileges are not rewritten; the preflight and postcondition pin them (anon/PUBLIC denied, ACL identical, service_role never granted by the migration)", () => {
  assert.doesNotMatch(fixSql, /^\s*(grant|revoke)\b/im);
  assert.doesNotMatch(fixSql, /to [^;]*service_role/);
  const raw = read(files.fix);
  assert.match(raw, /lead_contact_fix_precondition_failed/);
  assert.match(raw, /lead_contact_fix_postcondition_failed/);
  assert.match(raw, /set_config\('lead_contact\.acl_before'/);
  assert.match(raw, /v_before is distinct from v_now/);
  assert.match(raw, /has_function_privilege\('anon', v_fn, 'execute'\)/);
  assert.match(raw, /a\.grantee = 0/);
  assert.match(raw, /'search_path=pg_catalog, public' = any \(p\.proconfig\)/);
  assert.match(raw, /<> 4 then/, "postcondition insists on exactly four array_append calls");
});
check("fix: documents the accepted service_role default EXECUTE, that a grant alone authorizes nothing, and the failure it repairs", () => {
  const raw = read(files.fix);
  const header = raw.slice(0, raw.indexOf("do $$"));
  assert.match(header, /22P02/);
  assert.match(header, /service_role holds the Supabase default EXECUTE/);
  assert.match(header, /an EXECUTE grant alone authorizes nothing/);
  assert.match(header, /NOT APPLIED anywhere yet/);
});
check("fix: the migration has no other object changes (no table, view, policy, trigger or constraint statements)", () => {
  assert.doesNotMatch(fixSql, /^\s*(create|alter|drop)\s+(table|view|policy|trigger|index|type|schema|extension)\b/im);
  assert.equal((fixSql.match(/^create or replace function /gim) ?? []).length, 1);
});

check("view: keeps the same 17 columns in the same order", () => {
  const select = view.slice(view.indexOf("select"), view.indexOf("from public.sales_lead_metadata m"));
  const aliases = [...select.matchAll(/\bas ([a-z_]+)\b/g)].map((m) => m[1]);
  assert.equal(aliases.length, 6, "only the id, the four contact columns and subject are aliased expressions");
  const expected = ["lead_metadata_id", "contact_name", "company", "email", "phone", "subject"];
  for (const e of expected) assert.ok(aliases.includes(e), e);
  assert.ok(select.includes("m.lead_source,") && select.includes("m.updated_at,"));
  assert.ok(select.indexOf("m.updated_at") < select.indexOf("as contact_name"));
  assert.ok(select.indexOf("as contact_name") < select.indexOf("as company") && select.indexOf("as company") < select.indexOf("as email") && select.indexOf("as email") < select.indexOf("as phone") && select.indexOf("as phone") < select.indexOf("as subject"));
  assert.match(view, /v_expected constant text :=\s+'lead_metadata_id:uuid, lead_source:text, source_id:uuid, status:text, assigned_to:uuid, follow_up_at:timestamp with time zone, priority:text, lost_reason:text, won_at:timestamp with time zone, is_test:boolean, created_at:timestamp with time zone, updated_at:timestamp with time zone, contact_name:text, company:text, email:text, phone:text, subject:text';/);
});
check("view: security_invoker restated and verified, privileges verified, no drop/recreate", () => {
  assert.match(view, /create or replace view public\.v_sales_lead_inbox\s+with \(security_invoker = true\) as/);
  assert.doesNotMatch(view, /drop view/i);
  assert.match(view, /'security_invoker=true' = any \(reloptions\)/);
  assert.match(view, /has_table_privilege\('anon', 'public\.v_sales_lead_inbox', 'select'\)/);
});
check("view: overlay applies to the three supported sources only, as a complete record", () => {
  assert.equal((view.match(/o\.id is not null and m\.lead_source in \('enquiry', 'proposal_request', 'internal'\)/g) ?? []).length, 4);
  assert.match(view, /left join public\.sales_lead_contact_overrides o on o\.lead_metadata_id = m\.id/);
  assert.match(view, /when 'marketing_contact' then coalesce\(mc\.full_name, mc\.email, mc\.phone\)/);
});

// ---- Validation (Zod) and helpers --------------------------------------------
const { salesLeadContactUpdateSchema, salesLeadContactTargetSchema, fieldErrors } = await import("../lib/validation/schemas.ts");
const lc = await import("../lib/sales/lead-contact.ts");

check("zod: a complete valid record passes and is trimmed", () => {
  const r = salesLeadContactUpdateSchema.safeParse({ contact_name: "  Aisyah  ", company: "  ABC  ", email: "  a@b.co  ", phone: "  012  " });
  assert.ok(r.success); assert.deepEqual(r.data, { contact_name: "Aisyah", company: "ABC", email: "a@b.co", phone: "012" });
});
check("zod: name is required and whitespace-only is rejected", () => {
  for (const name of ["", "   "]) assert.equal(salesLeadContactUpdateSchema.safeParse({ contact_name: name, company: "", email: "a@b.co", phone: "" }).success, false);
});
check("zod: email or phone is required, either is enough, optional values may be empty", () => {
  assert.equal(salesLeadContactUpdateSchema.safeParse({ contact_name: "A", company: "", email: "", phone: "" }).success, false);
  assert.equal(salesLeadContactUpdateSchema.safeParse({ contact_name: "A", company: "", email: "", phone: "012" }).success, true);
  assert.equal(salesLeadContactUpdateSchema.safeParse({ contact_name: "A", company: "", email: "a@b.co", phone: "" }).success, true);
  const e = salesLeadContactUpdateSchema.safeParse({ contact_name: "A", company: "", email: "", phone: "" });
  assert.ok(!e.success && fieldErrors(e.error).email === "Email or phone is required");
});
check("zod: invalid email and over-long values are rejected", () => {
  assert.equal(salesLeadContactUpdateSchema.safeParse({ contact_name: "A", email: "not-an-email", phone: "" }).success, false);
  assert.equal(salesLeadContactUpdateSchema.safeParse({ contact_name: "x".repeat(121), email: "a@b.co" }).success, false);
  assert.equal(salesLeadContactUpdateSchema.safeParse({ contact_name: "A", company: "x".repeat(161), email: "a@b.co" }).success, false);
  assert.equal(salesLeadContactUpdateSchema.safeParse({ contact_name: "A", phone: "1".repeat(41) }).success, false);
});
check("zod: target accepts a UUID with null or a positive integer version only", () => {
  const id = "2fcc0f61-e8f1-42e7-aa63-1ab988ea921c";
  for (const v of [null, 1, 7]) assert.equal(salesLeadContactTargetSchema.safeParse({ lead_metadata_id: id, expected_version: v }).success, true);
  for (const v of [0, -1, 1.5, "1", undefined]) assert.equal(salesLeadContactTargetSchema.safeParse({ lead_metadata_id: id, expected_version: v }).success, false);
  assert.equal(salesLeadContactTargetSchema.safeParse({ lead_metadata_id: "not-a-uuid", expected_version: null }).success, false);
});
check("helpers: supported sources are enquiry, proposal_request and internal only", () => {
  for (const s of ["enquiry", "proposal_request", "internal"]) assert.equal(lc.isContactEditableSource(s), true);
  for (const s of ["marketing_contact", "", null, undefined, "Enquiry"]) assert.equal(lc.isContactEditableSource(s as string), false);
});
check("helpers: normalisation lower-cases e-mail and trims; dirty/changed ignore case and spacing in e-mail", () => {
  assert.deepEqual(lc.normalizeContactValues({ contact_name: " A ", company: null, email: " X@Y.CO ", phone: undefined }), { contact_name: "A", company: "", email: "x@y.co", phone: "" });
  const base = { contact_name: "A", company: "C", email: "x@y.co", phone: "1" };
  assert.equal(lc.contactFormDirty(base, { ...base, email: "X@Y.CO " }), false);
  assert.deepEqual(lc.changedContactFields(base, { ...base, company: "", phone: "2" }), ["company", "phone"]);
});
check("helpers: original contact comes from the right source columns", () => {
  assert.deepEqual(lc.originalContactFromSource("enquiry", { name: "N", company: "C", email: "E@X.CO", phone: "P" }), { contact_name: "N", company: "C", email: "e@x.co", phone: "P" });
  assert.deepEqual(lc.originalContactFromSource("proposal_request", { contact_person: "N", company_name: "C", email: "e@x.co", phone: "P" }), { contact_name: "N", company: "C", email: "e@x.co", phone: "P" });
  assert.deepEqual(lc.originalContactFromSource("internal", { contact_name: "N", company_name: null, email: null, phone: "P" }), { contact_name: "N", company: "", email: "", phone: "P" });
  assert.equal(lc.originalContactFromSource("marketing_contact", { full_name: "N" }), null);
  assert.equal(lc.originalContactFromSource("enquiry", null), null);
});
check("helpers: database errors map to fixed messages that never echo input", () => {
  const cases: [Record<string, string>, string][] = [
    [{ code: "42501", message: "forbidden" }, "forbidden"],
    [{ code: "P0001", message: "stale_update" }, "stale"],
    [{ code: "P0001", message: "no_changes" }, "no_changes"],
    [{ code: "P0001", message: "invalid_email" }, "invalid"],
    [{ code: "P0001", message: "contact_method_required" }, "invalid"],
    [{ code: "P0001", message: "source_not_supported" }, "unsupported"],
    [{ code: "P0001", message: "lead_not_found" }, "not_found"],
    [{ code: "PGRST202", message: "Could not find the function public.update_sales_lead_contact secret@example.com" }, "unavailable"],
    [{ code: "XX000", message: "boom secret@example.com +60123456789" }, "error"],
  ];
  for (const [err, kind] of cases) {
    const r = lc.mapContactRpcError(err);
    assert.equal(r.kind, kind); assert.doesNotMatch(r.message, /secret@example\.com|\+60123456789|update_sales_lead_contact|public\./);
  }
  assert.equal(lc.mapContactRpcError(null).kind, "error");
});

// ---- Server Action -----------------------------------------------------------
const actions = read("app/admin/(protected)/sales/leads/actions.ts");
const body = actions.slice(actions.indexOf("export async function updateLeadContact"));
check("action: guard, validate, RLS client, RPC, in that order", () => {
  before(body, 'await requireRole("editor")', 'await requireModuleAccess("sales_leads", "edit")');
  before(body, 'await requireModuleAccess("sales_leads", "edit")', "salesLeadContactTargetSchema.safeParse");
  before(body, "salesLeadContactTargetSchema.safeParse", "salesLeadContactUpdateSchema.safeParse");
  before(body, "salesLeadContactUpdateSchema.safeParse", "await createSupabaseServerClient()");
  before(body, "await createSupabaseServerClient()", 'rpc("update_sales_lead_contact"');
});
check("action: no service-role client, no any-cast, error is checked, no message echoed to the user or log", () => {
  assert.doesNotMatch(body, /createSupabaseServiceClient|SERVICE_ROLE|as any/);
  assert.match(body, /const \{ data, error \} = await supabase\.rpc/);
  assert.match(body, /console\.error\("update_sales_lead_contact failed", \{ code: error\?\.code \?\? null, kind: mapped\.kind \}\)/);
  assert.doesNotMatch(body, /error\.message|error\?\.message|JSON\.stringify|parsed\.data\)/);
  assert.doesNotMatch(body.slice(body.indexOf("console.error")), /parsed\.data\.(contact_name|email|phone|company)(?![^\n]*p_)/);
});
check("action: passes the version the browser sent only after validation, and revalidates the Sales views", () => {
  assert.match(body, /p_expected_version: target\.data\.expected_version/);
  for (const p of ["/admin/sales/leads/${target.data.lead_metadata_id}", '"/admin/sales/leads"', '"/admin/sales/follow-ups"', '"/admin/sales"']) assert.ok(body.includes(p), p);
});
check("action: existing Sales actions are all still exported", () => {
  for (const name of ["createLead", "setLeadAttribution", "updateLeadStatus", "assignLead", "setLeadFollowUp", "updateLeadQualification", "updateLeadTemperature", "addLeadNote", "convertLeadToOpportunity", "markLeadTest"]) {
    assert.ok(new RegExp(`export async function ${name}\\b`).test(actions), name);
  }
});

// ---- UI and page wiring (static; real browser testing happens at G3/UAT) ----------
const sheet = read("app/admin/(protected)/sales/leads/[id]/LeadContactEditSheet.tsx");
const page = read("app/admin/(protected)/sales/leads/[id]/page.tsx");
check("sheet: shadcn Sheet, labelled fields with errors, required name, e-mail/phone input modes", () => {
  assert.match(sheet, /from "..\/..\/..\/..\/..\/..\/components\/ui\/sheet"/);
  assert.equal((sheet.match(/<Field\b/g) ?? []).length, 4);
  assert.match(sheet, /error=\{errors\.contact_name\}[^>]*required/);
  assert.match(sheet, /type="email"[\s\S]*inputMode="email"/);
  assert.match(sheet, /type="tel"[\s\S]*inputMode="tel"/);
  assert.match(sheet, /SheetTitle[\s\S]*SheetDescription/);
});
check("sheet: save/cancel, unsaved-changes protection and conflict handling", () => {
  for (const s of ["Save changes", "Cancel", "Saving…", "Discard changes", "Keep editing", "Reload latest details", "beforeunload", "onOpenChange={requestOpenChange}", "router.refresh()", "aria-busy={pending}", 'role="alert"', 'role="status"', "contactFormDirty(session.initial, values)"]) assert.ok(sheet.includes(s), s);
  assert.match(sheet, /disabled=\{pending \|\| !dirty\}/);
  assert.match(sheet, /if \(pending\) return;/);
});
check("sheet: 44px touch targets and no browser autofill of third-party data", () => {
  assert.match(sheet, /minHeight: 44/);
  assert.ok((sheet.match(/className="h-11"/g) ?? []).length >= 3);
  assert.ok((sheet.match(/autoComplete="off"/g) ?? []).length === 4);
  assert.doesNotMatch(sheet, /overflow-x|whitespace-nowrap/);
});
check("sheet: never touches Supabase or credentials directly", () => {
  assert.doesNotMatch(sheet, /supabase|SERVICE_ROLE|createClient/i);
});
check("page: the action is offered only when the capability, source and module edit level allow it", () => {
  assert.match(page, /isContactEditableSource\(row\.lead_source\)/);
  assert.match(page, /from\("sales_lead_contact_overrides"\)\.select\("version, contact_name, company, email, phone"\)/);
  assert.match(page, /rpc\("has_module_access_level", \{ p_module_key: "sales_leads", p_level: "edit" \}\)/);
  assert.match(page, /const contactEdit = contactEditable && !overlayFailed && editLevelResult\?\.data === true \? contactSnapshot : null;/);
  assert.match(page, /\{contactEdit && \(\s*<LeadContactEditSheet/);
});
check("page: marketing leads link to the Marketing module and the original submission is still read from the source", () => {
  assert.match(page, /row\.lead_source === "marketing_contact" && \(/);
  assert.match(page, /\/admin\/marketing\/contacts\/\$\{row\.source_id\}\/edit/);
  assert.match(page, /supabase\.from\("enquiries"\)\.select\("\*"\)\.eq\("id", row\.source_id\)/);
  assert.match(page, /supabase\.from\("v_sales_lead_inbox"\)\.select\("\*"\)\.eq\("lead_metadata_id", id\)/);
  assert.doesNotMatch(page, /createSupabaseServiceClient/);
});
check("scope: no service-role use, no old rate-limit, login or registration code in the new files", () => {
  for (const f of ["lib/sales/lead-contact.ts", "app/admin/(protected)/sales/leads/[id]/LeadContactEditSheet.tsx"]) assert.doesNotMatch(read(f), /rate-limit|createSupabaseServiceClient|api\/admin\/login|registration/i);
});

// ---- Regression: a stale submission result must not reappear when the Sheet is reopened ----
check("stale result: the result current at open is hidden, a newer one is shown, no result means nothing to hide", () => {
  const empty = {};
  const oldFailure = { status: "error", message: "old" };
  const newFailure = { status: "error", message: "new" };
  assert.equal(lc.visibleSubmissionState(oldFailure, oldFailure, empty), empty, "same object as at open is hidden");
  assert.equal(lc.visibleSubmissionState(newFailure, oldFailure, empty), newFailure, "a newer submission is shown");
  assert.equal(lc.visibleSubmissionState(oldFailure, null, empty), oldFailure, "before the first open nothing is dismissed");
  assert.equal(lc.visibleSubmissionState(empty, empty, empty), empty);
});
check("stale result: the Sheet records the current result on a fresh open and filters what it shows", () => {
  assert.match(sheet, /const \[dismissedAtOpen, setDismissedAtOpen\] = useState<LeadContactActionState \| null>\(null\);/);
  assert.match(sheet, /const shown = visibleSubmissionState\(state, dismissedAtOpen, INITIAL\);/);
  assert.match(sheet, /const errors = shown\.errors \?\? \{\};/);
  assert.match(sheet, /const failure = shown\.status === "error" \? shown : null;/);
  const open = sheet.slice(sheet.indexOf("function requestOpenChange"), sheet.indexOf("function discardAndClose"));
  const fresh = open.slice(0, open.indexOf("return;"));
  assert.match(fresh, /setDismissedAtOpen\(state\)/);
  assert.match(fresh, /setValues\(initial\)/);
  assert.doesNotMatch(open.slice(open.indexOf("return;")), /setDismissedAtOpen/, "closing must not reset the filter");
});
check("stale result: editing-session input, the unsaved-changes confirmation and the version stay intact", () => {
  assert.match(sheet, /updateLeadContact\.bind\(null, leadMetadataId, session\.version\)/);
  assert.match(sheet, /if \(dirty\) \{\s*setConfirmDiscard\(true\);\s*return;\s*\}/);
  const fresh = sheet.slice(sheet.indexOf("function requestOpenChange"), sheet.indexOf("function discardAndClose"));
  assert.equal((fresh.match(/setValues\(/g) ?? []).length, 1, "values are reset only on a fresh open");
  assert.doesNotMatch(sheet, /sheet\.tsx|animation|keyframes/i, "shared Sheet animation and styling untouched");
});

// ---- Tailwind: the Sheet's utilities must actually be generated (the second G3 defect) --------
const twPath = fileURLToPath(new URL("app/admin/admin-tailwind.css", root));
const twCss = read("app/admin/admin-tailwind.css");
const SHEET_SOURCE = '@source "./(protected)/sales/leads/*/LeadContactEditSheet.tsx";';
const SHEET_UTILITIES = [".p-4", ".pt-2", ".mt-auto", ".flex-1", ".border-b", ".overflow-y-auto", ".max-w-\\[480px\\]", ".w-full", ".gap-1", ".gap-2", ".gap-3", ".flex-wrap", ".text-lg", ".h-11", ".flex-col"];
check("tailwind: the narrow @source entry for the Sheet is present and scanning stays source(none)", () => {
  assert.ok(twCss.includes(SHEET_SOURCE));
  assert.match(twCss, /@import "tailwindcss\/utilities" layer\(utilities\) source\(none\);/);
  const sources = twCss.match(/^@source .*;$/gm) ?? [];
  assert.equal(sources.length, 9, "the eight existing entries plus the Sheet");
  assert.deepEqual(sources.filter((l) => l.includes("**")), ['@source "../../components/ui/**/*.{ts,tsx}";'], "only the existing primitives glob may be recursive");
  assert.doesNotMatch(twCss, /@source "(\.\.\/)*(app|components)\/?\*\*/);
  assert.doesNotMatch(twCss, /@import "tailwindcss";|source\((?!none)/);
});
check("tailwind: the shared Sheet primitive and its animation rules are unchanged", () => {
  assert.equal(sha256(read("components/ui/sheet.tsx")), "ed88a177989e4391803d83e68fcc0e3626b1248b1f9f7052cb7a0e4cf8ca92a7");
  for (const rule of ['.teras-admin [data-slot="sheet-content"][data-state="open"] { animation: ta-sheet-in 0.22s ease-out; }', '.teras-admin [data-slot="sheet-content"][data-state="closed"] { animation: ta-sheet-out 0.18s ease-in; }', "@keyframes ta-sheet-in { from { transform: translateX(-100%); } }", "@keyframes ta-sheet-out { to { transform: translateX(-100%); } }"]) assert.ok(twCss.includes(rule), rule);
});
const postcss = (await import("postcss")).default;
const tailwindPostcss = (await import("@tailwindcss/postcss")).default;
const compile = async (css: string) => (await postcss([tailwindPostcss()]).process(css, { from: twPath })).css;
const generated = await compile(twCss);
const withoutSheet = await compile(twCss.replace(SHEET_SOURCE + "\n", ""));
check("tailwind: every utility the Sheet uses is generated for the admin stylesheet", () => {
  for (const u of SHEET_UTILITIES) assert.ok(generated.includes(u + " {") || generated.includes(u + "{") || generated.includes(u + "\n"), `${u} missing from generated CSS`);
});
check("tailwind: the test is sensitive (without the @source entry the missing layout utilities are exactly the ones the G3 UAT lacked)", () => {
  const missing = SHEET_UTILITIES.filter((u) => !(withoutSheet.includes(u + " {") || withoutSheet.includes(u + "{") || withoutSheet.includes(u + "\n")));
  assert.deepEqual(missing.sort(), [".border-b", ".flex-1", ".max-w-\\[480px\\]", ".mt-auto", ".overflow-y-auto", ".p-4", ".pt-2"].sort());
});
check("tailwind: the new entry adds utilities only, with no unscoped or element-level rules", () => {
  const selectors = (css: string) => new Set([...css.matchAll(/^\s*(\.[A-Za-z0-9_\\\[\]:.\-\/]+)\s*\{/gm)].map((m) => m[1]));
  const added = [...selectors(generated)].filter((x) => !selectors(withoutSheet).has(x));
  assert.ok(added.length >= 5 && added.length <= 12, `unexpected number of added selectors: ${added.length}`);
  for (const a of added) assert.match(a, /^\.(?:p-4|pt-2|mt-auto|flex-1|border-b|overflow-y-auto|max-w-\\\[480px\\\])$/, `unexpected generated selector ${a}`);
  assert.equal(generated.replace(/\s+/g, " ").includes("* {"), withoutSheet.replace(/\s+/g, " ").includes("* {"));
});

// ---- C2 concurrency integrity: value/version pairing (the G3 lost-update defect) -----------------
// The database is modelled in memory with the semantics of update_sales_lead_contact (migration 5): version
// check first, then change detection against the effective values, then a complete-record write. The model is
// a stand-in for reasoning about read interleavings; the real RPC is separately pinned by the static checks
// below, and real two-session behaviour is only proven in the authorized Staging UAT.
type Contact = { contact_name: string; company: string | null; email: string | null; phone: string | null };
type Overlay = Contact & { version: number };
const ORIGINAL: Contact = { contact_name: "Original Name", company: "Original Co", email: "original@example.invalid", phone: "+60 11-111 1111" };
const pick = (c: Contact): Contact => ({ contact_name: c.contact_name, company: c.company, email: c.email, phone: c.phone });
const makeDb = (overlay: Overlay | null = null) => {
  const db = {
    source: { ...ORIGINAL } as Contact,
    overlay: overlay ? ({ ...overlay } as Overlay) : null,
    view: (): Contact => (db.overlay ? pick(db.overlay) : { ...db.source }),
    readOverlay: async () => ({ data: db.overlay ? ({ ...db.overlay } as Overlay) : null, error: null as unknown }),
    readLead: async () => ({ data: db.view() as Contact | null, error: null as unknown }),
    submit(expected: number | null, values: Contact): { ok: true; version: number } | { ok: false; reason: "stale" | "no_changes" } {
      const next = lc.normalizeContactValues(values);
      if (db.overlay ? expected !== db.overlay.version : expected !== null) return { ok: false, reason: "stale" };
      if (lc.changedContactFields(db.view(), next).length === 0) return { ok: false, reason: "no_changes" };
      const version = (db.overlay?.version ?? 0) + 1;
      db.overlay = { contact_name: next.contact_name, company: next.company || null, email: next.email || null, phone: next.phone || null, version };
      return { ok: true, version };
    },
  };
  return db;
};
type Db = ReturnType<typeof makeDb>;
const OTHER_USER: Contact = { contact_name: "Corrected Name", company: "Corrected Co", email: "corrected@example.invalid", phone: "+60 22-222 2222" };
const commitOtherUser = (db: Db, patch: Partial<Contact> = {}) => { const r = db.submit(db.overlay?.version ?? null, { ...OTHER_USER, ...patch }); assert.ok(r.ok, "the other user's correction must commit"); };
// What the page used to do: the lead first, the version afterwards.
const readViewFirst = async (db: Db, between: () => void) => {
  const lead = await db.readLead();
  between();
  const overlay = await db.readOverlay();
  return { version: overlay.data?.version ?? null, initial: lc.normalizeContactValues(lead.data as Contact) };
};
// The user changes only the phone and saves; every other field is submitted as the form held it.
const saveOnlyPhone = (db: Db, snap: { version: number | null; initial: Contact }) => {
  const current = lc.normalizeContactValues(db.view());
  const result = db.submit(snap.version, { ...snap.initial, phone: "+60 33-333 3333" });
  const overwroteWithStale = result.ok && (["contact_name", "company", "email"] as const).some((f) => lc.normalizeContactValues(db.view())[f] !== current[f]);
  return { result, overwroteWithStale };
};
type Hook = () => void;
const readOverlayFirst = async (db: Db, hooks: { beforeOverlay?: Hook; betweenReads?: Hook; afterBoth?: Hook }) => {
  hooks.beforeOverlay?.();
  const out = await lc.readLeadContactSnapshot<Contact>({
    overlay: async () => { const r = await db.readOverlay(); hooks.betweenReads?.(); return r; },
    lead: () => db.readLead(),
  });
  hooks.afterBoth?.();
  return out.snapshot as { version: number | null; initial: Contact };
};
// A second database in the same state, so the mutant and the proper snapshot are each tried on a fresh copy.
const makeDbLike = (db: Db) => makeDb(db.overlay);
const POINTS = ["beforeOverlay", "betweenReads", "afterBoth", "none"] as const;
const startStates: Array<[string, () => Db]> = [
  ["no correction yet", () => makeDb()],
  ["correction v1 exists", () => { const db = makeDb(); commitOtherUser(db, { contact_name: "First Correction" }); return db; }],
];

const asyncChecks: Array<Promise<void>> = [];
const asyncCheck = (name: string, fn: () => Promise<void>) => {
  total += 1;
  asyncChecks.push(fn().then(() => console.log(`LULUS ${name}`), (error) => { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }));
};
asyncCheck("c2: the old view-first read pairs stale values with a newer version and the save silently overwrites the other user's correction (defect reproduced)", async () => {
  const db = makeDb();
  const snap = await readViewFirst(db, () => commitOtherUser(db));
  assert.equal(snap.version, 1, "the version is newer than the values");
  assert.equal(snap.initial.contact_name, ORIGINAL.contact_name, "the values are the old ones");
  const { result, overwroteWithStale } = saveOnlyPhone(db, snap);
  assert.equal(result.ok, true, "the database accepts it: no stale_update");
  assert.equal(overwroteWithStale, true);
  assert.equal(db.overlay?.contact_name, ORIGINAL.contact_name, "the other user's name is gone");
});
asyncCheck("c2: overlay-first read never allows a silent overwrite, for every commit timing and both starting states", async () => {
  let combos = 0;
  for (const [label, start] of startStates) {
    for (const point of POINTS) {
      for (const commitBeforeSave of [false, true]) {
        const db = start();
        const hooks: { beforeOverlay?: Hook; betweenReads?: Hook; afterBoth?: Hook } = {};
        if (point !== "none") hooks[point] = () => commitOtherUser(db, { phone: "+60 44-444 4444" });
        const snap = await readOverlayFirst(db, hooks);
        if (commitBeforeSave) commitOtherUser(db, { company: "Late Co" });
        const { result, overwroteWithStale } = saveOnlyPhone(db, snap);
        assert.equal(overwroteWithStale, false, `${label} / ${point} / late=${commitBeforeSave}`);
        if (!result.ok) assert.equal(result.reason, "stale", `${label} / ${point}: the only safe refusal is a version conflict`);
        combos += 1;
      }
    }
  }
  assert.equal(combos, 16);
});
asyncCheck("c2: no correction yet and one commits between the two reads: values are newer than the missing version, so the save fails safe as stale", async () => {
  const db = makeDb();
  const snap = await readOverlayFirst(db, { betweenReads: () => commitOtherUser(db) });
  assert.equal(snap.version, null);
  assert.equal(snap.initial.contact_name, OTHER_USER.contact_name, "an unavoidable inconsistent timing: new values, no version");
  assert.deepEqual(saveOnlyPhone(db, snap).result, { ok: false, reason: "stale" });
});
asyncCheck("c2: correction exists and a newer one commits between the reads: values and version still come from the same older row, and the save is stale", async () => {
  const db = makeDb();
  commitOtherUser(db, { contact_name: "First Correction" });
  const snap = await readOverlayFirst(db, { betweenReads: () => commitOtherUser(db, { contact_name: "Second Correction" }) });
  assert.equal(snap.version, 1);
  assert.equal(snap.initial.contact_name, "First Correction");
  assert.deepEqual(saveOnlyPhone(db, snap).result, { ok: false, reason: "stale" });
});
asyncCheck("c2: overlay is read before the lead, strictly sequentially (the lead read does not even start until the overlay read has finished)", async () => {
  const log: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pending = lc.readLeadContactSnapshot<Contact>({
    overlay: async () => { log.push("overlay:start"); await gate; log.push("overlay:end"); return { data: null, error: null }; },
    lead: async () => { log.push("lead:start"); return { data: { ...ORIGINAL }, error: null }; },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(log, ["overlay:start"], "lead read must wait for the overlay read");
  release();
  await pending;
  assert.deepEqual(log, ["overlay:start", "overlay:end", "lead:start"]);
});
asyncCheck("c2: a failed overlay read is never treated as 'no correction yet'; a missing lead yields no snapshot", async () => {
  const failed = await lc.readLeadContactSnapshot<Contact>({
    overlay: async () => ({ data: null, error: { code: "42501" } }),
    lead: async () => ({ data: { ...ORIGINAL }, error: null }),
  });
  assert.equal(failed.overlayFailed, true);
  assert.equal(failed.snapshot, null, "no version null substitution");
  const noLead = await lc.readLeadContactSnapshot<Contact>({ overlay: async () => ({ data: null, error: null }), lead: async () => ({ data: null, error: null }) });
  assert.equal(noLead.overlayFailed, false);
  assert.equal(noLead.snapshot, null);
  const missing = await lc.readLeadContactSnapshot<Contact>({ overlay: async () => ({ data: null, error: null }), lead: async () => ({ data: { ...ORIGINAL }, error: null }) });
  assert.equal(missing.overlayFailed, false, "a genuinely missing row is not an error");
  assert.equal(missing.snapshot?.version, null);
});
check("c2: contactEditSnapshot takes values and version from the overlay row, or the lead row with a null version", () => {
  const lead = { contact_name: "Lead Name", company: "Lead Co", email: "lead@example.invalid", phone: "+60 1" };
  const overlay = { version: 4, contact_name: "  Overlay Name ", company: null, email: "OVERLAY@Example.invalid ", phone: null };
  assert.deepEqual(lc.contactEditSnapshot(overlay, lead), { version: 4, initial: { contact_name: "Overlay Name", company: "", email: "overlay@example.invalid", phone: "" } });
  assert.deepEqual(lc.contactEditSnapshot(null, lead), { version: null, initial: { contact_name: "Lead Name", company: "Lead Co", email: "lead@example.invalid", phone: "+60 1" } });
  assert.deepEqual(lc.contactEditSnapshot(null, { contact_name: "N", company: null, email: null, phone: "+60 2" }).initial, { contact_name: "N", company: "", email: "", phone: "+60 2" });
  assert.equal(lc.contactEditSnapshot({ ...overlay, version: 7 }, lead).initial.company, "", "no value is borrowed from the lead row when an overlay exists");
});
asyncCheck("c2: two tabs that load the same version: the first save wins, the second is stale and the first correction survives", async () => {
  const db = makeDb();
  commitOtherUser(db, { contact_name: "First Correction" });
  const tabA = await readOverlayFirst(db, {});
  const tabB = await readOverlayFirst(db, {});
  assert.equal(tabA.version, tabB.version);
  assert.equal(db.submit(tabA.version, { ...tabA.initial, phone: "+60 55-555 5555" }).ok, true);
  assert.deepEqual(db.submit(tabB.version, { ...tabB.initial, company: "Tab B Co" }), { ok: false, reason: "stale" });
  assert.equal(db.overlay?.phone, "+60 55-555 5555");
  assert.equal(db.overlay?.company, "Corrected Co", "tab B's stale values were not written");
});
asyncCheck("c2: two concurrent first edits both send a null version: one wins, the other is stale", async () => {
  const db = makeDb();
  const a = await readOverlayFirst(db, {});
  const b = await readOverlayFirst(db, {});
  assert.equal(a.version, null); assert.equal(b.version, null);
  assert.equal(db.submit(null, { ...a.initial, phone: "+60 66-666 6666" }).ok, true);
  assert.deepEqual(db.submit(null, { ...b.initial, phone: "+60 77-777 7777" }), { ok: false, reason: "stale" });
  assert.equal(db.overlay?.phone, "+60 66-666 6666");
});
asyncCheck("c2: an unchanged submission after an external update is rejected as stale, never reported as 'no changes' and never written", async () => {
  const db = makeDb();
  commitOtherUser(db, { contact_name: "First Correction" });
  const tab = await readOverlayFirst(db, {});
  commitOtherUser(db, { contact_name: "Second Correction" });
  const before = JSON.stringify(db.overlay);
  assert.deepEqual(db.submit(tab.version, tab.initial), { ok: false, reason: "stale" });
  assert.deepEqual(db.submit(tab.version, db.view()), { ok: false, reason: "stale" }, "even values equal to the current ones: the version decides first");
  assert.equal(JSON.stringify(db.overlay), before);
});
asyncCheck("c2: after a conflict, reloading obtains a fresh snapshot and the next save succeeds", async () => {
  const db = makeDb();
  commitOtherUser(db, { contact_name: "First Correction" });
  const stale = await readOverlayFirst(db, {});
  commitOtherUser(db, { contact_name: "Second Correction" });
  assert.deepEqual(saveOnlyPhone(db, stale).result, { ok: false, reason: "stale" });
  const fresh = await readOverlayFirst(db, {});
  assert.equal(fresh.version, 2);
  assert.equal(fresh.initial.contact_name, "Second Correction");
  assert.equal(saveOnlyPhone(db, fresh).result.ok, true);
});
asyncCheck("c2: original enquiry/proposal data is never written by any of these flows", async () => {
  const db = makeDb();
  commitOtherUser(db);
  const snap = await readOverlayFirst(db, {});
  saveOnlyPhone(db, snap);
  assert.deepEqual(db.source, ORIGINAL);
  assert.deepEqual(lc.originalContactFromSource("enquiry", { name: " Original Name ", company: "Original Co", email: "ORIGINAL@example.invalid", phone: "+60 11-111 1111" }), { contact_name: "Original Name", company: "Original Co", email: "original@example.invalid", phone: "+60 11-111 1111" });
});
check("c2: the real SQL keeps the properties the model relies on (lock before the overlay read, version check before change detection, no source-table writes)", () => {
  for (const sql of [rpc, fixSql]) {
    before(sql, "for update;", "from public.sales_lead_contact_overrides\n  where lead_metadata_id = p_lead_metadata_id");
    before(sql, "raise exception 'stale_update'", "raise exception 'no_changes'");
    before(sql, "p_expected_version is distinct from v_ovr.version", "raise exception 'no_changes'");
    assert.doesNotMatch(sql, /(insert\s+into|update|delete\s+from)\s+public\.(enquiries|proposal_requests|sales_internal_lead_sources|marketing_contacts)\b/i);
  }
  assert.match(table, /lead_metadata_id uuid not null unique/);
});

// ---- C2: the editing session baseline -------------------------------------------------------------
check("c2 session: a captured session is immutable and independent of the objects it was built from", () => {
  const initial = { contact_name: "A", company: "B", email: "c@example.invalid", phone: "" };
  const session = lc.captureContactEditSession(3, initial);
  initial.contact_name = "Changed later";
  assert.equal(session.initial.contact_name, "A");
  assert.equal(session.version, 3);
  assert.throws(() => { (session as { version: number | null }).version = 9; }, TypeError);
  assert.throws(() => { (session.initial as { contact_name: string }).contact_name = "x"; }, TypeError);
  assert.equal(lc.captureContactEditSession(null, initial).version, null);
});
asyncCheck("c2 session: parent props refreshed while the Sheet is open do not change the open session; dirty state compares against the captured values", async () => {
  const db = makeDb();
  commitOtherUser(db, { contact_name: "First Correction" });
  const first = await readOverlayFirst(db, {});
  const session = lc.captureContactEditSession(first.version, first.initial);
  commitOtherUser(db, { contact_name: "Second Correction" });
  const refreshed = await readOverlayFirst(db, {});
  assert.equal(refreshed.version, 2, "the page re-rendered with newer props");
  assert.equal(session.version, 1, "the open session keeps its own version");
  assert.equal(lc.contactFormDirty(session.initial, first.initial), false, "untouched input is not dirty, whatever the new props say");
  assert.equal(lc.contactFormDirty(session.initial, { ...first.initial, phone: "+60 88" }), true);
  // The user's input is preserved; saving it with the session version is rejected as stale ...
  assert.deepEqual(db.submit(session.version, { ...session.initial, phone: "+60 88-888 8888" }), { ok: false, reason: "stale" });
  // ... whereas re-binding the refreshed version to the old values would have silently overwritten.
  const rebound = db.submit(refreshed.version, { ...first.initial, phone: "+60 88-888 8888" });
  assert.equal(rebound.ok, true);
  assert.equal(db.overlay?.contact_name, "First Correction", "the unsafe re-binding restores the older name");
});
const pageReadsOverlayFirst = (src: string) => {
  const o = src.indexOf('overlay: () => supabase.from("sales_lead_contact_overrides")');
  const l = src.indexOf('lead: () => supabase.from("v_sales_lead_inbox")');
  return o >= 0 && l > o && /await readLeadContactSnapshot</.test(src) && !/Promise\.all\(\[[^\]]*sales_lead_contact_overrides/.test(src) && !/Promise\.all\(\[[^\]]*v_sales_lead_inbox/.test(src);
};
const sheetCapturesSession = (src: string) => {
  const open = src.slice(src.indexOf("function requestOpenChange"), src.indexOf("function discardAndClose"));
  const fresh = open.slice(0, open.indexOf("return;"));
  return /updateLeadContact\.bind\(null, leadMetadataId, session\.version\)/.test(src)
    && /contactFormDirty\(session\.initial, values\)/.test(src)
    && /useState<ContactEditSession>\(\(\) => captureContactEditSession\(expectedVersion, initial\)\)/.test(src)
    && (src.match(/setSession\(/g) ?? []).length === 1 && fresh.includes("setSession(captureContactEditSession(expectedVersion, initial))")
    && !/bind\(null, leadMetadataId, expectedVersion\)/.test(src) && !/contactFormDirty\(initial,/.test(src);
};
check("c2 static: the page reads the overlay (all four values and the version) before the lead, as separate awaited reads, and the Sheet binds its captured session", () => {
  assert.equal(pageReadsOverlayFirst(page), true);
  assert.equal(sheetCapturesSession(sheet), true);
  assert.match(page, /readLeadContactSnapshot<SalesLeadInboxRow>/);
  assert.match(page, /expectedVersion=\{contactEdit\.version\}\s*\n\s*initial=\{contactEdit\.initial\}/);
  assert.doesNotMatch(page, /createSupabaseServiceClient|as any/);
  assert.equal(sha256(read("app/admin/(protected)/sales/leads/actions.ts")).length, 64);
});
check("c2 static: the 17-column inbox view, the RPC and the privileges are untouched by this change", () => {
  assert.match(view, /create or replace view public\.v_sales_lead_inbox/);
  assert.doesNotMatch(fixSql, /^\s*(grant|revoke)\b/im);
  assert.equal(sha256(read(files.fix)), "ae35f87744cb6c9ee6d3ccb9a8e1a4b48235b98c54949bed25ab653413af12df");
});

// ---- Mutation tests: reintroducing the unsafe behaviour must fail the regression checks -----------
asyncCheck("mutation: a view-first reader is detected as unsafe by the same interleaving checks", async () => {
  let unsafe = 0;
  for (const point of ["beforeOverlay", "betweenReads", "afterBoth"] as const) {
    const db = makeDb();
    const snap = await readViewFirst(db, point === "betweenReads" ? () => commitOtherUser(db) : () => {});
    if (point === "afterBoth") commitOtherUser(db);
    if (saveOnlyPhone(db, snap).overwroteWithStale) unsafe += 1;
  }
  assert.ok(unsafe >= 1, "at least the between-reads interleaving must overwrite");
});
asyncCheck("mutation: taking the version from the overlay but the values from the lead row is detected as unsafe", async () => {
  const db = makeDb();
  commitOtherUser(db, { contact_name: "First Correction" });
  // Mutant: the current version paired with the lead row's older values (what a mixed-source builder yields).
  const mutant = { version: db.overlay!.version, initial: lc.normalizeContactValues(ORIGINAL) };
  assert.equal(saveOnlyPhone(makeDbLike(db), mutant).overwroteWithStale, true, "a current version with older values overwrites");
  const proper = lc.contactEditSnapshot(db.overlay, ORIGINAL);
  assert.equal(saveOnlyPhone(db, proper).overwroteWithStale, false, "contactEditSnapshot takes the values from the overlay row instead");
});
check("mutation: the static checks fail when the unsafe code is reintroduced", () => {
  const swapped = page.replace('overlay: () => supabase.from("sales_lead_contact_overrides")', 'ZZ: () => supabase.from("sales_lead_contact_overrides")').replace('lead: () => supabase.from("v_sales_lead_inbox")', 'overlay: () => supabase.from("v_sales_lead_inbox")');
  assert.equal(pageReadsOverlayFirst(swapped), false, "labels swapped");
  const leadFirst = page.replace(/( {4}overlay: \(\) => [^\n]+\n)( {4}lead: \(\) => [^\n]+\n)/, "$2$1");
  assert.notEqual(leadFirst, page);
  assert.equal(pageReadsOverlayFirst(leadFirst), false, "lead read ordered before the overlay read");
  assert.equal(pageReadsOverlayFirst(page + '\nconst x = await Promise.all([supabase.from("sales_lead_contact_overrides").select("version").eq("lead_metadata_id", id).maybeSingle()]);'), false, "overlay read folded into Promise.all");
  assert.equal(sheetCapturesSession(sheet.replace("leadMetadataId, session.version)", "leadMetadataId, expectedVersion)")), false, "bound to the live prop");
  assert.equal(sheetCapturesSession(sheet.replace("contactFormDirty(session.initial, values)", "contactFormDirty(initial, values)")), false, "dirty against live props");
  assert.equal(sheetCapturesSession(sheet.replace("  useEffect(() => {\n    if (!open || !dirty) return;", "  useEffect(() => { setSession(captureContactEditSession(expectedVersion, initial)); }, [initial]);\n  useEffect(() => {\n    if (!open || !dirty) return;")), false, "session re-captured by an effect on every prop change");
  const reordered = fixSql.replace("raise exception 'no_changes'", "raise exception 'stale_update'").replace(/raise exception 'stale_update'/, "raise exception 'no_changes'");
  assert.throws(() => before(reordered, "raise exception 'stale_update'", "raise exception 'no_changes'"), "no_changes ahead of stale_update is caught by the ordering check");
});

await Promise.all(asyncChecks);
console.log(`\n${total - failures}/${total} semakan LULUS`);
if (failures > 0) { console.log(`${failures} semakan GAGAL`); process.exit(1); }
