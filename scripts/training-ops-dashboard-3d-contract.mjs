import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const helper = read("lib/dashboard/trainingOperations.ts");
const page = read("app/admin/(protected)/dashboard/page.tsx");
const component = read("app/admin/(protected)/dashboard/TrainingOperationsDashboard.tsx");

const forbidden = ["theory_score", "practical_score", "overall_score", "max_score", "remarks", "locked_by", "ic_number", "passport_number", "actor_email"];
for (const field of forbidden) {
  if (helper.includes(field) || page.includes(field) || component.includes(field)) throw new Error(`forbidden dashboard field present: ${field}`);
}
for (const status of ["open", "full", "in_progress", "completed", "cancelled"]) {
  if (!helper.includes(status)) throw new Error(`live schedule status missing: ${status}`);
}
if (helper.includes("closing_soon") || helper.includes("archived") || helper.includes("closed")) throw new Error("unsupported schedule lifecycle status referenced");
for (const token of ["malaysiaDateIso", "malaysiaOperationalWindow", "assessment_required", "competency_required", "registration_status", "deleted_at", "session_date", "is_primary", "is_active", "recordedSessions", "fullyPresent"]) {
  if (!helper.includes(token)) throw new Error(`required operational contract token missing: ${token}`);
}
if (helper.includes('select("*"')) throw new Error("select(*) is not allowed in dashboard query layer");
if (helper.includes("insert(") || helper.includes(".update(") || helper.includes(".delete(")) throw new Error("dashboard query layer must be read-only");
if (!page.includes('requireModuleAccess("dashboard")')) throw new Error("dashboard authorization missing");
if (!page.includes('hasModuleAccess("attendance")') || !page.includes('hasModuleAccess("assessment")')) throw new Error("module access gating missing");
if (!component.includes("Recorded sessions") && !component.includes("recorded session")) throw new Error("recorded-session wording missing");
if (!component.includes("Upcoming 7 Days") || !component.includes("Needs Attention") || !component.includes("Assignment Health")) throw new Error("required dashboard hierarchy missing");
for (const file of ["app/admin/(protected)/dashboard/loading.tsx", "app/admin/(protected)/dashboard/error.tsx"]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`required state file missing: ${file}`);
}
console.log("Training Operations Dashboard 3D contract checks passed");
