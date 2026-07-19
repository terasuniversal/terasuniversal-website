"use client";

import { useState } from "react";

export default function ContactEnquiryForm() {
  const [status, setStatus] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const subject = encodeURIComponent(`Website enquiry - ${data.get("course")}`);
    const body = encodeURIComponent(`Enquiry Type: ${data.get("enquiryType")}\nName: ${data.get("name")}\nCompany: ${data.get("company") || "-"}\nEmail: ${data.get("email")}\nPhone: ${data.get("phone")}\nCourse / Service: ${data.get("course")}\n\nMessage:\n${data.get("message")}`);
    setStatus("Your email application will open with the enquiry prepared.");
    window.location.href = `mailto:training@terasuniversal.com.my?subject=${subject}&body=${body}`;
  }

  return (
    <form className="contact-page-form" onSubmit={handleSubmit}>
      <div className="contact-page-form-grid">
        <label>Name<input name="name" type="text" autoComplete="name" required /></label>
        <label>Company<input name="company" type="text" autoComplete="organization" /></label>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Phone<input name="phone" type="tel" autoComplete="tel" required /></label>
      </div>
      <label>Enquiry Type<select name="enquiryType" defaultValue="Corporate" required><option>Corporate</option><option>Individual</option><option>Government</option><option>Training</option></select></label>
      <label>Course Interested<select name="course" defaultValue="" required><option value="" disabled>Select an option</option><option>Industrial Safety Training</option><option>Technical Competency</option><option>Industrial Consultancy</option><option>Workforce Development</option><option>Custom Corporate Training</option><option>Other Enquiry</option></select></label>
      <label>Message<textarea name="message" rows="6" required /></label>
      <button className="btn btn-gold contact-submit" type="submit">Submit Enquiry</button>
      {status && <p className="contact-form-status" aria-live="polite">{status}</p>}
    </form>
  );
}
