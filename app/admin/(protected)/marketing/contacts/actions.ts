"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { requireModuleAccess, requireRole } from "../../../../../lib/auth/session";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  marketingContactSchema,
  marketingContactConsentSchema,
  marketingContactNoteSchema,
  fieldErrors,
} from "../../../../../lib/validation/schemas";
import type { MarketingContactStatus } from "../../../../../lib/supabase/database.types";
import type { Database } from "../../../../../lib/supabase/database.types";

export type ContactFormState = {
  errors?: Record<string, string>;
  message?: string;
  /** Set when a soft duplicate match was found and NOT yet confirmed past — the form re-renders a "submit again to confirm" state instead of a hard block. */
  duplicateFound?: boolean;
};

function readForm(formData: FormData) {
  const v = (k: string) => {
    const x = formData.get(k);
    return x === null ? "" : String(x).trim();
  };
  return {
    full_name: v("full_name"),
    email: v("email"),
    phone: v("phone"),
    company: v("company"),
    source: v("source"),
    source_campaign_id: v("source_campaign_id"),
    owner_id: v("owner_id"),
    next_follow_up_at: v("next_follow_up_at"),
    consent_status: v("consent_status") || "not_set",
    consent_source: v("consent_source"),
    consented_at: v("consented_at"),
  };
}

function revalidateContact(id: string) {
  revalidatePath("/admin/marketing/contacts");
  revalidatePath(`/admin/marketing/contacts/${id}`);
}

type MarketingContactDuplicate = Pick<
  Database["public"]["Tables"]["marketing_contacts"]["Row"],
  "id" | "contact_number" | "full_name" | "email" | "phone"
>;

/**
 * Soft duplicate check (CLAUDE.md-consistent: no DB UNIQUE exists on email/
 * phone anywhere in this schema, matching every other person/company table
 * audited during the Phase 1B decision report). Email is checked first via
 * the plain indexed column (already-normalized at write time, matching
 * submit_public_enquiry's own lower(trim(...)) precedent). Phone is checked
 * via a bounded scan + JS-side digit comparison -- no phone-normalization
 * helper exists anywhere in this codebase to reuse, and building an
 * expression index for it was explicitly rejected in the schema decision
 * report as premature. The 200-row cap is a known V1 scale limitation,
 * acceptable at Marketing Contacts' expected volume; flagged in the report.
 */
async function findPotentialDuplicate(
  supabase: SupabaseClient<Database>,
  email: string,
  phone: string,
  excludeId?: string
): Promise<MarketingContactDuplicate | null> {
  if (email) {
    let q = supabase
      .from("marketing_contacts")
      .select("id, contact_number, full_name, email, phone")
      .eq("email", email)
      .limit(1);
    if (excludeId) q = q.neq("id", excludeId);
    const { data, error } = await q.maybeSingle();
    if (error) {
      console.error("marketing_contacts: email duplicate check failed", { message: error.message });
    } else if (data) {
      return data as MarketingContactDuplicate;
    }
  }
  if (phone) {
    const targetDigits = phone.replace(/\D/g, "");
    if (targetDigits) {
      let q = supabase
        .from("marketing_contacts")
        .select("id, contact_number, full_name, email, phone")
        .not("phone", "is", null)
        .limit(200);
      if (excludeId) q = q.neq("id", excludeId);
      const { data, error } = await q;
      if (error) {
        console.error("marketing_contacts: phone duplicate check failed", { message: error.message });
        return null;
      }
      const matches = (data ?? []) as unknown as MarketingContactDuplicate[];
      const match = matches.find((c) => c.phone && String(c.phone).replace(/\D/g, "") === targetDigits);
      if (match) return match;
    }
  }
  return null;
}

/**
 * campaign_number/contact_number is never set here (DB DEFAULT). Sequential
 * writes, not an RPC: unlike Sales Lead promotion, both marketing_contacts
 * and marketing_contact_events are directly INSERT-able by an authenticated
 * editor session (no privilege boundary crossed), matching the
 * sales_tasks/sales_activity precedent shape for "main record + append-only
 * event" (createTask inserts sales_tasks then separately logs
 * sales_activity). Improves on that precedent by actually checking the
 * event insert's `{ error }` and logging it (CLAUDE.md §16) rather than
 * silently dropping a failure — the contact row is still the source of
 * truth for success/failure; a lost timeline entry is a minor gap, not a
 * data-integrity violation, so it does not fail the user-facing action.
 */
