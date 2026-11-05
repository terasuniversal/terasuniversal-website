import { CRM_STATUS_ORDER, type SalesCrmStatus } from "./crm";

export const LEAD_WON_VIA_QUOTATION_MESSAGE =
  "A lead becomes Won only when its quotation is accepted. Accept the quotation on the opportunity instead.";

/**
 * Why a manual lead status change must be refused, or null when it is
 * allowed. Won is reached only through accept_quotation(), which keeps the
 * opportunity, quotation and lead consistent; setting it by hand would count
 * as won with no accepted quotation behind it. Re-submitting the status a
 * lead already has is not a transition.
 */
export function leadStatusChangeBlock(current: string | null | undefined, next: string): string | null {
  return next === "won" && current !== "won" ? LEAD_WON_VIA_QUOTATION_MESSAGE : null;
}

/** Statuses offered by manual status controls; Won is listed only while the lead already has it, so the select still shows the saved value. */
export function selectableLeadStatuses(current: SalesCrmStatus): SalesCrmStatus[] {
  return CRM_STATUS_ORDER.filter((status) => status !== "won" || current === "won");
}
