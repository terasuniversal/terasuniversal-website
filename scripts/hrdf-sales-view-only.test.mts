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
// Only the SALES_MODULE_KEYS array: the Sales Staff preset that follows it lists HRDF as view-only on purpose
// (see staff-sales-preset.test.mts), so a span that ran on to DEPARTMENTS flagged that intended entry.
const salesModuleKeys = rbac.match(/export const SALES_MODULE_KEYS = \[[\s\S]*?\] as const;/)?.[0] ?? "";
assert.match(salesModuleKeys, /"sales_leads"/, "the SALES_MODULE_KEYS array was found, so the HRDF check below is not vacuous");
assert.doesNotMatch(salesModuleKeys, /hrdf_claims/);
assert.match(staffActions, /module_key === "hrdf_claims" && targetIsNonAdmin/);
assert.match(staffActions, /access_level: requestedLevelByKey\.get\(module_key\)/);
assert.match(staffForm, /module\.key === "hrdf_claims"/);
assert.match(claimsPage, /requireRole\("editor"\)/);
assert.match(claimsPage, /requireModuleAccess\("hrdf_claims"\)/);
// RBAC: the invoice page's management controls follow the capability rule (admin or Custom-access editor).
assert.match(invoicePage, /const canManage = isCapabilityRoleEligible\(profile\) && canEditInvoices;/);
// S1 (Owner 2026-11-22): HRD Corp claims are managed in the HRD Corp portal. The claim card is read-only: it imports
// no server action and renders no form, and the invoice page passes it no management capability.
assert.doesNotMatch(claimCard, /from "\.\/actions"/);
assert.doesNotMatch(claimCard, /<form|<button|action=/);
assert.doesNotMatch(invoicePage, /canManageHrdf|hasModuleAccess\("hrdf_claims", "edit"\)/);
// The HRDF actions keep their guards and then refuse, so a direct call cannot reach the RPCs.
// RBAC: the HRDF guards are capabilities (HRDF edit stays Super Admin only in practice, D1).
assert.match(invoiceActions, /requireModuleCapability\("hrdf_claims", "edit"\)/);
assert.match(invoiceActions, /const HRDF_CLAIM_ACTIONS_ENABLED: boolean = false;/);
for (const fn of ["createHrdfClaimAction", "transitionHrdfClaimAction", "recordHrdfPaymentAction"]) {
  const body = invoiceActions.slice(invoiceActions.indexOf(`export async function ${fn}(`));
  const refuseAt = body.indexOf("if (!HRDF_CLAIM_ACTIONS_ENABLED) fail(");
  const rpcAt = body.indexOf("supabase.rpc(");
  assert.ok(refuseAt > 0 && rpcAt > refuseAt, `${fn} refuses before any RPC call`);
}
assert.match(invoiceActions, /create_hrdf_claim_for_invoice|transition_hrdf_claim|record_hrdf_payment/);
// Not in the menu; the legacy list stays reachable read-only for staff who hold HRDF view.
assert.doesNotMatch(nav, /key: "hrdf_claims"/);
assert.doesNotMatch(claimsPage, /<form|action=/);

console.log("HRDF Sales view-only source contract: PASS");
