// Privacy Notice — English, owner-approved v0.5 (base v0.4: docs/WEBSITE-PUBLIC-FIRST-PRIVACY-K3/PRIVACY-NOTICE-EN-DRAFT.md,
// decisions D-05/D-06/D-09/D-14/L-01 of 18 November 2026; v0.5 adds W2 decisions K-B and K-C, same date). Must stay substantively equivalent to content/ms/privacy.js:
// same 12 sections with the same block structure (scripts/privacy-publication-contract.mts compares them).
// Retention is stated as a general principle only; the proposed 24/12-month periods are NOT implemented and NOT published.
// The effective date is not written here: the page shows lib/privacy-publication.js PRIVACY_EFFECTIVE_DATE.
export const privacyNoticeEn = {
  lang: "en",
  title: "Privacy Notice",
  switchLink: { label: "Baca dalam Bahasa Melayu", href: "/privacy/ms", lang: "ms" },
  tocLabel: "Contents",
  pendingLabel: "Pending",
  effectiveLabel: "Effective date",
  unpublishedVersion: "Draft v0.5 · effective date set on publication · not in effect",
  sections: [
    {
      title: "Who we are",
      blocks: [
        { p: "This website (https://www.terasuniversal.com.my) is operated by TERAS UNIVERSAL SDN. BHD., a company incorporated in Malaysia. In this notice, “TERAS”, “we” and “us” mean TERAS UNIVERSAL SDN. BHD." },
        { rows: [
          ["Registration No.", "201201003207 (976732-P)"],
          ["Registered address", "No. 1559 (2nd Floor), Jalan Kota, P.O. Box 106, 05710 Alor Setar, Kedah, Malaysia"],
          ["Business address and training centre", "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia"],
        ] },
      ],
    },
    {
      title: "Personal data we collect through this website",
      blocks: [
        { list: [
          "Contact form: your name, company, email address, phone number, enquiry type, subject and message, and the page you sent it from.",
          "Request a Proposal form: your company, name, job title, business email, phone number, industry, training category and programme of interest, number of participants, location, preferred month, budget range, training objectives and notes.",
          "Certificate verification (/verify): the certificate number or verification link you enter. We also record your IP address, browser user-agent and the result of each check in a verification log.",
          "Technical data: our hosting provider processes standard request data such as your IP address, browser type and the pages you request. To prevent repeated or automated submissions, we check whether a form has recently been sent from the same email address.",
        ] },
        { p: "We do not ask for sensitive personal data through these forms. Please do not include it in your message." },
      ],
    },
    {
      title: "Why we use your personal data",
      blocks: [
        { list: [
          "To reply to your enquiry and to prepare a training proposal or quotation you asked for.",
          "To record enquiries and proposal requests in our customer records and follow them up as a business contact. If an enquiry leads to training or a contract, the related details become part of our business, quotation and accounting records.",
          "To send you an email confirming that we received your proposal request.",
          "To confirm whether a TERAS certificate is valid, and to keep a security record of verification checks so that we can detect misuse.",
          "To keep the website secure, prevent spam and fix technical problems.",
        ] },
        { p: "We use your data only for these purposes or for purposes directly related to them. We do not sell your personal data." },
        { p: "Sending an enquiry or proposal request does not sign you up for marketing emails. We will only add you to our marketing communications with your separate consent, and you can withdraw that consent at any time." },
      ],
    },
    {
      title: "Your choice",
      blocks: [{ p: "Providing your details is voluntary. If you do not provide the information marked as required in a form, we may not be able to reply to your enquiry or prepare a proposal. By submitting a form, you agree to our processing of your data as described in this notice." }],
    },
    {
      title: "Who we share your data with",
      blocks: [
        { p: "We share your data only with service providers that help us run this website and respond to you, and only for those purposes:" },
        { list: [
          "website hosting (Vercel);",
          "our database provider (Supabase), which stores our records in Singapore;",
          "our email delivery provider (Resend), which delivers form notifications to our team and confirmation emails to you;",
          "Google, because proposal requests may also be copied into a Google spreadsheet used by our team.",
        ] },
        { p: "We may also disclose data where the law requires it. Some of these providers may process data outside Malaysia." },
        { p: "Certificate verification is public by design. Anyone who enters a valid certificate number or verification link can see the certificate holder’s name, course, issue and expiry dates and certificate status. This allows employers and others to confirm a TERAS certificate. A certificate number is not a password, and the details shown are not private to the holder." },
      ],
    },
    {
      title: "Cookies, embedded content and links",
      blocks: [{ list: [
        "TERAS does not set analytics or advertising cookies on this public website, and we do not currently use website analytics. If we introduce analytics, we will update this notice first.",
        "Our Contact page shows an embedded Google Maps map. When the map loads, Google may collect information such as your IP address and may set its own cookies, under Google’s own privacy policy.",
        "Links to WhatsApp, Facebook or other external services take you to those services. Their own privacy policies apply.",
        "Login cookies are used only in the staff administration area.",
      ] }],
    },
    {
      title: "Online registration and payments",
      blocks: [{ p: "New online course registration and online payment are not currently offered through this website. Records of registrations or invoice payments made earlier, including payments processed through our payment provider (ToyyibPay), continue to be kept and handled as needed to complete those transactions and meet our obligations." }],
    },
    {
      title: "How long we keep your data",
      blocks: [{ p: "We retain personal data only for as long as reasonably necessary for the purposes described in this notice and to meet applicable legal, contractual and recordkeeping requirements. When it is no longer needed, we delete it or make it anonymous. This applies to our database, customer records, email copies and spreadsheet copies." }],
    },
    {
      title: "Security",
      blocks: [{ p: "We take reasonable technical and organisational steps to protect your personal data. These include encrypted connections (HTTPS), access controls, and limiting access to staff who need it. No method of transmission or storage is completely secure." }],
    },
    {
      title: "Your rights and how to contact us",
      blocks: [
        { p: "You may ask to access or correct your personal data, withdraw your consent, or ask us to limit its processing, as allowed by law. This includes correcting details shown on a certificate verification. Please send privacy requests and questions to our privacy contact. Requests are handled only by authorised TERAS staff, under the supervision of the company’s management." },
        { rows: [
          ["Privacy contact", "TERAS UNIVERSAL SDN. BHD."],
          ["Email", "admin@terasuniversal.com.my"],
          ["Telephone", "+60 19-519 3834"],
          ["Address", "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam, 06000 Jitra, Kedah, Malaysia"],
        ] },
        { p: "We may need to verify your identity before we act on a request." },
      ],
    },
    {
      title: "Changes to this notice",
      blocks: [{ p: "We may update this notice. The current version and its effective date will always be published on this page." }],
    },
    {
      title: "Language",
      blocks: [{ p: "This notice is published in Bahasa Melayu and English, and both versions have the same meaning." }],
    },
  ],
};
