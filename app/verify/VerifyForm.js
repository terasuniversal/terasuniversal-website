"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const certificatePattern = /^TU-[A-Z0-9]+-\d{4}-\d+$/;

export default function VerifyForm() {
  const router = useRouter();
  const [certificateNumber, setCertificateNumber] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const normalized = certificateNumber.trim().toUpperCase();

    if (!normalized) {
      setError("Please enter a certificate number.");
      return;
    }

    if (!certificatePattern.test(normalized)) {
      setError("Enter a valid certificate number, for example TU-WAH-2026-0001.");
      return;
    }

    setError("");
    router.push(`/verify/${encodeURIComponent(normalized)}`);
  }

  return (
    <form className="verify-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor="certificate-number">Certificate Number</label>
      <input
        id="certificate-number"
        className="verify-input"
        type="text"
        value={certificateNumber}
        onChange={(event) => {
          setCertificateNumber(event.target.value);
          if (error) setError("");
        }}
        placeholder="TU-WAH-2026-0001"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "certificate-error" : "certificate-help"}
      />
      <p id="certificate-help" className="verify-help">Use the certificate number printed on your certificate.</p>
      {error && <p id="certificate-error" className="verify-error" role="alert">{error}</p>}
      <button className="btn btn-primary verify-submit" type="submit">Verify Certificate</button>
    </form>
  );
}
