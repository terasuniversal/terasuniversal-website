"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { requireCertificate, getCurrentProfile } from "../../../../lib/auth/session";

/** Best-effort site origin for building verification URLs. */
async function siteOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : (process.env.NEXT_PUBLIC_SITE_URL || "https://terasuniversal.com.my");
}

/**
 * Generate a certificate for ONE participant on a schedule — only if they are
 * eligible (attendance = present, result = pass, competency = competent).
 * Returns a short status string.
 */
export async function generateCertificate(scheduleId: string, participantId: string): Promise<string> {
  await requireCertificate(true); // admin+
  const supabase = await createSupabaseServerClient();

  // Eligibility check via the DB view (single source of truth).
  const { data: elig } = await supabase
    .from("v_certificate_eligibility")
    .select("*")
    .eq("schedule_id", scheduleId)
    .eq("participant_id", participantId)
    .single();
  if (!elig) return "not-found";
  if (!elig.eligible) return "not-eligible";

  // Skip if a live certificate already exists for this pair.
  const { data: existing } = await supabase
    .from("certificates")
    .select("id")
    .eq("schedule_id", scheduleId)
    .eq("participant_id", participantId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing) return "exists";

  const profile = await getCurrentProfile();
  const { data: tpl } = await supabase.from("certificate_templates").select("id").eq("is_default", true).is("deleted_at", null).maybeSingle();

  const { data: created, error } = await supabase
    .from("certificates")
    .insert({
      participant_id: participantId,
      schedule_id: scheduleId,
      course_id: elig.course_id,
      template_id: tpl?.id ?? null,
      holder_name: elig.holder_name,
      status: "issued",
      issue_date: new Date().toISOString().slice(0, 10),
      issued_by: profile?.id ?? null,
    })
    .select("id, verification_token")
    .single();
  if (error) return error.message;

  // Stamp verification_url now that we have the token.
  const origin = await siteOrigin();
  await supabase.from("certificates").update({ verification_url: `${origin}/verify/${created.verification_token}` }).eq("id", created.id);

  revalidatePath("/admin/certificates");
  return "ok";
}

/** Bulk generate for every eligible, not-yet-certified participant. */
export async function bulkGenerate(scheduleId: string): Promise<{ generated: number; skipped: number }> {
  await requireCertificate(true);
  const supabase = await createSupabaseServerClient();
  const { data: eligible } = await supabase
    .from("v_certificate_eligibility")
    .select("participant_id")
    .eq("schedule_id", scheduleId)
    .eq("eligible", true);

  let generated = 0, skipped = 0;
  for (const row of eligible ?? []) {
    const res = await generateCertificate(scheduleId, (row as any).participant_id);
    if (res === "ok") generated++; else skipped++;
  }

  // Record in the Automation Centre.
  await supabase.from("automation_runs").insert({
    run_type: "bulk_certificate",
    status: skipped === 0 ? "success" : "partial",
    summary: `Bulk certificate generation: ${generated} generated, ${skipped} skipped`,
    total_count: (eligible ?? []).length,
    success_count: generated,
    skipped_count: skipped,
    failed_count: 0,
    params: { schedule_id: scheduleId },
    result: {},
  });

  revalidatePath("/admin/certificates");
  revalidatePath("/admin/automation");
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
  await supabase.from("certificates").update({ status: "issued", issue_date: new Date().toISOString().slice(0, 10) }).eq("id", id);
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
  await supabase.from("certificates").insert({
    participant_id: s.participant_id, schedule_id: s.schedule_id, course_id: s.course_id,
    template_id: s.template_id, holder_name: s.holder_name, status: "draft",
    issue_date: new Date().toISOString().slice(0, 10), issued_by: profile?.id ?? null,
    expiry_date: s.expiry_date, remarks: s.remarks,
  });
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
