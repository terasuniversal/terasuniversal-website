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

const CERT_SKILL_AREA_LABELS: Record<string, string> = {
  theory_session: "Theory Session",
  practical_training: "Practical Training",
  safety_awareness: "Safety Awareness",
  practical_assessment: "Practical Assessment",
  attendance_requirement: "Attendance Requirement",
};
const CERT_SKILL_STATUS_LABELS: Record<string, string> = {
  not_recorded: "Not Recorded",
  completed: "Completed",
  passed: "Passed",
  failed: "Failed",
  met: "Met",
  not_met: "Not Met",
};
/**
 * Reading order of the Participant Skills Record table. Both builders below
 * sort by this rather than by the `area` key, which is why it exists: the
 * snapshot builder previously ordered alphabetically, so a snapshot-backed
 * certificate would have listed Attendance Requirement first and Theory
 * Session last — a different row order from every other code path's
 * (chronological) one. Not visible in production yet only because
 * certificate_skill_results is still empty.
 */
const CERT_SKILL_AREA_ORDER = [
  "theory_session",
  "practical_training",
  "safety_awareness",
  "practical_assessment",
  "attendance_requirement",
] as const;

/**
 * LEGACY FALLBACK ONLY — used for certificates that have no immutable
 * certificate_skill_results snapshot of their own (every certificate issued
 * before Phase 2C, which today is all of them). A Phase-2C-issued certificate
 * never reaches this function; see loadCertificateRender's precedence.
 *
 * Reads the per-area statuses staff actually recorded in
 * participant_skill_results (the Assessment module's Participant Skills Record
 * form — app/admin/(protected)/assessment/actions.ts), which is the same table
 * app.issue_certificate_with_skill_snapshot snapshots from. This function used
 * to hardcode all four areas to "Not Recorded" on the premise that no per-area
 * source existed; that premise is simply out of date — the table has been
 * populated since Phase 2B, so real recorded results were being thrown away
 * and the back page under-reported completed training.
 *
 * Statuses are read, never derived: a combined assessment's pass/competent
 * result is NOT mapped onto these four areas here. Inferring them would
 * overwrite explicitly recorded staff input with a guess, and would invent a
 * per-area result the assessor never entered. An area with no row stays
 * "Not Recorded".
 *
 * Returns null (never fabricates) only when there is no evidence at all —
 * no schedule/participant link, or neither table yields anything — so callers
 * fall through to the template config's own default rows.
 */
async function buildParticipantSkillsRecord(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  scheduleId: string | null | undefined,
  participantId: string | null | undefined
): Promise<{ area: string; status: string }[] | null> {
  if (!scheduleId || !participantId) return null;
  try {
    const [skills, eligibility] = await Promise.all([
      supabase
        .from("participant_skill_results")
        .select("area, status")
        .eq("schedule_id", scheduleId)
        .eq("participant_id", participantId)
        .is("deleted_at", null),
      supabase
        .from("v_certificate_eligibility")
        .select("attendance_satisfied")
        .eq("schedule_id", scheduleId)
        .eq("participant_id", participantId)
        .maybeSingle(),
    ]);

    if (skills.error) {
      console.error("certData: participant_skill_results lookup failed", { scheduleId, message: skills.error.message });
    }
    if (eligibility.error) {
      console.error("certData: v_certificate_eligibility lookup failed", { scheduleId, message: eligibility.error.message });
    }

    const recorded = new Map<string, string>();
    for (const row of (skills.data ?? []) as { area: string; status: string }[]) {
      recorded.set(row.area, row.status);
    }
    const elig = eligibility.error ? null : eligibility.data;

    // No usable evidence from either source — stay out of the way rather than
    // rendering five "Not Recorded" rows over a template's own configured ones.
    if (recorded.size === 0 && !elig) return null;

    return CERT_SKILL_AREA_ORDER.map((area) => {
      if (area === "attendance_requirement") {
        const status = !elig || elig.attendance_satisfied === null || elig.attendance_satisfied === undefined
          ? "not_recorded"
          : elig.attendance_satisfied
            ? "met"
            : "not_met";
        return { area: CERT_SKILL_AREA_LABELS[area], status: CERT_SKILL_STATUS_LABELS[status] };
      }
      const raw = recorded.get(area) ?? "not_recorded";
      return { area: CERT_SKILL_AREA_LABELS[area], status: CERT_SKILL_STATUS_LABELS[raw] ?? raw };
    });
  } catch (err) {
    console.error("certData: participant skills record build threw", { scheduleId, err });
    return null;
  }
}

/**
 * Immutable issuance snapshot (Phase 2C) for the certificate's own id — the
 * authoritative source once it exists; see CertData.certificate_skills_record.
 * Keyed strictly by certificate_id, never by schedule/participant, so a
 * duplicated certificate reads its own copied rows rather than the source's.
 * Returns null (never synthesizes rows) when the certificate has zero
 * snapshot rows — legacy/pre-Phase-2C certificates — or if the query itself
 * fails; either case must fall through to buildParticipantSkillsRecord below,
 * never to a fabricated Completed/Passed value.
 */
async function buildCertificateSkillsRecord(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  certificateId: string
): Promise<{ area: string; status: string }[] | null> {
  try {
    const { data, error } = await supabase
      .from("certificate_skill_results")
      .select("area, status")
      .eq("certificate_id", certificateId);
    if (error) {
      console.error("certData: certificate_skill_results lookup failed", { certificateId, message: error.message });
      return null;
    }
    if (!data || data.length === 0) return null;
    // Sorted by reading order, not by `area` — see CERT_SKILL_AREA_ORDER. Any
    // area outside the known set keeps its row and lands after the known ones
    // rather than being silently dropped.
    const rank = (area: string) => {
      const i = CERT_SKILL_AREA_ORDER.indexOf(area as (typeof CERT_SKILL_AREA_ORDER)[number]);
      return i === -1 ? CERT_SKILL_AREA_ORDER.length : i;
    };
    return (data as { area: string; status: string }[])
      .slice()
      .sort((a, b) => rank(a.area) - rank(b.area) || a.area.localeCompare(b.area))
      .map((row) => ({
        area: CERT_SKILL_AREA_LABELS[row.area] ?? row.area,
        status: CERT_SKILL_STATUS_LABELS[row.status] ?? row.status,
      }));
  } catch (err) {
    console.error("certData: certificate_skill_results lookup threw", { certificateId, err });
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
  const certificateSkillsRecord = await buildCertificateSkillsRecord(supabase, c.id);
  // Only queried when there's no snapshot to use instead — a Phase-2C-issued
  // certificate never needs this live lookup at all.
  const participantSkillsRecord = certificateSkillsRecord
    ? null
    : await buildParticipantSkillsRecord(supabase, c.schedule_id, c.participant_id);

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
    certificate_skills_record: certificateSkillsRecord,
    participant_skills_record: participantSkillsRecord,
  };
  return { cert, data, config };
}
