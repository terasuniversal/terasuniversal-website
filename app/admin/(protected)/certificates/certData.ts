import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { siteOrigin } from "../../../../lib/site-origin";
import { generateQrSvg, formatHumanDate } from "../../../../lib/certificate-format";
import { findStandardScaffoldProgrammeByCourseId } from "../../../../lib/standard-scaffold-programmes";
import { findWorkingAtHeightProgrammeByCourseId } from "../../../../lib/working-at-height-programme";
import { resolveCertificateSkills, type CertificateSkillRow } from "../../../../lib/certificate-skills";
import type { GoldenReferenceFamily } from "../../../../lib/certificate-design-system";
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
 * Renderer_version values whose render_payload carries the frozen C4 Golden
 * Reference facts applyGoldenReferenceSnapshotConfig below dispatches on.
 * "c4_wave1_v1" is real and live today -- app.capture_c4_wave1_erector_snapshot()
 * (a BEFORE INSERT trigger on certificate_issuance_snapshots) bumps new
 * Erector issuances to this renderer_version and bakes certificate_family/
 * certificate_title/programme_content/watermark_asset_family into
 * render_payload at that moment, re-verified read-only against the canonical
 * staging project (eokiaehnvzbggmacifcf) 2026-10-31. The other two entries
 * are this app's own PROPOSED, not-yet-written-by-any-trigger contract for
 * an eventual Inspector/WAH equivalent -- listing them here costs nothing
 * (no real snapshot will ever carry one until that trigger exists) but
 * means zero app-code changes are needed once it does.
 */
const GOLDEN_REFERENCE_RENDERER_VERSIONS = new Set([
  "c4_wave1_v1",
  // PROPOSED -- not yet written by any trigger:
  "c4_wave1_inspector_v1",
  "c4_wave1_wah_v1",
]);

interface GoldenReferenceRenderPayload {
  certificate_family?: string;
  certificate_title?: string;
  watermark_asset_family?: string;
  programme_content?: {
    programme_title?: string;
    programme_duration?: string;
    objectives?: string;
    coverage?: string[];
    outcomes?: string[];
    assessment?: string[];
  };
}

/**
 * Populates config's Golden Reference / programme-content fields from a
 * frozen issuance snapshot's renderer_version + render_payload only --
 * never recomputed from current certificate_templates/programme data, so an
 * already-issued certificate's rendering can never change because a
 * programme or template was edited afterwards. A no-op for every
 * renderer_version this file doesn't recognize (legacy/no-snapshot
 * certificates, or a MODERN_SNAPSHOT certificate issued before any C4
 * trigger existed), which is what preserves their historical layout.
 * Exported for scripts/c4-snapshot-renderer-contract.mjs's direct,
 * standalone unit test.
 */
export function applyGoldenReferenceSnapshotConfig(
  config: TemplateConfig,
  rendererVersion: string | null | undefined,
  renderPayload: Record<string, unknown>,
): void {
  if (!rendererVersion || !GOLDEN_REFERENCE_RENDERER_VERSIONS.has(rendererVersion)) return;
  const payload = renderPayload as GoldenReferenceRenderPayload;
  if (!payload.certificate_family || !payload.certificate_title) return;
  config.golden_reference_family = payload.certificate_family as GoldenReferenceFamily;
  config.certificate_title = payload.certificate_title;
  config.show_back_page = true;
  config.show_qr ??= true;
  // Direct assignment, not ??=: the shared certificate_templates row this
  // frozen template_config was copied from at issuance sets
  // show_skills_record:false explicitly (see the !snapshot Standard Scaffold
  // block above), so ??= would never flip it. The table this reveals is
  // backed only by certificateSkillsRecord (certificate_skill_results, an
  // immutable, RPC-only-written table -- never participant_skill_results),
  // resolved above via resolveCertificateSkills() into effectiveSkillsRecord/
  // data.skills -- never recomputed from mutable programme/participant data.
  config.show_skills_record = true;
  config.frozen_watermark_asset_family = payload.watermark_asset_family ?? null;
  const content = payload.programme_content;
  if (content) {
    config.programme_title ??= content.programme_title;
    config.duration_label ??= content.programme_duration;
    config.objectives_text ??= content.objectives;
    config.coverage_items ??= content.coverage;
    config.learning_outcomes ??= content.outcomes;
    config.assessment_methods ??= content.assessment;
  }
}

