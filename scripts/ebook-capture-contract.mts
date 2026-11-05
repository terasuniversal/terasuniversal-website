import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// /ebook contract: the approved PDF is NOT in the repository and not publicly reachable; the form keeps TWO separate,
// unchecked checkboxes; the public API uses the shared limiter, origin, honeypot and timing checks and one narrow RPC;
// the feature is off by default; nothing is linked or in the sitemap; the migration never overwrites a consent choice.
// Static source checks; behaviour is covered by ebook-capture.test.mts, the local database tests and the local route QA.

const read = async (p: string) => (await readFile(p, "utf8")).replace(/\r\n/g, "\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const APPROVED_PDF_SHA256 = "fbf19c283c534e0638bfd91816e7e5b708ee3a8b69a6946612c53a4d570a04dc";

// 1. No eBook PDF anywhere in the repository (by content fingerprint and by name), and nothing in a public directory.
async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const name of await readdir(dir)) {
    if ([".git", "node_modules", ".next", ".vercel"].includes(name)) continue;
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = (await walk(".")).map((f) => f.replace(/\\/g, "/").replace(/^\.\//, ""));
const pdfs = files.filter((f) => f.toLowerCase().endsWith(".pdf"));
assert.deepEqual(pdfs, ["public/downloads/TERAS-UNIVERSAL-Company-Profile.pdf"], "the only PDF in the repository is the existing Company Profile");
for (const pdf of pdfs) {
  const hash = createHash("sha256").update(await readFile(pdf)).digest("hex");
  assert.notEqual(hash, APPROVED_PDF_SHA256, `${pdf} must not be the approved eBook`);
}
assert.ok(!files.some((f) => /^public\/.*ebook/i.test(f)), "nothing eBook-related in public/");
assert.ok(!files.some((f) => /TERAS_eBook|DariZeroKeDuniaIndustri/i.test(f)), "no file named after the eBook PDF");

const [route, form, page, privacyPage, privacyComponent, privacyData, rules, migration, resources, sitemap, megaNav, footer] = await Promise.all([
  read("app/api/ebook/route.ts"),
  read("components/public/EbookLeadForm.js"),
  read("app/ebook/page.js"),
  read("app/privacy/page.js"),
  read("components/public/PrivacyNoticeDraft.js"),
  read("data/privacyNoticeDraft.js"),
  read("lib/marketing/ebookCapture.ts"),
  read("supabase/migrations/20261105170000_ebook_lead_capture.sql"),
  read("app/resources/page.js"),
  read("app/sitemap.js"),
  read("components/MegaNav.js"),
  read("components/Footer.js"),
]);
const routeCode = code(route);
const formCode = code(form);
const pageCode = code(page);
const sql = migration.replace(/^\s*--.*$/gm, "");

// 2. No unprotected download URL anywhere in the new public code.
for (const [name, text] of [["page", pageCode], ["form", formCode], ["route", routeCode], ["rules", code(rules)]] as const) {
  assert.ok(!/\.pdf|\/downloads\/|\/ebooks?\/|signedUrl|createSignedUrl|downloadUrl|download_url|href=\{?["'`]?\/?[^"'`]*download/i.test(text.replace(/pdfFileName[^,\n]*,?/g, "")), `${name} contains no download URL`);
}
assert.match(code(rules), /delivery: "not_active"/, "delivery is explicitly not active");
assert.match(formCode, /Muat turun belum diaktifkan/, "the success panel is an explicit placeholder");

// 3. Off by default, in every public surface.
assert.match(await read("lib/marketing/ebookFlag.ts"), /env\.EBOOK_LEAD_CAPTURE_ENABLED === "true"/, "exact-match flag");
assert.match(pageCode, /if \(!isEbookCaptureEnabled\(\)\) notFound\(\);/, "/ebook 404s when off");
assert.match(code(privacyPage), /if \(!isEbookCaptureEnabled\(\)\) notFound\(\);/, "/privacy 404s when off");
assert.match(routeCode, /\{\n\s*if \(!isEbookCaptureEnabled\(\)\) return respond\(\{ error: "Not found\." \}, 404\);/, "the API returns 404 first when off");
for (const [name, text] of [["ebook page", page], ["privacy page", privacyPage]] as const) assert.match(text, /robots: \{ index: false, follow: false \}/, `${name} is excluded from search engines`);

// 4. Not linked or listed anywhere until launch.
for (const [name, text] of [["resources", resources], ["sitemap", sitemap], ["MegaNav", megaNav], ["Footer", footer]] as const) {
  assert.ok(!/["'`]\/ebook|["'`]\/privacy/.test(text), `${name} does not link /ebook or /privacy`);
}

// 5. The form: TWO separate checkboxes, both unchecked by default; the acknowledgement is required, marketing optional.
assert.match(formCode, /const \[privacy, setPrivacy\] = useState\(false\);/, "privacy acknowledgement starts unchecked");
assert.match(formCode, /const \[marketing, setMarketing\] = useState\(false\);/, "marketing consent starts unchecked");
const checkboxes = [...formCode.matchAll(/<input id="(ebook-privacy|ebook-marketing)" type="checkbox"([\s\S]*?)\/>/g)];
assert.deepEqual(checkboxes.map((m) => m[1]), ["ebook-privacy", "ebook-marketing"], "exactly two checkboxes, privacy then marketing");
assert.match(checkboxes[0][2], /checked=\{privacy\}/);
assert.match(checkboxes[0][2], /required/);
assert.match(checkboxes[0][2], /aria-required="true"/);
assert.match(checkboxes[1][2], /checked=\{marketing\}/);
assert.ok(!/required/.test(checkboxes[1][2]), "marketing consent is optional");
assert.ok(!/defaultChecked|checked=\{true\}|\schecked(?=[\s/>])/.test(checkboxes.map((m) => m[2]).join(" ")), "no checkbox is pre-ticked");
assert.match(formCode, /privacy_acknowledged: true,/, "the acknowledgement is sent only after it was ticked");
assert.match(formCode, /marketing_opt_in: marketing,/, "marketing consent is sent exactly as the visitor chose");
assert.match(formCode, /if \(!privacy\) found\.privacy = /, "submitting without the acknowledgement is blocked client-side too");
assert.ok(!/setMarketing\(true\)|setPrivacy\(true\)/.test(formCode), "neither box is ever ticked by code");
assert.match(formCode, /Pilihan\. Anda masih boleh mendapatkan eBook tanpa kebenaran ini/, "the form says the eBook does not depend on marketing consent");
assert.match(formCode, /\(DRAF, belum disemak undang-undang\)/, "the privacy link is marked DRAFT");
assert.match(formCode, /name="website"/, "honeypot field");
assert.match(formCode, /formStartedAt: startedAt\.current/, "form start time is sent");
assert.match(formCode, /request_id: requestId\.current/, "a stable request id makes retries idempotent");
// A failed capture never shows success: success is set in exactly one place, after a confirmed ok response.
assert.equal([...formCode.matchAll(/setStatus\("success"\)/g)].length, 1, "one success transition");
assert.match(formCode, /if \(response\.ok && payload && payload\.ok === true\) \{\s*setStatus\("success"\);/, "success only when the server confirmed");
assert.ok(!/console\.|localStorage|sessionStorage|gtag|dataLayer|fbq|navigator\.sendBeacon|document\.cookie/.test(formCode), "no logging, storage or analytics in the form");
assert.ok(!/className="btn|className=\{?"[^"]*\bbtn\b/.test(formCode), "the submit button does not use the .btn class that the site analytics tracks");
assert.ok(!/router\.(push|replace)|window\.location\.(href|assign|replace)\s*=/.test(formCode), "no redirect that could carry personal data in a URL");
assert.ok(!/method="get"|method='get'/i.test(formCode) && /onSubmit=\{handleSubmit\}/.test(formCode), "the form posts by script, never as a GET with fields in the URL");

// 6. The public API: order of defences, shared limiter, one RPC, no service role, nothing leaked.
const post = routeCode.slice(routeCode.indexOf("export async function POST"));
const order = [
  "isEbookCaptureEnabled()",
  "isAllowedOrigin(request)",
  'startsWith("application/json")',
  "MAX_BODY_BYTES",
  "ebook:ip:",
  "JSON.parse(text)",
  "website",
  "ebookLeadSchema.safeParse(raw)",
  "fillTimeStatus(",
  "ebook:email:",
  'supabase.rpc("submit_public_ebook_lead"',
].map((needle) => ({ needle, at: post.indexOf(needle) }));
for (const { needle, at } of order) assert.ok(at >= 0, `route has ${needle}`);
assert.deepEqual([...order.map((o) => o.at)].sort((a, b) => a - b), order.map((o) => o.at), "defences run in order: flag, origin, type, size, IP limit, parse, honeypot, validation, timing, email limit, RPC");
assert.equal([...routeCode.matchAll(/checkSharedRateLimit\(\{[^\n]*failClosed: true/g)].length, 2, "both rate limits are shared and fail closed");
assert.ok(!/new Map\(|recentSubscriptions|localFallback/.test(routeCode), "no in-memory limiter in the route");
// The server-only service client is used ONLY by the route, for that one RPC. It never reaches a client component or the shared rules.
assert.equal([...routeCode.matchAll(/createSupabaseServiceClient\(\)/g)].length, 1, "the route creates the service client exactly once");
assert.ok(!/createSupabaseServerClient|NEXT_PUBLIC_SUPABASE_SERVICE|SERVICE_ROLE_KEY|getSupabaseServiceRoleKey/.test(routeCode), "the route never reads the key itself or uses the anon client for the RPC");
assert.ok(!/createSupabaseServiceClient|SERVICE_ROLE|service_role|lib\/supabase\/server/i.test(code(rules) + formCode + pageCode + privacyPageCodeForKeyCheck()), "no privileged client or key reference in client-reachable code");
function privacyPageCodeForKeyCheck() { return code(privacyPage) + code(privacyComponent); }
assert.match(post.slice(0, post.indexOf("createSupabaseServiceClient()")), /ebook:email:/, "the service client is created only after every check, including both rate limits");
assert.match(routeCode, /catch \{[^}]*server_client_unavailable[\s\S]*?503/, "a missing server credential fails closed without reporting success");
assert.equal([...routeCode.matchAll(/\.rpc\(/g)].length, 1, "exactly one RPC call");
assert.ok(!/\.(insert|update|upsert|delete)\(|\.from\(/.test(routeCode), "the route never touches a table directly");
assert.match(routeCode, /p_privacy_notice_version: PRIVACY_NOTICE_VERSION/, "notice version comes from the server, not the client");
assert.match(routeCode, /p_consent_text_version: CONSENT_TEXT_VERSION/, "consent text version comes from the server, not the client");
assert.match(routeCode, /p_utm: sanitizeUtm\(input\.utm\)/, "UTM is re-sanitised on the server");
// Failure handling and privacy of responses and logs.
assert.match(routeCode, /if \(error \|\| !data \|\| typeof data !== "object"\) \{/, "a failed or empty RPC result is an error, never a success");
const errorLogs = [...routeCode.matchAll(/console\.error\("[^"]*", \{([^}]*)\}\)/g)];
assert.equal(errorLogs.length, [...routeCode.matchAll(/console\.error\(/g)].length, "every log is a literal message plus a small object");
for (const [, body] of errorLogs) assert.ok(/^\s*code: [^,]*$/.test(body), `error logs carry only the error code (found: ${body})`);
assert.ok(!/console\.(log|info|debug|warn)\(/.test(routeCode), "no other console output");
assert.ok(!/outcome|created|matched|duplicate/i.test(post.slice(post.indexOf("// Identical for"))), "the success response never says whether the contact existed");
assert.equal([...routeCode.matchAll(/return respond\(\{ ok: true, delivery: "not_active" \}\)/g)].length, 2, "success responses: honeypot and real capture, identical shape");
assert.match(routeCode, /Cache-Control": "no-store"/, "responses are not cached");
assert.ok(!/input\.email|input\.full_name|input\.phone/.test(routeCode.replace(/p_email: input\.email,|p_full_name: input\.full_name \|\| null,|p_phone: input\.phone \|\| null,|emailRateKeyPart\(input\.email\)/g, "")), "personal fields are used only for the RPC arguments and the hashed rate-limit key");

// 7. Draft privacy notice: clearly marked, text preserved, internal reviewer notes not published.
assert.match(privacyPage, /DRAFT — NOT LEGALLY REVIEWED — NOT APPROVED FOR PUBLICATION/, "privacy page banner");
assert.match(privacyData, /DRAFT: NOT LEGALLY REVIEWED\. NOT APPROVED FOR PUBLICATION\./, "data file header");
assert.ok(!/dangerouslySetInnerHTML/.test(privacyComponent + privacyPage + page + form), "no HTML injection");
assert.ok(!/Nota untuk penyemak|Keputusan diperlukan/.test(privacyData), "internal reviewer notes are not part of the page data");
assert.match(privacyData, /\[tarikh\]/, "the draft's own [to be confirmed] markers are preserved");
assert.ok(!/PDPA compliant|compliant with (the )?PDPA|mematuhi PDPA|dilindungi sepenuhnya/i.test(privacyData.replace(/Akta Perlindungan Data Peribadi 2010/g, "") + pageCode + formCode), "no claim that PDPA compliance has been established");

// 8. Migration: narrow definer RPC, fixed search_path, no public grant, never overwrites a consent choice.
assert.match(sql, /create or replace function public\.submit_public_ebook_lead\(/);
assert.match(sql, /security definer\s+set search_path = pg_catalog, public/, "SECURITY DEFINER with a fixed search_path");
assert.match(sql, /revoke all on function public\.submit_public_ebook_lead\([^)]*\) from public;/, "no PUBLIC execute");
assert.match(sql, /revoke all on function public\.submit_public_ebook_lead\([^)]*\) from anon, authenticated;/, "anon and authenticated explicitly revoked");
assert.match(sql, /grant execute on function public\.submit_public_ebook_lead\([^)]*\) to service_role;/, "EXECUTE only for service_role");
assert.ok(!/grant execute on function public\.submit_public_ebook_lead[^;]*(anon|authenticated|public)/.test(sql), "no EXECUTE grant to anon, authenticated or public");
assert.ok(!/grant\s+(all|select|insert|update|delete)\s+on\s+(table\s+)?public\./i.test(sql), "no table grant to anyone");
assert.ok(!/create policy|alter policy|disable row level security|service_role'|drop table|truncate|delete from/i.test(sql), "no policy change, RLS change or destructive statement");
assert.match(sql, /p_privacy_acknowledged is distinct from true then\s+raise exception 'privacy_acknowledgement_required'/, "acknowledgement enforced in the database");
assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('free_ebook:' \|\| v_email, 0\)\)/, "per-email advisory lock");
assert.match(sql, /where lower\(btrim\(email\)\) = v_email/, "duplicate match on the normalised email, never on phone");
assert.ok(!/where[^;]*phone\s*=\s*v_phone/.test(sql), "phone is never used to merge contacts");
assert.match(sql, /if v_opt_in and v_contact\.consent_status = 'not_set' then/, "an existing contact is opted in only if it has no recorded choice");
assert.equal([...sql.matchAll(/set consent_status\s*=\s*'opted_in'/g)].length, 1, "the only consent update is the not_set to opted_in case");
assert.ok(!/consent_status\s*=\s*'opted_out'/.test(sql.replace(/v_contact\.consent_status = 'not_set'/g, "")), "opted_out is never written or matched for overwrite");
assert.ok(!/set[^;]*\bstatus\s*=|set[^;]*\bsource\s*=|set[^;]*owner_id\s*=/.test(sql.slice(sql.indexOf("update public.marketing_contacts"))), "status, source and owner are never overwritten on a matched contact");
assert.match(sql, /'email_verified', false/, "the unverified email is recorded honestly");
assert.match(sql, /marketing_contact_events_ebook_request_uidx[\s\S]*\(contact_id, \(metadata ->> 'request_id'\)\)/, "retry-safety index per contact and request id");
assert.match(sql, /'ebook_requested', 'ebook_downloaded', 'ebook_course_enquiry'/, "the plan's event types are allowed");
assert.ok(!/insert into public\.marketing_contact_events[^;]*'ebook_downloaded'|insert into public\.marketing_contact_events[^;]*'ebook_course_enquiry'/.test(sql), "only ebook_requested is written: no download or course enquiry exists yet");

console.log("Ebook capture contract passed.");

// 9. Flag-off 404 guard in the middleware, and the privacy copy: the Owner's draft is preserved, the adapted copy is separate.
const [middlewareSrc, adapted, flagSrc] = await Promise.all([read("middleware.ts"), read("data/privacyNoticeAdapted.js"), read("lib/marketing/ebookFlag.ts")]);
const mw = code(middlewareSrc);
assert.match(mw, /pathname === "\/ebook" \|\| pathname === "\/privacy"/, "the middleware guard covers exactly /ebook and /privacy");
assert.match(mw, /if \(isEbookCaptureEnabled\(\)\) return NextResponse\.next\(\);/, "the guard lets both pages through only when the flag is on");
assert.match(mw, /NextResponse\.rewrite\(url, \{ status: 404/, "flag off: a genuine 404 status");
assert.match(mw, /"\/ebook",\s*"\/privacy",?\s*\]/, "the matcher adds only those two public paths to /admin");
assert.match(code(flagSrc), /EBOOK_LEAD_CAPTURE_ENABLED === "true"/, "exact-true flag, off by default");
assert.ok(/Anda memuat turun eBook percuma/.test(privacyData) && /You download the free eBook/.test(privacyData), "the Owner's original draft wording is preserved unchanged in data/privacyNoticeDraft.js");
assert.match(adapted, /PENDING LEGAL APPROVAL/, "the adapted copy is marked pending legal approval");
assert.match(adapted, /E-mel dan pengakuan Notis Privasi wajib\. Nama, telefon dan pilihan pemasaran adalah pilihan dan berasingan\./, "adapted (Malay): email and acknowledgement required, the rest optional");
assert.match(adapted, /Email and the privacy-notice acknowledgement are required\. Name, phone and the marketing choice are optional and separate\./, "adapted (English): same");
assert.match(adapted, /download is not active yet/, "the adapted copy says there is no download yet");
assert.ok(!/retention|retensi|disimpan selama|stored for|years|tahun/i.test(code(adapted).replace(/Akta[^"]*2010/g, "")), "the adapted copy adds no invented legal terms (retention, periods)");
assert.match(code(privacyPage), /privacyNoticeAdapted/, "/privacy renders the adapted copy");
assert.match(privacyPage, /menunggu kelulusan undang-undang/, "/privacy states the adapted version is pending legal approval");
console.log("Ebook capture contract (security and privacy additions) passed.");
