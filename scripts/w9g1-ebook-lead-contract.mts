/**
 * W9-G1 eBook lead contract (owner-approved, local only). Proves the named edits in scripts/w9g1-approved.mts are the
 * only changes to the four edited files, that the public API is behind a fail-closed switch and uses no service role,
 * that the form asks for full name, WhatsApp/phone and email with a required Privacy Notice acknowledgement and an
 * optional, unticked, email-only marketing choice, and that the demonstration still sends nothing.
 *
 * Run: node --experimental-transform-types scripts/w9g1-ebook-lead-contract.mts
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { revertW9g1, W9G1_CHANGED, W9G1_ADDED } from "./w9g1-approved.mts";
import { revertW9g3 } from "./w9g3-approved.mts";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (p: string) => readFileSync(path.join(root, p), "utf8").replace(/\r\n/g, "\n");
const sha256 = (text: string) => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");
let failures = 0;
const check = (name: string, fn: () => void) => {
  try { fn(); console.log(`LULUS ${name}`); } catch (error) { failures += 1; console.log(`GAGAL ${name} -> ${(error as Error).message.split("\n")[0]}`); }
};
const assert = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };

// SHA-256 (LF-normalised) at main 94643969 (after CRM G1 #262), before W9-G1.
const BEFORE: Record<string, string> = {
  "app/ebook/[[...ebook]]/page.js": "4b47d8d534f14afd537ce666c5e30b0afac46528ff1f650d86a6b34d58dff8e9",
  "components/ebook/EbookRequestDemo.js": "5d36d26e31027563bc267b84a429d55dbb433cc0b09d61772946e41f338a6cda",
  "components/ebook/ebook.module.css": "10c053be9ce02d25b89bc7f7f67b7c42d0267c759fa0c7125a6cf4cd11ec3f62",
  "lib/validation/schemas.ts": "545abe3639955b87ab60320541ace84d88982082f4dda2798f8fcc077019fc55",
};
// Untouched: the preview gate and release facts, the promo, the Privacy Notice, sitemap and robots.
const UNCHANGED: Record<string, string> = {
  "lib/ebook-preview.js": "9ebc46050dac241235ab70489d3d4a56d39edcd2f067e04c28a1124544461bee",
  "components/ebook/EbookPromo.js": "e2a264b4fbac67c4953a67442b3841f60c9997266920b5c542a96604d8288d4e",
  "content/en/privacy.js": "533b82b95b5305e915800af469330272f516fa9753ff48a6482125239951017a",
  "content/ms/privacy.js": "e1d17ff3775ed590259f5683ef049cc7578159aacd51b7e7dabfe44b01de9476",
  "app/sitemap.js": "786a2716b24488830905e615e68c9ea453b9661be03f653c75d14dd2d0987baa",
  "app/robots.js": "b8885739b9c70d240b9ed222f436c7524cae77ca1b396811764fea26ab5ff19c",
};

check("scope: exactly the four approved files carry W9-G1 named edits", () => {
  assert(JSON.stringify(W9G1_CHANGED) === JSON.stringify(Object.keys(BEFORE).sort()), W9G1_CHANGED.join(", "));
  for (const p of W9G1_ADDED) assert(existsSync(path.join(root, p)), `missing ${p}`);
});
check("integrity: reverting the named edits restores each file exactly (nothing else changed)", () => {
  // W9-G3 (owner-approved) later edited the page and the stylesheet; its named edits are undone first.
  for (const [p, hash] of Object.entries(BEFORE)) assert(sha256(revertW9g1(p, revertW9g3(p, read(p)))) === hash, p);
});
check("unchanged: preview gate, release facts, promo, Privacy Notice (EN/BM), sitemap, robots", () => {
  for (const [p, hash] of Object.entries(UNCHANGED)) assert(sha256(read(p)) === hash, p);
});
check("switch: TERAS_EBOOK_PUBLIC must be exactly \"on\"; POST answers 404 first; other methods always 404", () => {
  assert(/return env\.TERAS_EBOOK_PUBLIC === "on";/.test(read("lib/ebook-lead.js")), "flag");
  const api = read("app/api/ebook/route.js");
  assert(/export async function POST\(request\) \{\n  if \(!ebookPublicEnabled\(\)\) return new NextResponse\(null, \{ status: 404 \}\);/.test(api), "POST gate first");
  assert(/export function GET\(\) \{\n  return new NextResponse\(null, \{ status: 404 \}\);/.test(api), "GET 404");
  assert(/export const PUT = GET;\nexport const PATCH = GET;\nexport const DELETE = GET;/.test(api), "PUT/PATCH/DELETE answer 404 too");
  // W9-G2.1: OPTIONS is exported (otherwise Next.js answers 204 + Allow); HEAD follows GET automatically.
  assert(/\nexport const OPTIONS = GET;/.test(api), "OPTIONS answers 404 too");
  assert(!/export (const|async function|function) HEAD\b/.test(api), "HEAD is derived from GET, not separately handled");
});
// W9-G3 (owner-approved; W9-EBOOK-RPC-CONTRACT v1.0): the CRM RPCs are service_role only, so the request logic and the
// route never touch credentials themselves; the privileged module is the single service-role entry point (asserted in
// scripts/w9g3-ebook-contract.mts). This check keeps the request logic and route free of credentials, storage and PII logs.
check("security: request logic and route hold no credentials, storage or provider code; no PII in logs", () => {
  const code = read("app/api/ebook/route.js") + read("lib/ebook-request.js");
  assert(!/createSupabaseServiceClient|createSupabaseServerClient|getSupabaseServiceRoleKey|SERVICE_ROLE|storage\.from|createSignedUrl|\.pdf|new Resend|from "resend"/.test(code), "forbidden API");
  assert(/backend\.callEbookRpc\(EBOOK_RPC\.submit, \{/.test(code), "contract RPC through the privileged backend");
  const logCalls = code.split("\n").filter((l) => /\blog\("|console\.(error|log|warn)\(/.test(l));
  assert(logCalls.length >= 2, "log calls found");
  for (const line of logCalls) assert(!/fullName|phone|email\b|token|payload|data\.|url/i.test(line.replace(/log\("ebook [a-z ]+"/, "")), line.trim());
});
check("form: full name, WhatsApp/phone and email required; consent A required; B optional, unticked, email only", () => {
  const demo = read("components/ebook/EbookRequestDemo.js");
  for (const re of [/<input name="name" type="text"[^>]* required/, /<input name="phone" type="tel"[^>]* required/, /<input name="email" type="email"[^>]* required/,
    /<input name="fulfilment" type="checkbox" required/, /<input name="marketing" type="checkbox" \/>/, /normalizeMalaysianPhone\(form\.get\("phone"\)\)/]) assert(re.test(demo), String(re));
  const lead = read("lib/ebook-lead.js");
  assert(/EBOOK_PRIVACY_ACK_TEXT =\n  "I have read the TERAS UNIVERSAL Privacy Notice and agree to my name, phone number and email address being used to provide this eBook and handle my request\.";/.test(lead), "A text");
  assert(/EBOOK_MARKETING_TEXT =\n  "Optional: send me information about TERAS UNIVERSAL training courses and schedules by email\. I can withdraw at any time\.";/.test(lead), "B text");
  assert(!/whatsapp|call|sms/i.test(lead.match(/EBOOK_MARKETING_TEXT =\n  "([^"]+)"/)![1]), "B is email only");
  assert(/We will not call you or send WhatsApp messages for promotions\./.test(lead), "phone note");
});
check("demo: still a local demonstration with no network, storage or API call", () => {
  const demo = read("components/ebook/EbookRequestDemo.js");
  assert(!/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|indexedDB|action=|\/api\//.test(demo), "network");
  assert(/Delivery is not active yet\./.test(demo), "honest completion");
});
check("schema: ebookLeadSchema lives in lib/validation/schemas.ts and normalises the phone with lib/my-phone.js", () => {
  const schemas = read("lib/validation/schemas.ts");
  assert(/export const ebookLeadSchema = z\.object\(\{/.test(schemas), "schema");
  assert(/import \{ normalizeMalaysianPhone \} from "\.\.\/my-phone\.js";/.test(schemas), "single phone normaliser");
  assert(/privacyAck: z\.boolean\(\)\.refine\(\(value\) => value === true/.test(schemas), "privacy true");
  assert(/marketingEmailOptIn: z\.boolean\(\)\.default\(false\)/.test(schemas), "marketing default false");
});

check("W9-G1.1 privacy: native submission is POST, the button is disabled until React mounts, noscript explains", () => {
  const demo = read("components/ebook/EbookRequestDemo.js");
  assert(/<form className=\{styles\.form\} method="post" onSubmit=\{handleSubmit\} noValidate/.test(demo), "form method=post");
  assert(!/method="get"|method=\{/i.test(demo) && (demo.match(/<form /g) || []).length === 1, "one form, never GET");
  assert(/const \[ready, setReady\] = useState\(false\);\n  useEffect\(\(\) => \{ setReady\(true\); \}, \[\]\);/.test(demo), "ready only after mount");
  assert(/<button type="submit" className=\{styles\.submit\} disabled=\{!ready\}>/.test(demo), "submit disabled until ready");
  assert((demo.match(/type="submit"/g) || []).length === 1, "single submit button (implicit submission follows it)");
  assert(/<noscript><p className=\{styles\.hint\} role="note">JavaScript is needed to request the eBook\. Nothing you type here is sent without it\.<\/p><\/noscript>/.test(demo), "noscript note");
});
check("W9-G1.1 phone: one shared validator following MCMC NEAP 2023 (01Y 7/8 digits, 015Z + 7, geographic)", () => {
  const phone = read("lib/my-phone.js");
  assert(/MCMC, Numbering and Electronic Addressing Plan \(NEAP\), 2023 edition/.test(phone), "NEAP reference");
  for (const re of [/\/\^1\[0-46-9\]\[2-9\]\\d\{6\}\$\//, /\/\^1\[0-46-9\]\[1-9\]\\d\{7\}\$\//, /\/\^15\\d\[1-9\]\\d\{6\}\$\//]) assert(re.test(phone), String(re));
  assert(/not consulted/.test(phone) && /only well-formed/.test(phone), "format is not reachability");
  const importers = ["components/ebook/EbookRequestDemo.js", "lib/validation/schemas.ts"].filter((f) => /normalizeMalaysianPhone/.test(read(f)));
  assert(importers.length === 2, "client and server share lib/my-phone.js");
});

console.log(failures ? `\n${failures} GAGAL` : "\nSemua LULUS");
process.exit(failures ? 1 : 0);
