import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

// Contract for the removal of the legacy API login endpoint. That endpoint was a second, UI-unreferenced sign-in path that
// checked the legacy admin_users table, skipped the profiles.is_active check and returned raw session tokens in a JSON body.
// The working CRM login is app/admin/login (a Server Action over cookie sessions) and must stay exactly as protected as before.
// Static checks only: no network, no credentials, no live Supabase access.

const LEGACY_PATH = ["app", "api", "admin", "login"].join("/");
const LEGACY_URL = ["api", "admin", "login"].join("/");

const checks: Array<[string, boolean]> = [];
const check = (label: string, ok: boolean) => checks.push([label, ok]);

// 1. The legacy endpoint is gone, in every route-file spelling Next.js would serve.
const routeFiles = ["route.js", "route.ts", "route.mjs", "route.cjs", "route.jsx", "route.tsx"];
check("legacy API login route file is absent", routeFiles.every((file) => !existsSync(`${LEGACY_PATH}/${file}`)));
check("legacy API login directory is absent", !existsSync(LEGACY_PATH));

// 2. Nothing in application code, middleware, config or scripts refers to it.
async function collect(directory: string, found: string[]) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git"].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(full, found);
    else if (/\.(js|jsx|mjs|cjs|ts|tsx|mts|json)$/.test(entry.name)) found.push(full);
  }
}
const sourceFiles: string[] = [];
for (const dir of ["app", "components", "lib", "scripts"]) await collect(dir, sourceFiles);
for (const file of ["middleware.ts", "next.config.mjs", "package.json"]) if (existsSync(file)) sourceFiles.push(file);
const self = path.normalize("scripts/legacy-admin-login-removal-contract.mts");
const referrers: string[] = [];
for (const file of sourceFiles) {
  if (path.normalize(file) === self) continue;
  if ((await readFile(file, "utf8")).includes(LEGACY_URL)) referrers.push(file);
}
check(`no application, script or config file refers to the legacy endpoint${referrers.length ? ` (found in: ${referrers.join(", ")})` : ""}`, referrers.length === 0);

// 3. The real CRM login is still present and still wired the same way.
const page = existsSync("app/admin/login/page.tsx");
const actions = existsSync("app/admin/login/actions.ts") ? await readFile("app/admin/login/actions.ts", "utf8") : "";
check("the /admin/login page is still present", page);
check("the login Server Action is still present", /export async function loginAction/.test(actions));
check("login still validates input with a schema before touching Auth", /loginSchema\.safeParse/.test(actions) && actions.indexOf("loginSchema.safeParse") < actions.indexOf("signInWithPassword"));
check("login still uses the cookie-session server client (not a token-returning client)", /createSupabaseServerClient\(\)/.test(actions) && !/createClient\(/.test(actions));
check("login still checks profiles.is_active", /from\("profiles"\)[\s\S]*?select\("is_active, role, must_change_password"\)/.test(actions) && /!profile\?\.is_active/.test(actions));
check("a deactivated account is still signed out immediately", /!profile\?\.is_active\)\s*\{\s*await supabase\.auth\.signOut\(\)/.test(actions));
check("a failed profile lookup still fails closed with a generic message", /profileError[\s\S]*?return \{ error: GENERIC_LOGIN_ERROR \}/.test(actions));
check("login still writes the audit event with the service role helper", /writeLoginAudit\(/.test(actions));
check("login still forces a first-login password change", /must_change_password\) redirect\("\/admin\/account\/change-password"\)/.test(actions));
check("login still only redirects to /admin destinations", /startsWith\("\/admin"\)/.test(actions));
check("login never returns a session or tokens to the client", !/access_token|refresh_token|return \{[^}]*session/.test(actions));

// 4. Cookie-session and middleware protections that make /admin/login work are unchanged.
const server = await readFile("lib/supabase/server.ts", "utf8");
check("the server client still reads and writes the session through Next.js cookies", /createServerClient/.test(server) && /getAll\(\)/.test(server) && /setAll\(/.test(server));
const middlewareLib = await readFile("lib/supabase/middleware.ts", "utf8");
const middleware = await readFile("middleware.ts", "utf8");
check("middleware still revalidates the user with auth.getUser() (not a cached session)", /auth\.getUser\(\)/.test(middlewareLib) && !/getSession\(\)/.test(middlewareLib));
check("middleware still covers /admin (so /admin/login still passes through the session refresh)", /\/admin\/:path\*/.test(middleware));
check("unauthenticated /admin visitors are still redirected to /admin/login", /\/admin\/login/.test(middlewareLib));

// 5. No remaining API route can hand a session or raw tokens back in a response body.
const apiFiles: string[] = [];
await collect("app/api", apiFiles);
const tokenLeaks: string[] = [];
for (const file of apiFiles) if (/access_token|refresh_token|NextResponse\.json\(\{\s*session/.test(await readFile(file, "utf8"))) tokenLeaks.push(file);
check(`no API route returns a session or auth tokens in a JSON body${tokenLeaks.length ? ` (found in: ${tokenLeaks.join(", ")})` : ""}`, tokenLeaks.length === 0);

// 6. The other public auth route (password reset) is untouched by this change and keeps its guard.
const reset = existsSync("app/api/admin/reset-password/route.js") ? await readFile("app/api/admin/reset-password/route.js", "utf8") : "";
check("the password reset route is still present and still behind the Preview isolation guard", /validatePublicSupabaseConfig\(\)/.test(reset));
check("the password reset route still does not reveal whether an account exists", /If this email belongs to an admin account/.test(reset));

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} legacy-admin-login-removal check(s) passed.`);
if (failed) process.exit(1);
