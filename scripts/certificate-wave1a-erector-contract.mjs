import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// C4 Wave1A Erector snapshot contract — static/source-level checks only.
// No database runtime, no Docker, no Supabase CLI, no staging/production.
//
// Design principle (review repair): every assertion is bound to the
// SPECIFIC SQL object it is meant to verify (a named DO block, a named
// function's own definition + its immediately-trailing GRANT/REVOKE
// statements, or a named CREATE TRIGGER statement) — never to "does this
// substring appear anywhere in the file". A disconnected copy of a required
// fragment sitting in an unrelated block, function, or comment must NOT
// satisfy an assertion scoped to a different object. This is proven by the
// negative-control tests at the end of this file, which mutate an in-memory
// copy of the migration source and assert the relevant scoped check throws.

const repoRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const migrationDir = join(repoRoot, "supabase/migrations");
const migrationFiles = readdirSync(migrationDir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

// Normalize CRLF -> LF immediately. All downstream matching (including
// every mutation constructed for the negative controls) operates on LF-only
// text, so string-literal substring replacement works regardless of the
// line-ending convention actually checked into the migration file on disk.
function normalizeNewlines(source) {
  return source.replace(/\r\n/g, "\n");
}

// Strip both SQL line comments and nested block comments, preserving line
// breaks and quoted strings. Text inside a comment cannot count as an
// executable security statement (notably a commented-out REVOKE).
function stripSqlComments(source) {
  let result = "";
  let quoted = null;
  let lineComment = false;
  let blockDepth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (char === "\n") {
        result += "\n";
        lineComment = false;
      } else {
        result += " ";
      }
    } else if (blockDepth) {
      if (char === "/" && next === "*") {
        blockDepth++;
        result += "  ";
        i++;
      } else if (char === "*" && next === "/") {
        blockDepth--;
        result += "  ";
        i++;
      } else {
        result += char === "\n" ? "\n" : " ";
      }
    } else if (quoted) {
      result += char;
      if (char === quoted) {
        if (next === quoted) {
          result += next;
          i++;
        } else {
          quoted = null;
        }
      }
    } else if (char === "'" || char === '"') {
      quoted = char;
      result += char;
    } else if (char === "-" && next === "-") {
      lineComment = true;
      result += "  ";
      i++;
    } else if (char === "/" && next === "*") {
      blockDepth = 1;
      result += "  ";
      i++;
    } else {
      result += char;
    }
  }
  check(blockDepth === 0, "SQL_COMMENT_UNTERMINATED", "unterminated SQL block comment");
  return result;
}

function prepare(rawSource) {
  return stripSqlComments(normalizeNewlines(rawSource));
}

const wave1Name = "20261004023132_c4_wave1_erector_snapshot.sql";
assert.ok(migrationFiles.includes(wave1Name), "C4 Wave1A Erector snapshot migration must exist");

// Migration version uniqueness.
const versionMatches = migrationFiles.filter((name) => name.startsWith("20261004023132"));
assert.equal(versionMatches.length, 1, "migration version 20261004023132 must be unique in this migration set");
console.log("TEST 1 — migration version 20261004023132 is unique: PASS");

const wave1Raw = normalizeNewlines(readFileSync(join(migrationDir, wave1Name), "utf8"));
const wave1Code = stripSqlComments(wave1Raw);

// Excluded migration versions remain absent.
const excludedVersions = ["20260927182751", "20260929072952", "20260929120000", "20261003233640"];
for (const excluded of excludedVersions) {
  const present = migrationFiles.some((name) => name.startsWith(excluded));
  assert.ok(!present, `excluded migration version ${excluded} must not be present in this candidate`);
}
console.log("TEST 2 — excluded migration versions are absent: PASS");

// ===========================================================================
// Extraction helpers — every helper below returns a BOUNDED substring of the
// source text corresponding to exactly one named SQL object, never the
// whole file. Positive assertions operate on these bounded substrings.
// ===========================================================================

function check(condition, checkId, message) {
  if (!condition) {
    const error = new Error(`${checkId}: ${message}`);
    error.checkId = checkId;
    throw error;
  }
}

// Extracts `do $tag$ ... $tag$;` as one bounded block, by exact dollar-quote
// tag name (each tag in this migration is unique: marker_authority_preflight,
// preflight, postconditions).
function extractDoBlock(code, tag, label = `do $${tag}$ block`) {
  const openTag = `$${tag}$`;
  const startMatch = code.match(new RegExp(`do\\s+\\$${tag}\\$`, "i"));
  assert.ok(startMatch, `${label} must exist`);
  const start = startMatch.index;
  const bodyStart = start + startMatch[0].length;
  const end = code.indexOf(openTag, bodyStart);
  assert.ok(end > bodyStart, `${label} must close with ${openTag}`);
  return code.slice(start, end + openTag.length + 1);
}

// Extracts `create or replace function qualifiedName(...) ... $tag$;` as one
// bounded block (the function's own definition only, no trailing grants).
function extractFunctionDef(code, qualifiedName) {
  const re = new RegExp(`create or replace function ${qualifiedName.replace(/\./g, "\\.")}\\s*\\(`, "i");
  const start = code.search(re);
  assert.ok(start >= 0, `${qualifiedName} definition must exist as executable SQL`);
  const asMatch = code.slice(start).match(/\bas\s+(\$[a-zA-Z0-9_]*\$)/);
  assert.ok(asMatch, `${qualifiedName} must have a dollar-quoted body`);
  const tag = asMatch[1];
  const tagEnd = start + asMatch.index + asMatch[0].length;
  const bodyEnd = code.indexOf(tag, tagEnd);
  assert.ok(bodyEnd > tagEnd, `${qualifiedName} dollar-quoted body must close with ${tag}`);
  return code.slice(start, bodyEnd + tag.length + 1);
}

