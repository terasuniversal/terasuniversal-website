// A1 static contract (offline). Usage: node --experimental-strip-types scripts/crm-anon-a1-contract.mts <root>
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const root = process.argv[2] ?? ".";
const read = (p: string) => readFileSync(join(root, p), "utf8");
const MIG = read("supabase/migrations/20261127120000_anon_content_staff_select_to_authenticated.sql");
const RB = read("docs/security/crm-anon-a1/20261127120000_anon_content_staff_select_to_authenticated.rollback.sql");
const ST = JSON.parse(read("docs/security/crm-anon-a1/a1-staging-policy-manifest.json"));
const PR = JSON.parse(read("docs/security/crm-anon-a1/a1-production-policy-manifest.json"));

let failed = 0, passed = 0;
const check = (n: string, ok: boolean, d = "") => { ok ? passed++ : failed++; console.log(`${ok ? "PASS" : "FAIL"} ${n}${d ? ` (${d})` : ""}`); };
const strip = (s: string) => s.replace(/--.*$/gm, "");

// Same formula as the live fingerprint: concat_ws('|', table, policy, permissive, roles::text, cmd, qual, with_check)
// (concat_ws skips NULLs), joined by \n in (table, policy) order, md5.
const fp = (ps: any[], roleOverride?: (p: any) => string[]) => createHash("md5").update(
  [...ps].sort((a, b) => (a.table + "\u0000" + a.policy < b.table + "\u0000" + b.policy ? -1 : 1))
    .map((p) => [p.table, p.policy, p.permissive, `{${(roleOverride ? roleOverride(p) : p.roles).join(",")}}`, p.cmd, p.using, p.with_check]
      .filter((x) => x !== null).join("|")).join("\n")).digest("hex");

const targets = ST.policies.filter((p: any) => p.a1_target);
check("Staging manifest: 41 policies, 9 targets", ST.policies.length === 41 && targets.length === 9);
check("Staging targets are SELECT, roles {public}, USING app.is_editor(), no WITH CHECK",
  targets.every((p: any) => p.cmd === "SELECT" && p.roles.join() === "public" && p.using === "app.is_editor()" && p.with_check === null));
check("Staging manifest recomputes pinned nine-table fingerprint", fp(ST.policies) === ST.pinned.nine_tables_41_pre);
check("Staging manifest recomputes pinned targets fingerprint", fp(targets) === ST.pinned.targets_9_pre);
const post = (p: any) => (p.a1_target ? ["authenticated"] : p.roles);
check("expected post-A1 nine-table fingerprint recomputes", fp(ST.policies, post) === ST.pinned.nine_tables_41_post_expected);
check("expected post-A1 targets fingerprint recomputes", fp(targets, post) === ST.pinned.targets_9_post_expected);
check("5 *_public_read policies present and not targeted",
  ST.policies.filter((p: any) => p.policy.endsWith("_public_read") && !p.a1_target).length === 5);
check("no write policy is targeted", targets.every((p: any) => p.cmd === "SELECT"));

const prT = PR.policies.filter((p: any) => p.a1_target);
check("Production manifest: 29 policies, 9 targets incl. 4 FOR ALL", PR.policies.length === 29 && prT.length === 9 && prT.filter((p: any) => p.cmd === "ALL").length === 4);
check("Production manifest recomputes pinned fingerprints", fp(PR.policies) === PR.pinned.nine_tables_29 && fp(prT) === PR.pinned.targets_9);

