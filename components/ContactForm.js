"use client";

import { useState } from "react";

export default function ContactForm() {
  const [status, setStatus] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = data.get("name");
    const company = data.get("company");
    const email = data.get("email");
    const phone = data.get("phone");
    const course = data.get("course");
    const message = data.get("message");

    const subject = encodeURIComponent(`Website training enquiry — ${course}`);
    const body = encodeURIComponent(
`Name: ${name}
Company: ${company || "-"}
Email: ${email}
Phone: ${phone}
Course / Service: ${course}

Message:
${message}`
    );

    setStatus("Your email application will open with the enquiry prepared.");
    window.location.href = `mailto:training@terasuniversal.com.my?subject=${subject}&body=${body}`;
  }

  return (
    <form className="contact-form" onSubmit={handleSubmit}>
      <div className="field-grid">
        <label>
          Full Name *
          <input name="name" type="text" autoComplete="name" required />
        </label>
        <label>
          Company
          <input name="company" type="text" autoComplete="organization" />
        </label>
        <label>
          Email *
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Phone *
          <input name="phone" type="tel" autoComplete="tel" required />
        </label>
      </div>
      <label>
        Course / Service Interested *
        <select name="course" required defaultValue="">
          <option value="" disabled>Select an option</option>
          <option>Working at Height</option>
          <option>Scaffolding</option>
          <option>Safety Awareness</option>
          <option>Custom Corporate Training</option>
          <option>Consultancy</option>
          <option>Other Enquiry</option>
        </select>
      </label>
      <label>
        Message *
        <textarea name="message" rows="5" required />
      </label>
      <button className="btn btn-primary form-submit" type="submit">Prepare Email Enquiry</button>
      {status && <p className="form-status" aria-live="polite">{status}</p>}
      <p className="form-note">
        This secure, zero-cost form prepares an email to training@terasuniversal.com.my using the visitor&apos;s email application.
      </p>
    </form>
  );
}
