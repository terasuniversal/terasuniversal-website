import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { siteOrigin } from "../../../../lib/site-origin";
import { generateQrSvg, formatHumanDate } from "../../../../lib/certificate-format";
import type { CertData, TemplateConfig } from "../../../../components/admin/CertificateDocument";

// Delegates to the same UTC-safe, round-trip-validated parser the renderers
// use (lib/certificate-format.ts) — this file previously used
// `new Date(d).toLocaleDateString(...)` directly, which formats in the
// server's local timezone and can shift a date-only value like
// "2026-07-12" back a day in any timezone west of UTC.
function fmtDate(d?: string | null): string | null {
  return d ? formatHumanDate(d) : null;
}

/**
 * Participant-specific skills-record rows for the certificate's back page.
 * Only "Attendance Requirement" is provable from live data today (via the
 * same v_certificate_eligibility view that gates certificate generation —
 * reused here, not reimplemented); the other four areas have no per-area
 * data source in attendance/assessments (see DATABASE_AUDIT.md discussion),
 * so they stay "Not Recorded" rather than being inferred from the single
 * combined assessment result. Returns null (never fabricates) when the
 * certificate has no schedule/participant link or the lookup fails/finds
 * no row — callers must treat null as "fall through to template config".
 */
async function buildParticipantSkillsRecord(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  scheduleId: string | null | undefined,
  participantId: string | null | undefined
): Promise<{ area: string; status: string }[] | null> {
  if (!scheduleId || !participantId) return null;
  try {
    const { data: elig, error } = await supabase
      .from("v_certificate_eligibility")
      .select("attendance_satisfied")
      .eq("schedule_id", scheduleId)
      .eq("participant_id", participantId)
      .maybeSingle();
    if (error || !elig) return null;
    return [
      { area: "Theory Session", status: "Not Recorded" },
      { area: "Practical Training", status: "Not Recorded" },
      { area: "Safety Awareness", status: "Not Recorded" },
      { area: "Practical Assessment", status: "Not Recorded" },
      { area: "Attendance Requirement", status: elig.attendance_satisfied ? "Met" : "Not Met" },
    ];
  } catch {
    return null;
  }
}

/** Loads a certificate + its template + related data for rendering. */
export async function loadCertificateRender(id: string): Promise<
  | { cert: any; data: CertData; config: TemplateConfig }
  | null
> {
  const supabase = await createSupabaseServerClient();
  // NOTE: the `training_schedules` embed (schedule venue/trainer/signature
  // integration) is intentionally omitted — that table doesn't exist yet
  // (Module 10 / Schedules is not fixed as of this pass). A PostgREST
  // embedded-relationship select against a nonexistent table fails the
  // whole query rather than degrading gracefully, so it must stay out
  // until Schedules lands. Restore it then. `certificates`/`courses`/
  // `participants`/`certificate_templates` are all confirmed live
  // (re-verified against the connected project) with real FKs.
  const { data: cert } = await supabase
    .from("certificates")
    .select("*, courses(title, duration), participants(participant_id, ic_passport_no), certificate_templates(config)")
    .eq("id", id)
    .single();
  if (!cert) return null;

  const c = cert as any;
  let tpl = c.certificate_templates as { config?: TemplateConfig } | null;

  // The great majority of live certificates have template_id = null (issued
  // before per-course template assignment existed), which would otherwise
  // mean they render with an empty config. Fall back to the active default
  // template so customizing it actually takes effect — but a template with a
  // named design_variant (currently only Template A,
  // "professional_scaffold_erection_skills") is scoped to one specific
  // course and must never be picked here, or every other course's
  // null-template-id certificate would silently render as a Scaffold
  // Erection certificate the moment that template's is_default/is_active
  // flags line up. Only a truly generic template (no design_variant) is
  // eligible as this blind fallback.
  if (!tpl) {
    const { data: def } = await supabase
      .from("certificate_templates")
      .select("config")
      .eq("is_default", true)
      .eq("is_active", true)
      .is("deleted_at", null)
      .filter("config->>design_variant", "is", null)
      .limit(1)
      .maybeSingle();
    tpl = def ?? null;
  }
  const config: TemplateConfig = { ...((tpl?.config as TemplateConfig) ?? {}) };

  const certificateNumber: string = c.certificate_number || c.certificate_no;
  const origin = await siteOrigin();
  // Prefer the certificate's own stored verification_url — issuance
  // (app/admin/(protected)/certificates/actions.ts) sets this from
  // verification_token at insert time, and verify_and_log's p_method:'auto'
  // matches on either token or certificate_number, so both resolve the same
  // way. Only build a fresh one from the certificate number for the many
  // legacy rows issued before verification_token/verification_url existed.
  const verificationUrl: string | null =
    c.verification_url || (certificateNumber ? `${origin}/verify/${encodeURIComponent(certificateNumber)}` : null);

  // Generated once here (not as an <img> pointed at a third-party API) so it
  // renders identically in the browser preview, the print/PDF page, and the
  // ZIP export — see generateQrSvg's own comment for why the external-API
  // approach was silently broken by this app's CSP.
  const qrSvg = config.show_qr !== false && verificationUrl ? await generateQrSvg(verificationUrl, config.primary_color || "#0B3A63") : null;

  // c.participant_id is the raw uuid FK on `certificates` (distinct from
  // c.participants?.participant_id below, which is the joined participant's
  // display code like "TU-000158") — the eligibility view keys on the uuid.
  const participantSkillsRecord = await buildParticipantSkillsRecord(supabase, c.schedule_id, c.participant_id);

  const data: CertData = {
    certificate_number: certificateNumber,
    holder_name: c.holder_name || c.participant_name,
    course_name: c.course_name ?? c.courses?.title ?? null,
    programme_duration: c.courses?.duration ?? null,
    ic_passport: c.identity_no ?? c.participants?.ic_passport_no ?? null,
    participant_id: c.participants?.participant_id ?? null,
    training_date: fmtDate(c.training_start_date),
    training_end_date: fmtDate(c.training_end_date),
    venue: c.venue ?? null,
    trainer: c.trainer_name ?? c.instructor ?? null,
    issue_date: fmtDate(c.issue_date),
    // verify_and_log (the canonical verification RPC — see app/verify/*)
    // matches on either verification_token or certificate_number, so the
    // stored verification_url (built from the token at issuance) and a
    // number-based fallback both resolve correctly here.
    verification_url: verificationUrl,
    qr_svg: qrSvg,
    participant_skills_record: participantSkillsRecord,
  };
  return { cert, data, config };
}
