import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve as resolvePath } from "node:path";

// M-S7 Group A contract. Static only: no database is contacted.
// 1. The migration file is byte-identical to the one applied to Production on 2026-11-22 (history row 20261123090000).
// 2. Each of the eight RPCs keeps its original body (renamed *_unguarded, no client EXECUTE) and gets a same-signature
//    SECURITY DEFINER wrapper (search_path '') whose module requirement equals EXACTLY the edit guards of its calling
//    Server Action, raising 'not_authorized' before calling the original.
// 3. Nothing else changes: no table, policy, grant table, callback (*_from_callback), PKG-1 registration RPC or HRDF rule.
// 4. Every application call still matches the wrapper's parameter names, and no service-role path calls these RPCs.
// Usage: node --experimental-strip-types <this> [<app-repo-root>]

const repoRoot = resolvePath(process.argv[2] ?? ".");
const migPath = join(repoRoot, "supabase/migrations/20261123090000_finance_hrdf_rpc_module_authorization.sql");
const MIG_SHA256 = "cf9c991f4f5751152ec253ec63fc844941d4a432eaafb603589a0956ddda737d";
const rawBuf = readFileSync(migPath);
const raw = rawBuf.toString("utf8");
const sql = raw.replace(/--[^\n]*/g, "");
let failures = 0, passed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; } catch (e) { failures++; console.error(`FAIL ${name}\n  ${(e as Error).message}`); }
}
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The intended permission per RPC (D1: these edits are super_admin-only unless granted).
const RPCS: Record<string, { sig: string; params: string[]; modules: string[]; returns: string }> = {
  record_manual_payment: { sig: "uuid, text, text, numeric, date, text, text", params: ["p_invoice_id", "p_payment_provider", "p_payment_method", "p_amount", "p_payment_date", "p_payment_reference", "p_notes"], modules: ["invoices"], returns: "jsonb" },
  generate_receipt_for_payment: { sig: "uuid", params: ["p_payment_id"], modules: ["invoices"], returns: "jsonb" },
  record_toyyibpay_bill: { sig: "uuid, uuid, text, text, numeric", params: ["p_invoice_id", "p_attempt_id", "p_billcode", "p_payment_url", "p_amount"], modules: ["invoices"], returns: "jsonb" },
  mark_toyyibpay_attempt_superseded: { sig: "uuid", params: ["p_attempt_id"], modules: ["invoices"], returns: "jsonb" },
  get_active_toyyibpay_attempt: { sig: "uuid", params: ["p_invoice_id"], modules: ["invoices"], returns: "jsonb" },
  log_toyyibpay_conflict: { sig: "uuid, uuid, text", params: ["p_invoice_id", "p_attempt_id", "p_conflict_type"], modules: ["invoices"], returns: "jsonb" },
  record_hrdf_payment: { sig: "uuid, numeric, text, text, date, text, text", params: ["p_claim_id", "p_amount", "p_payment_provider", "p_payment_method", "p_payment_date", "p_payment_reference", "p_notes"], modules: ["invoices", "hrdf_claims"], returns: "jsonb" },
  transition_hrdf_claim: { sig: "uuid, text, jsonb", params: ["p_claim_id", "p_to_status", "p_payload"], modules: ["hrdf_claims"], returns: "public.hrdf_claims" },
};

// ---- 1. Exact file ------------------------------------------------------------------------------------------------
check("migration is byte-identical to the Production-applied file (sha256 cf9c991f)", () => {
  assert.equal(createHash("sha256").update(rawBuf).digest("hex"), MIG_SHA256);
  assert.ok(!raw.includes("\r"), "file must be LF only");
});

