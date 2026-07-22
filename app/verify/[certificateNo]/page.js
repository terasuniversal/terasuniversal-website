import Image from "next/image";
import { notFound } from "next/navigation";
import MobileNav from "../../../components/MobileNav";
import PrintButton from "../../../components/PrintButton";
import Footer from "../../../components/Footer";
import { findCertificateByValue } from "../../../lib/certificates";

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
  pending: { label: "CERTIFICATE PENDING", message: "This certificate is recorded but is not yet available as a confirmed certificate." },
};

export default async function CertificateResultPage({ params }) {
  const rawCertificateNo = (await params).certificateNo;
  let certificateNumber;

  try {
    certificateNumber = decodeURIComponent(rawCertificateNo || "").trim().toUpperCase();
  } catch {
    notFound();
  }

  const record = await findCertificateByValue(certificateNumber);

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
    ["Expiry Date", formatDate(record.expiryDate)],
    ["Issue Date", formatDate(record.issueDate)],
    ["Venue", record.venue],
    ["Instructor", record.instructor],
    ["Status", record.status],
  ].filter(([, value]) => value);

  return (
    <main className="verify-page verify-result-page">
      <header className="site-header"><div className="container nav-wrap"><a className="brand" href="/" aria-label="TERAS UNIVERSAL home"><Image src="/teras-universal-logo.png" alt="TERAS UNIVERSAL logo" width={220} height={140} priority sizes="154px" /></a><nav className="desktop-nav" aria-label="Main navigation"><a href="/about">About</a><a href="/services">Services</a><a href="/training">Training</a><a href="/#industries">Industries</a><a href="/#faq">FAQ</a><a href="/contact">Contact</a><a href="/verify" aria-current="page">Verify Certificate</a><a className="nav-proposal" href="/request-proposal">Request Proposal</a><a className="nav-cta" href="https://wa.me/60195193834" target="_blank" rel="noreferrer">WhatsApp</a></nav><MobileNav basePath="/" /></div></header>

      <section className="verify-result" aria-labelledby="result-title" aria-live="polite"><div className="container"><div className={`verify-status verify-status-${record.status}`}><span aria-hidden="true">{record.status === "valid" ? "✓" : "!"}</span><div><p className="verify-status-label">{content.label}</p><h1 id="result-title">{content.message}</h1></div></div><div className="verify-result-card"><p className="eyebrow">Certificate Details</p><dl className="verify-details">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={label === "Certificate Number" ? "verify-certificate-number" : ""}>{value}</dd></div>)}</dl>{record.certificateFileUrl && <p><a className="btn btn-outline" href={record.certificateFileUrl} target="_blank" rel="noreferrer">View Certificate File</a></p>}<div className="verify-actions"><a className="btn btn-primary" href="/verify">Verify Another Certificate</a><PrintButton /></div></div></div></section>

      <a className="floating-whatsapp" href="https://wa.me/60195193834" target="_blank" rel="noreferrer" aria-label="Contact TERAS UNIVERSAL on WhatsApp">WA</a><Footer />
    </main>
  );
}
