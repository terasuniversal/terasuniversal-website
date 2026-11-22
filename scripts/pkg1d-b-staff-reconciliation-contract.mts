import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// PKG-1d-B staff payment reconciliation contract: Admin and Super Admin only, read-only, RLS-bound session, named
// evidence keys only, exact-match search, no money or seat decisions, no database change. Static source checks; the
// rules are covered by pkg1d-b-reconciliation.test.mts and the V1 queue contract/tests, which must still pass unchanged.

const read = async (p: string) => (await readFile(p, "utf8")).replace(/\r\n/g, "\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const [listPage, detailPage, loader, rules, queueLoader, queueRules, rbac, nav, pkg] = await Promise.all([
  read("app/admin/(protected)/registrations/page.tsx"),
  read("app/admin/(protected)/registrations/[id]/page.tsx"),
  read("lib/registrations/reconciliationLoader.ts"),
  read("lib/registrations/reconciliation.ts"),
  read("lib/registrations/reviewQueueLoader.ts"),
  read("lib/registrations/reviewQueue.ts"),
  read("lib/auth/rbac.ts"),
  read("lib/admin-nav.ts"),
  read("package.json"),
]);
const loaderCode = code(loader);
const detailCode = code(detailPage);
const listCode = code(listPage);
const rulesCode = code(rules);
const all = [loaderCode, detailCode, listCode, rulesCode, code(queueLoader), code(queueRules)].join("\n");

