import { readFile } from "node:fs/promises";

const rbac = await readFile("lib/auth/rbac.ts", "utf8");
const form = await readFile("app/admin/(protected)/users/StaffUserForm.tsx", "utf8");
const actions = await readFile("app/admin/(protected)/users/actions.ts", "utf8");
const editPage = await readFile("app/admin/(protected)/users/[id]/page.tsx", "utf8");

const checks: Array<[string, boolean]> = [
  ["Sales preset is application-level", /export const SALES_STAFF_PRESET/.test(rbac)],
  ["Sales preset creates an Editor", /role: "editor"/.test(rbac)],
  ["Sales preset uses the Sales department", /department: "sales"/.test(rbac)],
  ["Sales preset enables custom access", /accessControlEnabled: true/.test(rbac)],
  ["Sales preset includes explicit HRDF view", /moduleKey: "hrdf_claims", accessLevel: "view"/.test(rbac)],
  ["Sales preset has no admin module level", !/SALES_STAFF_PRESET[\s\S]*?accessLevel: "admin"/.test(rbac)],
  ["Sales preset excludes Staff Users", !/SALES_STAFF_PRESET[\s\S]*?moduleKey: "users"/.test(rbac)],
  ["Sales preset excludes training defaults", !/SALES_STAFF_PRESET[\s\S]*?moduleKey: "courses"/.test(rbac)],
  ["Sales preset excludes marketing defaults", !/SALES_STAFF_PRESET[\s\S]*?moduleKey: "marketing"/.test(rbac)],
  ["Preset application is a button draft action", /type="button"[\s\S]*?applySalesPreset/.test(form)],
  ["Preset does not submit until the form is saved", /Nothing is saved until you submit this form/.test(form)],
  ["Preset submits explicit module levels", /name="module_access"/.test(form)],
  ["Existing staff receives stored access levels", /access_level/.test(editPage)],
  ["Server validates submitted access levels", /getModuleAccessLevels/.test(actions)],
  ["Non-admin HRDF remains forced to view", /module_key === "hrdf_claims" && targetIsNonAdmin/.test(actions)],
];

let failures = 0;
for (const [name, pass] of checks) {
  if (pass) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`); }
}

if (failures) process.exit(1);
console.log(`Result: ${checks.length} checks passed.`);