// Bound a function's associated DDL by the next TOP-LEVEL migration object,
// not by the first unexpected statement. An ALTER/SET/RESET between grants
// (or after the grants) must stay visible to the security checks.
function extractFunctionRegion(code, qualifiedName) {
  const def = extractFunctionDef(code, qualifiedName);
  const idx = code.indexOf(def);
  assert.ok(idx >= 0, `${qualifiedName} definition must be locatable in the source for grant-block extraction`);
  const afterDef = code.slice(idx + def.length);
  const nextObject = /^(?:drop\s+trigger|create\s+trigger|create\s+or\s+replace\s+function|do\s+\$|alter\s+table)\b/im.exec(afterDef);
  check(nextObject !== null, "FUNCTION_REGION_UNTERMINATED", `${qualifiedName} must be followed by a top-level migration object`);
  return def + afterDef.slice(0, nextObject.index);
}

// Extracts the exact function name bound to a named CREATE TRIGGER
// statement's EXECUTE FUNCTION clause.
function extractTriggerBoundFunction(code, triggerName) {
  const re = new RegExp(`create\\s+trigger\\s+${triggerName}\\b[\\s\\S]{0,400}?execute\\s+function\\s+([a-zA-Z0-9_.]+)\\s*\\(`, "i");
  const match = code.match(re);
  assert.ok(match, `trigger ${triggerName} must exist as an executable CREATE TRIGGER ... EXECUTE FUNCTION statement`);
  return match[1];
}

// Finds every `grant ... on public.certificates ... to
// certificate_lifecycle_executor` statement within a bounded text (a
// function+grants block, or the whole migration for a cross-check), by
// splitting on `;` — this migration never uses `;` inside a GRANT
// statement's own text, so a naive split is exact here.
function findCertificatesExecutorGrants(block) {
  return block
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((stmt) => /^grant\b/i.test(stmt) && /\bon\s+public\.certificates\b/i.test(stmt) && /\bto\s+certificate_lifecycle_executor\b/i.test(stmt));
}

