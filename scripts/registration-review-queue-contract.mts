import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Registration review queue contract: Admin and Super Admin only (page and loader), read-only, RLS-bound session,
// minimal safe columns, bounded pagination, and a SELECT-only admin policy migration. Static source checks; the
// state and exception rules are covered by registration-review-queue.test.mts.

const read = async (p: string) => (await readFile(p, "utf8")).replace(/\r\n/g, "\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const [page, loader, rules, rbac, nav, types, errorFile, loading, migration, pkg] = await Promise.all([
  read("app/admin/(protected)/registrations/page.tsx"),
  read("lib/registrations/reviewQueueLoader.ts"),
  read("lib/registrations/reviewQueue.ts"),
  read("lib/auth/rbac.ts"),
  read("lib/admin-nav.ts"),
  read("lib/supabase/database.types.ts"),
  read("app/admin/(protected)/registrations/error.tsx"),
  read("app/admin/(protected)/registrations/loading.tsx"),
  read("supabase/migrations/20261105150000_public_registration_admin_read_policies.sql"),
  read("package.json"),
]);
const pageCode = code(page);
const loaderCode = code(loader);
const sql = migration.replace(/^\s*--.*$/gm, "");

// 1. Server-side Admin guard: first statement of the page and of the loader, before any data access.
const pageBody = pageCode.slice(pageCode.indexOf("export default async function RegistrationsPage"));
assert.match(pageBody, /\{\n\s*await requireRole\("admin"\);/, "the page awaits requireRole(admin) first");
const loaderBody = loaderCode.slice(loaderCode.indexOf("export async function loadRegistrationQueue"));
assert.match(loaderBody, /\{\n\s*await requireRole\("admin"\);/, "the loader awaits requireRole(admin) first");
assert.ok(pageBody.indexOf('requireRole("admin")') < pageBody.indexOf("loadRegistrationQueue("), "guard runs before data is loaded");
assert.ok(loaderBody.indexOf('requireRole("admin")') < loaderBody.indexOf("createSupabaseServerClient()"), "guard runs before the client is created");
assert.ok(!/requireRole\("(editor|trainer)"\)/.test(pageCode + loaderCode), "no weaker role anywhere");

// 2. Ordinary RLS-bound session only. No service role, browser client or server action.
assert.match(loaderCode, /createSupabaseServerClient\(\)/);
assert.ok(!/createSupabaseServiceClient|createSupabaseBrowserClient|SERVICE_ROLE|service_role/i.test(loaderCode + pageCode + rules), "no service-role or browser client");
assert.ok(!/["']use server["']/.test(page + loader + rules), "no server actions");
assert.ok(!/^\s*["']use client["']/m.test(page) && !/["']use client["']/.test(loader + rules), "page, loader and rules are server-side");
assert.ok(/^"use client";/.test(errorFile), "the error boundary is the only client file");

// 3. Read-only: no writes, no RPC calls, no mutation controls, no export.
assert.ok(!/\.(insert|update|upsert|delete)\(|\.rpc\(/.test(loaderCode + pageCode), "no mutation or RPC call");
assert.ok(!/<button/.test(pageCode.replace(/<button type="submit"[^>]*>Apply<\/button>/, "")), "the only button is the filter Apply");
assert.ok(!/retry|finalize|refund|repair|verify manual|mark paid/i.test(pageCode.replace(/\{[^}]*\}/g, "")), "no retry, finalize, refund, repair or verification control text");
assert.ok(!/Export|download|csv|\/export/i.test(pageCode.replace(/export (const|default|async|function) /g, "")), "no export in v1");

// 4. Tables read, and the columns that must never be selected.
const tables = [...loaderCode.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]).sort();
assert.deepEqual(
  tables,
  ["course_schedules", "courses", "public_registration_attendees", "public_registration_payments", "public_registrations", "public_registrations", "public_registrations", "public_registrations", "schedule_participants"].sort(),
  "only the registration tables plus course, schedule and enrolment lookups",
);
const selectArgs = [...loaderCode.matchAll(/\.select\(\s*(?:"([^"]*)"|`([^`]*)`|(\w+))/g)].map((m) => m[1] ?? m[2] ?? m[3]);
assert.ok(selectArgs.length >= 9, "every query lists its columns");
const listColumns = loaderCode.match(/const listColumns =\s*"([^"]*)"/)?.[1] ?? "";
const selectedText = [...selectArgs.filter((s) => s !== "listColumns"), listColumns].join(" ");
for (const forbidden of ["raw_response", "ic_passport_no", "identity_normalized", "email", "phone", "confirmation_token_hash", "idempotency_key_hash", "payment_url", "provider_bill_code", "provider_reference", "*"]) {
  assert.ok(!new RegExp(`(^|[\\s,])${forbidden.replace("*", "\\*")}($|[\\s,])`).test(selectedText), `${forbidden} is never selected`);
}
assert.ok(!/raw_response|ic_passport_no|identity_normalized/.test(loaderCode + pageCode), "sensitive columns are not even referenced in the loader or page");
assert.match(loaderCode, /has_transaction_id: str\(p\.provider_transaction_id\)\.length > 0/, "the provider transaction id is reduced to a boolean");
assert.ok(!/provider_transaction_id/.test(pageCode + code(rules)), "the transaction id never reaches the page or the pure rules");

// 5. Bounded, ordered pagination; filters are whitelisted values only.
assert.match(loaderCode, /\.order\("created_at", \{ ascending: false \}\)\.order\("id", \{ ascending: false \}\)\.range\(from, from \+ PAGE_SIZE - 1\)/, "newest first, 25 per page, deterministic");
assert.match(rules, /PAGE_SIZE = 25;/);
assert.match(loaderCode, /count: "exact"/, "an exact count drives the page count");
assert.match(loaderCode, /ATTENDEE_LIMIT[\s\S]*PAYMENT_LIMIT[\s\S]*ENROLMENT_LIMIT/, "supporting queries are bounded");
assert.match(loaderCode, /reason: "too_large"/, "a full supporting query is refused, not shown as complete");
assert.match(loaderCode, /enrolmentExact/, "a capped enrolment lookup becomes UNKNOWN, not a silent undercount");
assert.ok(!/\.or\(|\.ilike\(|\.like\(/.test(loaderCode), "no free-text filter string is built");
assert.match(loaderCode, /params\.status\) q = q\.eq\("registration_status", params\.status\)/);
assert.match(loaderCode, /params\.payment\) q = q\.eq\("payment_status", params\.payment\)/);

// 6. Honest "Needs attention": the filters are global (database-side), everything else is labelled page-only.
assert.deepEqual([...rules.matchAll(/(expired_hold|paid_unconfirmed): "[^"]*\(all pages\)"/g)].map((m) => m[1]), ["expired_hold", "paid_unconfirmed"], "global filters are labelled all pages");
assert.match(pageCode, /checked only on the \{PAGE_SIZE\} rows shown, so it is not a total/, "the page states that other indicators cover the current page only");
assert.match(pageCode, /Registrations \(all\)[\s\S]*Hold expired, still open \(all\)[\s\S]*Paid, not confirmed \(all\)/, "the totals are labelled as covering all registrations");
assert.match(pageCode, /not treated as a completed registration/, "payment is not treated as completion");
assert.match(pageCode, /UNKNOWN/, "uncheckable cases are labelled UNKNOWN");
assert.match(pageCode, /result\.ok/, "failed loads render an error state, not partial rows");
assert.match(loading, /role="status"/);

// 7. Access wiring.
assert.match(rbac, /registrations: "admin",/, "MODULE_ACCESS requires admin");
assert.ok(!/\["registrations",/.test(rbac), "not a staff-assignable catalog module");
assert.match(nav, /key: "registrations", label: "Registrations", href: "\/admin\/registrations", icon: "participants", minRole: "admin"/, "nav entry is Admin only");

// 8. Types: read-only Row shapes for the three tables, no write shapes offered.
for (const t of ["public_registrations: { Row: PublicRegistration; Insert: Record<string, never>; Update: Record<string, never>", "public_registration_attendees: { Row: PublicRegistrationAttendee; Insert: Record<string, never>; Update: Record<string, never>", "public_registration_payments: { Row: PublicRegistrationPayment; Insert: Record<string, never>; Update: Record<string, never>"]) {
  assert.ok(types.includes(t), `types declare ${t.split(":")[0]} read-only`);
}

// 9. Migration: ONE file, SELECT-only admin policies, no broad grants, existing deny policies untouched.
assert.deepEqual([...sql.matchAll(/'(public_registrations|public_registration_attendees|public_registration_payments)'/g)].map((m) => m[1]), ["public_registrations", "public_registration_attendees", "public_registration_payments"], "exactly the three tables");
assert.match(sql, /for select to authenticated using \(app\.is_admin\(\)\)/, "SELECT policy for authenticated, admin only");
assert.match(sql, /t \|\| '_admin_select'/, "policy names end in _admin_select");
assert.match(sql, /grant select on table public\.%I to authenticated/, "SELECT-only grant to authenticated");
assert.ok(!/\bto anon\b|\bto public\b|\bfor all\b|\bfor insert\b|\bfor update\b|\bfor delete\b/i.test(sql), "no anon, public or write policy");
assert.ok(!/grant\s+(all|insert|update|delete|truncate|references|trigger)/i.test(sql), "no broad or write grant");
assert.ok(!/revoke/i.test(sql), "no revoke in this migration");
assert.ok(!/no_direct_client_access/.test(sql), "the existing deny policies are not touched");
assert.ok(!/drop table|drop column|truncate|delete from|insert into|update public/i.test(sql), "no data or schema destruction");
assert.match(sql, /to_regclass\(/, "guarded against a missing table");
assert.match(sql, /drop policy if exists %I/, "idempotent");
assert.ok(!/create (or replace )?function|security definer/i.test(sql), "no new function");

// 10. Hygiene shared with the other finance and admin code.
assert.ok(!/Promise\.all\(\[[^\]]*await/.test(loaderCode), "no await inside Promise.all([...])");
assert.ok(!/\bas any\b/.test(loaderCode + pageCode + rules), "no any casts");
assert.ok(!/console\.(log|info|debug)\(/.test(loaderCode + pageCode), "no console logging of data");
const errorLogs = [...loaderCode.matchAll(/console\.error\("[^"]*", \{([^}]*)\}\)/g)];
assert.ok(errorLogs.length >= 4 && errorLogs.length === [...loaderCode.matchAll(/console\.error\(/g)].length, "every error log is a literal message plus a small object");
for (const [, body] of errorLogs) {
  const keys = body.split(",").map((part) => part.split(":")[0].trim());
  assert.ok(keys.every((k) => ["query", "code", "limit"].includes(k)), `error logs carry only the query name, error code and limit (found ${keys.join(",")})`);
}
assert.match(pkg, /"test:registration-review-queue": /, "tests are registered in package.json");

console.log("Registration review queue contract passed.");
