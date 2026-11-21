import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Static contract for PKG-1: the migration that withdraws public EXECUTE from the two public registration write RPCs,
// plus a regression guard against any later migration granting them back to anon/authenticated/PUBLIC.
// No database or network. The role-switch (SQLSTATE) checks run in revoke-public-registration-rpcs-db-contract.mts.
const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};

const file = "20261122100000_revoke_public_execute_registration_rpcs.sql";
const sql = read(`supabase/migrations/${file}`);
// Executable statements only: strip "--" comments so wording in comments cannot satisfy or break a check.
const strip = (text: string) => text.split(/\r?\n/).filter((line) => !line.trim().startsWith("--")).join("\n");
const code = strip(sql);
const CREATE = "public\\.create_public_registration\\(uuid, text, text, jsonb\\)";
const BEGIN = "public\\.begin_public_registration_payment\\(text, text, text\\)";
const migrations = readdirSync(new URL("supabase/migrations/", root)).filter((n) => n.endsWith(".sql")).sort();

check("migration: sorts after every migration version known when it was written (live and on other branches)", () => {
  // Known on 21 Nov 2026: Production latest live 20261119032421 (five CRM migrations not on main; their branch files are
  // 20261108100000-20261108100400), Staging latest live 20261121130000, and CRM branch files up to 20261122095000.
  for (const known of ["20261108100400", "20261119032421", "20261121130000", "20261122095000"]) assert.ok(file > known, `${file} <= ${known}`);
  assert.ok(migrations.includes(file));
  assert.ok(migrations.indexOf(file) > migrations.indexOf("20261106120000_revoke_public_execute_check_public_rate_limit.sql"));
});
check("migration: revokes from PUBLIC, anon and authenticated by exact signature (both RPCs)", () => {
  assert.match(code, new RegExp(`revoke all on function ${CREATE} from public, anon, authenticated;`));
  assert.match(code, new RegExp(`revoke all on function ${BEGIN} from public, anon, authenticated;`));
});
check("migration: grants EXECUTE to service_role only (both RPCs)", () => {
  const grants = code.match(/^grant [^;]+;/gim) ?? [];
  assert.equal(grants.length, 2);
  assert.match(grants[0], new RegExp(`grant execute on function ${CREATE} to service_role;`));
  assert.match(grants[1], new RegExp(`grant execute on function ${BEGIN} to service_role;`));
});
check("migration: two revokes and two grants, nothing else at top level", () => {
  assert.equal((code.match(/^revoke\b/gim) ?? []).length, 2);
  assert.equal((code.match(/^grant\b/gim) ?? []).length, 2);
});
check("migration: touches no other object (no drop/create/alter/table/policy/data/default privileges)", () => {
  assert.doesNotMatch(code, /\b(drop|create\s+or\s+replace|create\s+function|alter\s|truncate|delete\s+from|insert\s+into|update\s+\w+\s+set|default\s+privileges|policy)\b/i);
  assert.doesNotMatch(code, /get_public_registration_(schedule|status)|submit_proposal_request|submit_public_enquiry|toyyibpay_payment_from_callback/);
});
check("migration: refuses a missing function, an overload and missing roles", () => {
  assert.match(code, /to_regprocedure\('public\.create_public_registration\(uuid,text,text,jsonb\)'\)/);
  assert.match(code, /to_regprocedure\('public\.begin_public_registration_payment\(text,text,text\)'\)/);
  assert.match(code, /v_overloads <> 2/);
  assert.match(code, /rolname = 'service_role'/);
  assert.match(code, /pkg1_precondition_failed/);
});
check("migration: asserts the final ACL (service_role yes, anon/authenticated no, no other grantee incl. PUBLIC)", () => {
  // Each condition must be followed directly by its own failing raise, so no single check can be silently dropped.
  assert.match(code, /if not has_function_privilege\('service_role', v_fn, 'execute'\) then\s+raise exception 'pkg1_postcondition_failed: service_role lost EXECUTE/);
  assert.match(code, /if has_function_privilege\('anon', v_fn, 'execute'\) or has_function_privilege\('authenticated', v_fn, 'execute'\) then\s+raise exception 'pkg1_postcondition_failed: anon or authenticated can still execute/);
  assert.match(code, /a\.grantee not in \(p\.proowner, 'service_role'::regrole\);\s+if v_bad <> 0 then\s+raise exception 'pkg1_postcondition_failed: unexpected EXECUTE grantee/);
  assert.match(code, /foreach v_fn in array array\[\s+'public\.create_public_registration\(uuid,text,text,jsonb\)'::regprocedure,\s+'public\.begin_public_registration_payment\(text,text,text\)'::regprocedure/);
});

// Regression guard (REG-3): earlier migrations re-created create_public_registration and re-granted anon each time.
// No migration sorted after PKG-1 may grant either RPC to anon, authenticated or PUBLIC again.
check("regression: no later migration grants the registration write RPCs back to anon/authenticated/PUBLIC", () => {
  const offenders: string[] = [];
  for (const name of migrations.filter((n) => n > file)) {
    const later = strip(read(`supabase/migrations/${name}`)).replace(/\s+/g, " ");
    if (/grant [^;]*on function public\.(create_public_registration|begin_public_registration_payment)\b[^;]*\bto [^;]*\b(anon|authenticated|public)\b/i.test(later)) offenders.push(name);
  }
  assert.deepEqual(offenders, []);
});
check("regression: no later migration re-creates either RPC (a re-created function could inherit default ACLs)", () => {
  const offenders = migrations.filter((n) => n > file)
    .filter((n) => /create\s+(or\s+replace\s+)?function\s+public\.(create_public_registration|begin_public_registration_payment)\b/i.test(strip(read(`supabase/migrations/${n}`))));
  assert.deepEqual(offenders, [], "a later re-creation must repeat the PKG-1 revoke/grant and update this contract");
});

// The application: both RPCs are reached only from the two registration routes, and only after the F-1 kill switch.
const routes = {
  create_public_registration: "app/api/registration/route.ts",
  begin_public_registration_payment: "app/api/registration/payment/route.ts",
} as const;
check("app: each RPC is called only from its registration route under app/, lib/ and components/", () => {
  const hits: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) walk(next);
      else if (/\.(js|jsx|ts|tsx|mjs)$/.test(entry.name)) {
        const rel = decodeURIComponent(next.pathname.slice(root.pathname.length));
        if (/\.rpc\(\s*["'](create_public_registration|begin_public_registration_payment)["']/.test(read(rel))) hits.push(rel);
      }
    }
  };
  for (const d of ["app", "lib", "components"]) walk(new URL(`${d}/`, root));
  assert.deepEqual(hits.sort(), Object.values(routes).sort());
});
check("app: in both routes the F-1 kill switch answers before the RPC call", () => {
  for (const [rpc, path] of Object.entries(routes)) {
    const body = read(path);
    const gate = body.indexOf("if (!publicRegistrationEnabled())");
    const call = body.indexOf(`.rpc("${rpc}"`);
    assert.ok(gate >= 0 && call > gate, `${path}: gate ${gate}, call ${call}`);
  }
});

// The baseline captures production as of its export and stays unchanged; only a new migration changes the ACL.
check("baseline: V3 schema is not edited by this change", () => {
  const v3 = read("supabase/baseline/v3/schema.sql");
  assert.match(v3, /GRANT ALL ON FUNCTION "public"\."create_public_registration"/);
  assert.match(v3, /GRANT ALL ON FUNCTION "public"\."begin_public_registration_payment"/);
});
// The unapplied grant-hardening draft still lists both RPCs as anon-callable. It is left byte-for-byte unchanged; what
// matters is that it can never restore their anon EXECUTE: it is outside the migration chain, it never grants anything to
// anon, and its post-check aborts the whole run when a keep-list function is not anon-executable (fails closed).
check("draft: the unapplied hardening draft cannot restore anon EXECUTE (outside the chain, no anon grant, fails closed)", () => {
  const path = "supabase/post_baseline_drafts/20261104090000_harden_anon_function_execute_grants.sql";
  const draft = strip(read(path));
  assert.ok(!migrations.includes("20261104090000_harden_anon_function_execute_grants.sql"));
  // Static or dynamic ("format('grant execute on function %s to anon')") grants; an error message that merely says
  // "grant EXECUTE on new functions to anon" is not a grant statement.
  assert.doesNotMatch(draft, /grant\s+execute\s+on\s+function[^;']*\bto\s+[^;']*\banon\b/i);
  assert.match(draft, /and not has_function_privilege\('anon', p\.oid, 'execute'\);\s+if v_bad is not null then\s+raise exception 'grant_hardening_aborted: intended-public function\(s\) not executable by anon/);
});

if (failures > 0) { console.log(`\n${failures} semakan GAGAL`); process.exit(1); }
console.log("\nSemua semakan LULUS");
