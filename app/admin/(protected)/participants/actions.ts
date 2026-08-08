"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireRole } from "../../../../lib/auth/session";
import { participantSchema, fieldErrors } from "../../../../lib/validation/schemas";
import { normalizeIdentityNumber } from "../../../../lib/identity";

export type ParticipantFormState = { errors?: Record<string, string>; message?: string };

const DUPLICATE_IDENTITY_MESSAGE = "A participant with this IC/Passport number already exists.";

/**
 * Pre-check only — a race between two simultaneous submissions can still
 * slip past this. The live `participants_active_identity_unique`-style
 * database index (see supabase/migrations) is the real safety net;
 * mapDbError() below catches that as a fallback if this check is beaten.
 */
async function findDuplicateIdentity(supabase: any, icPassportNo: string, excludeId?: string): Promise<boolean> {
  const normalized = normalizeIdentityNumber(icPassportNo);
  if (!normalized) return false;
  let query = supabase.from("participants").select("id, ic_passport_no").is("deleted_at", null);
  if (excludeId) query = query.neq("id", excludeId);
  const { data } = await query;
  return (data ?? []).some((row: any) => normalizeIdentityNumber(row.ic_passport_no) === normalized);
}

const OPTIONAL_NULLABLE = [
  "email", "nationality", "position", "gender", "date_of_birth", "address",
  "emergency_contact_name", "emergency_contact_phone", "registration_date", "schedule_id", "company_id",
];

function readForm(formData: FormData) {
  const v = (k: string) => {
    const x = formData.get(k);
    return x === null ? "" : String(x).trim();
  };
  return {
    full_name: v("full_name"),
    ic_passport_no: v("ic_passport_no"),
    company: v("company"),
    phone: v("phone"),
    email: v("email"),
    nationality: v("nationality"),
    position: v("position"),
    gender: v("gender") as "Male" | "Female" | "",
    date_of_birth: v("date_of_birth"),
    address: v("address"),
    emergency_contact_name: v("emergency_contact_name"),
    emergency_contact_phone: v("emergency_contact_phone"),
    registration_date: v("registration_date"),
    schedule_id: v("schedule_id") || null,
    company_id: v("company_id") || null,
    status: (v("status") || "registered") as any,
  };
}

function toPayload(data: any) {
  const out: any = { ...data };
  for (const k of OPTIONAL_NULLABLE) if (out[k] === "" || out[k] === undefined) out[k] = null;
  return out;
}

/**
 * Friendly Postgres-error → form-error mapping. This is the DB-level safety
 * net for the race window findDuplicateIdentity() can't close — never
 * surfaces the constraint name or raw SQL to the user.
 */
function mapDbError(error: { code?: string; message: string }): ParticipantFormState {
  if (error.code === "23505") {
    if (error.message.includes("identity") || error.message.includes("ic")) return { errors: { ic_passport_no: DUPLICATE_IDENTITY_MESSAGE } };
    return { errors: { _form: "A duplicate value was detected." } };
  }
  return { message: error.message };
}

export async function createParticipant(_prev: ParticipantFormState, formData: FormData): Promise<ParticipantFormState> {
  await requireRole("admin"); // Editors are read-only.
  const parsed = participantSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  if (await findDuplicateIdentity(supabase, parsed.data.ic_passport_no)) {
    return { errors: { ic_passport_no: DUPLICATE_IDENTITY_MESSAGE } };
  }
  const { error } = await supabase.from("participants").insert(toPayload(parsed.data));
  if (error) return mapDbError(error);
  // Audit is written automatically by the DB trigger (action='create').
  revalidatePath("/admin/participants");
  redirect("/admin/participants");
}

export async function updateParticipant(id: string, _prev: ParticipantFormState, formData: FormData): Promise<ParticipantFormState> {
  await requireRole("admin");
  const parsed = participantSchema.safeParse(readForm(formData));
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const supabase = await createSupabaseServerClient();
  if (await findDuplicateIdentity(supabase, parsed.data.ic_passport_no, id)) {
    return { errors: { ic_passport_no: DUPLICATE_IDENTITY_MESSAGE } };
  }
  const { error } = await supabase.from("participants").update(toPayload(parsed.data)).eq("id", id);
  if (error) return mapDbError(error);
  revalidatePath("/admin/participants");
  revalidatePath(`/admin/participants/${id}`);
  redirect(`/admin/participants/${id}`);
}

/** Soft delete — row stays in DB (deleted_at set). */
export async function softDeleteParticipant(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("participants").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/participants");
}

/** Restore a soft-deleted participant. */
export async function restoreParticipant(id: string) {
  await requireRole("admin");
  const supabase = await createSupabaseServerClient();
  await supabase.from("participants").update({ deleted_at: null }).eq("id", id);
  revalidatePath("/admin/participants");
  revalidatePath(`/admin/participants/${id}`);
}

/** Bulk soft-delete from the list's selection. */
export async function bulkDeleteParticipants(formData: FormData) {
  await requireRole("admin");
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("participants").update({ deleted_at: new Date().toISOString() }).in("id", ids);
  revalidatePath("/admin/participants");
}

/** Bulk restore from the "deleted" view. */
export async function bulkRestoreParticipants(formData: FormData) {
  await requireRole("admin");
  const ids = formData.getAll("ids").map(String).filter(Boolean);
  if (ids.length === 0) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("participants").update({ deleted_at: null }).in("id", ids);
  revalidatePath("/admin/participants");
}
