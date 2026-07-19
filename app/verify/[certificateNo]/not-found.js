export const metadata = { robots: { index: false, follow: false } };

export default function CertificateNotFound() {
  return <main className="verify-page verify-not-found"><div className="container"><p className="verify-status-label">CERTIFICATE NOT FOUND</p><h1>Certificate not found.</h1><p>We could not find a certificate matching the number entered.</p><a className="btn btn-primary" href="/verify">Verify Another Certificate</a></div></main>;
}
