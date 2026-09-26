import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const actionsPath = join(repoRoot, "app/admin/(protected)/certificates/actions.ts");
const migrationDirectory = join(repoRoot, "supabase/migrations");
const actions = readFileSync(actionsPath, "utf8");
const migrationPaths = readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql")).map((name) => join(migrationDirectory, name));
const migrations = migrationPaths.map((path) => readFileSync(path, "utf8"));
const allSql = migrations.join("\n");
const newMigrationName = "20260924170000_certificate_public_rpc_surface.sql";
const newMigrationPath = join(migrationDirectory, newMigrationName);
const newMigration = readFileSync(newMigrationPath, "utf8");
const newWrappers = new Set([
  "duplicate_certificate_with_skill_snapshot",
  "reissue_certificate",
  "revoke_certificate",
  "update_certificate_metadata",
  "set_certificate_deleted",
  "set_certificate_verification_enabled",
]);
const expected = {
  issue_certificate_with_skill_snapshot: {
    args: "p_schedule_id uuid, p_participant_id uuid, p_certificate_number text",
    returns: "returns table (id uuid, verification_token text)",
    implementation: "app.issue_certificate_with_skill_snapshot",
  },
  duplicate_certificate_with_skill_snapshot: {
    args: "p_source_certificate_id uuid",
    returns: "returns table (id uuid, verification_token text)",
    implementation: "app.duplicate_certificate_with_skill_snapshot",
  },
  reissue_certificate: {
    args: "p_certificate_id uuid, p_event_type text, p_reason text, p_notes jsonb",
    returns: "returns table (id uuid, certificate_id uuid, certificate_number text, event_type text, reissued_at timestamptz)",
    implementation: "app.reissue_certificate",
  },
  revoke_certificate: {
    args: "p_certificate_id uuid, p_remarks text",
    returns: "returns void",
    implementation: "app.revoke_certificate",
  },
  update_certificate_metadata: {
    args: "p_certificate_id uuid, p_expiry_date date, p_remarks text",
    returns: "returns void",
    implementation: "app.update_certificate_metadata",
  },
  set_certificate_deleted: {
    args: "p_certificate_id uuid, p_deleted boolean",
    returns: "returns void",
    implementation: "app.set_certificate_deleted",
  },
  set_certificate_verification_enabled: {
    args: "p_certificate_id uuid, p_enabled boolean",
    returns: "returns void",
    implementation: "app.set_certificate_verification_enabled",
  },
};

const calls = [...new Set([...actions.matchAll(/\.rpc\(\s*(["'])([A-Za-z_][A-Za-z0-9_]*)\1/g)].map((match) => match[2]))];
assert.ok(calls.length > 0, "certificate Server Actions must have discoverable RPC calls");
const assertKnownRpc = (name) => assert.ok(expected[name], `Unregistered certificate RPC ${name}; inspect its arguments and SQL implementation before extending this contract`);
assert.throws(() => assertKnownRpc("xyz"), /Unregistered certificate RPC xyz/, "a future supabase.rpc(\"xyz\") call without a reviewed mapping must fail this contract");
for (const name of calls) {
  assertKnownRpc(name);
  const mapping = expected[name];
  const start = allSql.toLowerCase().indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `Missing application-facing public.${name} SQL function`);
  const end = allSql.indexOf("$$;", start);
  assert.notEqual(end, -1, `Unterminated public.${name} SQL function`);
  const definition = allSql.slice(start, end + 3).toLowerCase().replace(/\s+/g, " ");
  const header = definition.slice(0, definition.indexOf(" returns"));
  const args = header.slice(header.indexOf("(") + 1, header.lastIndexOf(")")).replace(/\s+default\b[^,)]*/gi, "").trim();
  assert.equal(args, mapping.args, `public.${name} named arguments and types must match the Server Action`);
  assert.ok(definition.includes(mapping.returns), `public.${name} return shape must match the Server Action`);
  assert.ok(definition.includes(mapping.implementation), `public.${name} must delegate to ${mapping.implementation}`);
}
for (const name of Object.keys(expected)) assert.ok(calls.includes(name), `Expected lifecycle RPC ${name} is missing from certificate Server Actions`);

const normalizedMigration = newMigration.toLowerCase().replace(/\s+/g, " ");
assert.ok(normalizedMigration.includes("alter function public.issue_certificate_with_skill_snapshot(uuid, uuid, text) set search_path = pg_catalog, app;"), "existing issuance wrapper must use the narrowed fixed search_path");
assert.ok(normalizedMigration.includes("revoke all on function public.issue_certificate_with_skill_snapshot(uuid, uuid, text) from public, anon, authenticated, service_role;"), "issuance API must revoke PUBLIC and anon");
assert.ok(normalizedMigration.includes("grant execute on function public.issue_certificate_with_skill_snapshot(uuid, uuid, text) to authenticated;"), "issuance API must remain authenticated-only");
for (const name of newWrappers) {
  const argumentTypes = expected[name].args.split(",").map((argument) => argument.trim().split(/\s+/).at(-1)).join(", ");
  const normalizedSignature = argumentTypes;
  const start = newMigration.toLowerCase().indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `New migration must define public.${name}`);
  const end = newMigration.indexOf("$$;", start);
  const definition = newMigration.slice(start, end + 3).toLowerCase();
  assert.ok(definition.includes("security invoker"), `public.${name} must be SECURITY INVOKER`);
  assert.ok(definition.includes("set search_path = pg_catalog, app"), `public.${name} must pin its search_path`);
  assert.ok(normalizedMigration.includes(`revoke all on function public.${name}(${normalizedSignature}) from public, anon, authenticated, service_role;`), `public.${name} must revoke PUBLIC, anon, authenticated, and service_role before granting the intended role`);
  assert.ok(normalizedMigration.includes(`grant execute on function public.${name}(${normalizedSignature}) to authenticated;`), `public.${name} must grant EXECUTE only to authenticated`);
}
assert.ok(!/verify_and_log|verify_certificate|import_legacy_certificate/i.test(newMigration), "wrapper migration must not alter public verification or legacy import");
console.log("I3B public RPC surface contract passed.");
for (const name of calls) console.log(`- public.${name} -> ${expected[name].implementation}: PASS`);
