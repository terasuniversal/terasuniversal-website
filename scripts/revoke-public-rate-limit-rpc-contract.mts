import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Static contract for PR-2b: the migration that withdraws public EXECUTE from check_public_rate_limit.
// No database or network. The behavioural (role-switch) checks run in the Staging UAT.
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

const file = "20261106120000_revoke_public_execute_check_public_rate_limit.sql";
const sql = read(`supabase/migrations/${file}`);
// Executable statements only: strip "--" comments so wording in comments cannot satisfy or break a check.
const code = sql.split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n");
const sig = "public\\.check_public_rate_limit\\(text, integer, integer\\)";

check("migration: sorts after every existing migration", () => {
  const names = readdirSync(new URL("supabase/migrations/", root)).filter((n) => n.endsWith(".sql")).sort();
  assert.equal(names[names.length - 1], file);
});
check("migration: revokes from PUBLIC, anon and authenticated by exact signature", () => {
  assert.match(code, new RegExp(`revoke all on function ${sig} from public, anon, authenticated;`));
});
check("migration: grants EXECUTE to service_role only", () => {
  const grants = code.match(/grant [^;]+;/g) ?? [];
  assert.equal(grants.length, 1);
  assert.match(grants[0], new RegExp(`grant execute on function ${sig} to service_role;`));
});
check("migration: touches no other object (no drop/create/alter/table/policy/default privileges)", () => {
  assert.doesNotMatch(code, /\b(drop|create\s+or\s+replace|create\s+function|alter\s|truncate|delete\s+from|insert\s+into|update\s+\w+\s+set|default\s+privileges|policy)\b/i);
});
check("migration: refuses a missing function, an overload and missing roles", () => {
  assert.match(code, /to_regprocedure\('public\.check_public_rate_limit\(text,integer,integer\)'\)/);
  assert.match(code, /v_overloads <> 1/);
  assert.match(code, /rolname = 'service_role'/);
  assert.match(code, /pr2b_precondition_failed/);
});
check("migration: asserts the final ACL (service_role yes, anon/authenticated no, no PUBLIC grantee)", () => {
  assert.match(code, /has_function_privilege\('service_role', v_fn, 'execute'\)/);
  assert.match(code, /has_function_privilege\('anon', v_fn, 'execute'\) or has_function_privilege\('authenticated', v_fn, 'execute'\)/);
  assert.match(code, /a\.grantee = 0/);
  assert.match(code, /pr2b_postcondition_failed/);
});
check("migration: one logical change (a single revoke and a single grant)", () => {
  assert.equal((code.match(/^revoke\b/gim) ?? []).length, 1);
  assert.equal((code.match(/^grant\b/gim) ?? []).length, 1);
});

// The application must keep calling the RPC only through the service-role client.
const limiter = read("lib/rate-limit.js");
check("app: the limiter calls the RPC through the guarded service client", () => {
  assert.match(limiter, /createSupabaseServiceClient/);
  assert.match(limiter, /validatePrivilegedSupabaseConfig/);
  assert.doesNotMatch(limiter, /createClient\(/);
});
check("app: the RPC has no other caller in application code", () => {
  const dirs = ["app", "lib", "components"];
  const hits: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) walk(next);
      else if (/\.(js|jsx|ts|tsx|mjs)$/.test(entry.name) && read(next.pathname.slice(root.pathname.length)).includes("check_public_rate_limit")) hits.push(entry.name);
    }
  };
  for (const d of dirs) walk(new URL(`${d}/`, root));
  assert.deepEqual(hits, ["rate-limit.js"]);
});

// The baseline captures production as of its export and stays unchanged; only a new migration changes the ACL.
check("baseline: V3 schema is not edited by this change", () => {
  assert.match(read("supabase/baseline/v3/schema.sql"), /GRANT ALL ON FUNCTION "public"\."check_public_rate_limit"/);
});
check("draft: the stale keep-list entry is flagged", () => {
  assert.match(read("supabase/post_baseline_drafts/20261104090000_harden_anon_function_execute_grants.sql"), /STALE ENTRY: check_public_rate_limit/);
});

if (failures > 0) { console.log(`\n${failures} semakan GAGAL`); process.exit(1); }
console.log("\nSemua semakan LULUS");
