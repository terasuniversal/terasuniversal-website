"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

    if (normalized.length < 4 || normalized.length > 80) {
      setError("Enter a valid certificate number.");
      return;
    }

    setError("");
    router.push(`/verify/${encodeURIComponent(normalized)}`);
  }

  return (
    <form className="verify-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor="certificate-number">Certificate number</label>
      <input
        id="certificate-number"
        className="verify-input"
        type="text"
        value={certificateNumber}
        onChange={(event) => {
          setCertificateNumber(event.target.value);
          if (error) setError("");
        }}
        placeholder="BE/LI/1851/26"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? "certificate-error" : "certificate-help"}
      />
      <p id="certificate-help" className="verify-help">Use the unique certificate number issued by TERAS UNIVERSAL.</p>
      {error && <p id="certificate-error" className="verify-error" role="alert">{error}</p>}
      <button className="btn btn-primary verify-submit" type="submit">Verify Certificate</button>
    </form>
  );
}

