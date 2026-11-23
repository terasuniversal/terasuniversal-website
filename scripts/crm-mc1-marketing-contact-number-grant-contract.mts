// MC-1 static contract: the migration grants exactly one privilege (EXECUTE on app.next_marketing_contact_number() to
// authenticated) behind fail-closed pre/postconditions, and nothing else; the rollback revokes exactly that privilege.
// The file must stay byte-identical to what Staging already applied (ledger statement md5), so it is never edited.
// Run: node --experimental-strip-types scripts/crm-mc1-marketing-contact-number-grant-contract.mts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const raw = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const MIGRATION = "supabase/migrations/20261128120000_marketing_contact_number_execute_grant.sql";
const ROLLBACK = "docs/security/crm-mc1/20261128120000_marketing_contact_number_execute_grant.rollback.sql";
const sql = raw(MIGRATION);
const code = sql.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
// Statement scans ignore string literals (error messages such as 'unexpected ACL after grant').
const statements = code.replace(/'[^']*'/g, "''");
let passed = 0;
const check = (name: string, fn: () => void) => { fn(); passed++; console.log(`PASS ${name}`); };

check("file is byte-identical to the content Staging applied (sha256 and ledger statement md5)", () => {
  assert.equal(createHash("sha256").update(sql).digest("hex"), "5b80674d423ab4c33a90c1aa1be1f0e91f98f83c00249008394039a33a17f330");
  assert.equal(createHash("md5").update(sql.replace(/\n$/, "")).digest("hex"), "34842b55152f0e9a12d4f80952692d86");
});

check("exactly one GRANT, to authenticated, on app.next_marketing_contact_number(); no other privilege or DDL", () => {
  assert.deepEqual(statements.match(/\bgrant\b[^;]*;/gi), ["grant execute on function app.next_marketing_contact_number() to authenticated;"]);
  assert.doesNotMatch(statements, /\b(revoke|drop|alter|create|insert|update|delete|truncate|owner\s+to)\b/i);
  assert.doesNotMatch(statements, /\bto\s+(anon|public|service_role)\b/i);
});

check("fail-closed precondition pins the reviewed body, owner, SECURITY DEFINER, search_path and ACL before the grant", () => {
  const pre = code.slice(0, code.indexOf("grant execute"));
  assert.match(pre, /md5\(prosrc\)[\s\S]*'e510ba76350107132dfa688c3b793924'/);
  assert.match(pre, /prosecdef/);
  assert.match(pre, /<> 'postgres'/);
  assert.match(pre, /'\{search_path=app\}'/);
  assert.match(pre, /'\{postgres=X\/postgres\}'/);
  assert.match(pre, /mc1_precondition_failed/);
  assert.match(pre, /set_config\('lock_timeout', '5s', true\)/);
});

check("postcondition requires the exact new ACL and anon still denied", () => {
  const post = code.slice(code.indexOf("grant execute"));
  assert.match(post, /'\{postgres=X\/postgres,authenticated=X\/postgres\}'/);
  assert.match(post, /has_function_privilege\('anon', v_fn, 'EXECUTE'\)/);
  assert.match(post, /has_schema_privilege\('anon', 'app', 'USAGE'\)/);
  assert.match(post, /mc1_postcondition_failed/);
});

check("rollback revokes exactly that privilege and nothing else", () => {
  const rb = raw(ROLLBACK).split("\n").filter((line) => line.trim() && !line.trimStart().startsWith("--"));
  assert.deepEqual(rb, ["revoke execute on function app.next_marketing_contact_number() from authenticated;"]);
});

check("version mapping recorded in the inventory without editing the applied file", () => {
  const inventory = raw("docs/database-baseline-audit/REPOSITORY_MIGRATION_INVENTORY.md");
  assert.match(inventory, /\| 20261128120000_marketing_contact_number_execute_grant \| 20261123023212 \| not applied \| `34842b55152f0e9a12d4f80952692d86` \|/);
  assert.match(inventory, /\| 20261123100000_fpay1_p2_cancel_finalize_guards \| 20261123100405 \| 20261123111548 \| `7b0f86ad1cf00c249ad1515e83c2c4e8` \|/);
});

console.log(`\n${passed} check(s) passed.`);