export async function createContact(_prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const profile = await requireRole("editor");
  await requireModuleAccess("marketing_contacts");
  const parsed = marketingContactSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const email = parsed.data.email ? parsed.data.email.trim().toLowerCase() : "";
  const phone = parsed.data.phone || "";

  const confirmDuplicate = formData.get("confirmDuplicate") === "1";
  if (!confirmDuplicate) {
    const dup = await findPotentialDuplicate(supabase, email, phone);
    if (dup) {
      const matchedOn = dup.email && email && dup.email === email ? "email" : "phone number";
      return {
        message: `Possible duplicate: ${dup.full_name || dup.email || dup.phone || dup.contact_number} (${dup.contact_number}) already has this ${matchedOn}. Submit again to create anyway.`,
        duplicateFound: true,
      };
    }
  }

  const { data: created, error } = await supabase
    .from("marketing_contacts")
    .insert({
      full_name: parsed.data.full_name,
      email: email || null,
      phone: phone || null,
      company: parsed.data.company || null,
      source: parsed.data.source,
      source_campaign_id: parsed.data.source_campaign_id || null,
      owner_id: parsed.data.owner_id || null,
      next_follow_up_at: parsed.data.next_follow_up_at ? new Date(parsed.data.next_follow_up_at).toISOString() : null,
      consent_status: parsed.data.consent_status,
      consent_source: parsed.data.consent_source || null,
      consented_at:
        parsed.data.consent_status === "opted_in" && parsed.data.consented_at
          ? new Date(parsed.data.consented_at).toISOString()
          : null,
      // created_by/updated_by intentionally omitted -- app.stamp_actor() sets both from auth.uid().
    })
    .select("id")
    .single();
  if (error) return { message: error.message };

  const { error: eventError } = await supabase
    .from("marketing_contact_events")
    .insert({ contact_id: created.id, event_type: "created", actor_id: profile.id });
  if (eventError) {
    console.error("marketing_contacts: failed to log created event", { message: eventError.message, contactId: created.id });
  }

  revalidatePath("/admin/marketing/contacts");
  redirect(`/admin/marketing/contacts/${created.id}`);
}

/**
 * Edit-only -- status and consent are deliberately excluded from both the
 * form and this payload; lifecycle changes go through the dedicated
 * transition actions below, consent through updateContactConsent, matching
 * the "Edit" vs "Stage"/"Consent" split the Campaign and consent
 * architecture both use.
 */
export async function updateContact(id: string, _prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const profile = await requireRole("editor");
  await requireModuleAccess("marketing_contacts");
  const parsed = marketingContactSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const email = parsed.data.email ? parsed.data.email.trim().toLowerCase() : "";
  const phone = parsed.data.phone || "";

  const confirmDuplicate = formData.get("confirmDuplicate") === "1";
  if (!confirmDuplicate) {
    const dup = await findPotentialDuplicate(supabase, email, phone, id);
    if (dup) {
      const matchedOn = dup.email && email && dup.email === email ? "email" : "phone number";
      return {
        message: `Possible duplicate: ${dup.full_name || dup.email || dup.phone || dup.contact_number} (${dup.contact_number}) already has this ${matchedOn}. Submit again to save anyway.`,
        duplicateFound: true,
      };
    }
  }

  const { data: existing, error: existingError } = await supabase
    .from("marketing_contacts")
    .select("source_campaign_id")
    .eq("id", id)
    .maybeSingle();
  if (existingError) return { message: existingError.message };

  const newCampaignId = parsed.data.source_campaign_id || null;

  const { error } = await supabase
    .from("marketing_contacts")
    .update({
      full_name: parsed.data.full_name,
      email: email || null,
      phone: phone || null,
      company: parsed.data.company || null,
      source: parsed.data.source,
      source_campaign_id: newCampaignId,
      owner_id: parsed.data.owner_id || null,
      next_follow_up_at: parsed.data.next_follow_up_at ? new Date(parsed.data.next_follow_up_at).toISOString() : null,
    })
    .eq("id", id);
  if (error) return { message: error.message };

  if (newCampaignId && (!existing || newCampaignId !== existing.source_campaign_id)) {
    const { error: eventError } = await supabase
      .from("marketing_contact_events")
      .insert({ contact_id: id, event_type: "campaign_linked", campaign_id: newCampaignId, actor_id: profile.id });
    if (eventError) {
      console.error("marketing_contacts: failed to log campaign_linked event", { message: eventError.message, contactId: id });
    }
  }

  revalidateContact(id);
  redirect(`/admin/marketing/contacts/${id}`);
}