// Migration body (single DO block: ALTERs are issued with EXECUTE format over the two pinned arrays)
const arr = (src: string, name: string) => {
  const m = src.match(new RegExp(name + " text\\[\\] := array\\[([\\s\\S]*?)\\];"));
  return m ? [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]) : [];
};
const pairs = (src: string) => { const t = arr(src, "v_tables"), p = arr(src, "v_targets"); return t.length === p.length ? t.map((x, i) => `${p[i]}@${x}`).sort() : []; };
const want = targets.map((p: any) => `${p.policy}@${p.table}`).sort();
check("migration: target arrays pair exactly the 9 manifest targets", JSON.stringify(pairs(MIG)) === JSON.stringify(want));
const alterStmts = [...strip(MIG).matchAll(/alter policy[^\n]*/gi)].map((m) => m[0]);
check("migration: exactly one ALTER POLICY statement, TO authenticated, driven by the arrays",
  alterStmts.length === 1 && /execute format\('alter policy %I on public\.%I to authenticated', r\.pol, r\.tbl\)/.test(strip(MIG)));
check("migration: whole file is ONE DO block (no statement outside it)", strip(MIG).trim().startsWith("do $a1$") && strip(MIG).trim().endsWith("$a1$;") && strip(MIG).split("$a1$").length === 3);
check("migration: no explicit BEGIN/COMMIT/temp table", !/^\s*(begin|commit)\s*;/im.test(strip(MIG)) && !/temporary table/i.test(strip(MIG)));
check("migration: no other DDL/DML/grant", !/\b(create|drop|grant|revoke|insert|update|delete|truncate|alter table|alter function)\b/i.test(strip(MIG).replace(/alter policy %I on public\.%I to authenticated/g, "")));
check("migration: never grants to anon or schema app", !/grant[\s\S]*?\banon\b/i.test(strip(MIG)) && !/usage\s+on\s+schema\s+app/i.test(strip(MIG)));
check("migration: transaction-local lock_timeout 5s", /set_config\('lock_timeout', '5s', true\)/.test(MIG));
check("migration: lock comment states ACCESS EXCLUSIVE", /ACCESS EXCLUSIVE/.test(MIG) && !/no table lock/i.test(MIG));
check("migration preflight checks the 9 targets as SELECT/{public}/app.is_editor()", /p\.cmd = 'SELECT'[\s\S]*array\['public'\]::name\[\][\s\S]*p\.qual = 'app\.is_editor\(\)' and p\.with_check is null/.test(MIG));
for (const [k, h] of Object.entries({ pre41: ST.pinned.nine_tables_41_pre, post41: ST.pinned.nine_tables_41_post_expected, post9: ST.pinned.targets_9_post_expected }))
  check(`migration pins ${k} = ${String(h).slice(0, 8)}`, MIG.includes(String(h)));
check("migration: negative postcondition fingerprints all non-target policies and the count", /v_others_before[\s\S]*v_others_after[\s\S]*v_total_before \+ 9/.test(MIG));

// Rollback
check("rollback: same 9 policy/table pairs", JSON.stringify(pairs(RB)) === JSON.stringify(want));
check("rollback: one ALTER POLICY ... TO public via EXECUTE", /execute format\('alter policy %I on public\.%I to public', r\.pol, r\.tbl\)/.test(strip(RB)) && [...strip(RB).matchAll(/alter policy/gi)].length === 1);
check("rollback: ONE DO block, no explicit BEGIN/COMMIT (safe inside apply_migration)", strip(RB).trim().startsWith("do $a1r$") && strip(RB).trim().endsWith("$a1r$;") && !/^\s*(begin|commit)\s*;/im.test(strip(RB)));
check("rollback: pinned pre/post checks + non-target fingerprint", RB.includes(ST.pinned.nine_tables_41_pre) && RB.includes(ST.pinned.nine_tables_41_post_expected) && /v_others_before/.test(RB));
check("rollback: no other DDL", !/\b(create|drop|grant|revoke|insert|update|delete|truncate)\b/i.test(strip(RB)));

// Production safety: the Staging preflight cannot match the Production target set.
check("Staging preflight would refuse Production (Group B targets are ALL / *_editor_all there)",
  prT.some((p: any) => p.cmd === "ALL") && !prT.every((p: any) => arr(MIG, "v_targets").includes(p.policy)));

console.log(`\n${failed ? `${failed} check(s) FAILED, ` : ""}${passed} check(s) passed.`);
process.exit(failed ? 1 : 0);