// ---- 2. Rename, revoke, wrapper, ACL per RPC ----------------------------------------------------------------------
const wrapperBody = (fn: string) => {
  const at = sql.indexOf(`create or replace function public.${fn}(`);
  assert.ok(at >= 0, `wrapper ${fn} missing`);
  return sql.slice(at, sql.indexOf("end; $$;", at) + 8);
};
for (const [fn, r] of Object.entries(RPCS)) {
  check(`${fn}: original renamed to ${fn}_unguarded and closed to every client role`, () => {
    assert.ok(sql.includes(`alter function public.${fn}(${r.sig}) rename to ${fn}_unguarded;`));
    assert.ok(new RegExp(`revoke all on function public\\.${fn}_unguarded\\(${esc(r.sig)}\\) from public, anon, authenticated, service_role;`).test(sql));
    assert.doesNotMatch(sql, new RegExp(`grant [^;]*${fn}_unguarded`));
  });
  check(`${fn}: wrapper keeps the signature, is SECURITY DEFINER with an empty search_path, and returns ${r.returns}`, () => {
    const b = wrapperBody(fn);
    const head = b.slice(0, b.indexOf(" as $$"));
    const names = [...head.matchAll(/\b(p_[a-z_]+)\s+[a-z]/g)].map((m) => m[1]);
    assert.deepEqual(names, r.params);
    assert.match(head, new RegExp(`returns ${esc(r.returns)} language plpgsql security definer set search_path = ''`));
    if (fn === "transition_hrdf_claim") assert.match(head, /p_payload jsonb default '\{\}'::jsonb/);
  });
  check(`${fn}: wrapper requires exactly ${r.modules.map((m) => m + ":edit").join(" + ")} and raises not_authorized first`, () => {
    const b = wrapperBody(fn);
    const mods = [...b.matchAll(/public\.has_module_access_level\('([a-z_]+)', '([a-z]+)'\)/g)].map((m) => `${m[1]}:${m[2]}`);
    assert.deepEqual(mods, r.modules.map((m) => `${m}:edit`));
    const guardAt = b.indexOf("raise exception 'not_authorized'"), callAt = b.indexOf(`return public.${fn}_unguarded(`);
    assert.ok(guardAt > 0 && callAt > guardAt, "guard must precede the call");
    assert.ok(b.includes(`return public.${fn}_unguarded(${r.params.join(", ")});`), "must forward every argument in order");
  });
  check(`${fn}: wrapper ACL is set to authenticated only (anon, service_role and PUBLIC revoked) in the ACL loop`, () => {
    assert.ok(sql.includes(`'public.${fn}(${r.sig.replace(/, /g, ",")})'`), "wrapper listed in the ACL loop");
  });
}
check("ACL loop: owner postgres, revoke public/anon/service_role, grant authenticated only", () => {
  assert.ok(sql.includes("execute format('alter function %s owner to postgres', s);"));
  assert.ok(sql.includes("execute format('revoke all on function %s from public, anon, service_role', s);"));
  assert.ok(sql.includes("execute format('grant execute on function %s to authenticated', s);"));
  assert.equal((sql.match(/\bgrant\b/gi) ?? []).length, 1, "only one grant statement");
});
check("fail-closed preflight pins the reviewed Production bodies and requires M1 first", () => {
  for (const m of ["1394d6827bc46d83b6265c1d8ce77bef", "f86100a8e7d2234912b080ce76280144", "55acc776bd049b57f1ab2bbe60f90218", "9f0eb10e71703836343d8a300f48ae83",
    "70da315bac633830bb0250d9b26c8156", "f81f10397bb7993bdfaf0da878f03435", "db3e3d34fce21530c92e3ae8ab43a82d", "b77f8fefce280fc7df201a86b1546f0b"]) assert.ok(sql.includes(`'${m}'`), m);
  assert.ok(sql.includes("version = '20261123080000'"));
  assert.match(sql, /ms7_precondition_failed/);
  assert.match(sql, /ms7_postcondition_failed/);
});

