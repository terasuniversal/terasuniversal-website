"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireCertificate } from "../../../../lib/auth/session";
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
 * Inserts one certificate from an already-fetched, already-eligible row, via
 * the atomic app.issue_certificate_with_skill_snapshot RPC (Phase 2C — see
 * supabase/migrations/20260811100000_certificate_skill_results_and_issuance_rpc.sql).
 * Not exported. `elig` is used only to resolve the certificate-number prefix
 * here; the RPC itself re-reads v_certificate_eligibility fresh, inside its
 * own transaction, and is the actual authority on eligibility and on every
 * training-date/venue/trainer/course field — this function no longer trusts
 * `elig`'s copy of those for the write itself, closing the race between this
 * read and the insert. The RPC also derives `issued_by` from auth.uid()
 * server-side rather than a caller-supplied value.
 */
async function insertEligibleCertificate(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  elig: EligibilityRow
): Promise<string> {
  const { data: tmpl } = await supabase
    .from("certificate_templates")
    .select("config")
    .eq("id", elig.certificate_template_id)
    .maybeSingle();
  const prefix = (tmpl?.config as { certificate_number_prefix?: string } | null)?.certificate_number_prefix;
  const certificateNumber = prefix ? await nextPrefixedCertificateNumber(supabase, prefix) : null;

  const { data, error } = await supabase.rpc("issue_certificate_with_skill_snapshot" as never, {
    p_schedule_id: elig.schedule_id,
    p_participant_id: elig.participant_id,
    p_certificate_number: certificateNumber,
  } as never);

  if (error) {
    // certificates_active_schedule_participant_uniq is the real guard against
    // a race between two concurrent issuance calls for the same pair —
    // surface it as "exists", not a raw constraint-name error. The RPC's own
    // fresh eligibility re-check (closing the TS-read-to-write race) raises a
    // distinct "Not eligible" error, mapped to "not-eligible" here.
    const code = (error as { code?: string }).code;
    if (code === "23505") return "exists";
    if (error.message?.includes("Not eligible")) return "not-eligible";
    return error.message;
  }

  const created = (data as { id: string; verification_token: string }[] | null)?.[0];
  if (!created) return "error";

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

  const result = await insertEligibleCertificate(supabase, row);
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

  let generated = 0, skipped = 0;
  for (const row of eligibleRows) {
    const result = await insertEligibleCertificate(supabase, row);
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

/**
 * Duplicate — new cert (new number + token) for the same holder, plus a
 * verbatim copy of the source certificate's certificate_skill_results
 * snapshot rows, atomically via app.duplicate_certificate_with_skill_snapshot
 * (Phase 2C). Never re-derives skill results from current
 * participant_skill_results — a duplicate must preserve what the source
 * certificate recorded at its own original issuance, not today's data. If
 * the source has no snapshot rows (pre-Phase-2C or legacy), the duplicate
 * simply gets none either — nothing is fabricated.
 */
export async function duplicateCertificate(id: string) {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("duplicate_certificate_with_skill_snapshot" as never, {
    p_source_certificate_id: id,
  } as never);
  if (error) return;
  const created = (data as { id: string; verification_token: string }[] | null)?.[0];

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
