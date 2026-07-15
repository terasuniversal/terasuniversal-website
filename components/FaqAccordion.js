"use client";

import { useState } from "react";

const items = [
  ["Can training be conducted at our company site?", "Yes. Selected programmes may be delivered onsite, subject to programme requirements, site suitability, equipment availability and safety arrangements."],
  ["Do you provide in-house corporate training?", "Yes. Programmes can be customised for a specific organisation, department, project team or workforce group."],
  ["Can programme content be customised?", "Yes. Training scope may be adapted according to participant profiles, operational risks, organisational procedures and desired learning outcomes."],
  ["Do participants receive a certificate?", "Certification or proof of completion depends on the programme structure, attendance, assessment requirements and applicable competency criteria."],
  ["How can we request a quotation?", "Submit the website enquiry form, contact TERAS UNIVERSAL through WhatsApp or email training@terasuniversal.com.my."],
  ["Are programmes suitable for beginners?", "Selected programmes are suitable for beginners, while others require prior knowledge, experience or specific entry requirements."],
  ["Do you provide practical training?", "Yes. Where applicable, programmes combine theory, demonstrations, guided practical exercises and structured assessment."],
  ["Can training dates be arranged according to our schedule?", "Training dates may be discussed according to trainer availability, participant numbers, site arrangements and programme requirements."],
];

export default function FaqAccordion() {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className="faq-accordion">
      {items.map(([question, answer], index) => {
        const isOpen = openIndex === index;
        return (
          <div className={`faq-item${isOpen ? " is-open" : ""}`} key={question}>
            <button className="faq-question" type="button" aria-expanded={isOpen} aria-controls={`faq-answer-${index}`} onClick={() => setOpenIndex(isOpen ? null : index)}>
              <span>{question}</span>
              <span className="faq-indicator" aria-hidden="true">{isOpen ? "-" : "+"}</span>
            </button>
            <div id={`faq-answer-${index}`} className="faq-answer" hidden={!isOpen}>
              <p>{answer}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
