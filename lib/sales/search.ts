const QUOTATION_SEARCH_FIELDS = ["quotation_no"] as const;
const INVOICE_SEARCH_FIELDS = [
  "invoice_no",
  "billing_name",
  "billing_company",
  "customer_company_name",
  "customer_contact_name",
  "quotation_number_snapshot",
] as const;

/** Build a safe PostgREST OR filter from already-sanitized free text. */
function ilikeFilters(fields: readonly string[], term: string): string[] {
  return fields.map((field) => `${field}.ilike.%${term}%`);
}

export function buildQuotationSearchFilter(term: string, opportunityIds: readonly string[]): string {
  const filters = ilikeFilters(QUOTATION_SEARCH_FIELDS, term);
  if (opportunityIds.length > 0) filters.push(`opportunity_id.in.(${opportunityIds.join(",")})`);
  return filters.join(",");
}

export function buildInvoiceSearchFilter(term: string): string {
  return ilikeFilters(INVOICE_SEARCH_FIELDS, term).join(",");
}
