"use client";

import { useEffect, useRef, useState } from "react";

// DRAFT form wording: NOT LEGALLY REVIEWED. The two checkboxes below are deliberately SEPARATE and both start UNCHECKED:
//   A. Privacy Notice acknowledgement: REQUIRED. It is not marketing consent.
//   B. Marketing communications: OPTIONAL. Not ticking it never blocks the eBook.
// No analytics event, console output or URL ever carries what the visitor types.

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

function newRequestId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function readUtm() {
  const params = new URLSearchParams(window.location.search);
  const out = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    if (value) out[key] = value.slice(0, 200);
  }
  return out;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+()./ -]{3,40}$/;

export default function EbookLeadForm({ ebookId }) {
  const startedAt = useRef(0);
  const requestId = useRef("");
  const utm = useRef({});
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState({});
  const [privacy, setPrivacy] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    startedAt.current = Date.now();
    requestId.current = newRequestId();
    utm.current = readUtm();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    if (status === "submitting") return;
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const fullName = String(form.get("full_name") || "").trim();
    const phone = String(form.get("phone") || "").trim();
    const website = String(form.get("website") || "");

    const found = {};
    if (!email) found.email = "Sila masukkan e-mel anda.";
    else if (!EMAIL_PATTERN.test(email) || email.length > 254) found.email = "Sila masukkan alamat e-mel yang sah.";
    if (phone && !PHONE_PATTERN.test(phone)) found.phone = "Sila semak nombor telefon anda.";
    if (!privacy) found.privacy = "Sila sahkan bahawa anda telah membaca Notis Privasi.";
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setStatus("idle");
      setMessage("");
      return;
    }

    setStatus("submitting");
    setMessage("");
    try {
      const response = await fetch("/api/ebook", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          full_name: fullName,
          phone,
          ebook_id: ebookId,
          privacy_acknowledged: true,
          marketing_opt_in: marketing,
          request_id: requestId.current,
          utm: utm.current,
          website,
          formStartedAt: startedAt.current,
        }),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      // Success is only ever shown when the server confirmed the capture.
      if (response.ok && payload && payload.ok === true) {
        setStatus("success");
        return;
      }
      setStatus("error");
      setMessage((payload && payload.error) || "Kami tidak dapat merekod permintaan anda sekarang. Sila cuba lagi sebentar lagi.");
    } catch {
      setStatus("error");
      setMessage("Sambungan gagal. Permintaan anda belum direkodkan. Sila cuba lagi.");
    }
  }

  if (status === "success") {
    return (
      <div className="ebook-success" role="status" aria-live="polite">
        <h2>Permintaan anda telah direkodkan</h2>
        <p>Terima kasih. Kami telah menerima permintaan eBook anda.</p>
        <div className="ebook-placeholder">
          <strong>Muat turun belum diaktifkan.</strong>
          <span> [PLACEHOLDER: pautan muat turun akan ditambah selepas Pemilik meluluskan storan dan kaedah penghantaran.]</span>
        </div>
      </div>
    );
  }

  return (
    <form className="ebook-form" onSubmit={handleSubmit} noValidate aria-describedby={message ? "ebook-form-message" : undefined}>
      <div className="ebook-field">
        <label className="ebook-label" htmlFor="ebook-email">E-mel <span aria-hidden="true">*</span><span className="ebook-sr"> (wajib)</span></label>
        <input id="ebook-email" className="ebook-input" type="email" name="email" inputMode="email" autoComplete="email" maxLength={254} required aria-required="true" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "ebook-email-error" : undefined} />
        {errors.email && <p className="ebook-error" id="ebook-email-error">{errors.email}</p>}
      </div>

      <div className="ebook-field">
        <label className="ebook-label" htmlFor="ebook-name">Nama <span className="ebook-optional">(pilihan)</span></label>
        <input id="ebook-name" className="ebook-input" type="text" name="full_name" autoComplete="name" maxLength={200} />
      </div>

      <div className="ebook-field">
        <label className="ebook-label" htmlFor="ebook-phone">Telefon <span className="ebook-optional">(pilihan)</span></label>
        <input id="ebook-phone" className="ebook-input" type="tel" name="phone" inputMode="tel" autoComplete="tel" maxLength={40} aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "ebook-phone-error" : undefined} />
        {errors.phone && <p className="ebook-error" id="ebook-phone-error">{errors.phone}</p>}
      </div>

      {/* Honeypot: hidden from people and assistive technology. */}
      <div className="ebook-hp" aria-hidden="true">
        <label htmlFor="ebook-website">Laman web</label>
        <input id="ebook-website" type="text" name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <fieldset className="ebook-checks">
        <legend className="ebook-sr">Pengakuan dan persetujuan</legend>
        <div className="ebook-check">
          <input id="ebook-privacy" type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} required aria-required="true" aria-invalid={Boolean(errors.privacy)} aria-describedby={errors.privacy ? "ebook-privacy-error" : undefined} />
          <label htmlFor="ebook-privacy">
            Saya telah membaca dan mengakui <a href="/privacy" target="_blank" rel="noopener">Notis Privasi</a> (DRAF, belum disemak undang-undang). <strong>Wajib.</strong>
          </label>
        </div>
        {errors.privacy && <p className="ebook-error" id="ebook-privacy-error">{errors.privacy}</p>}

        <div className="ebook-check">
          <input id="ebook-marketing" type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)} />
          <label htmlFor="ebook-marketing">
            Saya bersetuju menerima maklumat kursus dan promosi daripada TERAS UNIVERSAL. <span className="ebook-optional">Pilihan. Anda masih boleh mendapatkan eBook tanpa kebenaran ini.</span>
          </label>
        </div>
      </fieldset>

      {message && <p className="ebook-error ebook-form-error" id="ebook-form-message" role="alert">{message}</p>}

      <button type="submit" className="ebook-submit" disabled={status === "submitting"}>
        {status === "submitting" ? "Menghantar…" : "Minta eBook percuma"}
      </button>
    </form>
  );
}