// 1. Admin guard first in every exported loader and in both pages, before any client or data access.
const exported = [...loaderCode.matchAll(/export async function (\w+)\([^)]*\)[^{]*\{\n([^\n]*)/g)];
assert.deepEqual(exported.map((m) => m[1]).sort(), ["loadPaymentEvidence", "loadReconciliationDetail", "loadReconciliationOverview", "resolveQueueScope"].sort(), "exactly the four read loaders are exported");
for (const [, name, firstLine] of exported) assert.equal(firstLine.trim(), 'await requireRole("admin");', `${name} guards first`);
const detailBody = detailCode.slice(detailCode.indexOf("export default async function RegistrationReconciliationPage"));
assert.match(detailBody, /\{\n\s*await requireRole\("admin"\);/, "the detail page awaits requireRole(admin) first");
assert.ok(detailBody.indexOf("isUuid(id)") < detailBody.indexOf("loadReconciliationDetail("), "the id is validated before any load");
assert.match(detailBody, /if \(!isUuid\(id\)\) notFound\(\);/);
const listBody = listCode.slice(listCode.indexOf("export default async function RegistrationsPage"));
assert.ok(listBody.indexOf('requireRole("admin")') < listBody.indexOf("loadReconciliationOverview("), "list guard runs before the overview");
assert.ok(!/requireRole\("(editor|trainer|client|participant)"\)|requireStaff\(/.test(all), "no weaker guard anywhere");

// 2. RLS-bound server session only; nothing client-side, no server actions.
assert.ok(!/createSupabaseServiceClient|createSupabaseBrowserClient|SERVICE_ROLE|service_role|SUPABASE_SERVICE/i.test(all), "no service-role or browser client");
assert.ok(!/["']use server["']|["']use client["']/.test(listPage + detailPage + loader + rules), "server components and loaders only; no server action");
assert.match(loaderCode, /createSupabaseServerClient\(\)/);

// 3. Read-only: no writes, no RPC, no mutation controls on the detail page.
assert.ok(!/\.(insert|update|upsert|delete)\(|\.rpc\(/.test(all), "no mutation and no RPC call in the reconciliation path");
assert.ok(!/<form|<button|formAction|action=\{/.test(detailCode), "the detail page has no form or button");
assert.ok(!/verify_public_registration_manual_payment\(|finalize_public_registration_crm\(|begin_public_registration_payment\(/.test(all), "no payment RPC is referenced as a call");
assert.match(detailPage, /Staff verification is not available on this screen yet\./, "manual verification is explicitly unavailable");
assert.match(detailPage, /Do not mark payments as paid outside the approved process\./);

// 4. Data minimisation: raw_response only through the named evidence keys; audit metadata only through named keys.
for (const m of all.matchAll(/raw_response[^\s",'`)]*/g)) {
  assert.match(m[0], /^raw_response->>?(late_success_reconciliation_required|late_success|amount_mismatch|transaction_conflicts|success_after_refund)$/, `raw_response use is allowlisted: ${m[0]}`);
}
for (const m of loaderCode.matchAll(/metadata[^\s",'`)]*/g)) {
  assert.match(m[0], /^metadata->>(event|provider_transaction_id|verified_amount|provider_amount|expected_amount|payment_reference)$/, `metadata use is allowlisted: ${m[0]}`);
}
const selects = [...loaderCode.matchAll(/\.select\(\s*(?:"([^"]*)"|(EVIDENCE_SELECT))/g)].map((m) => m[1] ?? "EVIDENCE_SELECT");
assert.ok(selects.length >= 15, "every query lists its columns");
const selected = selects.join(",");
for (const forbidden of ["payment_url", "confirmation_token_hash", "idempotency_key_hash", "ic_passport_no", "identity_normalized", "phone", "raw_response", "metadata", "\\*"]) {
  assert.ok(!new RegExp(`(^|[\\s,])${forbidden}($|[\\s,])`).test(selected), `${forbidden} is never selected whole`);
}
assert.ok(!/(^|[\s,])email($|[\s,])/.test(selected), "no attendee or payer email is selected (actor_email on audit rows is staff)");

// 5. Search and filters: exact matches with whitelisted values only, no filter string from user input.
// PostgREST .filter() takes a column name string first; Array.prototype.filter(fn) is fine.
assert.ok(!/\.or\(|\.ilike\(|\.like\(|\.textSearch\(|\.filter\(\s*["'`]/.test(all), "no free-text filter string is built");
assert.match(rules, /\/\^\[A-Za-z0-9\]\[A-Za-z0-9_-\]\{2,63\}\$\//, "search is a strict identifier whitelist");
assert.match(listCode, /const search = parseSearch\(sp\.q\);/);
assert.match(listCode, /const view = parseView\(sp\.view\);/);
assert.match(loaderCode, /\.eq\("registration_reference", search\.toUpperCase\(\)\)/);
assert.match(loaderCode, /\.eq\("provider_transaction_id", search\)/);
assert.match(loaderCode, /\.eq\("provider_bill_code", search\)/);
assert.match(loaderCode, /return \{ ok: true, ids: ids\.filter\(isUuid\) \};/, "resolved ids are uuid-checked before they reach a filter");
assert.ok(
  code(queueLoader).includes('if (scope.ids !== null) q = q.in("id", scope.ids.length > 0 ? scope.ids : ["00000000-0000-0000-0000-000000000000"]);'),
  'an empty id scope means "no match", never "no filter"',
);

// 6. Bounded queries; caps become "too large" or UNKNOWN, never a silent partial list.
for (const c of ["SCOPE_LIMIT = 1000", "SCOPE_ID_LIMIT = 200", "EVIDENCE_CHUNK = 100", "ATTEMPT_LIMIT = 50", "AUDIT_LIMIT = 100", "HOLD_LIMIT = 1000"]) assert.ok(loader.includes(c), c);
assert.match(loaderCode, /reason: "too_large"/);
assert.match(loaderCode, /conflictLists\.some\(\(l\) => l\.length >= SCOPE_LIMIT\) \? null/, "a capped conflict count is UNKNOWN");
assert.match(listCode, /count === null \? "UNKNOWN"/);

// 7. Access wiring is unchanged (Admin only), and no new module or navigation entry was added.
assert.match(rbac, /registrations: "admin",/);
assert.match(nav, /key: "registrations", label: "Registrations", href: "\/admin\/registrations", icon: "participants", minRole: "admin"/);

// 8. Hygiene shared with the other admin code.
assert.ok(!/Promise\.all\(\[[^\]]*await/.test(all), "no await inside Promise.all([...])");
assert.ok(!/\bas any\b|@ts-ignore|@ts-expect-error/.test(all), "no any casts or suppressed type errors");
assert.ok(!/console\.(log|info|debug|warn)\(/.test(loaderCode + detailCode + listCode), "no console logging of data");
for (const [, body] of loaderCode.matchAll(/console\.error\("[^"]*", \{([^}]*)\}\)/g)) {
  const keys = body.split(",").map((part) => part.split(":")[0].trim());
  assert.ok(keys.every((k) => ["query", "code", "limit"].includes(k)), `error logs carry only query, code and limit (found ${keys.join(",")})`);
}
assert.ok(!/dangerouslySetInnerHTML/.test(detailPage + listPage), "database text is rendered as escaped JSX only");
assert.match(pkg, /"test:pkg1d-b-reconciliation": /);
assert.match(pkg, /"test:pkg1d-b-reconciliation-contract": /);

// 9. Scope: no database change and nothing outside the registrations module, its styles, tests and package scripts.
const base = process.env.TERAS_PKG1D_B_BASE ?? "771db3acadb5d7514dea6f436e2d1e1ca2cb3531";
let changed: string[] = [];
try {
  const tracked = execFileSync("git", ["diff", "--name-only", base], { encoding: "utf8" });
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], { encoding: "utf8" });
  changed = [...new Set([...tracked.split("\n"), ...untracked.split("\n")].map((s) => s.trim()).filter(Boolean))];
} catch {
  changed = [];
}
if (changed.length > 0) {
  const allowed = [
    /^app\/admin\/\(protected\)\/registrations\/page\.tsx$/,
    /^app\/admin\/\(protected\)\/registrations\/\[id\]\/page\.tsx$/,
    /^lib\/registrations\/(reconciliation|reconciliationLoader|reviewQueue|reviewQueueLoader)\.ts$/,
    /^app\/admin\/admin\.css$/,
    /^scripts\/pkg1d-b-[a-z-]+\.(test\.)?mts$/,
    /^scripts\/pkg1d-b-staff-reconciliation-contract\.mts$/,
    /^package\.json$/,
    /^docs\/pkg1d-b\//,
    // Named PKG-1d-B exemptions in the two public-site scope guards (no other change to them, checked below).
    /^scripts\/public-design-foundation-contract\.mts$/,
    /^scripts\/s6-content-contract\.mts$/,
  ];
  for (const f of changed) assert.ok(allowed.some((r) => r.test(f)), `changed file is in scope: ${f}`);
  assert.ok(!changed.some((f) => f.startsWith("supabase/")), "no migration or SQL change");

  const diffLines = (path: string) =>
    execFileSync("git", ["diff", "-U0", base, "--", path], { encoding: "utf8" })
      .replace(/\r/g, "")
      .split("\n")
      .filter((l) => /^[+-](?![+-])/.test(l));
  // package.json: exactly the two PKG-1d-B test scripts are added, nothing removed or changed.
  assert.deepEqual(diffLines("package.json"), [
    '+    "test:pkg1d-b-reconciliation": "node --experimental-strip-types scripts/pkg1d-b-reconciliation.test.mts",',
    '+    "test:pkg1d-b-reconciliation-contract": "node --experimental-strip-types scripts/pkg1d-b-staff-reconciliation-contract.mts",',
  ]);
  // admin.css: only additions, all inside the scoped ta-recon-* block.
  const css = diffLines("app/admin/admin.css");
  assert.ok(css.length > 0 && css.every((l) => l.startsWith("+")), "admin.css only gains lines");
  assert.ok(css.every((l) => /^\+(\/\* PKG-1d-B .*\*\/|\.ta-recon[\w-]*[\s.:,{]|\.ta-recon \.|@media \(max-width: \d+px\) \{ \.ta-recon)/.test(l)), `admin.css additions are ta-recon-* only:\n${css.join("\n")}`);
  // The two scope guards: exactly these named PKG-1d-B exemption lines are added or changed -- no more, no less.
  // An exact list (not a pattern) so that widening an exemption in either guard fails here.
  const guards = [...diffLines("scripts/public-design-foundation-contract.mts"), ...diffLines("scripts/s6-content-contract.mts")];
  assert.deepEqual(guards, [
    "-check(\"protected paths have no changes against the contract base except the S5B-1B Round 1 approved files and the PKG-1d-A callback route\", () => {",
    "-  const changed = git([\"diff\", \"--name-only\", CONTRACT_BASE, \"--\", ...PROTECTED]).trim().split(\"\\n\").filter(Boolean).filter((path) => !ROUND1_APPROVED.includes(path) && !PF_CHANGED.includes(path) && path !== PKG1D_A_CALLBACK_FILE);",
    "+// PKG-1d-B (local, pending owner review, 22 Nov 2026): the read-only staff reconciliation screen may change exactly",
    "+// these admin files and add exactly the one detail page. scripts/pkg1d-b-staff-reconciliation-contract.mts proves their",
    "+// content (Admin guard first, read-only, named evidence keys only) and that admin.css only gains the ta-recon-* block.",
    "+const PKG1D_B_CHANGED = [\"app/admin/(protected)/registrations/page.tsx\", \"app/admin/admin.css\"];",
    "+const PKG1D_B_ADDED = [\"app/admin/(protected)/registrations/[id]/page.tsx\"];",
    "+check(\"protected paths have no changes against the contract base except the S5B-1B Round 1 approved files, the PKG-1d-A callback route and the PKG-1d-B admin files\", () => {",
    "+  const changed = git([\"diff\", \"--name-only\", CONTRACT_BASE, \"--\", ...PROTECTED]).trim().split(\"\\n\").filter(Boolean).filter((path) => !ROUND1_APPROVED.includes(path) && !PF_CHANGED.includes(path) && path !== PKG1D_A_CALLBACK_FILE && !PKG1D_B_CHANGED.includes(path) && !PKG1D_B_ADDED.includes(path));",
    "-  const added = changedSinceBase(PROTECTED).filter((line) => line.startsWith(\"?? \")).map((line) => line.slice(3)).filter((path) => !PF_ADDED.includes(path));",
    "+  const added = changedSinceBase(PROTECTED).filter((line) => line.startsWith(\"?? \")).map((line) => line.slice(3)).filter((path) => !PF_ADDED.includes(path) && !PKG1D_B_ADDED.includes(path));",
    "-    \" M app/api/payments/toyyibpay/registration-callback/route.ts\", \"?? lib/payments/registrationCallbackSelection.ts\"]);",
    "+    \" M app/api/payments/toyyibpay/registration-callback/route.ts\", \"?? lib/payments/registrationCallbackSelection.ts\",",
    "+    // PKG-1d-B (local, pending owner review, 22 Nov 2026): package.json gains exactly the two PKG-1d-B test scripts;",
    "+    // scripts/pkg1d-b-staff-reconciliation-contract.mts proves that no other line changed.",
    "+    \" M package.json\"]);",
  ], "scope-guard edits are exactly the named PKG-1d-B exemptions");
}

console.log("PKG-1d-B staff reconciliation contract passed.");
