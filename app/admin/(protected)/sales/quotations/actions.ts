"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireRole, requireModuleAccess } from "../../../../../lib/auth/session";
import { quotationHeaderSchema, quotationRejectSchema, fieldErrors, type QuotationHeaderInput } from "../../../../../lib/validation/schemas";
import { computeQuotationTotals } from "../../../../../lib/sales/crm";
import { canonicalizePackageSnapshot, commercialName, type CourseCommercialProfileData, type PackageIncludeSnapshot } from "../../../../../lib/sales/course-commercial";

export type SalesActionState = { message?: string; errors?: Record<string, string> };

function revalidateQuotation(id: string, opportunityId?: string) {
  revalidatePath(`/admin/sales/quotations/${id}`);
  revalidatePath("/admin/sales/quotations");
  if (opportunityId) revalidatePath(`/admin/sales/opportunities/${opportunityId}`);
  revalidatePath("/admin/sales");
}

function parseItemsField(raw: FormDataEntryValue | null): unknown[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function logActivity(supabase: any, leadMetadataId: string | null, opportunityId: string, quotationId: string, type: string, note: string | null, actorId: string) {
  await supabase.from("sales_activity").insert({ lead_metadata_id: leadMetadataId, opportunity_id: opportunityId, quotation_id: quotationId, type, note, actor_id: actorId });
}

async function getLeadMetadataId(supabase: any, opportunityId: string): Promise<string | null> {
  const { data } = await supabase.from("sales_opportunities").select("lead_metadata_id").eq("id", opportunityId).maybeSingle();
  return data?.lead_metadata_id ?? null;
}

async function prepareQuotationItems(supabase: any, items: QuotationHeaderInput["items"]) {
  const courseIds = [...new Set(items.map((item) => item.course_id).filter((id): id is string => Boolean(id)))];
  const profilesByCourse = new Map<string, CourseCommercialProfileData>();
  if (courseIds.length > 0) {
    const { data, error } = await supabase
      .from("course_commercial_profiles")
      .select("id, course_id, standard_display_name, hrdf_display_name, hrdf_claimable, quotation_description, package_includes, accommodation_included_default, accommodation_description_default, meals_included_default, meals_description_default")
      .in("course_id", courseIds);
    if (error) return { error: error.message };
    for (const profile of (data ?? []) as CourseCommercialProfileData[]) profilesByCourse.set(profile.course_id, profile);
  }

  const rows = [];
  for (const item of items) {
    const courseId = item.course_id || null;
    if (!courseId) {
      if (item.hrdf_claim) return { error: "HRDF Claim requires a configured course profile." };
      if (item.package_includes_snapshot.length > 0) return { error: "Package Includes requires a configured course profile." };
      rows.push({ ...item, course_id: null, course_name_snapshot: null, hrdf_claim: false, package_includes_snapshot: [] });
      continue;
    }

    const profile = profilesByCourse.get(courseId);
    if (!profile) return { error: "The selected course has no commercial profile configured." };
    if (item.hrdf_claim && (!profile.hrdf_claimable || !profile.hrdf_display_name?.trim())) {
      return { error: `HRDF Claim is not configured for ${profile.standard_display_name}.` };
    }
    const packageSnapshot = canonicalizePackageSnapshot(item.package_includes_snapshot as PackageIncludeSnapshot[], profile);
    if ("error" in packageSnapshot) return { error: packageSnapshot.error };
    rows.push({
      ...item,
      course_id: courseId,
      course_name_snapshot: commercialName(profile, item.hrdf_claim),
      hrdf_claim: item.hrdf_claim,
      package_includes_snapshot: packageSnapshot,
    });
  }
  return { rows };
}

/** Task 8: create quotation (revision 0) from an Opportunity — admin+ only, per sales_quotations RLS. */
export async function createQuotation(
  opportunityId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  const profile = await requireRole("admin");
  await requireModuleAccess("sales_quotations");
  const parsed = quotationHeaderSchema.safeParse({
    customer_company_name: formData.get("customer_company_name") ?? "",
    customer_contact_name: formData.get("customer_contact_name") ?? "",
    customer_registration_no: formData.get("customer_registration_no") ?? "",
    customer_email: formData.get("customer_email") ?? "",
    customer_phone: formData.get("customer_phone") ?? "",
    billing_address: formData.get("billing_address") ?? "",
    training_service_address: formData.get("training_service_address") ?? "",
    valid_until: formData.get("valid_until") ?? "",
    currency: formData.get("currency") || "MYR",
    discount: formData.get("discount") || 0,
    sst_applicable: formData.get("sst_applicable") === "on",
    sst_rate: formData.get("sst_rate") || 0,
    terms: formData.get("terms") ?? "",
    notes: formData.get("notes") ?? "",
    items: parseItemsField(formData.get("items")),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  const preparedItems = await prepareQuotationItems(supabase, d.items);
  if ("error" in preparedItems) return { message: preparedItems.error };
  const { data: opportunity } = await supabase.from("sales_opportunities").select("*").eq("id", opportunityId).maybeSingle();
  if (!opportunity) return { message: "Opportunity not found." };
  if (opportunity.stage === "won" || opportunity.stage === "lost" || opportunity.stage === "cancelled") {
    return { message: `This opportunity is already ${opportunity.stage} — a new quotation cannot be created for it.` };
  }
  const { data: company } = opportunity.company_id
    ? await supabase.from("companies").select("company_name, registration_no, email, phone, person_in_charge, pic_email, pic_phone, billing_address, address").eq("id", opportunity.company_id).maybeSingle()
    : { data: null };
  const submitted = (name: string) => formData.has(name);

  const totals = computeQuotationTotals({
    items: d.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price, discount: i.discount })),
    discount: d.discount,
    sstApplicable: d.sst_applicable,
    sstRate: d.sst_rate,
  });
  const sstRate = d.sst_applicable ? d.sst_rate : 0;
  if (totals.taxableAmount < 0 || totals.total < 0) return { message: "Discount cannot exceed the quotation amount." };

  const { data: quotation, error } = await supabase
    .from("sales_quotations")
    .insert({
      opportunity_id: opportunityId,
      valid_until: d.valid_until || null,
      currency: d.currency,
      subtotal: totals.subtotal,
      discount: d.discount,
      sst_applicable: d.sst_applicable,
      sst_rate: sstRate,
      sst_amount: totals.tax,
      tax: totals.tax,
      total: totals.total,
      terms: d.terms || null,
      notes: d.notes || null,
      created_by: profile.id,
      customer_company_name: submitted("customer_company_name") ? d.customer_company_name || null : company?.company_name || opportunity.company_name || null,
      customer_contact_name: submitted("customer_contact_name") ? d.customer_contact_name || null : company?.person_in_charge || opportunity.contact_person || null,
      customer_registration_no: submitted("customer_registration_no") ? d.customer_registration_no || null : company?.registration_no || null,
      customer_email: submitted("customer_email") ? d.customer_email || null : company?.email || company?.pic_email || opportunity.contact_email || null,
      customer_phone: submitted("customer_phone") ? d.customer_phone || null : company?.phone || company?.pic_phone || opportunity.contact_phone || null,
      billing_address: submitted("billing_address") ? d.billing_address || null : company?.billing_address || company?.address || null,
      training_service_address: submitted("training_service_address") ? d.training_service_address || null : null,
    })
    .select("id, quotation_no")
    .single();
  if (error) return { message: error.message };

  const { error: itemsError } = await supabase.from("sales_quotation_items").insert(
    preparedItems.rows.map((item, index) => ({
      quotation_id: quotation.id,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      discount: item.discount,
      sort_order: index,
      course_id: item.course_id,
      course_name_snapshot: item.course_name_snapshot,
      hrdf_claim: item.hrdf_claim,
      package_includes_snapshot: item.package_includes_snapshot,
    }))
  );
  if (itemsError) return { message: itemsError.message };

  // Moving to "quotation" stage happens here rather than only on send — a
  // draft in progress already means the opportunity left "qualified".
  await supabase.from("sales_opportunities").update({ stage: "quotation", updated_at: new Date().toISOString() }).eq("id", opportunityId);

  const leadMetadataId = await getLeadMetadataId(supabase, opportunityId);
  await logActivity(supabase, leadMetadataId, opportunityId, quotation.id, "quotation_created", `${quotation.quotation_no} created`, profile.id);

  revalidateQuotation(quotation.id, opportunityId);
  redirect(`/admin/sales/quotations/${quotation.id}`);
}

