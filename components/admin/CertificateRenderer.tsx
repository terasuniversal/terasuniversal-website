import { CertificateDocument, CertificateBackPage, type CertData, type TemplateConfig } from "./CertificateDocument";
import { ProfessionalScaffoldCertificateDocument, ProfessionalScaffoldCertificateBackPage } from "./ProfessionalScaffoldCertificateDocument";

/**
 * Single dispatch point for which certificate design renders a given
 * template — keyed by `config.design_variant`, never by course name/title
 * matching. Every admin surface that renders a certificate (PDF/print page,
 * certificate detail preview, template editor live preview) should go
 * through this instead of importing CertificateDocument directly, so a new
 * design variant only has to be wired here once.
 */
export function CertificateFront({ data, config }: { data: CertData; config: TemplateConfig }) {
  if (config.design_variant === "professional_scaffold_erection_skills") {
    return <ProfessionalScaffoldCertificateDocument data={data} config={config} />;
  }
  return <CertificateDocument data={data} config={config} />;
}

export function CertificateBack({ data, config }: { data: CertData; config: TemplateConfig }) {
  if (config.design_variant === "professional_scaffold_erection_skills") {
    return <ProfessionalScaffoldCertificateBackPage data={data} config={config} />;
  }
  return <CertificateBackPage data={data} config={config} />;
}
