import { CertificateDocument, CertificateBackPage, CertificateBodyTextContinuationPages, type CertData, type TemplateConfig } from "./CertificateDocument";


/**
 * Single dispatch point for the TERAS certificate master layout. Course
 * variants change data and the resolved course-family line-art, not the
 * certificate's page structure. Every admin surface that renders a
 * certificate should use this shared front/back pair.
 */
export function CertificateFront({ data, config }: { data: CertData; config: TemplateConfig }) {
  return <CertificateDocument data={data} config={config} />;
}

export function CertificateBack({ data, config }: { data: CertData; config: TemplateConfig }) {
  return <>
    <CertificateBackPage data={data} config={config} />
    <CertificateBodyTextContinuationPages data={data} config={config} />
  </>;
}