async function buildCertificateSkillsRecord(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  certificateId: string
): Promise<CertificateSkillRow[]> {
  try {
    const { data, error } = await supabase
      .from("certificate_skill_results")
      .select("area, status")
      .eq("certificate_id", certificateId);
    if (error) throw new Error("Certificate historical skills are unavailable; rendering stopped safely.");
    return (data ?? []) as CertificateSkillRow[];
  } catch (err) {
    console.error("certData: certificate_skill_results lookup threw", { certificateId, err });
    throw new Error("Certificate historical skills are unavailable; rendering stopped safely.");
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
  const { data: issuanceSnapshot, error: snapshotError } = await supabase
    .from("certificate_issuance_snapshots")
    .select("snapshot_version, renderer_version, holder_name, identity_no, identity_last4, course_name, training_start_date, training_end_date, venue, trainer_name, template_id, template_name, template_config, signature_reference, verification_metadata, render_payload, branch_address")
    .eq("certificate_id", c.id)
    .maybeSingle();
  if (snapshotError) {
    console.error("certData: issuance snapshot lookup failed", { certificateId: c.id, message: snapshotError.message });
    throw new Error("Certificate historical snapshot is unavailable; rendering stopped safely.");
  }
  const snapshot = (issuanceSnapshot ?? null) as {
    renderer_version?: string | null;
    holder_name?: string | null;
    identity_no?: string | null;
    course_name?: string | null;
    training_start_date?: string | null;
    training_end_date?: string | null;
    venue?: string | null;
    trainer_name?: string | null;
    template_config?: TemplateConfig | null;
    signature_reference?: string | null;
    verification_metadata?: Record<string, unknown> | null;
    render_payload?: Record<string, unknown> | null;
    branch_address?: string | null;
  } | null;
  const renderMode = snapshot ? "MODERN_SNAPSHOT" : "LEGACY_FALLBACK";
  // Issuing branch's registered address, as an authoritative historical fact.
  // MODERN_SNAPSHOT: only the frozen snapshot row's own branch_address --
  // deliberately never falls through to the live `certificates` row or to
  // certificate_branches if the snapshot's own value is missing, so a
  // snapshot-backed certificate can never silently acquire an address from a
  // different (mutable or legacy) source. LEGACY_FALLBACK: the base
  // certificates row's own branch_address, captured at that certificate's
  // own (pre-snapshot) issuance -- not recomputed from current branch
  // settings either.
  const issuerBranchAddress: string | null = snapshot
    ? (snapshot.branch_address ?? null)
    : (c.branch_address ?? null);
  let tpl = snapshot
    ? { config: snapshot.template_config ?? {} }
    : c.certificate_templates as { config?: TemplateConfig } | null;

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
  if (!snapshot && !tpl) {
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
  if (snapshot?.signature_reference) config.signature_url = snapshot.signature_reference;

  // Standard Scaffold family: the shared certificate_templates row deliberately
  // holds no per-programme content of its own (see
  // lib/standard-scaffold-programmes.ts's header) -- it's merged in here by the
  // certificate's own course_id, filling only fields the template row didn't
  // already set so a future per-template override still wins. Re-verified live
  // 2026-08-23: the "TERAS Standard Scaffold Certificate" template row exists,
  // is active (design_variant set, show_skills_record:false), and all 6
  // Erector/Inspection course rows have their certificate_template_id bound to
  // it -- this branch IS reachable today, not merely "in principle". Scaffold
  // Awareness has no live course row at all, so it can never bind. Course-level
  // certificate_generation_enabled remains independently programme-specific
  // (only Basic and Advanced Erector have it on as of this check) and is
  // untouched by this merge -- binding a template is separate from enabling
  // generation from it.
  if (!snapshot && config.design_variant === "standard_scaffold_certificate") {
    const programme = findStandardScaffoldProgrammeByCourseId(c.course_id);
    if (programme) {
      config.programme_title ??= programme.programme_title;
      config.duration_label ??= programme.duration_label;
      config.objectives_text ??= programme.objectives_text;
      config.coverage_items ??= programme.coverage_items;
      config.learning_outcomes ??= programme.learning_outcomes;
      config.assessment_methods ??= programme.assessment_methods;
      // watermark_level is set only on the 3 Erector programmes; unset for
      // Inspection/Awareness, so ??= leaves those courses' front/back-page
      // motif exactly as before. inspector_watermark_level is the mirror of
      // this for the 3 Inspection programmes, and is never set alongside
      // watermark_level on the same entry -- the two families are mutually
      // exclusive per lib/standard-scaffold-programmes.ts's own comment.
      config.watermark_level ??= programme.watermark_level;
      config.inspector_watermark_level ??= programme.inspector_watermark_level;
      // Skills Record Phase 1 (approved 2026-08-23): only the 6
      // Erector/Inspector programmes carry a skills_record (derived from
      // their own coverage_items -- see standard-scaffold-programmes.ts),
      // so this is gated on that rather than running unconditionally --
      // Scaffold Awareness has none and must stay untouched.
      //
      // show_skills_record needs a direct assignment here, not ??=: the
      // single shared certificate_templates row sets show_skills_record:false
      // explicitly for all 7 programmes alike (re-verified live 2026-08-23),
      // so ??= against an already-false value would be a no-op and could
      // never turn display on per-programme. This does not touch
      // data.certificate_skills_record / data.participant_skills_record
      // (tiers 1-2, built independently below from certificate_skill_results /
      // participant_skill_results) -- the renderer's own precedence ternary
      // always checks those first, so a real recorded result can never be
      // masked by this static fallback.
      if (programme.skills_record) {
        config.skills_record ??= programme.skills_record;
        config.show_skills_record = true;
      }
    }
  }

  // Working at Height family: same fill-if-absent merge pattern as Standard
  // Scaffold above, by the certificate's own course_id. content_status is
  // "verified" in lib/working-at-height-programme.ts (business-approved
  // 2026-08-21). Inert today: no live certificate_templates row has this
  // design_variant yet (no migration has been created or applied for this
  // family).
  if (!snapshot && config.design_variant === "working_at_height_certificate") {
    const programme = findWorkingAtHeightProgrammeByCourseId(c.course_id);
    if (programme) {
      config.programme_title ??= programme.programme_title;
      config.duration_label ??= programme.duration_label;
      config.objectives_text ??= programme.objectives_text;
      config.coverage_items ??= programme.coverage_items;
      config.learning_outcomes ??= programme.learning_outcomes;
      config.assessment_methods ??= programme.assessment_methods;
    }
    // The harness/lanyard/anchorage watermark is a property of the design_variant
    // itself, not per-programme content, so it's set here unconditionally
    // (not inside the `if (programme)` block above) — see
    // lib/certificate-watermarks.ts's workingAtHeightWatermarkShapes().
    config.wah_watermark ??= true;
  }

  const verificationMetadata = snapshot?.verification_metadata ?? {};
  const renderPayload = snapshot?.render_payload ?? {};
  applyGoldenReferenceSnapshotConfig(config, snapshot?.renderer_version, renderPayload);

  const certificateNumber: string = String(
    verificationMetadata.certificate_number ?? renderPayload.certificate_number ?? c.certificate_number ?? c.certificate_no ?? ""
  );
  const origin = await siteOrigin();
  // Prefer the certificate's own stored verification_url — issuance
  // (app/admin/(protected)/certificates/actions.ts) sets this from
  // verification_token at insert time, and verify_and_log's p_method:'auto'
  // matches on either token or certificate_number, so both resolve the same
  // way. Only build a fresh one from the certificate number for the many
  // legacy rows issued before verification_token/verification_url existed.
  const storedVerificationPath = typeof verificationMetadata.verification_path === "string" ? verificationMetadata.verification_path : null;
  const verificationUrl: string | null = snapshot
    ? (storedVerificationPath
      ? (storedVerificationPath.startsWith("http") ? storedVerificationPath : `${origin}${storedVerificationPath}`)
      : (certificateNumber ? `${origin}/verify/${encodeURIComponent(certificateNumber)}` : null))
    : (c.verification_url || (certificateNumber ? `${origin}/verify/${encodeURIComponent(certificateNumber)}` : null));

  // Generated once here (not as an <img> pointed at a third-party API) so it
  // renders identically in the browser preview, the print/PDF page, and the
  // ZIP export — see generateQrSvg's own comment for why the external-API
  // approach was silently broken by this app's CSP.
  const qrSvg = config.show_qr !== false && verificationUrl ? await generateQrSvg(verificationUrl, config.primary_color || "#0B3A63") : null;

  // c.participant_id is the raw uuid FK on `certificates` (distinct from
  // c.participants?.participant_id below, which is the joined participant's
  // display code like "TU-000158") — the eligibility view keys on the uuid.
  const certificateSkillsRecord = await buildCertificateSkillsRecord(supabase, c.id);
  const skillsResolution = resolveCertificateSkills(Boolean(snapshot), certificateSkillsRecord);

  const data: CertData = {
    render_mode: renderMode,
    skills_provenance: skillsResolution.provenance,
    skills_completeness: skillsResolution.completeness,
    renderer_version: snapshot?.renderer_version ?? null,
    certificate_number: certificateNumber,
    holder_name: snapshot?.holder_name ?? c.holder_name ?? c.participant_name,
    course_name: snapshot?.course_name ?? c.course_name ?? c.courses?.title ?? null,
    programme_duration: snapshot
      ? (typeof renderPayload.programme_duration === "string" ? renderPayload.programme_duration : config.duration_label ?? null)
      : c.courses?.duration ?? null,
    ic_passport: snapshot?.identity_no ?? c.identity_no ?? c.participants?.ic_passport_no ?? null,
    participant_id: c.participants?.participant_id ?? null,
    training_date: fmtDate(snapshot?.training_start_date ?? c.training_start_date),
    training_end_date: fmtDate(snapshot?.training_end_date ?? c.training_end_date),
    venue: snapshot?.venue ?? c.venue ?? null,
    trainer: snapshot?.trainer_name ?? c.trainer_name ?? c.instructor ?? null,
    issue_date: fmtDate(typeof renderPayload.issue_date === "string" ? renderPayload.issue_date : c.issue_date),
    // verify_and_log (the canonical verification RPC — see app/verify/*)
    // matches on either verification_token or certificate_number, so the
    // stored verification_url (built from the token at issuance) and a
    // number-based fallback both resolve correctly here.
    verification_url: verificationUrl,
    qr_svg: qrSvg,
    certificate_skills_record: certificateSkillsRecord,
    participant_skills_record: null,
    effective_skills_record: skillsResolution.skills,
    skills: skillsResolution.skills,
    issuer_branch_address: issuerBranchAddress,
  };
  return { cert, data, config };
}
