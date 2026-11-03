import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Creates a revision of a sent, rejected or expired quotation.
 *
 * NOT ATOMIC. Each statement here is its own request and so its own database
 * transaction; there is no rollback across them. What protects the existing
 * quotation is the ORDER: the replacement draft and its line items are written
 * first and the original is marked superseded last, so a failure in any earlier
 * step leaves the original exactly as it was. (It used to be superseded first,
 * which stranded it with no successor whenever the revision insert then failed,
 * for example on a database that lacks the SST columns.)
 *
 * What can still go wrong, by design of this interim fix:
 * - the draft can exist for a moment before the original is superseded;
 * - if copying the line items fails, an incomplete draft is left behind (the
 *   original is unchanged, and the draft can be completed in the editor);
 * - retrying after a late failure can create a second draft;
 * - two people revising at once can still race, though the unique
 *   (quotation_no, revision_no) key makes the second insert fail cleanly.
 *
 * To be replaced by the atomic create_quotation_revision() function in the P0
 * quotation integrity design, once that migration is approved and applied.
 */

const REVISABLE_STATUSES = ["sent", "rejected", "expired"];

export type QuotationRevisionStage = "load" | "revision" | "items" | "supersede";

export type QuotationRevisionResult =
  | { ok: true; revisionId: string; opportunityId: string; auditSaved: boolean }
  | { ok: false; stage: QuotationRevisionStage; message: string; revisionCreated: boolean };

const MISSING_COLUMN_CODES = new Set(["PGRST204", "42703"]);

/** True when the database rejected a statement because a column does not exist (PostgREST schema-cache or Postgres wording). */
export function isMissingColumnError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code && MISSING_COLUMN_CODES.has(error.code)) return true;
  const text = error.message ?? "";
  return /could not find the '[^']+' column/i.test(text) || /column "?[\w.]+"? .*does not exist/i.test(text);
}

function failure(stage: QuotationRevisionStage, message: string, revisionCreated = false): QuotationRevisionResult {
  return { ok: false, stage, message, revisionCreated };
}

// Only the failing step and the database error code are logged: never row data or the raw message.
function logFailure(stage: string, error: { code?: string | null } | null | undefined) {
  try {
    console.error("Quotation revision step failed", { stage, code: error?.code ?? null });
  } catch {
    // A broken logger must never change the outcome of the revision.
  }
}

type Progress = { stage: QuotationRevisionStage; revisionCreated: boolean };

// Shown when a request rejects or the client throws. After a thrown INSERT or UPDATE the database may or may not
// have committed, so these messages say "could not confirm" instead of claiming an outcome.
const EXCEPTION_MESSAGES: Record<QuotationRevisionStage, string> = {
  load: "Unable to load the quotation. Try again.",
  revision: "Could not confirm that the revision was created. The original quotation was not changed. Check the quotation list before trying again.",
  items: "The revision draft was created, but its line items could not be confirmed as copied. The original quotation was not changed. Open the new draft to check and complete the items; do not create another revision.",
  supersede: "The revision draft was created, but it could not be confirmed that the original quotation was marked as superseded. Review both before sending either.",
};

export async function runQuotationRevision(
  supabase: SupabaseClient,
  input: { quotationId: string; actorId: string },
): Promise<QuotationRevisionResult> {
  const progress: Progress = { stage: "load", revisionCreated: false };
  try {
    return await revise(supabase, input, progress);
  } catch {
    // A rejected request or a client exception (network failure, timeout). Nothing from the error is logged or shown, only the step.
    logFailure(`${progress.stage}-exception`, null);
    return failure(progress.stage, EXCEPTION_MESSAGES[progress.stage], progress.revisionCreated);
  }
}