// ---- 3. Scope: nothing else changes -------------------------------------------------------------------------------
check("no table, policy, row, extension or schema change", () => {
  assert.doesNotMatch(sql, /\b(create|alter|drop)\s+(table|policy|view|index|trigger|schema|extension|type)\b/i);
  assert.doesNotMatch(sql, /\b(insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i);
  assert.doesNotMatch(sql, /\bdrop\s+function\b/i);
});
check("callbacks and PKG-1 registration RPCs are only asserted, never altered", () => {
  assert.doesNotMatch(sql, /(create or replace|alter) function public\.[a-z_]*(from_callback|registration)/);
  assert.doesNotMatch(sql, /(grant|revoke)[^;]*(from_callback|registration)/);
  assert.match(sql, /has_function_privilege\('service_role', 'public\.finalize_toyyibpay_payment_from_callback/);
});
check("HRDF business rules untouched (no HRDF-H, no new helper, bodies only renamed)", () => {
  assert.doesNotMatch(sql, /hrdf_eligible_amount_from_snapshot/);
  assert.doesNotMatch(sql, /create or replace function public\.[a-z_]+_unguarded/);
  assert.equal((sql.match(/create or replace function/g) ?? []).length, 8);
});
check("M1 Group B functions are asserted postgres-only, not changed again", () => {
  for (const f of ["finalize_toyyibpay_payment", "mark_toyyibpay_attempt_failed", "reverse_won_opportunity"]) {
    assert.doesNotMatch(sql, new RegExp(`(alter|create or replace) function public\\.${f}\\(`));
    assert.doesNotMatch(sql, new RegExp(`(grant|revoke)[^;]*public\\.${f}\\(`));
  }
});

// ---- 4. Application compatibility ---------------------------------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) { if (n !== "node_modules" && !n.startsWith(".")) walk(p, out); }
    else if (/\.(ts|tsx|js|mjs)$/.test(n)) out.push(p);
  }
  return out;
}
const files = [...walk(join(repoRoot, "app")), ...walk(join(repoRoot, "lib"))];
let callSites = 0;
for (const f of files) {
  const t = readFileSync(f, "utf8");
  for (const fn of Object.keys(RPCS)) {
    for (const m of t.matchAll(new RegExp(`\\.rpc\\("${fn}"\\s*,\\s*\\{([\\s\\S]*?)\\}\\s*\\)`, "g"))) {
      callSites++;
      const rel = relative(repoRoot, f).replace(/\\/g, "/");
      check(`${rel}: ${fn} call uses only wrapper parameter names and supplies every required one`, () => {
        const keys = [...m[1].matchAll(/\b(p_[a-z_]+)\s*:/g)].map((k) => k[1]);
        for (const k of keys) assert.ok(RPCS[fn].params.includes(k), `unknown parameter ${k}`);
        const required = RPCS[fn].params.filter((p) => !(fn === "transition_hrdf_claim" && p === "p_payload"));
        for (const p of required) assert.ok(keys.includes(p), `missing ${p}`);
      });
      check(`${rel}: ${fn} caller holds the same edit guards as the wrapper`, () => {
        const at = m.index ?? 0;
        const body = t.slice(t.lastIndexOf("\nexport ", at), at);
        const guards = new Set([...body.matchAll(/requireModuleAccess\("([a-z_]+)", "edit"\)/g)].map((g) => g[1]));
        for (const mod of RPCS[fn].modules) assert.ok(guards.has(mod), `missing requireModuleAccess("${mod}", "edit")`);
      });
    }
  }
  check(`${relative(repoRoot, f).replace(/\\/g, "/")}: no service-role client calls a Group A RPC`, () => {
    for (const m of t.matchAll(/(\w+)\s*=\s*createSupabaseServiceClient\(\)/g)) {
      for (const fn of [...Object.keys(RPCS), ...Object.keys(RPCS).map((x) => x + "_unguarded")])
        assert.doesNotMatch(t, new RegExp(`\\b${m[1]}\\s*\\.rpc\\("${fn}"`), `${m[1]}.rpc("${fn}")`);
    }
    for (const fn of Object.keys(RPCS)) assert.doesNotMatch(t, new RegExp(`\\.rpc\\("${fn}_unguarded"`), "app must not call *_unguarded");
  });
}
// 10 M-S7 call sites + 4 from the F-PAY-1 cancel orchestration in cancelInvoiceAction
// (get_active_toyyibpay_attempt, mark_toyyibpay_attempt_superseded, log_toyyibpay_conflict x2).
check("all fourteen known application call sites were found", () => assert.equal(callSites, 14));

console.log(failures ? `${failures} check(s) FAILED, ${passed} passed.` : `${passed} check(s) passed.`);
process.exit(failures ? 1 : 0);