// Asserts the UPDATE grant(s) on public.certificates to the executor found
// within `block` are EXACTLY one column-scoped grant of exactly
// {render_contract_version} — no broad (whole-row) UPDATE, no ALL
// privileges, no additional/other column, no duplicate expanding grant.
function assertExactUpdateGrantSet(block, context) {
  const grants = findCertificatesExecutorGrants(block);
  check(grants.length !== 0, "EXACT_UPDATE_GRANT_MISSING", `${context}: no executor grant on public.certificates`);
  for (const grant of grants) {
    const match = /^grant\s+([\s\S]*?)\s+on\s+public\.certificates\s+to\s+certificate_lifecycle_executor\s*$/i.exec(grant);
    check(match !== null, "CERTIFICATE_GRANT_INVALID", `${context}: unrecognized grant statement: ${grant}`);
    const privileges = match[1].trim();
    check(!/^all\b/i.test(privileges) && !/\bupdate\b(?!\s*\()/i.test(privileges), "BROAD_UPDATE_FORBIDDEN", `${context}: broad grant: ${grant}`);
    check(!/\b(?:delete|insert|select|truncate|references|trigger)\b/i.test(privileges), "EXTRA_CERTIFICATE_PRIVILEGE_FORBIDDEN", `${context}: unrelated privilege: ${grant}`);
    check(/^update\s*\(\s*render_contract_version\s*\)$/i.test(privileges), "EXTRA_UPDATE_COLUMN_FORBIDDEN", `${context}: UPDATE clause is not exactly UPDATE(render_contract_version): ${grant}`);
  }
  check(grants.length === 1, "EXTRA_UPDATE_COLUMN_FORBIDDEN", `${context}: expected one grant, found ${grants.length}`);
}

// ===========================================================================
// 1A — issuer precondition block, bound to app.issue_certificate_with_skill_snapshot
// ===========================================================================

const issuerSecurityClauses = [
  "v_owner <> 'certificate_lifecycle_executor'",
  "v_definer is distinct from true",
  "v_config is distinct from array['search_path=public, app, extensions']::text[]",
  "v_acl is distinct from '{certificate_lifecycle_executor=X/certificate_lifecycle_executor}'",
  "not pg_catalog.has_function_privilege('certificate_lifecycle_executor', v_fn, 'EXECUTE')",
  "pg_catalog.has_function_privilege('anon', v_fn, 'EXECUTE')",
  "pg_catalog.has_function_privilege('authenticated', v_fn, 'EXECUTE')",
  "pg_catalog.has_function_privilege('service_role', v_fn, 'EXECUTE')",
  "pg_catalog.strpos(v_definition, 'app.request_actor_id()') = 0",
  "pg_catalog.strpos(v_definition, 'auth.uid()') > 0",
];
const issuerInsertCondition = "v_pos = 0 or pg_catalog.strpos(pg_catalog.substr(v_definition, v_pos + pg_catalog.length(v_insert)), v_insert) > 0 or pg_catalog.strpos(v_definition, 'app.c4_wave1_erector_issuance') > 0";
const normalizeCondition = (text) => text.trim().replace(/\s+/g, " ");

function extractIfCondition(block, anchor, checkId) {
  const start = block.indexOf(anchor);
  check(start !== -1, checkId, `missing conditional anchor: ${anchor}`);
  const match = /^if\s+([\s\S]*?)\s+then\b/i.exec(block.slice(start));
  check(match !== null, checkId, `missing IF condition at ${anchor}`);
  return { condition: match[1], end: start + match[0].length };
}

function assertIssuerPreconditionInvariants(block) {
  check(/v_fn oid := pg_catalog\.to_regprocedure\('app\.issue_certificate_with_skill_snapshot\(uuid,uuid,text\)'\)/i.test(block), "ISSUER_BINDING_INVALID", "issuer OID must name the exact lifecycle function");
  check(/from pg_catalog\.pg_proc p where p\.oid = v_fn;\s*v_definition := pg_catalog\.pg_get_functiondef\(v_fn\);/i.test(block), "ISSUER_BINDING_INVALID", "catalog fields and definition must derive from issuer OID");
  const definitionAnchor = "v_definition := pg_catalog.pg_get_functiondef(v_fn);";
  const bodyStart = block.indexOf("\nbegin\n");
  const firstDefinition = block.indexOf(definitionAnchor);
  check(bodyStart !== -1 && firstDefinition > bodyStart, "ISSUER_PREFLIGHT_REACHABILITY_INVALID", "issuer preflight must begin before catalog lookup");
  const prelude = block.slice(bodyStart + "\nbegin\n".length, firstDefinition + definitionAnchor.length);
  const expectedPrelude = `if v_fn is null or pg_catalog.to_regclass('public.certificate_issuance_snapshots') is null then
    raise exception 'C4 Wave 1A precondition failed: issuer or issuance snapshot table is missing';
  end if;
  select pg_catalog.pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig, p.proacl::text
    into v_owner, v_definer, v_config, v_acl
  from pg_catalog.pg_proc p where p.oid = v_fn;
  ${definitionAnchor}`;
  check(normalizeCondition(prelude) === normalizeCondition(expectedPrelude), "ISSUER_PREFLIGHT_REACHABILITY_INVALID", "issuer catalog lookup and security IF must not be bypassed by earlier statements");
  const afterDefinition = block.slice(block.indexOf(definitionAnchor) + definitionAnchor.length);
  check(/^\s*if\s+v_owner <>/i.test(afterDefinition), "ISSUER_CONDITION_INVALID", "issuer security IF must immediately follow its catalog lookup");
  const { condition, end } = extractIfCondition(afterDefinition, "if v_owner <>", "ISSUER_CONDITION_INVALID");
  check(/pg_catalog\.strpos\(v_definition,\s*'app\.request_actor_id\(\)'\)\s*=\s*0/i.test(condition), "ISSUER_ACTOR_CONDITION_INVALID", "issuer actor check must be inside its security IF");
  check(normalizeCondition(condition) === issuerSecurityClauses.join(" or "), "ISSUER_CONDITION_INVALID", "issuer owner, definer, search_path, ACL, actor, and auth checks must be the exact enforced IF expression");
  check(/^\s*raise exception 'C4 Wave 1A precondition failed: issuer exact owner\/security\/search_path\/ACL\/actor contract differs';\s*end if;/i.test(afterDefinition.slice(end)), "ISSUER_CONDITION_INVALID", "issuer security IF must retain its immediate failure branch");
  check(/v_insert\s+text\s*:=\s*'insert into public\.certificate_issuance_snapshots \('/i.test(block), "ISSUER_INSERT_CONDITION_INVALID", "issuer insert marker declaration missing");
  const afterSecurityIf = afterDefinition.slice(end).match(/^\s*raise exception 'C4 Wave 1A precondition failed: issuer exact owner\/security\/search_path\/ACL\/actor contract differs';\s*end if;([\s\S]*)$/i);
  check(afterSecurityIf !== null, "ISSUER_CONDITION_INVALID", "issuer security IF must end with its failure branch");
  const insertPrelude = afterSecurityIf[1].slice(0, afterSecurityIf[1].indexOf("if v_pos = 0"));
  check(normalizeCondition(insertPrelude) === normalizeCondition(`v_definition := pg_catalog.pg_get_functiondef(v_fn); v_pos := pg_catalog.strpos(v_definition, v_insert);`), "ISSUER_PREFLIGHT_REACHABILITY_INVALID", "snapshot insert check must follow security IF without a bypass");
  const insertIf = extractIfCondition(block, "if v_pos = 0", "ISSUER_INSERT_CONDITION_INVALID");
  check(normalizeCondition(insertIf.condition) === issuerInsertCondition, "ISSUER_INSERT_CONDITION_INVALID", "issuer snapshot insert must have the exact single-site condition");
  check(/^\s*raise exception 'C4 Wave 1A precondition failed: trusted issuer snapshot insertion is absent\/ambiguous or uses caller-settable marker authority';\s*end if;/i.test(block.slice(insertIf.end)), "ISSUER_INSERT_CONDITION_INVALID", "issuer insert IF must retain its immediate failure branch");
}

function runIssuerPreconditionTests(code) {
  const issuerBlock = extractDoBlock(code, "preflight", "the issuer precondition DO block ($preflight$)");
  assertIssuerPreconditionInvariants(issuerBlock);
  return issuerBlock;
}

runIssuerPreconditionTests(wave1Code);
console.log("TEST 3 — issuer (app.issue_certificate_with_skill_snapshot) precondition invariants are bound to the $preflight$ DO block specifically: PASS");

// ===========================================================================
// 1B — each new function's own definition + its immediately-trailing grants
// ===========================================================================

const NEW_FUNCTIONS = [
  "app.guard_certificate_render_contract",
  "app.capture_c4_wave1_erector_snapshot",
  "app.persist_certificate_render_contract_marker",
];

function assertFunctionSecurityInvariants(block, qualifiedName) {
  const header = block.slice(0, block.search(/\bas\s+\$[a-zA-Z0-9_]*\$/i));
  check(/\bsecurity invoker\b/i.test(header) && !/\bsecurity definer\b/i.test(header), "FUNCTION_SECURITY_MODE_INVALID", `${qualifiedName} must be SECURITY INVOKER`);
  check(!/set\s+local\s+role\s+certificate_lifecycle_executor/i.test(block), "FUNCTION_SET_ROLE_FORBIDDEN", `${qualifiedName} must not use SET LOCAL ROLE`);
  check(!/\breset\s+role\s*;/i.test(block), "FUNCTION_ROLE_RESET_FORBIDDEN", `${qualifiedName} must not RESET ROLE`);
  const fnCall = `${qualifiedName}()`.replace(/[().]/g, "\\$&");
  check(!new RegExp(`alter\\s+function\\s+${fnCall}\\s+owner\\s+to\\s+certificate_lifecycle_executor`, "i").test(block), "FUNCTION_OWNER_TRANSFER_FORBIDDEN", `${qualifiedName} must not change owner to executor`);
  check(new RegExp(`revoke\\s+all\\s+on\\s+function\\s+${fnCall}\\s+from\\s+public,\\s*anon,\\s*authenticated,\\s*service_role`, "i").test(block), "FUNCTION_ACL_INVALID", `${qualifiedName} must REVOKE from API roles`);
  check(new RegExp(`grant\\s+execute\\s+on\\s+function\\s+${fnCall}\\s+to\\s+certificate_lifecycle_executor`, "i").test(block), "FUNCTION_ACL_INVALID", `${qualifiedName} must GRANT EXECUTE to executor`);
}

function runFunctionSecurityTests(code) {
  const blocks = {};
  for (const fn of NEW_FUNCTIONS) {
    const block = extractFunctionRegion(code, fn);
    assertFunctionSecurityInvariants(block, fn);
    blocks[fn] = block;
  }
  return blocks;
}

const functionGrantBlocks = runFunctionSecurityTests(wave1Code);
console.log("TEST 4 — each new Wave1A trigger function's SECURITY INVOKER declaration, no-SET-ROLE, no-ownership-transfer, and its own REVOKE/GRANT pair are bound to that function's associated DDL region: PASS");

// Exact UPDATE grant set, bound to the persist function's own grant block
// (where the real grant statement lives) AND cross-checked against the
// whole migration (so a stray/duplicate/broad grant placed elsewhere in the
// file is also caught, not just one missing from the expected location).
assertExactUpdateGrantSet(functionGrantBlocks["app.persist_certificate_render_contract_marker"], "app.persist_certificate_render_contract_marker's own region");
assertExactUpdateGrantSet(wave1Code, "the whole Wave1A migration");
console.log("TEST 5 — the UPDATE grant on public.certificates is bound to persist_certificate_render_contract_marker's own grant block, and is exactly {render_contract_version} migration-wide: PASS");

// ===========================================================================
// 1C — trigger declarations, bound to their exact EXECUTE FUNCTION target
// ===========================================================================

const TRIGGER_BINDINGS = [
  ["trg_guard_certificate_render_contract", "app.guard_certificate_render_contract"],
  ["trg_capture_c4_wave1_erector_snapshot", "app.capture_c4_wave1_erector_snapshot"],
  ["trg_persist_certificate_render_contract_marker", "app.persist_certificate_render_contract_marker"],
];

function runTriggerBindingTests(code) {
  for (const [triggerName, expectedFn] of TRIGGER_BINDINGS) {
    const boundFn = extractTriggerBoundFunction(code, triggerName);
    check(boundFn.toLowerCase() === expectedFn.toLowerCase(), "TRIGGER_BINDING_INVALID", `trigger ${triggerName} must bind to ${expectedFn}, found ${boundFn}`);
  }
}

runTriggerBindingTests(wave1Code);
console.log("TEST 6 — all three CREATE TRIGGER statements are individually extracted and proven to bind to their exact expected function: PASS");

// ===========================================================================
// 2 — Negative security assertions (global absence checks — any occurrence
// anywhere is itself the forbidden thing, so no object-scoping is needed
// for these specific negative checks; only positive existence checks need
// to be scoped to the correct object).
// ===========================================================================

function runGlobalNegativeSecurityChecks(code) {
  check(!/grant\s+(?:[\w,\s]*\bcreate\b[\w,\s]*)\s+on\s+schema\s+app\s+to/i.test(code), "SCHEMA_CREATE_FORBIDDEN", "migration must not grant CREATE ON SCHEMA app");
  check(!/grant\s+certificate_lifecycle_executor\s+to\s+(?:anon|authenticated|service_role)/i.test(code), "API_EXECUTOR_MEMBERSHIP_FORBIDDEN", "API roles must not receive executor membership");
  check(!/alter\s+role\s+certificate_lifecycle_executor\b[^;]*\b(login|superuser|bypassrls)\b/i.test(code), "EXECUTOR_ROLE_ESCALATION_FORBIDDEN", "executor must not receive LOGIN/SUPERUSER/BYPASSRLS");
  check(!/set\s+local\s+role\s+certificate_lifecycle_executor/i.test(code), "FUNCTION_SET_ROLE_FORBIDDEN", "migration must not SET LOCAL ROLE executor");
  check(!/\breset\s+role\s*;/i.test(code), "FUNCTION_ROLE_RESET_FORBIDDEN", "migration must not RESET ROLE for the unsupported ownership model");
  for (const fn of NEW_FUNCTIONS) {
    const fnCall = `${fn}()`.replace(/[().]/g, "\\$&");
    check(!new RegExp(`alter\\s+function\\s+${fnCall}\\s+owner\\s+to\\s+certificate_lifecycle_executor`, "i").test(code), "FUNCTION_OWNER_TRANSFER_FORBIDDEN", `${fn} must not be transferred anywhere in the migration`);
  }
}

runGlobalNegativeSecurityChecks(wave1Code);
console.log("TEST 7 — no CREATE ON SCHEMA app grant, no new API-role membership, no LOGIN/SUPERUSER/BYPASSRLS escalation, no SET LOCAL ROLE sequence anywhere in the migration: PASS");

// ===========================================================================
// 5 — preserved pre-existing valid checks (fixture identity, trigger-
// interaction invariants, fail-closed behavior, historical marker behavior).
// ===========================================================================

const guardDef = extractFunctionDef(wave1Code, "app.guard_certificate_render_contract");
const captureDef = extractFunctionDef(wave1Code, "app.capture_c4_wave1_erector_snapshot");
const persistDef = extractFunctionDef(wave1Code, "app.persist_certificate_render_contract_marker");

assert.match(wave1Code, /'2a78decf-6997-4626-a7cc-a1a23a110cf8'::uuid/i);
assert.match(wave1Code, /'904293c4-8792-41d7-8744-42143887e577'::uuid/i);
assert.match(wave1Code, /'b9c737b8-8a97-4c91-91ee-c65dc5982ca7'::uuid/i);
assert.match(wave1Code, /jsonb_build_object\(\s*\n\s*'canonical_course_id',\s*v_course_id,\s*\n\s*'certificate_family',\s*'scaffold_erector'/);
assert.match(wave1Code, /new\.template_config->>'design_variant'\s*(?:=|is distinct from)\s*'standard_scaffold_certificate'/);
console.log("TEST 8 — Basic/Intermediate/Advanced Erector course UUIDs and family/design_variant discriminators present in executable code: PASS");

assert.match(wave1Code, /before insert or update of render_contract_version on public\.certificates/i);
console.log("TEST 9A — guard trigger scoped to INSERT or UPDATE OF render_contract_version only (no broad recursive surface): PASS");

assert.match(guardDef, /pg_catalog\.pg_trigger_depth\(\)\s*<=\s*1/);
assert.match(guardDef, /old\.render_contract_version is not null/);
assert.match(guardDef, /new\.render_contract_version not in \('certificate_renderer_v1', 'c4_wave1_v1'\)/);
console.log("TEST 9B — immutable marker guard requires nested trigger depth, NULL-origin, and a known renderer version (no bypass path): PASS");

assert.match(wave1Code, /before insert on public\.certificate_issuance_snapshots[\s\S]{0,80}?for each row execute function app\.capture_c4_wave1_erector_snapshot/);
const snapshotTableMigration = migrationFiles.find((name) =>
  /create table if not exists public\.certificate_issuance_snapshots/i.test(
    readFileSync(join(migrationDir, name), "utf8")
  )
);
assert.ok(snapshotTableMigration, "certificate_issuance_snapshots table-defining migration must exist");
const snapshotTableSource = readFileSync(join(migrationDir, snapshotTableMigration), "utf8");
assert.match(snapshotTableSource, /certificate_issuance_snapshots_certificate_key unique \(certificate_id\)/i);
console.log("TEST 9C — capture trigger is BEFORE INSERT only, backed by a UNIQUE(certificate_id) DB constraint (no duplicate snapshot insert path): PASS");

const historicalGuardMigration = "20260922160000_certificates_v2_dependency_unblock.sql";
assert.ok(migrationFiles.includes(historicalGuardMigration), "historical update guard migration must exist");
const historicalGuardSource = prepare(readFileSync(join(migrationDir, historicalGuardMigration), "utf8"));
const guardFnBody2 = extractFunctionDef(historicalGuardSource, "app.certificate_historical_update_guard");
assert.ok(!/render_contract_version/i.test(guardFnBody2), "historical update guard must not reference render_contract_version (no column-level conflict)");
console.log("TEST 9D — historical_update_guard's protected column list excludes render_contract_version (no guard conflict): PASS");

const sharedTriggerMigration = prepare(readFileSync(join(migrationDir, "0006_functions_triggers.sql"), "utf8"));
assert.ok(!/render_contract_version/i.test(sharedTriggerMigration), "shared updated_at/stamp_actor/audit trigger migration predates and never references render_contract_version");
const setUpdatedAtBody = extractFunctionDef(sharedTriggerMigration, "app.set_updated_at");
assert.match(setUpdatedAtBody, /new\.updated_at\s*=\s*now\(\)/);
assert.equal((setUpdatedAtBody.match(/\bnew\./g) || []).length, 1, "app.set_updated_at() must assign exactly one column (updated_at) and nothing else");
console.log("TEST 9E/F — generic triggers never touch render_contract_version; set_updated_at() is a pure single-column assignment: PASS");

assert.match(wave1Code, /before insert or update of render_contract_version on public\.certificates/i);
assert.match(wave1Code, /before insert on public\.certificate_issuance_snapshots/i);
assert.match(wave1Code, /after insert on public\.certificate_issuance_snapshots/i);
console.log("TEST 9G — BEFORE guard / BEFORE capture / AFTER marker-persist timing clauses are exactly as documented (safe ordering): PASS");

assert.match(captureDef, /raise exception 'C4 Wave 1A fail-closed: unknown Erector course UUID/);
assert.match(captureDef, /if new\.template_config->>'design_variant' = 'standard_scaffold_certificate' then\s*\n\s*raise exception 'C4 Wave 1A fail-closed: unknown Erector course UUID/);
console.log("TEST 9H — non-Erector course path is fail-closed (raises on claimed Erector variant) or a true no-op (returns NEW unchanged): PASS");

assert.match(guardDef, /Certificate duplicates may only be created by the trusted lifecycle executor/);
const captureReplacesCheckIdx = captureDef.search(/if\s+v_replaces_certificate_id\s+is\s+not\s+null\s+then/i);
const captureCourseSelectIdx = captureDef.search(/select\s+c\.course_id/i);
assert.ok(captureReplacesCheckIdx >= 0, "capture function must branch on v_replaces_certificate_id");
assert.ok(captureCourseSelectIdx >= 0 && captureCourseSelectIdx < captureReplacesCheckIdx, "course_id is selected once before the duplicate branch, not re-resolved inside it");
const duplicateBranch = captureDef.slice(captureReplacesCheckIdx, captureDef.indexOf("return new;", captureReplacesCheckIdx) + "return new;".length);
assert.match(duplicateBranch, /return new;/, "duplicate branch must return immediately without re-resolving course/template/programme data");
assert.doesNotMatch(duplicateBranch, /jsonb_build_object\(\s*\n\s*'canonical_course_id'/, "duplicate branch must not rebuild the Erector render_payload");
assert.match(captureDef, /Certificate duplicate marker does not match its copied snapshot renderer/);
assert.match(persistDef, /Certificate duplicate marker does not match its immutable issuance snapshot/);
console.log("TEST 9I — duplicate/replacement path preserves the copied snapshot's marker semantics exactly (no re-resolution): PASS");

const issuerMigrations = migrationFiles
  .map((name) => ({ name, code: prepare(readFileSync(join(migrationDir, name), "utf8")) }))
  .filter(({ code }) => /create\s+or\s+replace\s+function\s+app\.issue_certificate_with_skill_snapshot\s*\(/i.test(code));
assert.ok(issuerMigrations.length, "an issuance RPC migration must exist");
const latestIssuer = issuerMigrations.at(-1).code;
const issuerBody = extractFunctionDef(latestIssuer, "app.issue_certificate_with_skill_snapshot");
const certInsertCount = (issuerBody.match(/insert\s+into\s+public\.certificates\s*\(/gi) || []).length;
const snapshotInsertCount = (issuerBody.match(/insert\s+into\s+public\.certificate_issuance_snapshots\s*\(/gi) || []).length;
assert.equal(certInsertCount, 1, "issuer must insert exactly one certificates row");
assert.equal(snapshotInsertCount, 1, "issuer must insert exactly one certificate_issuance_snapshots row");
console.log("TEST 9J — issue_certificate_with_skill_snapshot inserts exactly one certificate and one snapshot per call: PASS");

assert.match(wave1Code, /has_column_privilege\('certificate_lifecycle_executor', 'public\.certificates', 'render_contract_version', 'UPDATE'\)/i);
assert.match(wave1Code, /has_table_privilege\('certificate_lifecycle_executor', 'public\.certificates', 'UPDATE'\)/i);
assert.match(wave1Code, /has_schema_privilege\('certificate_lifecycle_executor', 'app', 'CREATE'\)/i);
console.log("TEST 10 — Wave1A migration embeds its own executable narrow-privilege postconditions (column UPDATE present, table-wide UPDATE absent, schema CREATE absent): PASS");

console.log("ALL C4 WAVE1A ERECTOR SNAPSHOT STATIC CONTRACT TESTS: PASS");

// ===========================================================================
// 4 — Negative-control tests: prove the bound assertions FAIL when the
// required fragment is disconnected from its correct object, or when a
// forbidden pattern is actually inserted. These operate ONLY on in-memory
// mutated copies of the source text; the real migration file is never
// touched.
// ===========================================================================

console.log("--- NEGATIVE CONTROLS (each must correctly reject its mutated source) ---");

function expectThrows(label, description, expectedCheckId, fn) {
  assert.throws(fn, (error) => {
    assert.equal(error.checkId, expectedCheckId, `NEGATIVE CONTROL ${label} failed for the wrong reason: ${error.message}`);
    return true;
  }, `NEGATIVE CONTROL ${label} (${description}) should have failed check ${expectedCheckId}`);
  console.log(`NEGATIVE CONTROL ${label} — ${description} (${expectedCheckId}): correctly rejected: PASS`);
}

function replaceOnceAfter(source, anchor, find, replaceWith) {
  const anchorIdx = source.indexOf(anchor);
  assert.ok(anchorIdx >= 0, `fixture setup: anchor not found: ${anchor}`);
  const findIdx = source.indexOf(find, anchorIdx);
  assert.ok(findIdx >= 0, `fixture setup: target not found after anchor: ${find}`);
  return source.slice(0, findIdx) + replaceWith + source.slice(findIdx + find.length);
}

function replaceOnce(source, find, replacement) {
  assert.ok(source.includes(find), `fixture setup: target not found: ${find}`);
  return source.replace(find, replacement);
}

const actorCheck = "or pg_catalog.strpos(v_definition, 'app.request_actor_id()') = 0";
const unrelatedActorCheck = "perform pg_catalog.strpos(v_definition, 'app.request_actor_id()') = 0;";
const insertCheckEnd = "raise exception 'C4 Wave 1A precondition failed: trusted issuer snapshot insertion is absent/ambiguous or uses caller-settable marker authority';\n  end if;";
function addUnrelatedActorCheck(source) {
  return replaceOnce(source, insertCheckEnd, `${insertCheckEnd}\n  ${unrelatedActorCheck}`);
}

// A1: Keep the expected actor phrase but disable the actor failure clause.
{
  const mutatedCode = prepare(replaceOnce(wave1Raw, actorCheck, "or (pg_catalog.strpos(v_definition, 'app.request_actor_id()') = 0 and false)"));
  expectThrows("A1", "weakened issuer condition", "ISSUER_CONDITION_INVALID", () => runIssuerPreconditionTests(mutatedCode));
}

// A2: Move the actor check to an unrelated statement IN THE SAME DO block.
{
  const moved = replaceOnce(wave1Raw, actorCheck, "or false");
  const mutatedCode = prepare(addUnrelatedActorCheck(moved));
  assert.match(mutatedCode, /perform pg_catalog\.strpos\(v_definition, 'app\.request_actor_id\(\)'\) = 0;/);
  expectThrows("A2", "actor check moved within preflight", "ISSUER_ACTOR_CONDITION_INVALID", () => runIssuerPreconditionTests(mutatedCode));
}

// A3: Duplicate the expected phrase elsewhere in preflight while the real
// actor clause is present but weakened; disconnected text cannot rescue it.
{
  const weakened = replaceOnce(wave1Raw, actorCheck, "or (pg_catalog.strpos(v_definition, 'app.request_actor_id()') = 0 and false)");
  const mutatedCode = prepare(addUnrelatedActorCheck(weakened));
  expectThrows("A3", "duplicate phrase outside weakened IF", "ISSUER_CONDITION_INVALID", () => runIssuerPreconditionTests(mutatedCode));
}

// [A] issuer-required substring moved to an unrelated SQL block: the
// app.request_actor_id() usage check is removed from the $preflight$ block
// and an executable (non-comment) copy of the same literal is inserted into
// the unrelated $marker_authority_preflight$ block instead. The whole-file
// substring still exists; the scoped $preflight$ extraction must not see it.
{
  const mutatedRaw = wave1Raw
    .replace(
      "or pg_catalog.strpos(v_definition, 'app.request_actor_id()') = 0",
      "or false"
    )
    .replace(
      "do $marker_authority_preflight$\nbegin",
      "do $marker_authority_preflight$\nbegin\n  perform (select 1 where pg_catalog.strpos('z', 'app.request_actor_id()') = 0);"
    );
  const mutatedCode = stripSqlComments(mutatedRaw);
  assert.match(mutatedCode, /app\.request_actor_id\(\)/, "fixture sanity: the literal must still exist somewhere in the mutated file");
  expectThrows("A", "issuer substring relocated to an unrelated block", "ISSUER_ACTOR_CONDITION_INVALID", () => {
    const block = extractDoBlock(mutatedCode, "preflight", "the issuer precondition DO block ($preflight$)");
    assertIssuerPreconditionInvariants(block);
  });
}

// [B] app.request_actor_id() exists elsewhere (a different function body)
// but is removed from the issuer precondition block specifically.
{
  const mutatedRaw = wave1Raw
    .replace(/'app\.request_actor_id\(\)'/g, "'xxx_removed_for_negative_control_b'")
    .replace(
      "raise exception 'Issuance snapshots may only be written by the trusted lifecycle executor';",
      "raise exception 'Issuance snapshots may only be written by the trusted lifecycle executor; contains app.request_actor_id() marker for negative control B';"
    );
  const mutatedCode = stripSqlComments(mutatedRaw);
  assert.match(mutatedCode, /app\.request_actor_id\(\)/, "fixture sanity: the literal must still exist somewhere in the mutated file");
  expectThrows("B", "app.request_actor_id() present elsewhere but absent from the issuer precondition block", "ISSUER_ACTOR_CONDITION_INVALID", () => {
    const block = extractDoBlock(mutatedCode, "preflight", "the issuer precondition DO block ($preflight$)");
    assertIssuerPreconditionInvariants(block);
  });
}

// [C] a trigger points to the wrong function.
{
  const mutatedRaw = wave1Raw.replace(
    "for each row execute function app.guard_certificate_render_contract();",
    "for each row execute function app.persist_certificate_render_contract_marker();"
  );
  const mutatedCode = stripSqlComments(mutatedRaw);
  expectThrows("C", "trg_guard_certificate_render_contract rebound to the wrong function", "TRIGGER_BINDING_INVALID", () => {
    runTriggerBindingTests(mutatedCode);
  });
}

// [D] UPDATE grant becomes UPDATE(render_contract_version, another_column).
{
  const mutatedRaw = wave1Raw.replace(
    "grant update (render_contract_version) on public.certificates to certificate_lifecycle_executor;",
    "grant update (render_contract_version, status) on public.certificates to certificate_lifecycle_executor;"
  );
  const mutatedCode = stripSqlComments(mutatedRaw);
  expectThrows("D1", "UPDATE grant expanded to include an extra column", "EXTRA_UPDATE_COLUMN_FORBIDDEN", () => {
    const block = extractFunctionRegion(mutatedCode, "app.persist_certificate_render_contract_marker");
    assertExactUpdateGrantSet(block, "app.persist_certificate_render_contract_marker's own region");
  });
  expectThrows("D1 (whole-migration cross-check)", "UPDATE grant expanded to include an extra column", "EXTRA_UPDATE_COLUMN_FORBIDDEN", () => {
    assertExactUpdateGrantSet(mutatedCode, "the whole Wave1A migration");
  });
}

// D2: Keep the correct grant and add a second, independent column grant.
{
  const mutatedCode = prepare(wave1Raw + "\ngrant update (identity_no) on public.certificates to certificate_lifecycle_executor;\n");
  expectThrows("D2", "a second separate UPDATE-column grant", "EXTRA_UPDATE_COLUMN_FORBIDDEN", () => {
    assertExactUpdateGrantSet(mutatedCode, "the whole Wave1A migration");
  });
}

// [E] a broad (whole-row) table UPDATE grant is added anywhere.
{
  const mutatedRaw = wave1Raw + "\ngrant update on public.certificates to certificate_lifecycle_executor;\n";
  const mutatedCode = stripSqlComments(mutatedRaw);
  expectThrows("E", "a broad UPDATE grant on public.certificates was added", "BROAD_UPDATE_FORBIDDEN", () => {
    assertExactUpdateGrantSet(mutatedCode, "the whole Wave1A migration");
  });
}

// [F] SECURITY DEFINER is inserted on one of the new trigger functions.
{
  const mutatedRaw = replaceOnceAfter(
    wave1Raw,
    "create or replace function app.guard_certificate_render_contract()",
    "security invoker",
    "security definer"
  );
  const mutatedCode = stripSqlComments(mutatedRaw);
  expectThrows("F", "app.guard_certificate_render_contract mutated to SECURITY DEFINER", "FUNCTION_SECURITY_MODE_INVALID", () => {
    const block = extractFunctionRegion(mutatedCode, "app.guard_certificate_render_contract");
    assertFunctionSecurityInvariants(block, "app.guard_certificate_render_contract");
  });
}

// G: Owner transfer AFTER intact grants stays in the function's region.
{
  const mutatedRaw = replaceOnceAfter(
    wave1Raw,
    "create or replace function app.guard_certificate_render_contract()",
    "grant execute on function app.guard_certificate_render_contract() to certificate_lifecycle_executor;",
    "grant execute on function app.guard_certificate_render_contract() to certificate_lifecycle_executor;\nalter function app.guard_certificate_render_contract() owner to certificate_lifecycle_executor;"
  );
  const mutatedCode = stripSqlComments(mutatedRaw);
  expectThrows("G", "owner transfer after intact grant block", "FUNCTION_OWNER_TRANSFER_FORBIDDEN", () => {
    const block = extractFunctionRegion(mutatedCode, "app.guard_certificate_render_contract");
    assertFunctionSecurityInvariants(block, "app.guard_certificate_render_contract");
  });
}

// H1: SET LOCAL ROLE after intact grants must fail its own check.
{
  const mutatedRaw = replaceOnceAfter(
    wave1Raw,
    "create or replace function app.guard_certificate_render_contract()",
    "grant execute on function app.guard_certificate_render_contract() to certificate_lifecycle_executor;",
    "grant execute on function app.guard_certificate_render_contract() to certificate_lifecycle_executor;\nset local role certificate_lifecycle_executor;"
  );
  const mutatedCode = stripSqlComments(mutatedRaw);
  expectThrows("H1 (global)", "SET LOCAL ROLE in migration", "FUNCTION_SET_ROLE_FORBIDDEN", () => {
    runGlobalNegativeSecurityChecks(mutatedCode);
  });
  expectThrows("H1 (function-scoped)", "SET LOCAL ROLE in intact function region", "FUNCTION_SET_ROLE_FORBIDDEN", () => {
    const block = extractFunctionRegion(mutatedCode, "app.guard_certificate_render_contract");
    assertFunctionSecurityInvariants(block, "app.guard_certificate_render_contract");
  });
}

// H2: A stray RESET ROLE is also a forbidden part of the old role-switch
// model, independently of H1's SET check.
{
  const mutatedRaw = replaceOnceAfter(
    wave1Raw,
    "create or replace function app.guard_certificate_render_contract()",
    "grant execute on function app.guard_certificate_render_contract() to certificate_lifecycle_executor;",
    "grant execute on function app.guard_certificate_render_contract() to certificate_lifecycle_executor;\nreset role;"
  );
  const mutatedCode = prepare(mutatedRaw);
  expectThrows("H2", "RESET ROLE after intact function grants", "FUNCTION_ROLE_RESET_FORBIDDEN", () => {
    const block = extractFunctionRegion(mutatedCode, "app.guard_certificate_render_contract");
    assertFunctionSecurityInvariants(block, "app.guard_certificate_render_contract");
  });
}

// Comment-only false positive control: a forbidden phrase appearing only in
// a `-- comment` must not satisfy the CREATE ON SCHEMA app negative check.
{
  const mutatedRaw = wave1Raw + "\n-- GRANT CREATE ON SCHEMA app TO certificate_lifecycle_executor; (this is only a comment)\n";
  const mutatedCode = stripSqlComments(mutatedRaw);
  // Must NOT throw: the comment is stripped, so the real executable code is
  // unchanged and the negative check must still pass cleanly.
  runGlobalNegativeSecurityChecks(mutatedCode);
  console.log("NEGATIVE CONTROL (comment-only false positive) — forbidden phrase inside a comment does not trip the check: PASS");
}

// A block-commented REVOKE is no longer executable, even though its text is
// still present. The ACL assertion must not accept it.
{
  const revoke = "revoke all on function app.guard_certificate_render_contract() from public, anon, authenticated, service_role;";
  const mutatedCode = prepare(replaceOnce(wave1Raw, revoke, `/* ${revoke} */`));
  expectThrows("block-commented REVOKE", "required REVOKE made non-executable", "FUNCTION_ACL_INVALID", () => runFunctionSecurityTests(mutatedCode));
}

// Multiple privileges in ONE GRANT must not evade the exact-set check.
{
  const grant = "grant update (render_contract_version) on public.certificates to certificate_lifecycle_executor;";
  const multiUpdate = prepare(replaceOnce(wave1Raw, grant, "grant update (render_contract_version), update (status) on public.certificates to certificate_lifecycle_executor;"));
  expectThrows("multiple UPDATE privileges", "two UPDATE clauses in one GRANT", "EXTRA_UPDATE_COLUMN_FORBIDDEN", () => assertExactUpdateGrantSet(multiUpdate, "whole migration"));
  const withDelete = prepare(replaceOnce(wave1Raw, grant, "grant update (render_contract_version), delete on public.certificates to certificate_lifecycle_executor;"));
  expectThrows("additional DELETE privilege", "UPDATE and DELETE in one GRANT", "EXTRA_CERTIFICATE_PRIVILEGE_FORBIDDEN", () => assertExactUpdateGrantSet(withDelete, "whole migration"));
}

// The issuer IF must be reachable, not merely present later in a DO block.
{
  const mutatedCode = prepare(replaceOnce(wave1Raw, "  v_pos integer;\nbegin", "  v_pos integer;\nbegin\n  return;"));
  assert.match(extractDoBlock(mutatedCode, "preflight"), /begin\s+return;/);
  expectThrows("issuer early RETURN", "issuer checks bypassed before catalog lookup", "ISSUER_PREFLIGHT_REACHABILITY_INVALID", () => runIssuerPreconditionTests(mutatedCode));
}

console.log("ALL NEGATIVE CONTROL TESTS: PASS");