async function revise(supabase: SupabaseClient, input: { quotationId: string; actorId: string }, progress: Progress): Promise<QuotationRevisionResult> {
  const { quotationId, actorId } = input;

  // Reads first: nothing is written until every read has succeeded.
  const { data: source, error: sourceError } = await supabase.from("sales_quotations").select("*").eq("id", quotationId).maybeSingle();
  if (sourceError) {
    logFailure("load-quotation", sourceError);
    return failure("load", "Unable to load the quotation. Try again.");
  }
  if (!source) return failure("load", "Quotation not found.");
  if (!REVISABLE_STATUSES.includes(source.status)) {
    return failure("load", `A ${source.status} quotation cannot be revised. Only sent, rejected or expired quotations can be revised.`);
  }

  const { data: sourceItems, error: itemsReadError } = await supabase
    .from("sales_quotation_items")
    .select("description, quantity, unit, unit_price, discount, sort_order, course_id, course_name_snapshot, hrdf_claim, package_includes_snapshot")
    .eq("quotation_id", quotationId)
    .order("sort_order");
  if (itemsReadError) {
    logFailure("load-items", itemsReadError);
    return failure("load", "Unable to load the quotation line items. Try again.");
  }

  const { data: maxRevisionRow, error: maxRevisionError } = await supabase
    .from("sales_quotations")
    .select("revision_no")
    .eq("quotation_no", source.quotation_no)
    .order("revision_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (maxRevisionError) {
    logFailure("load-revision-number", maxRevisionError);
    return failure("load", "Unable to work out the next revision number. Try again.");
  }
  const nextRevisionNo = (maxRevisionRow?.revision_no ?? source.revision_no) + 1;

  // 1. The replacement draft. If this fails the original has not been touched.
  progress.stage = "revision";
  const { data: revision, error: revisionError } = await supabase
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
      tax_label_snapshot: source.tax_label_snapshot,
      tax_basis_snapshot: source.tax_basis_snapshot,
      sst_registration_number_snapshot: source.sst_registration_number_snapshot,
      sst_effective_date_snapshot: source.sst_effective_date_snapshot,
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
      created_by: actorId,
    })
    .select("id, quotation_no")
    .single();
  if (revisionError || !revision) {
    logFailure("insert-revision", revisionError);
    return failure(
      "revision",
      isMissingColumnError(revisionError)
        ? "Revision is unavailable: the database is missing quotation columns this version needs. The original quotation was not changed."
        : "Unable to create the revision. The original quotation was not changed.",
    );
  }

  progress.revisionCreated = true;

  // 2. The line items. If this fails the original is still untouched.
  progress.stage = "items";
  if (sourceItems && sourceItems.length > 0) {
    const { error: copyError } = await supabase
      .from("sales_quotation_items")
      .insert(sourceItems.map((item: Record<string, unknown>) => ({ ...item, quotation_id: revision.id })));
    if (copyError) {
      logFailure("copy-items", copyError);
      return failure(
        "items",
        "The revision draft was created but its line items could not be copied. The original quotation was not changed. Open the new draft to add the items; do not create another revision.",
        true,
      );
    }
  }

  // 3. Only now is the original marked superseded, and only if it is still in the state it was read in.
  progress.stage = "supersede";
  const now = new Date().toISOString();
  const { data: superseded, error: supersedeError } = await supabase
    .from("sales_quotations")
    .update({ status: "superseded", superseded_at: now, updated_at: now })
    .eq("id", quotationId)
    .eq("status", source.status)
    .select("id")
    .maybeSingle();
  if (supersedeError) {
    logFailure("supersede-original", supersedeError);
    return failure(
      "supersede",
      "The revision draft was created, but the original quotation could not be marked as superseded. Review both before sending either.",
      true,
    );
  }
  if (!superseded) {
    return failure(
      "supersede",
      "The revision draft was created, but the original quotation changed while it was being revised. Review both before sending either.",
      true,
    );
  }

  // 4. The audit entry. The revision is already complete, so a failure here (an error result or a thrown exception) is logged and
  // reported through auditSaved, never turned into an error.
  let auditSaved = false;
  try {
    const { data: opportunity, error: opportunityError } = await supabase
      .from("sales_opportunities")
      .select("lead_metadata_id")
      .eq("id", source.opportunity_id)
      .maybeSingle();
    if (opportunityError) logFailure("load-opportunity-for-audit", opportunityError);
    else {
      const { error: auditError } = await supabase.from("sales_activity").insert({
        lead_metadata_id: opportunity?.lead_metadata_id ?? null,
        opportunity_id: source.opportunity_id,
        quotation_id: revision.id,
        type: "quotation_revised",
        note: `${revision.quotation_no} revised`,
        actor_id: actorId,
      });
      if (auditError) logFailure("insert-audit", auditError);
      else auditSaved = true;
    }
  } catch {
    logFailure("audit-exception", null);
  }

  return { ok: true, revisionId: revision.id, opportunityId: source.opportunity_id, auditSaved };
}
