import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { siteOrigin } from "../../../../lib/site-origin";
import { generateQrSvg } from "../../../../lib/certificate-format";
import type { CertData, TemplateConfig } from "../../../../components/admin/CertificateDocument";

function fmtDate(d?: string | null): string | null {
  return d ? new Date(d).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" }) : null;
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

  // Every live certificate currently has template_id = null (the template
  // system was never wired up to actual generation), which would otherwise
  // mean every certificate renders with an empty config. Fall back to the
  // active default template so customizing it actually takes effect.
  if (!tpl) {
    const { data: def } = await supabase
      .from("certificate_templates")
      .select("config")
      .eq("is_default", true)
      .eq("is_active", true)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    tpl = def ?? null;
  }
  const config: TemplateConfig = { ...((tpl?.config as TemplateConfig) ?? {}) };

  const certificateNumber: string = c.certificate_number || c.certificate_no;
  const origin = await siteOrigin();
  const verificationUrl = certificateNumber ? `${origin}/verify/${encodeURIComponent(certificateNumber)}` : null;

  // Generated once here (not as an <img> pointed at a third-party API) so it
  // renders identically in the browser preview, the print/PDF page, and the
  // ZIP export — see generateQrSvg's own comment for why the external-API
  // approach was silently broken by this app's CSP.
  const qrSvg = config.show_qr !== false && verificationUrl ? await generateQrSvg(verificationUrl, config.primary_color || "#0B3A63") : null;

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
    // The real, working verification route matches on certificate_number
    // (verify_and_log RPC) — verification_token/verification_url are null
    // on every live certificate today, so the QR must be built from the
    // number, not those columns.
    verification_url: verificationUrl,
    qr_svg: qrSvg,
  };
  return { cert, data, config };
}
