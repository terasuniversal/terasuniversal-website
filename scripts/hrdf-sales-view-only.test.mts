import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const rbac = await readFile("lib/auth/rbac.ts", "utf8");
const staffActions = await readFile("app/admin/(protected)/users/actions.ts", "utf8");
const staffForm = await readFile("app/admin/(protected)/users/StaffUserForm.tsx", "utf8");
const claimsPage = await readFile("app/admin/(protected)/hrdf-claims/page.tsx", "utf8");
const invoicePage = await readFile("app/admin/(protected)/invoices/[id]/page.tsx", "utf8");
const claimCard = await readFile("app/admin/(protected)/invoices/[id]/HrdfClaimCard.tsx", "utf8");
const invoiceActions = await readFile("app/admin/(protected)/invoices/[id]/actions.ts", "utf8");
const nav = await readFile("lib/admin-nav.ts", "utf8");

assert.match(rbac, /\["hrdf_claims", "HRDF Claims", "Sales", "admin"\]/);
assert.match(rbac, /moduleKey === "hrdf_claims" && accessControlEnabled/);
const salesPreset = rbac.match(/export const SALES_MODULE_KEYS[\s\S]*?export const DEPARTMENTS/)?.[0] ?? "";
assert.doesNotMatch(salesPreset, /hrdf_claims/);
assert.match(staffActions, /module_key === "hrdf_claims" && targetIsNonAdmin/);
assert.match(staffActions, /access_level: requestedLevelByKey\.get\(module_key\)/);
assert.match(staffForm, /module\.key === "hrdf_claims"/);
assert.match(claimsPage, /requireRole\("editor"\)/);
assert.match(claimsPage, /requireModuleAccess\("hrdf_claims"\)/);
assert.match(invoicePage, /const canManage = isAdmin\(profile\.role\)/);
assert.match(claimCard, /\{canManage &&/);
assert.match(invoiceActions, /requireRole\("admin"\)/);
assert.match(invoiceActions, /create_hrdf_claim_for_invoice|transition_hrdf_claim|record_hrdf_payment/);
assert.match(nav, /key: "hrdf_claims"/);

console.log("HRDF Sales view-only source contract: PASS");
