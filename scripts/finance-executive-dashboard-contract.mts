import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// CEO Dashboard contract: Super Admin only (page and loader), read-only, RLS-bound client, no service role,
// no hrdf_claims read (HRDF is counted once through invoice_payments), no client-side data access.
// Static source checks; the money rules are covered by finance-executive-kpis.test.mts.

const read = async (p: string) => (await readFile(p, "utf8")).replace(/\r\n/g, "\n");
const [page, loader, kpis, rbac, nav, errorFile, loading] = await Promise.all([
  read("app/admin/(protected)/executive/page.tsx"),
  read("lib/finance/executiveKpisLoader.ts"),
  read("lib/finance/executiveKpis.ts"),
  read("lib/auth/rbac.ts"),
  read("lib/admin-nav.ts"),
  read("app/admin/(protected)/executive/error.tsx"),
  read("app/admin/(protected)/executive/loading.tsx"),
]);

// Executable code with comments stripped, so rules can be asserted without matching prose.
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const pageCode = code(page);
const loaderCode = code(loader);

// 1. Server-side Super Admin guard is the first statement of the page component and of the loader.
const pageBody = pageCode.slice(pageCode.indexOf("export default async function ExecutivePage"));
assert.match(pageBody, /\{\n\s*await requireRole\("super_admin"\);/, "the page awaits requireRole(super_admin) first");
const loaderBody = loaderCode.slice(loaderCode.indexOf("export async function loadExecutiveKpis"));
assert.match(loaderBody, /\{\n\s*await requireRole\("super_admin"\);/, "the loader awaits requireRole(super_admin) first");
assert.ok(pageBody.indexOf('requireRole("super_admin")') < pageBody.indexOf("loadExecutiveKpis("), "guard runs before any data is loaded");
assert.ok(loaderBody.indexOf('requireRole("super_admin")') < loaderBody.indexOf("createSupabaseServerClient()"), "guard runs before the client is created");

// 2. Server component only: no client directive on the page or loader, no browser client, no service role.
assert.ok(!/^\s*["']use client["']/m.test(page), "page is a Server Component");
assert.ok(!/["']use client["']/.test(loader) && !/["']use client["']/.test(kpis), "loader and KPI helper are server-side");
assert.ok(/^"use client";/.test(errorFile), "error boundary is the only client file");
assert.ok(!/createSupabaseBrowserClient|createSupabaseServiceClient|SERVICE_ROLE|service_role/i.test(loaderCode + pageCode), "no browser or service-role client");
assert.match(loaderCode, /createSupabaseServerClient\(\)/, "uses the RLS-bound server client");

// 3. Read-only: no writes, no RPC calls, no server actions.
assert.ok(!/\.(insert|update|upsert|delete)\(|\.rpc\(/.test(loaderCode + pageCode), "no mutation or RPC call");
assert.ok(!/["']use server["']/.test(page + loader + kpis), "no server actions");

// 4. Reads only the tables the definitions need; HRDF claims are never read (no second count of HRDF money).
const tables = [...loaderCode.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
assert.deepEqual(tables, ["invoice_payments", "invoices", "invoices", "sales_quotations"], "only quotations, invoices and invoice_payments are read");
assert.ok(!/hrdf_claims/.test(loaderCode), "hrdf_claims is not read");
assert.match(kpis, /payment_source === "hrdf"/, "HRDF is identified within invoice_payments");

// 5. Definitions are wired into the queries.
assert.match(loaderCode, /\.eq\("status", "accepted"\)[\s\S]*\.eq\("is_test", false\)/, "Booked reads accepted, non-test quotations");
assert.match(loaderCode, /\.in\("status", billable\)[\s\S]*\.gte\("issued_at", start\)/, "Billed uses billable statuses and issued_at");
assert.match(loaderCode, /\.gt\("balance_due", 0\)/, "Outstanding reads open balances");
assert.match(loaderCode, /\.in\("status", \["successful", "refunded"\]\)/, "payments query reads successful and refunded only");
assert.match(kpis, /BILLABLE_INVOICE_STATUSES = \["issued", "partially_paid", "paid"\]/, "billable statuses");
assert.match(kpis, /payment_provider === "toyyibpay" \? toCents\(p\.verified_amount\) : toCents\(p\.amount\)/, "Toyyibpay uses verified_amount");

// 6. Row limit fails closed instead of showing a partial figure; errors never leak row data.
assert.match(loaderCode, /ROW_LIMIT/, "row limit exists");
assert.match(loaderCode, /reason: "too_large"/, "a full result set is refused");
assert.match(loaderCode, /reason: "query_failed"/, "a failed query is refused");
assert.ok(!/console\.error\([^)]*(message|data)\b/.test(loaderCode.replace(/code: result\.error\.code/g, "")), "error logging does not include messages or row data");

// 7. No await inside a Promise.all array literal (CLAUDE.md section 5/13) and no `as any`.
assert.ok(!/Promise\.all\(\[[^\]]*await/.test(loaderCode), "no await inside Promise.all([...])");
assert.ok(!/\bas any\b/.test(loaderCode + pageCode + kpis), "no any casts");

// 8. Access wiring: MODULE_ACCESS requires super_admin, the catalog (staff-assignable) does not list it, nav is super_admin only.
assert.match(rbac, /executive: "super_admin",/, "MODULE_ACCESS has the executive entry at super_admin");
assert.ok(!/\["executive",/.test(rbac), "executive is not in the staff-assignable MODULE_CATALOG");
assert.match(nav, /key: "executive", label: "CEO Dashboard", href: "\/admin\/executive", icon: "dashboard", minRole: "super_admin"/, "nav entry is super_admin only");

// 9. Period and presentation rules.
assert.match(page, /REPORT_RANGE_KEYS/, "month, quarter, year and custom ranges come from the shared Sales range keys");
assert.match(page, /Outstanding \(current/, "Outstanding is labelled as a current balance");
assert.match(page, /Booked \(period\)[\s\S]*Billed \(period\)[\s\S]*Collected \(period\)/, "period figures are labelled");
assert.match(page, /Refunded \(not in Collected\)/, "refunds are shown separately");
assert.match(page, /of which SST/, "SST is shown separately");
assert.match(page, /result\.ok/, "failed loads render an error state");
assert.match(loading, /role="status"/, "loading state exists");

console.log("Finance executive dashboard contract passed.");