/** Edits are only allowed while status='draft' — checked here, not just hidden in the UI. */
export async function updateQuotationDraft(
  quotationId: string,
  _prev: SalesActionState,
  formData: FormData
): Promise<SalesActionState> {
  await requireRole("admin");
  await requireModuleAccess("sales_quotations");
  const parsed = quotationHeaderSchema.safeParse({
    customer_company_name: formData.get("customer_company_name") ?? "",
    customer_contact_name: formData.get("customer_contact_name") ?? "",
    customer_registration_no: formData.get("customer_registration_no") ?? "",
    customer_email: formData.get("customer_email") ?? "",
    customer_phone: formData.get("customer_phone") ?? "",
    billing_address: formData.get("billing_address") ?? "",
    training_service_address: formData.get("training_service_address") ?? "",
    valid_until: formData.get("valid_until") ?? "",
    currency: formData.get("currency") || "MYR",
    discount: formData.get("discount") || 0,
    sst_applicable: formData.get("sst_applicable") === "on",
    sst_rate: formData.get("sst_rate") || 0,
    terms: formData.get("terms") ?? "",
    notes: formData.get("notes") ?? "",
    items: parseItemsField(formData.get("items")),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };
  const d = parsed.data;

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("sales_quotations").select("status, opportunity_id").eq("id", quotationId).maybeSingle();
  if (!existing) return { message: "Quotation not found." };
  if (existing.status !== "draft") return { message: "Only draft quotations can be edited. Create a revision instead." };
  const preparedItems = await prepareQuotationItems(supabase, d.items);
  if ("error" in preparedItems) return { message: preparedItems.error };

  const totals = computeQuotationTotals({
    items: d.items.map((i) => ({ quantity: i.quantity, unitPrice: i.unit_price, discount: i.discount })),
    discount: d.discount,
    sstApplicable: d.sst_applicable,
    sstRate: d.sst_rate,
  });
  const sstRate = d.sst_applicable ? d.sst_rate : 0;
  if (totals.taxableAmount < 0 || totals.total < 0) return { message: "Discount cannot exceed the quotation amount." };

  const { error } = await supabase
    .from("sales_quotations")
    .update({
      valid_until: d.valid_until || null,
      currency: d.currency,
      subtotal: totals.subtotal,
      discount: d.discount,
      sst_applicable: d.sst_applicable,
      sst_rate: sstRate,
      sst_amount: totals.tax,
      tax: totals.tax,
      total: totals.total,
      terms: d.terms || null,
      notes: d.notes || null,
      updated_at: new Date().toISOString(),
      customer_company_name: d.customer_company_name || null,
      customer_contact_name: d.customer_contact_name || null,
      customer_registration_no: d.customer_registration_no || null,
      customer_email: d.customer_email || null,
      customer_phone: d.customer_phone || null,
      billing_address: d.billing_address || null,
      training_service_address: d.training_service_address || null,
    })
    .eq("id", quotationId);
  if (error) return { message: error.message };

  await supabase.from("sales_quotation_items").delete().eq("quotation_id", quotationId);
  const { error: itemsError } = await supabase.from("sales_quotation_items").insert(
    preparedItems.rows.map((item, index) => ({
      quotation_id: quotationId,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.unit_price,
      discount: item.discount,
      sort_order: index,
      course_id: item.course_id,
      course_name_snapshot: item.course_name_snapshot,
      hrdf_claim: item.hrdf_claim,
      package_includes_snapshot: item.package_includes_snapshot,
    }))
  );
  if (itemsError) return { message: itemsError.message };

  revalidateQuotation(quotationId, existing.opportunity_id);
  return {};
}

/**
 * Task 10: "Send Quotation" is a manual status transition only — no email
 * is actually dispatched. Prepares the status/data architecture per the
 * task's explicit fallback ("if email delivery is out of scope, prepare
 * the status/data architecture only") rather than wiring Resend without
 * first getting sign-off on a quotation-email template/sender identity
 * that doesn't exist yet. sent_at is idempotency-guarded (status must
 * currently be draft) to prevent accidental repeated "sends".
 */
export async function markQuotationSent(quotationId: string, _prev: SalesActionState, _formData: FormData): Promise<SalesActionState> {
  const profile = await requireRole("admin");
  await requireModuleAccess("sales_quotations");
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("sales_quotations").select("status, opportunity_id, quotation_no").eq("id", quotationId).maybeSingle();
  if (!existing) return { message: "Quotation not found." };
  if (existing.status !== "draft") return { message: "Only draft quotations can be marked as sent." };

  const { error } = await supabase
    .from("sales_quotations")
    .update({ status: "sent", sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", quotationId);
  if (error) return { message: error.message };

  const leadMetadataId = await getLeadMetadataId(supabase, existing.opportunity_id);
  await logActivity(supabase, leadMetadataId, existing.opportunity_id, quotationId, "quotation_sent", `${existing.quotation_no} marked as sent`, profile.id);

  revalidateQuotation(quotationId, existing.opportunity_id);
  return {};
}

/** Task 11: accepted flow — delegates the whole won cascade to accept_quotation(). */
export async function acceptQuotationAction(quotationId: string, _prev: SalesActionState, _formData: FormData): Promise<SalesActionState> {
  await requireRole("admin");
  await requireModuleAccess("sales_quotations");
  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("sales_quotations").select("opportunity_id").eq("id", quotationId).maybeSingle();
  const { error } = await supabase.rpc("accept_quotation", { p_quotation_id: quotationId });
  if (error) return { message: error.message };

  revalidateQuotation(quotationId, existing?.opportunity_id);
  revalidatePath("/admin/sales/leads");
  return {};
}

/** Task 9: rejection — does not auto-cascade the opportunity/lead (see migration comments). */
export async function rejectQuotationAction(quotationId: string, _prev: SalesActionState, formData: FormData): Promise<SalesActionState> {
  await requireRole("admin");
  await requireModuleAccess("sales_quotations");
  const parsed = quotationRejectSchema.safeParse({ reason: formData.get("reason") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { data: existing } = await supabase.from("sales_quotations").select("opportunity_id").eq("id", quotationId).maybeSingle();
  const { error } = await supabase.rpc("reject_quotation", { p_quotation_id: quotationId, p_reason: parsed.data.reason });
  if (error) return { message: error.message };

  revalidateQuotation(quotationId, existing?.opportunity_id);
  return {};
}

/**
 * Task 9: revisions. The prior quotation is marked superseded (never
 * overwritten/deleted — its historical data stays fully auditable), a new
 * row is created with the SAME quotation_no and revision_no + 1, items are
 * copied so staff edit from where the client left off rather than from
 * scratch.
 */
export async function createRevision(quotationId: string, _prev: SalesActionState, _formData: FormData): Promise<SalesActionState> {
  const profile = await requireRole("admin");
  await requireModuleAccess("sales_quotations");
  const supabase = await createSupabaseServerClient();

  const { data: source } = await supabase.from("sales_quotations").select("*").eq("id", quotationId).maybeSingle();
  if (!source) return { message: "Quotation not found." };
  if (!["sent", "rejected", "expired"].includes(source.status)) {
    return { message: `A ${source.status} quotation cannot be revised. Only sent, rejected or expired quotations can be revised.` };
  }

  const { data: sourceItems } = await supabase
    .from("sales_quotation_items")
    .select("description, quantity, unit, unit_price, discount, sort_order, course_id, course_name_snapshot, hrdf_claim, package_includes_snapshot")
    .eq("quotation_id", quotationId)
    .order("sort_order");

  const { data: maxRevisionRow } = await supabase
    .from("sales_quotations")
    .select("revision_no")
    .eq("quotation_no", source.quotation_no)
    .order("revision_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextRevisionNo = (maxRevisionRow?.revision_no ?? source.revision_no) + 1;

  await supabase.from("sales_quotations").update({ status: "superseded", superseded_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", quotationId);

  const { data: revision, error } = await supabase
    .from("sales_quotations")
    .insert({
      opportunity_id: source.opportunity_id,
      quotation_no: source.quotation_no,
      revision_no: nextRevisionNo,
      parent_quotation_id: quotationId,
      valid_until: source.valid_until,
      currency: source.currency,
      subtotal: source.subtotal,
      discount: source.discount,
      sst_applicable: source.sst_applicable,
      sst_rate: source.sst_rate,
      sst_amount: source.sst_amount,
      tax: source.tax,
      total: source.total,
      terms: source.terms,
      notes: source.notes,
      customer_company_name: source.customer_company_name,
      customer_contact_name: source.customer_contact_name,
      customer_registration_no: source.customer_registration_no,
      customer_email: source.customer_email,
      customer_phone: source.customer_phone,
      billing_address: source.billing_address,
      training_service_address: source.training_service_address,
      created_by: profile.id,
    })
    .select("id, quotation_no")
    .single();
  if (error) return { message: error.message };

  if (sourceItems && sourceItems.length > 0) {
    await supabase.from("sales_quotation_items").insert(sourceItems.map((item: any) => ({ ...item, quotation_id: revision.id })));
  }

  const leadMetadataId = await getLeadMetadataId(supabase, source.opportunity_id);
  await logActivity(supabase, leadMetadataId, source.opportunity_id, revision.id, "quotation_revised", `${revision.quotation_no} revised`, profile.id);

  revalidateQuotation(revision.id, source.opportunity_id);
  redirect(`/admin/sales/quotations/${revision.id}`);
}
