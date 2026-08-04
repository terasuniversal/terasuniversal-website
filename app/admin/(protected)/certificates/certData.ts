import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import type { CertData, TemplateConfig } from "../../../../components/admin/CertificateDocument";

/** Loads a certificate + its template + related data for rendering. */
export async function loadCertificateRender(id: string): Promise<
  | { cert: any; data: CertData; config: TemplateConfig; orientation: string }
  | null
> {
  const supabase = await createSupabaseServerClient();
  const { data: cert } = await supabase
    .from("certificates")
    .select("*, courses(title), participants(ic_passport_no), training_schedules(start_date, venue, trainer, trainers(full_name, signature_image)), certificate_templates(orientation, config)")
    .eq("id", id)
    .single();
  if (!cert) return null;

  const tpl = (cert as any).certificate_templates;
  const config: TemplateConfig = { ...((tpl?.config as TemplateConfig) ?? {}) };
  const orientation: string = tpl?.orientation ?? "landscape";
  const sched = (cert as any).training_schedules;

  // Integration: if the schedule's trainer has a signature, use it on the cert.
  const trainer = sched?.trainers;
  if (trainer?.signature_image) config.signature_url = trainer.signature_image;
  if (trainer?.full_name) config.signature_name = trainer.full_name;

  const data: CertData = {
    certificate_number: cert.certificate_number,
    holder_name: cert.holder_name,
    course_name: (cert as any).courses?.title ?? null,
    ic_passport: (cert as any).participants?.ic_passport_no ?? null,
    training_date: sched?.start_date ? new Date(sched.start_date).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" }) : null,
    venue: sched?.venue ?? null,
    trainer: sched?.trainer ?? null,
    issue_date: cert.issue_date ? new Date(cert.issue_date).toLocaleDateString("en-MY", { day: "numeric", month: "long", year: "numeric" }) : null,
    verification_url: cert.verification_url,
    verification_token: cert.verification_token,
  };
  return { cert, data, config, orientation };
}
