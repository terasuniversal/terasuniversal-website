import { notFound } from "next/navigation";
import SiteHeader from "../../../components/SiteHeader";
import SiteFooter from "../../../components/SiteFooter";
import PrintButton from "../../../components/PrintButton";
import { certificates, findCertificate } from "../../../data/certificates";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return {
    title: "Certificate Verification Result",
    robots: { index: false, follow: false },
  };
}

function formatDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}

const statusContent = {
  valid: { label: "CERTIFICATE VERIFIED", message: "This certificate is valid and officially recorded by TERAS UNIVERSAL SDN. BHD." },
  expired: { label: "CERTIFICATE EXPIRED", message: "This certificate was officially issued but has passed its validity date." },
  revoked: { label: "CERTIFICATE REVOKED", message: "This certificate is no longer recognised as valid by TERAS UNIVERSAL SDN. BHD." },
};

export default async function CertificateResultPage({ params }) {
  const rawCertificateNo = (await params).certificateNo;
  let certificateNumber;

  try {
    certificateNumber = decodeURIComponent(rawCertificateNo || "").trim().toUpperCase();
  } catch {
    notFound();
  }

  const record = findCertificate(certificates, certificateNumber);

  if (!record || !statusContent[record.status]) notFound();

  const content = statusContent[record.status];
  const trainingStart = formatDate(record.trainingStartDate);
  const trainingEnd = formatDate(record.trainingEndDate);
  const details = [
    ["Participant Name", record.participantName],
    ["Course Name", record.courseName],
    ["Course Code", record.courseCode],
    ["Certificate Number", record.certificateNumber || certificateNumber],
    ["Training Start Date", trainingStart],
    ["Training End Date", trainingEnd],
    ["Issue Date", formatDate(record.issueDate)],
    ["Venue", record.venue],
    ["Status", record.status],
  ].filter(([, value]) => value);

  return (
    <main className="verify-page verify-result-page">
      <SiteHeader />

      <section className="verify-result" aria-labelledby="result-title" aria-live="polite"><div className="container"><div className={`verify-status verify-status-${record.status}`}><span aria-hidden="true">{record.status === "valid" ? "✓" : "!"}</span><div><p className="verify-status-label">{content.label}</p><h1 id="result-title">{content.message}</h1></div></div><div className="verify-result-card"><p className="eyebrow">Certificate Details</p><dl className="verify-details">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={label === "Certificate Number" ? "verify-certificate-number" : ""}>{value}</dd></div>)}</dl><div className="verify-actions"><a className="btn btn-primary" href="/verify">Verify Another Certificate</a><PrintButton /></div></div></div></section>

      <a className="floating-whatsapp" href="https://wa.me/60195193834" target="_blank" rel="noreferrer" aria-label="Contact TERAS UNIVERSAL on WhatsApp">WA</a>
      <SiteFooter />
    </main>
  );
}
