/**
 * W9-G1 (owner-approved, local only): the exact, named edits for the eBook lead form requirement update.
 *   app/ebook page: the privacy summary names full name, WhatsApp/phone number and email, says the number is not used
 *   for promotional calls or WhatsApp, and that marketing is by email only.
 *   EbookRequestDemo: required full name, Malaysian WhatsApp/phone (lib/my-phone.js) and email; versioned consent text
 *   from lib/ebook-lead.js; still a local demonstration with no network or storage.
 *   ebook.module.css: .hint for the phone note and .submit:disabled. lib/validation/schemas.ts: ebookLeadSchema.
 *   W9-G1.1 (owner-approved): the demo form is method="post", its submit button is disabled until React mounts, and a
 *   noscript note explains that JavaScript is needed, so a native submission can never put personal data in a URL.
 * revertW9g1(path, text) undoes ONLY these edits and fails closed when an edit is not found exactly once. Generated from
 * git diff -U1 against main 94643969; strings are JSON-escaped verbatim.
 */
const EDITS: Record<string, [string, string][]> = {
  "app/ebook/[[...ebook]]/page.js": [
    [
      "              <h2 id=\"ebook-request-title\">Request your free copy</h2>\n              <p>Tell us who you are and where to send the eBook. We only ask for what is needed to provide it and handle your request.</p>\n              <h3>How your details would be used</h3>\n              <ul className={styles.privacy}>\n                <li>Your full name, WhatsApp/phone number and email are used to provide this eBook and handle your request. Your number is not used for promotional calls or WhatsApp messages.</li>\n                <li>Hearing from TERAS about courses by email is a separate, optional choice. You get the eBook either way.</li>\n                <li>TERAS UNIVERSAL’s Privacy Notice is being finalised and will be published before this form goes live.</li>\n",
      "              <h2 id=\"ebook-request-title\">Request your free copy</h2>\n              <p>Tell us where to send the eBook. We only ask for what is needed to send it.</p>\n              <h3>How your details would be used</h3>\n              <ul className={styles.privacy}>\n                <li>Your name and email are used to send you this eBook.</li>\n                <li>Hearing from TERAS about courses is a separate, optional choice. You get the eBook either way.</li>\n                <li>TERAS UNIVERSAL’s Privacy Notice is being finalised and will be published before this form goes live.</li>\n"
    ]
  ],
  "components/ebook/EbookRequestDemo.js": [
    [
      "\nimport { useEffect, useState } from \"react\";\nimport styles from \"./ebook.module.css\";\nimport { normalizeMalaysianPhone } from \"../../lib/my-phone\";\nimport { EBOOK_MARKETING_TEXT, EBOOK_PHONE_NOTE, EBOOK_PRIVACY_ACK_TEXT } from \"../../lib/ebook-lead\";\n\n",
      "\nimport { useState } from \"react\";\nimport styles from \"./ebook.module.css\";\n\n"
    ],
    [
      "// fulfilment purpose: the demonstration completes whether or not it is ticked.\n// W9-G1: full name, Malaysian WhatsApp/phone number (normalised to +60) and email are required; the consent wording is the\n// versioned text in lib/ebook-lead.js. The phone number carries no marketing consent (email-only, optional, unticked).\n// W9-G1.1 privacy hardening, independent of the React submit handler: the server-rendered form is method=\"post\" (a native\n// submission can never put the name, phone or email in a URL or history entry) and its only submit button is disabled\n// until React has mounted, so neither a click nor Enter (implicit submission) can submit before hydration or without\n// JavaScript. A noscript note explains this to visitors without JavaScript.\nconst EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n",
      "// fulfilment purpose: the demonstration completes whether or not it is ticked.\nconst EMAIL = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/;\n"
    ],
    [
      "  const [done, setDone] = useState(null);\n  const [ready, setReady] = useState(false);\n  useEffect(() => { setReady(true); }, []);\n\n",
      "  const [done, setDone] = useState(null);\n\n"
    ],
    [
      "    const name = String(form.get(\"name\") || \"\").trim();\n    const phone = normalizeMalaysianPhone(form.get(\"phone\"));\n    const email = String(form.get(\"email\") || \"\").trim();\n    const next = {};\n    if (name.length < 2) next.name = \"Please enter your full name.\";\n    if (!phone.ok) next.phone = \"Please enter a valid Malaysian WhatsApp or phone number, for example 012-345 6789 or +60 12-345 6789.\";\n    if (!EMAIL.test(email)) next.email = \"Please enter a valid email address.\";\n",
      "    const name = String(form.get(\"name\") || \"\").trim();\n    const email = String(form.get(\"email\") || \"\").trim();\n    const next = {};\n    if (!name) next.name = \"Please enter your name.\";\n    if (!EMAIL.test(email)) next.email = \"Please enter a valid email address.\";\n"
    ],
    [
      "    if (Object.keys(next).length) return;\n    // Only the consent choice and the normalised number format are kept, to show what would be recorded; the details\n    // themselves are discarded.\n    setDone({ marketing: Boolean(form.get(\"marketing\")), phoneType: phone.type });\n  }\n",
      "    if (Object.keys(next).length) return;\n    // Only the consent choice is kept, to show that it is recorded separately; the name and email are discarded.\n    setDone({ marketing: Boolean(form.get(\"marketing\")) });\n  }\n"
    ],
    [
      "          <div><dt>eBook request</dt><dd>Accepted by the demonstration</dd></div>\n          <div><dt>Phone number</dt><dd>Accepted ({done.phoneType === \"fixed\" ? \"fixed line\" : \"mobile\"}, stored as +60)</dd></div>\n          <div><dt>Marketing email</dt><dd>{done.marketing ? \"Opted in (optional)\" : \"Not given (optional)\"}</dd></div>\n          <div><dt>Promotional calls or WhatsApp</dt><dd>Not consented (not asked on this form)</dd></div>\n        </dl>\n",
      "          <div><dt>eBook request</dt><dd>Accepted by the demonstration</dd></div>\n          <div><dt>Marketing contact</dt><dd>{done.marketing ? \"Opted in (optional)\" : \"Not given (optional)\"}</dd></div>\n        </dl>\n"
    ],
    [
      "  return (\n    <form className={styles.form} method=\"post\" onSubmit={handleSubmit} noValidate aria-describedby=\"ebook-demo-note\">\n      <p id=\"ebook-demo-note\" className={styles.demoNote}><strong>Local preview.</strong> This form is a demonstration only: it does not send, store or email anything, and it does not provide the PDF.</p>\n      <label className={styles.field}>\n        <span>Full name <span aria-hidden=\"true\">*</span></span>\n        <input name=\"name\" type=\"text\" autoComplete=\"name\" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? \"ebook-name-error\" : undefined} />\n",
      "  return (\n    <form className={styles.form} onSubmit={handleSubmit} noValidate aria-describedby=\"ebook-demo-note\">\n      <p id=\"ebook-demo-note\" className={styles.demoNote}><strong>Local preview.</strong> This form is a demonstration only: it does not send, store or email anything, and it does not provide the PDF.</p>\n      <label className={styles.field}>\n        <span>Name <span aria-hidden=\"true\">*</span></span>\n        <input name=\"name\" type=\"text\" autoComplete=\"name\" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? \"ebook-name-error\" : undefined} />\n"
    ],
    [
      "      <label className={styles.field}>\n        <span>WhatsApp / phone number <span aria-hidden=\"true\">*</span></span>\n        <input name=\"phone\" type=\"tel\" inputMode=\"tel\" autoComplete=\"tel\" placeholder=\"012-345 6789\" required aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? \"ebook-phone-note ebook-phone-error\" : \"ebook-phone-note\"} />\n        <span id=\"ebook-phone-note\" className={styles.hint}>{EBOOK_PHONE_NOTE}</span>\n        {errors.phone && <span id=\"ebook-phone-error\" className={styles.error}>{errors.phone}</span>}\n      </label>\n      <label className={styles.field}>\n        <span>Email address <span aria-hidden=\"true\">*</span></span>\n        <input name=\"email\" type=\"email\" autoComplete=\"email\" required aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? \"ebook-email-error\" : undefined} />\n",
      "      <label className={styles.field}>\n        <span>Email <span aria-hidden=\"true\">*</span></span>\n        <input name=\"email\" type=\"email\" autoComplete=\"email\" required aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? \"ebook-email-error\" : undefined} />\n"
    ],
    [
      "        <input name=\"fulfilment\" type=\"checkbox\" required aria-invalid={Boolean(errors.fulfilment)} aria-describedby={errors.fulfilment ? \"ebook-fulfilment-error\" : undefined} />\n        <span>{EBOOK_PRIVACY_ACK_TEXT} <span aria-hidden=\"true\">*</span></span>\n      </label>\n",
      "        <input name=\"fulfilment\" type=\"checkbox\" required aria-invalid={Boolean(errors.fulfilment)} aria-describedby={errors.fulfilment ? \"ebook-fulfilment-error\" : undefined} />\n        <span>I agree that TERAS UNIVERSAL may use my name and email to send me this free eBook. <span aria-hidden=\"true\">*</span></span>\n      </label>\n"
    ],
    [
      "        <input name=\"marketing\" type=\"checkbox\" />\n        <span>{EBOOK_MARKETING_TEXT} You will receive the eBook whether or not you tick this.</span>\n      </label>\n      <noscript><p className={styles.hint} role=\"note\">JavaScript is needed to request the eBook. Nothing you type here is sent without it.</p></noscript>\n      <button type=\"submit\" className={styles.submit} disabled={!ready}>Get the free eBook</button>\n      <p className={styles.required}><span aria-hidden=\"true\">*</span> Required</p>\n",
      "        <input name=\"marketing\" type=\"checkbox\" />\n        <span>Optional: TERAS UNIVERSAL may contact me about training courses and updates. You will receive the eBook whether or not you tick this.</span>\n      </label>\n      <button type=\"submit\" className={styles.submit}>Get the free eBook</button>\n      <p className={styles.required}><span aria-hidden=\"true\">*</span> Required</p>\n"
    ]
  ],
  "components/ebook/ebook.module.css": [
    [
      "}\n.hint {\n  display: block;\n  color: #4a5a6e;\n  font-size: 14px;\n  line-height: 1.45;\n}\n.submit:disabled {\n  cursor: not-allowed;\n  opacity: 0.6;\n}\n.submit,\n",
      "}\n.submit,\n"
    ]
  ],
  "lib/validation/schemas.ts": [
    [
      "import { z } from \"zod\";\nimport { normalizeMalaysianPhone } from \"../my-phone.js\";\n\n",
      "import { z } from \"zod\";\n\n"
    ],
    [
      "export type ContactEnquiryInput = z.infer<typeof contactEnquirySchema>;\n// W9-G1 eBook lead form (public /api/ebook). Name, Malaysian phone and email are required; the phone is normalised to\n// E.164 (+60…) here so the CRM deduplicates on one canonical value. The Privacy Notice acknowledgement must be exactly\n// true. Marketing is a separate, optional email-only choice that defaults to false; the phone number carries no consent.\nexport const ebookLeadSchema = z.object({\n  fullName: z.string().trim().min(2, \"Please enter your full name\").max(120),\n  phone: z.string().trim().max(30).transform((value, ctx) => {\n    const result = normalizeMalaysianPhone(value);\n    if (!result.ok) {\n      ctx.addIssue({ code: \"custom\", message: \"Please enter a valid Malaysian WhatsApp or phone number\" });\n      return z.NEVER;\n    }\n    return result.e164;\n  }),\n  email: z.string().trim().toLowerCase().email(\"Please enter a valid email address\").max(254),\n  privacyAck: z.boolean().refine((value) => value === true, \"Please confirm the Privacy Notice to receive the eBook\"),\n  marketingEmailOptIn: z.boolean().default(false),\n});\nexport type EbookLeadInput = z.infer<typeof ebookLeadSchema>;\n\n",
      "export type ContactEnquiryInput = z.infer<typeof contactEnquirySchema>;\n\n"
    ]
  ]
};

export const W9G1_CHANGED = Object.keys(EDITS).sort();
export const W9G1_ADDED = ["app/api/ebook/route.js", "lib/ebook-lead.js", "lib/ebook-request.js", "lib/my-phone.js", "scripts/w9g1-approved.mts", "scripts/w9g1-ebook-lead-contract.mts", "scripts/w9g1-ebook-lead.test.mts"];

export function revertW9g1(path: string, text: string): string {
  const crlf = text.includes("\r\n");
  const eol = (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    if (out.split(from).length !== 2) throw new Error(`W9-G1: expected edit not found exactly once in ${path}`);
    out = out.replace(from, () => eol(before));
  }
  return out;
}
