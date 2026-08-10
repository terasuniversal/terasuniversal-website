"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireCertificate, getCurrentProfile } from "../../../../lib/auth/session";
import { siteOrigin } from "../../../../lib/site-origin";

/**
 * Shape returned by v_certificate_eligibility (see the migration that
 * creates it) — not covered by the hand-written database.types.ts, so typed
 * explicitly here rather than cast to `any`, matching the pattern already
 * used for verify_certificate_by_value's CertificateRow in app/verify.
 */
interface EligibilityRow {
  schedule_id: string;
  participant_id: string;
  course_id: string;
  course_name: string | null;
  holder_name: string;
  schedule_status: string;
  schedule_start_date: string | null;
  schedule_end_date: string | null;
  venue: string | null;
  trainer_name: string | null;
  attendance_percentage: number;
  attendance_min_percent: number;
  eligible: boolean;
  ineligibility_reason: string | null;
  existing_certificate_id: string | null;
  existing_certificate_number: string | null;
  certificate_generation_enabled: boolean;
  certificate_template_id: string | null;
}

/**
 * Computes the next number for a template that opts into a custom prefix
 * (config.certificate_number_prefix, e.g. "TU-SESP") instead of the generic
 * CERT-YYYY-NNNNNN the certificates_before_insert trigger assigns when
 * certificate_number is left null. Scans existing certificate_number values
 * for the same prefix+year rather than a dedicated DB sequence — this only
 * has to be correct for one admin's sequential clicks / bulkGenerate's own
 * sequential loop, not high-concurrency throughput; a collision (two staff
 * generating for the same prefix in the same instant) surfaces as a 23505
 * on uq_certificates_number, same as any other insert race here.
 */
