import { readFile } from "node:fs/promises";

const dashboard = await readFile("app/admin/(protected)/dashboard/page.tsx", "utf8");
const layout = await readFile("app/admin/(protected)/layout.tsx", "utf8");
const search = await readFile("app/admin/(protected)/search/page.tsx", "utf8");
const certificateApi = await readFile("app/api/admin/certificates/route.js", "utf8");
const downloads = await readFile("app/admin/(protected)/downloads/new/page.tsx", "utf8");
const downloadForm = await readFile("app/admin/(protected)/downloads/new/NewDownloadForm.tsx", "utf8");

const checks: Array<[string, boolean]> = [
  ["dashboard checks the dashboard module", /requireModuleAccess\("dashboard"\)/.test(dashboard)],
  ["dashboard checks each protected data owner", ["courses", "schedules", "participants", "certificates", "assessment", "news"].every((key) => new RegExp(`hasModuleAccess\\("${key}"\\)`).test(dashboard))],
  ["dashboard conditionally executes course queries", /canCourses \? supabase\.from\("courses"\)/.test(dashboard)],
  ["dashboard conditionally executes participant queries", /canParticipants \? supabase\.from\("participants"\)/.test(dashboard)],
  ["dashboard conditionally executes certificate queries", /canCertificates \? supabase\.from\("certificates"\)/.test(dashboard)],
  ["dashboard hides unauthorized widgets", /canSchedules && <Card|canParticipants && <Card|canCertificates && <Card|canAssessment && <Card/.test(dashboard)],
  ["dashboard hides training quick actions", /canCourses && <Link[^>]+href="\/admin\/courses\/new"/.test(dashboard)],
  ["layout checks badge owners before querying", /hasModuleAccess\("certificates"\)[\s\S]*hasModuleAccess\("participants"\)/.test(layout)],
  ["layout conditionally queries certificate badge", /canSeeCertificates \? supabase[\s\S]*?from\("certificates"\)/.test(layout)],
  ["layout conditionally queries participant badge", /canSeeParticipants \? supabase[\s\S]*?from\("participants"\)/.test(layout)],
  ["search has an explicit category owner map", /const SEARCH_MODULES =/.test(search)],
  ["search checks module access before data queries", /const searchAccess = Object\.fromEntries/.test(search)],
  ["search conditionally queries every category", [["course", "courses"], ["participant", "participants"], ["company", "companies"], ["certificate", "certificates"], ["trainer", "trainers"], ["news", "news_posts"], ["download", "downloads"]].every(([category, table]) => new RegExp(`searchAccess\\.${category} \\?[^\\n]*(?:source|supabase\\.from)\\("${table}"\\)`).test(search)) && /searchAccess\.schedule \? scheduleQuery/.test(search)],
  ["certificate API checks the certificates module", /has_module_access_level/.test(certificateApi) && /p_module_key: "certificates"/.test(certificateApi)],
  ["certificate API requires admin for POST", /requireAdmin\(\{ manage: true \}\)/.test(certificateApi)],
  ["downloads page has a direct module guard", /requireModuleAccess\("downloads"\)/.test(downloads)],
  ["downloads form remains a client component", /"use client"/.test(downloadForm)],
];

let failures = 0;
for (const [name, pass] of checks) {
  if (pass) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`); }
}

if (failures) process.exit(1);
console.log(`Result: ${checks.length} checks passed.`);
