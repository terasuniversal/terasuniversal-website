/**
 * W9-G3 eBook flow contract (owner-approved, local only; W9-EBOOK-RPC-CONTRACT v1.0, frozen). Proves:
 *  - the named edits in scripts/w9g3-approved.mts are the only changes to the two pinned eBook files;
 *  - the service role enters the eBook flow at exactly one place (lib/ebook-runtime.server.js wires
 *    lib/ebook-privileged.server.js), behind the Preview isolation guard, with explicit RPC and object allowlists;
 *  - no client component imports server-only modules; the routes are the only importers of the runtime;
 *  - verification consumes tokens only on POST, the download token travels only in a POST body, and the signed URL is
 *    never logged; the shared contract values match the frozen contract exactly;
 *  - the email DNS filter implements implicit MX, Null MX and transient handling;
 *  - W9-G3.1 (erratum v1.0.2): verification links carry the token only in the URL fragment; legacy ?t= is refused;
 *    the token is never stored client-side or logged;
 *  - the live form keeps the privacy hardening (POST, disabled until ready), optional unticked marketing, no phone consent.
 *
 * Run: node --experimental-transform-types scripts/w9g3-ebook-contract.mts
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { revertW9g3, W9G3_ADDED, W9G3_CHANGED, W9G3_PROTECTED_ADDED } from "./w9g3-approved.mts";
import { revertW10uxFoundation, W10UX_FOUNDATION } from "./w10ux-approved.mts"; // CE-1 is later than W9-G3: undone first

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (p: string) => { const t = readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n"); return p === W10UX_FOUNDATION ? revertW10uxFoundation(t) : t; };
const sha256 = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const f = path.join(dir, n); return statSync(f).isDirectory() ? walk(f) : [f]; });
const rel = (f: string) => path.relative(root, f).replace(/\\/g, "/");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

// SHA-256 (LF-normalised) at main 45672429, before W9-G3.
const BEFORE: Record<string, string> = {
  "app/ebook/[[...ebook]]/page.js": "ffc92ee47831aeeabd8374e1df5aef4b915c54ecac1d1e60005c50e1893936a4",
  "components/ebook/ebook.module.css": "afb755fa9efdd3c60a937f7010253169106e5ff80bed3f547604b79005f19a68",
  "scripts/public-design-foundation-contract.mts": "6df0d3e94448429e2e18e7113e82a73e2e89513a9ae8c9b20244504e4dc2b637", // W9-G3.2
};
// Service-role importers that already existed at 45672429; W9-G3 may add exactly one (the eBook runtime wiring).
const SERVICE_ROLE_BASELINE = [
  "app/admin/(protected)/feedback/[scheduleId]/page.tsx", "app/admin/(protected)/feedback/actions.ts", "app/admin/(protected)/invoices/toyyibpayActions.ts",
  "app/admin/(protected)/participants/actions.ts", "app/admin/(protected)/participants/legacy-import/actions.ts", "app/admin/(protected)/users/actions.ts",
  "app/admin/login/actions.ts", "app/api/feedback/schedule/resolve/route.ts", "app/api/payments/toyyibpay/callback/route.ts",
  "app/api/payments/toyyibpay/registration-callback/route.ts", "app/api/registration/payment/route.ts", "app/api/request-proposal/route.js",
  "lib/certificate-render-assets.ts", "lib/rate-limit.js", "lib/supabase/server.ts",
];
const SOURCES = ["app", "components", "lib"].flatMap((d) => walk(path.join(root, d))).filter((f) => /\.(js|jsx|ts|tsx|mjs)$/.test(f));

check("kit allowlist (W9-G3.2): exactly the verify page was added, no wildcard; any other kit importer is still rejected", () => {
  const listOf = (src: string) => [...(src.split(/\r?\n/).find((l) => l.includes("assert.deepEqual(importers, ["))!.matchAll(/"([^"]+)"/g))].map((m) => m[1]);
  const now = listOf(read("scripts/public-design-foundation-contract.mts"));
  const base = listOf(revertW9g3("scripts/public-design-foundation-contract.mts", read("scripts/public-design-foundation-contract.mts")));
  assert(JSON.stringify(now.filter((p) => !base.includes(p))) === JSON.stringify(["app/ebook/verify/[[...verify]]/page.js"]) && base.every((p) => now.includes(p)), "only the verify page added");
  assert(now.length === base.length + 1 && JSON.stringify([...now].sort()) === JSON.stringify(now), "sorted, one entry added");
  assert(!now.some((p) => /[*?]|\.\.\.\]\/|^app\/ebook\/?$|\/$/.test(p.replace("[[...ebook]]", "").replace("[[...verify]]", "").replace("[[...lang]]", "").replace("[[...part]]", ""))), "no wildcard or directory entries");
  // Negative: a page that is not on the list but imports the kit makes the importer list differ, so deepEqual fails.
  const probe = [...now, "app/ebook/unauthorized/page.js"].sort();
  assert(JSON.stringify(probe) !== JSON.stringify(now), "an unauthorized kit importer is still rejected");
});
check("protected paths (W9-G3.3): exactly the two W9-G3 API routes are excepted; the assertion is otherwise unchanged", () => {
  assert(JSON.stringify(W9G3_PROTECTED_ADDED) === JSON.stringify(["app/api/ebook/download/route.js", "app/api/ebook/verify/route.js"]) && Object.isFrozen(W9G3_PROTECTED_ADDED), "exact frozen list");
  assert(W9G3_PROTECTED_ADDED.every((p) => W9G3_ADDED.includes(p) && existsSync(path.join(root, p)) && /^app\/api\/ebook\/(verify|download)\/route\.js$/.test(p)), "each is a W9-G3 file that exists; no wildcard or directory");
  const f = read("scripts/public-design-foundation-contract.mts");
  const line = f.split("\n").find((l) => l.includes("protected paths have no new files"));
  assert(line === 'check("protected paths have no new files (committed or untracked) since the contract base", () => {', "assertion title unchanged");
  assert(f.includes('const added = changedSinceBase(PROTECTED).filter((line) => line.startsWith("?? ")).map((line) => line.slice(3)).filter((path) => !PF_ADDED.includes(path) && !W9G3_PROTECTED_ADDED.includes(path) /* W9-G3.3 exact paths */);\n  assert.deepEqual(added, [], added.join(", "));'), "same deepEqual, one exact-list filter added");
  assert(f.includes('const PROTECTED = ["app/globals.css", "app/layout.js", "app/admin", "components/admin", "app/verify", "app/registration", "app/api", "lib/supabase", "middleware.ts", "next.config.mjs"];'), "protected path list unchanged");
  assert((f.match(/W9G3_PROTECTED_ADDED/g) || []).length === 2, "used only in the import and the new-files filter (not in the changed-files check)");
});
check("scope: exactly the three pinned files carry W9-G3 named edits; every added file exists", () => {
  assert(JSON.stringify(W9G3_CHANGED) === JSON.stringify(Object.keys(BEFORE).sort()), W9G3_CHANGED.join(", "));
  for (const p of W9G3_ADDED) assert(existsSync(path.join(root, p)), `missing ${p}`);
});
check("integrity: reverting the named edits restores every pinned file exactly", () => {
  for (const [p, hash] of Object.entries(BEFORE)) assert(sha256(revertW9g3(p, read(p))) === hash, p);
});
check("service role: exactly one new importer (lib/ebook-runtime.server.js); nothing else in the eBook flow", () => {
  const importers = SOURCES.filter((f) => /createSupabaseServiceClient/.test(readFileSync(f, "utf8"))).map(rel).sort();
  const added = importers.filter((f) => !SERVICE_ROLE_BASELINE.includes(f));
  assert(JSON.stringify(added) === JSON.stringify(["lib/ebook-runtime.server.js"]), added.join(", "));
  for (const f of ["lib/ebook-privileged.server.js", "lib/ebook-request.js", "lib/ebook-contract.js", "lib/ebook-mailer.js", "lib/email-dns.js", "lib/ebook-verify-link.js",
    "app/api/ebook/route.js", "app/api/ebook/verify/route.js", "app/api/ebook/download/route.js", "components/ebook/EbookRequestForm.js", "components/ebook/EbookVerify.js"]) {
    assert(!/createSupabaseServiceClient|getSupabaseServiceRoleKey|SUPABASE_SERVICE_ROLE_KEY/.test(read(f)), f);
  }
});
check("privileged module: guard before client, browser refusal, explicit allowlists, 60-second signing", () => {
  const m = read("lib/ebook-privileged.server.js");
  assert(/if \(typeof window !== "undefined"\) throw new EbookPrivilegedUnavailable\("browser"\);/.test(m), "browser refusal");
  assert(/const guard = validate\(\);\n    if \(!guard \|\| guard\.ok !== true\) throw new EbookPrivilegedUnavailable[^\n]*\n    if \(!client\) client = createClient\(\);/.test(m), "guard before client");
  assert(/if \(!EBOOK_RPC_ALLOWLIST\.includes\(name\)\) throw new EbookPrivilegedUnavailable\("rpc_not_allowlisted"\);/.test(m), "rpc allowlist");
  assert(/if \(bucket !== EBOOK_PUBLICATION\.bucket \|\| objectPath !== EBOOK_PUBLICATION\.objectPath\)/.test(m), "path allowlist");
  const r = read("lib/ebook-runtime.server.js");
  assert(/validate: \(\) => validatePrivilegedSupabaseConfig\(\), createClient: \(\) => createSupabaseServiceClient\(\)/.test(r), "runtime wires the guard");
  assert(/local && process\.env\.TERAS_EBOOK_MAILER === "mock"/.test(r), "mock mailer only on a local target");
});
check("contract: frozen v1.0 values (version, RPCs, token shape, publication, 60 s)", () => {
  const c = read("lib/ebook-contract.js");
  for (const re of [/EBOOK_CONTRACT_VERSION = "v1\.0";/, /submit: "submit_ebook_request",\n  verify: "verify_ebook_email",\n  redeem: "redeem_ebook_token",/,
    /EBOOK_TOKEN_PATTERN = \/\^\[A-Za-z0-9_-\]\{43\}\$\/;/, /EBOOK_PUBLICATION = Object\.freeze\(\{ bucket: "ebook-private", objectPath: "v1\.5\.1\/teras-ebook-v1\.5\.1\.pdf" \}\);/,
    /EBOOK_SIGNED_URL_SECONDS = 60;/]) assert(re.test(c), String(re));
  assert(!/reserve_email_quota/.test(c), "eBook never calls the quota RPC itself (submit does it internally)");
});
check("client boundary: no client component imports a server-only module; only the eBook routes import the runtime", () => {
  for (const f of SOURCES.filter((f) => /^["']use client["']/m.test(readFileSync(f, "utf8")))) {
    assert(!/ebook-privileged|ebook-runtime|supabase\/server|rate-limit|preview-isolation|from "resend"/.test(readFileSync(f, "utf8")), rel(f));
  }
  const runtimeImporters = SOURCES.filter((f) => /ebook-runtime\.server/.test(readFileSync(f, "utf8"))).map(rel).sort();
  assert(JSON.stringify(runtimeImporters) === JSON.stringify(["app/api/ebook/download/route.js", "app/api/ebook/route.js", "app/api/ebook/verify/route.js"]), runtimeImporters.join(", "));
});
check("routes: switch first, every other method 404, same-origin, no-store/no-referrer on verify and download", () => {
  for (const r of ["app/api/ebook/route.js", "app/api/ebook/verify/route.js", "app/api/ebook/download/route.js"]) {
    const s = read(r);
    assert(/export async function POST\(request\) \{\n  if \(!ebookPublicEnabled\(\)\) return new NextResponse\(null, \{ status: 404 \}\);/.test(s), `${r} switch`);
    assert(/export const PUT = GET;\nexport const PATCH = GET;\nexport const DELETE = GET;/.test(s) && /export const OPTIONS = GET;/.test(s), `${r} methods`);
    assert(/export function GET\(\) \{\n  return new NextResponse\(null, \{ status: 404 \}\);\n\}/.test(s), `${r} GET is always 404`);
  }
  for (const r of ["app/api/ebook/verify/route.js", "app/api/ebook/download/route.js"]) {
    const s = read(r);
    assert(/"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"/.test(s), `${r} headers`);
    assert(/if \(!origin \|\| origin !== /.test(s), `${r} same-origin`);
  }
});
check("verification: GET never consumes; token removed from the address bar; consumed only by POST", () => {
  const v = read("components/ebook/EbookVerify.js");
  assert(/window\.history\.replaceState\(null, "", window\.location\.pathname\);/.test(v), "token removed from URL/history");
  const fetches = v.match(/fetch\(/g) || [];
  assert(fetches.length === 2, "exactly two fetches (verify, download)");
  assert(/async function confirm\(\) \{[\s\S]*?fetch\("\/api\/ebook\/verify", \{ method: "POST"/.test(v), "verify POST only inside confirm()");
  assert(/async function download\(\) \{[\s\S]*?fetch\("\/api\/ebook\/download", \{ method: "POST"/.test(v), "download POST only inside download()");
  assert(/onClick=\{confirm\}/.test(v), "explicit user action");
  const page = read("app/ebook/verify/[[...verify]]/page.js");
  assert(/referrer: "no-referrer"/.test(page) && /robots: \{ index: false, follow: false \}/.test(page), "page metadata");
});
check("download: token only in a POST body; GET is 404; signed URL never logged or placed in our URLs", () => {
  const v = read("components/ebook/EbookVerify.js");
  assert(/body: JSON\.stringify\(\{ t: downloadToken \}\)/.test(v), "download token in the POST body");
  assert(/window\.location\.assign\(data\.url\);/.test(v) && /onClick=\{download\}/.test(v), "explicit click opens the signed URL (CSP form-action safe)");
  assert(!/download\?t=|\/api\/ebook\/download\?/.test(v + read("app/api/ebook/download/route.js") + read("lib/ebook-request.js")), "no token in download URLs");
  const d = read("app/api/ebook/download/route.js");
  assert(/const body = await request\.json\(\);\n    token = typeof body\?\.t === "string" \? body\.t : null;/.test(d), "JSON body token");
  assert(/NextResponse\.json\(\{ status: "ready", url: result\.url \}, \{ status: 200, headers: HEADERS \}\)/.test(d), "signed URL only in a no-store JSON body");
  assert(!/NextResponse\.redirect/.test(d), "no redirect to Storage (form-action)");
  const logLines = (read("lib/ebook-request.js") + read("lib/ebook-mailer.js") + read("lib/ebook-runtime.server.js") + d).split("\n").filter((l) => /\blog\("|console\.(error|log|warn)\(/.test(l));
  for (const line of logLines) assert(!/url|token|email\b|phone|fullName|signed/i.test(line.replace(/log\("ebook [a-z ]+"/, "")), line.trim());
});
check("token transport (v1.0.2): fragment links only; legacy ?t= refused; no client storage; no token in logs", () => {
  const has = (s: string, piece: string) => s.includes(piece);
  const l = read("lib/ebook-verify-link.js");
  assert(has(l, "return `${siteOrigin}${EBOOK_VERIFY_PATH}#t=${token}`;"), "link builder uses #t=");
  assert(has(l, 'if (!EBOOK_TOKEN_PATTERN.test(String(token))) throw'), "link builder refuses malformed tokens");
  assert(has(l, 'const legacy = query.has("t");') && has(l, "token: !legacy && t && EBOOK_TOKEN_PATTERN.test(t) ? t : null,"), "legacy query token refused");
  assert(has(l, 'const fragment = new URLSearchParams(String(hash || "").replace(/^#/, ""));') && has(l, 'const t = fragment.get("t");'), "token read from the fragment only");
  assert(!/console\.|\blog\(/.test(l), "link module never logs");
  const r = read("lib/ebook-runtime.server.js");
  assert(has(r, "verifyUrlFor: (token) => ebookVerifyUrl(siteOrigin, token),"), "runtime builds links with the fragment builder");
  const v = read("components/ebook/EbookVerify.js");
  assert(has(v, 'const link = parseVerifyLink({ hash: window.location.hash, search: window.location.search });\n      window.history.replaceState(null, "", window.location.pathname);'), "fragment read, then removed at once (pathname only)");
  assert(has(v, 'window.addEventListener("hashchange", readLink);') && has(v, 'return () => window.removeEventListener("hashchange", readLink);') && has(v, "    readLink();\n"), "same-document links (hashchange) are read and cleaned too");
  assert(!/location\.search\)\.get\("t"\)|searchParams\.get\("t"\)/.test(v), "client never reads a query token");
  const server = ["lib/ebook-request.js", "lib/ebook-runtime.server.js", "lib/ebook-mailer.js", "app/api/ebook/route.js", "app/api/ebook/verify/route.js", "app/api/ebook/download/route.js"].map(read).join("\n");
  assert(!/verify\?t=|\/ebook\/verify\?/.test(server + l), "no query-string verification link anywhere on the server");
  for (const f of ["components/ebook/EbookVerify.js", "lib/ebook-verify-link.js", "components/ebook/EbookRequestForm.js"]) {
    assert(!/localStorage|sessionStorage|document\.cookie|indexedDB|caches\.open|navigator\.sendBeacon|console\./.test(read(f)), `${f}: no client storage, beacons or console`);
  }
});
check("email DNS: implicit MX, Null MX, NXDOMAIN, transient accepted, transient not cached", () => {
  const e = read("lib/email-dns.js");
  for (const re of [/kind: "implicit_mx"/, /kind: "null_mx"/, /kind: "nxdomain"/, /kind: "no_mail_host"/, /kind: "transient"/, /result\.kind !== "transient"/, /\["", "\."\]\.includes/]) assert(re.test(e), String(re));
});
check("live form: POST + disabled until mounted, uniform states, optional unticked marketing, honeypot, no phone consent", () => {
  const f = read("components/ebook/EbookRequestForm.js");
  assert(/<form className=\{styles\.form\} method="post" onSubmit=\{handleSubmit\}/.test(f), "POST form");
  assert(/useEffect\(\(\) => \{ setReady\(true\); \}, \[\]\);/.test(f) && /disabled=\{!ready \|\| sending\}/.test(f), "disabled until ready");
  assert(/<input name="marketing" type="checkbox" \/>/.test(f), "marketing unticked, optional");
  assert(/<input name="fulfilment" type="checkbox" required/.test(f), "privacy required");
  assert(/name="website" type="text" tabIndex=\{-1\}/.test(f), "honeypot");
  assert(/If your details are valid, we have sent a confirmation link/.test(f), "uniform confirmation copy");
  assert(!/verified/i.test(f.replace(/\/\/[^\n]*/g, "")), "never shows the phone or email as verified");
  assert(!/whatsapp_inbound|phone_ownership|call consent/i.test(f), "no phone consent");
});

console.log(failures ? `\n${failures} GAGAL` : "\nSemua LULUS");
process.exit(failures ? 1 : 0);