async function nextPrefixedCertificateNumber(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  prefix: string
): Promise<string> {
  const year = new Date().getFullYear();
  const { data } = await supabase
    .from("certificates")
    .select("certificate_number")
    .ilike("certificate_number", `${prefix}-${year}-%`)
    .order("certificate_number", { ascending: false })
    .limit(1);
  const last = (data?.[0] as { certificate_number: string } | undefined)?.certificate_number;
  const lastSeq = last ? parseInt(last.slice(last.lastIndexOf("-") + 1), 10) : 0;
  const seq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Inserts one certificate from an already-fetched, already-eligible row.
 * Not exported — every caller must have checked `elig.eligible` itself,
 * which (per v_certificate_eligibility) guarantees `certificate_template_id`
 * is non-null here — the course's bound template is used directly, never a
 * global "default" template. Populates the training-date/venue/trainer
 * snapshot fields from the schedule (the certificates_before_insert trigger
 * only auto-fills certificate_number/certificate_no/verification_token/
 * holder_name↔participant_name/course_name — it does not know about
 * schedules or per-course template bindings).
 */
async function insertEligibleCertificate(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  elig: EligibilityRow,
  issuedBy: string | null
): Promise<string> {
  const { data: tmpl } = await supabase
    .from("certificate_templates")
    .select("config")
    .eq("id", elig.certificate_template_id)
    .maybeSingle();
  const prefix = (tmpl?.config as { certificate_number_prefix?: string } | null)?.certificate_number_prefix;
  const certificateNumber = prefix ? await nextPrefixedCertificateNumber(supabase, prefix) : undefined;

  const { data: created, error } = await supabase
    .from("certificates")
    .insert({
      participant_id: elig.participant_id,
      schedule_id: elig.schedule_id,
      course_id: elig.course_id,
      template_id: elig.certificate_template_id,
      ...(certificateNumber ? { certificate_number: certificateNumber } : {}),
      holder_name: elig.holder_name,
      participant_name: elig.holder_name,
      course_name: elig.course_name,
      training_start_date: elig.schedule_start_date,
      training_end_date: elig.schedule_end_date,
      venue: elig.venue,
      trainer_name: elig.trainer_name,
      status: "valid",
      issue_date: new Date().toISOString().slice(0, 10),
      issued_by: issuedBy,
    })
    .select("id, verification_token")
    .single();

  if (error) {
    // certificates_active_schedule_participant_uniq is the real guard against
    // a race between the eligibility read and this insert (two admins
    // generating for the same pair at once) — surface it as "exists", not a
    // raw constraint-name error.
    if (error.code === "23505") return "exists";
    return error.message;
  }

  const origin = await siteOrigin();
  await supabase.from("certificates").update({ verification_url: `${origin}/verify/${created.verification_token}` }).eq("id", created.id);

  return "ok";
}

/**
 * Generate a certificate for ONE participant on a schedule — only if
 * v_certificate_eligibility says they're eligible (schedule completed,
 * attendance %, assessment/competency per course config, no existing
 * active certificate). Returns a short status string.
 */
export async function generateCertificate(scheduleId: string, participantId: string): Promise<string> {
  await requireCertificate(true); // admin+
  const supabase = await createSupabaseServerClient();

  const { data: elig } = await supabase
    .from("v_certificate_eligibility")
    .select("*")
    .eq("schedule_id", scheduleId)
    .eq("participant_id", participantId)
    .maybeSingle();
  if (!elig) return "not-found";
  const row = elig as EligibilityRow;
  if (!row.eligible) return row.ineligibility_reason ?? "not-eligible";

  const profile = await getCurrentProfile();
  const result = await insertEligibleCertificate(supabase, row, profile?.id ?? null);
  if (result === "ok") revalidatePath("/admin/certificates");
  return result;
}

/**
 * Bulk generate for every eligible, not-yet-certified participant on a
 * schedule. Fetches eligibility once (the view already carries
 * existing_certificate_id, so no separate "who's already certified" query
 * is needed) and inserts one row per participant — certificate numbers are
 * assigned by a per-row BEFORE INSERT trigger (public.certificate_number_seq),
 * so correctness requires one insert per row here rather than a batched
 * multi-row insert.
 */
export async function bulkGenerate(scheduleId: string): Promise<{ generated: number; skipped: number }> {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();

  const { data: rows } = await supabase.from("v_certificate_eligibility").select("*").eq("schedule_id", scheduleId);
  const eligibleRows = ((rows ?? []) as EligibilityRow[]).filter((r) => r.eligible);

  const profile = await getCurrentProfile();

  let generated = 0, skipped = 0;
  for (const row of eligibleRows) {
    const result = await insertEligibleCertificate(supabase, row, profile?.id ?? null);
    if (result === "ok") generated++; else skipped++;
  }

  revalidatePath("/admin/certificates");
  return { generated, skipped };
}

export async function revokeCertificate(id: string, formData?: FormData) {
  await requireCertificate(true);
  const remarks = formData ? String(formData.get("remarks") ?? "").trim() : "";
  const supabase = await createSupabaseServerClient();
  await supabase.from("certificates").update({ status: "revoked", remarks: remarks || null }).eq("id", id);
  revalidatePath("/admin/certificates");
  revalidatePath(`/admin/certificates/${id}`);
}

export async function reissueCertificate(id: string) {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();
  await supabase.from("certificates").update({ status: "valid", issue_date: new Date().toISOString().slice(0, 10) }).eq("id", id);
  revalidatePath("/admin/certificates");
  revalidatePath(`/admin/certificates/${id}`);
}

/** Duplicate — new cert (new number + token) for the same holder. */
export async function duplicateCertificate(id: string) {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();
  const { data: src } = await supabase.from("certificates").select("*").eq("id", id).single();
  if (!src) return;
  const s: any = src;
  const profile = await getCurrentProfile();
  const { data: created } = await supabase
    .from("certificates")
    .insert({
      participant_id: s.participant_id, schedule_id: s.schedule_id, course_id: s.course_id,
      template_id: s.template_id, holder_name: s.holder_name, status: "draft",
      issue_date: new Date().toISOString().slice(0, 10), issued_by: profile?.id ?? null,
      expiry_date: s.expiry_date, remarks: s.remarks,
    })
    .select("id, verification_token")
    .single();

  // Stamp verification_url now that we have the new token — matches
  // generateCertificate's pattern. Without this, the duplicate's QR code
  // encodes an unresolvable relative path (BUG_REPORT.md BUG-27).
  if (created) {
    const origin = await siteOrigin();
    await supabase.from("certificates").update({ verification_url: `${origin}/verify/${created.verification_token}` }).eq("id", created.id);
  }

  revalidatePath("/admin/certificates");
}

export async function updateCertificateMeta(id: string, formData: FormData) {
  await requireCertificate(true);
  const expiry = String(formData.get("expiry_date") ?? "").trim();
  const remarks = String(formData.get("remarks") ?? "").trim();
  const supabase = await createSupabaseServerClient();
  await supabase.from("certificates").update({ expiry_date: expiry || null, remarks: remarks || null }).eq("id", id);
  revalidatePath(`/admin/certificates/${id}`);
}

export async function softDeleteCertificate(id: string) {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();
  await supabase.from("certificates").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/certificates");
}

export async function restoreCertificate(id: string) {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();
  await supabase.from("certificates").update({ deleted_at: null }).eq("id", id);
  revalidatePath("/admin/certificates");
}

/** Regenerate the verification token (invalidates old QR/links). */
export async function regenerateVerificationToken(id: string) {
  await requireCertificate(true);
  const { randomBytes } = await import("crypto");
  const token = randomBytes(16).toString("hex");
  const origin = await siteOrigin();
  const supabase = await createSupabaseServerClient();
  await supabase.from("certificates").update({ verification_token: token, verification_url: `${origin}/verify/${token}` }).eq("id", id);
  revalidatePath(`/admin/certificates/${id}`);
}

/** Enable / disable public verification for this certificate. */
export async function setVerificationEnabled(id: string, enabled: boolean) {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();
  await supabase.from("certificates").update({ verification_enabled: enabled }).eq("id", id);
  revalidatePath(`/admin/certificates/${id}`);
}