/**
 * Focused consent action (CLAUDE.md-consistent centralization -- no other
 * action touches consent_status/consent_source/consented_at/
 * unsubscribed_at). This is a live status change, not historical data
 * entry, so it stamps now() itself rather than accepting a caller-supplied
 * timestamp -- keeps the "opted_in should have a consented_at" relationship
 * correct by construction without a DB CHECK (the locked decision left
 * this to the Server Action layer deliberately). Reverting to not_set does
 * not clear prior consented_at/unsubscribed_at -- "preserve historical
 * data sensibly", not a re-subscription workflow.
 */
export async function updateContactConsent(id: string, _prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const profile = await requireRole("editor");
  await requireModuleAccess("marketing_contacts");
  const parsed = marketingContactConsentSchema.safeParse({
    consent_status: String(formData.get("consent_status") ?? ""),
    consent_source: String(formData.get("consent_source") ?? "").trim(),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const patch: Record<string, unknown> = {
    consent_status: parsed.data.consent_status,
    consent_source: parsed.data.consent_source || null,
  };
  if (parsed.data.consent_status === "opted_in") patch.consented_at = new Date().toISOString();
  if (parsed.data.consent_status === "opted_out") patch.unsubscribed_at = new Date().toISOString();

  const { error } = await supabase.from("marketing_contacts").update(patch).eq("id", id);
  if (error) return { message: error.message };

  const { error: eventError } = await supabase.from("marketing_contact_events").insert({
    contact_id: id,
    event_type: "consent_changed",
    note: `Consent set to ${parsed.data.consent_status}`,
    actor_id: profile.id,
  });
  if (eventError) {
    console.error("marketing_contacts: failed to log consent_changed event", { message: eventError.message, contactId: id });
  }

  // Distinct event for the specific unsubscribe fact, per the locked design
  // -- not duplicated for opted_in/not_set, which have no equivalent
  // "meaningful secondary fact" to log.
  if (parsed.data.consent_status === "opted_out") {
    const { error: unsubError } = await supabase
      .from("marketing_contact_events")
      .insert({ contact_id: id, event_type: "unsubscribed", actor_id: profile.id });
    if (unsubError) {
      console.error("marketing_contacts: failed to log unsubscribed event", { message: unsubError.message, contactId: id });
    }
  }

  revalidateContact(id);
  redirect(`/admin/marketing/contacts/${id}`);
}

export async function addContactNote(id: string, _prev: ContactFormState, formData: FormData): Promise<ContactFormState> {
  const profile = await requireRole("editor");
  await requireModuleAccess("marketing_contacts");
  const parsed = marketingContactNoteSchema.safeParse({ note: String(formData.get("note") ?? "") });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("marketing_contact_events")
    .insert({ contact_id: id, event_type: "note_added", note: parsed.data.note, actor_id: profile.id });
  if (error) return { message: error.message };

  revalidateContact(id);
  redirect(`/admin/marketing/contacts/${id}`);
}

/**
 * Single-step lifecycle transition, shared by the three exported actions
 * below -- same fail-closed shape as Campaign's transitionCampaign, but
 * accepts a SET of valid `from` statuses (not one), matching the locked
 * non-linear transition matrix (§K of the accompanying report). Reads the
 * row's CURRENT status live and only writes if it's in the allowed set --
 * never trusts a client-supplied status. `sales_ready -> promoted` is
 * deliberately not one of the three exported actions -- Phase 1B-D's job.
 */
async function transitionContactStatus(id: string, allowedFrom: MarketingContactStatus[], to: MarketingContactStatus): Promise<void> {
  const profile = await requireRole("editor");
  await requireModuleAccess("marketing_contacts");
  const supabase = await createSupabaseServerClient();

  const { data: current, error: readError } = await supabase.from("marketing_contacts").select("status").eq("id", id).maybeSingle();
  if (readError) {
    console.error("marketing_contacts: failed to read current status before transition", { message: readError.message, id, to });
    return;
  }
  if (!current || !allowedFrom.includes(current.status as MarketingContactStatus)) return;

  const { data: updated, error } = await supabase
    .from("marketing_contacts")
    .update({ status: to })
    .eq("id", id)
    .in("status", allowedFrom)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("marketing_contacts: transition update failed", { message: error.message, id, to });
    return;
  }
  if (!updated) return;

  const { error: eventError } = await supabase
    .from("marketing_contact_events")
    .insert({ contact_id: id, event_type: "status_changed", note: `Status changed to ${to}`, actor_id: profile.id });
  if (eventError) {
    console.error("marketing_contacts: failed to log status_changed event", { message: eventError.message, id });
  }

  revalidateContact(id);
}

export async function moveContactToNurturing(id: string): Promise<void> {
  await transitionContactStatus(id, ["new", "sales_ready", "archived"], "nurturing");
}

export async function markContactSalesReady(id: string): Promise<void> {
  await transitionContactStatus(id, ["new", "nurturing"], "sales_ready");
}

export async function archiveContact(id: string): Promise<void> {
  await transitionContactStatus(id, ["new", "nurturing", "sales_ready"], "archived");
}

/**
 * Phase 1B-D -- the first editor-level Marketing -> Sales trust-boundary
 * write. Calls public.promote_marketing_contact_to_sales (Phase 1B-D
 * migration), a SECURITY DEFINER RPC that owns the entire atomic
 * transaction (contact eligibility check, sales_lead_metadata insert,
 * marketing_contacts update, marketing_contact_events insert). This action
 * does NOT perform any of those writes itself -- it only calls the RPC and
 * surfaces its result, matching "the RPC owns atomicity" exactly.
 *
 * Guard is requireRole("editor") + requireModuleAccess("marketing_contacts")
 * ONLY -- deliberately not requireModuleAccess("sales_leads") too. The RPC
 * is the explicit, deliberate handoff mechanism; requiring Sales module
 * access here would defeat its purpose and reintroduce the admin-gate the
 * locked business decision explicitly rejected (see the Phase 1B final
 * schema decision report, §T/§U). The RPC independently re-enforces the
 * editor+ role floor itself -- this guard is not the only protection.
 */
export async function promoteMarketingContactToSales(id: string, _prev: ContactFormState, _formData: FormData): Promise<ContactFormState> {
  await requireRole("editor");
  await requireModuleAccess("marketing_contacts");
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.rpc("promote_marketing_contact_to_sales", { p_contact_id: id });
  if (error) {
    console.error("marketing_contacts: promotion RPC failed", { message: error.message, contactId: id });
    // Map the RPC's known, deliberately-named error codes to user-readable
    // text (matches app/api/contact/route.ts's own "check if the raw
    // Postgres message includes a known marker string" pattern) — never
    // surface a raw Postgres/PL/pgSQL error string to the user (CLAUDE.md §15).
    const friendly: Record<string, string> = {
      contact_not_found: "This contact could not be found.",
      not_sales_ready: "This contact must be marked Sales Ready before it can be promoted.",
      forbidden: "You do not have permission to promote this contact.",
    };
    const code = Object.keys(friendly).find((k) => error.message.includes(k));
    return { message: code ? friendly[code] : "Could not promote this contact right now. Please try again." };
  }

  revalidatePath("/admin/marketing/contacts");
  revalidatePath(`/admin/marketing/contacts/${id}`);
  revalidatePath("/admin/sales/leads");
  redirect(`/admin/marketing/contacts/${id}`);
}
