import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type { CertData, TemplateConfig } from "../../../../components/admin/CertificateDocument";

/** Loads a certificate + its template + related data for rendering. */
export async function loadCertificateRender(id: string): Promise<
  | { cert: any; data: CertData; config: TemplateConfig; orientation: string }
  | null
> {
  const supabase = await createSupabaseServerClient();
  // NOTE: the `training_schedules` embed (schedule venue/trainer/signature
  // integration) is intentionally omitted — that table doesn't exist yet
  // (Module 10 / Schedules is not fixed as of this pass). A PostgREST
  // embedded-relationship select against a nonexistent table fails the
  // whole query rather than degrading gracefully, so it must stay out
  // until Schedules lands. Restore it then.
  const { data: cert } = await supabase
    .from("certificates")
    .select("*, courses(title), participants(ic_passport_no), certificate_templates(orientation, config)")
    .eq("id", id)
    .single();
  if (!cert) return null;

  const tpl = (cert as any).certificate_templates;
  const config: TemplateConfig = { ...((tpl?.config as TemplateConfig) ?? {}) };
  const orientation: string = tpl?.orientation ?? "landscape";

  const data: CertData = {
    certificate_number: cert.certificate_number,
    holder_name: cert.holder_name,
    course_name: (cert as any).courses?.title ?? null,
    ic_passport: (cert as any).participants?.ic_passport_no ?? null,
    training_date: null, // pending Module 10 (Schedules) — see note above
    venue: null, // pending Module 10 (Schedules)
    trainer: null, // pending Module 10 (Schedules)
    issue_date: cert.issue_date ? new Date(cert.issue_date).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" }) : null,
    verification_url: cert.verification_url,
    verification_token: cert.verification_token,
  };
  return { cert, data, config, orientation };
}
