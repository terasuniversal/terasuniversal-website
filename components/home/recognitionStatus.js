import { accreditations } from "../../data/companyProfile";

const longDate = (iso) => new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));

// A dated recognition is current until the end of its last valid day (Malaysia time). After that it is
// shown only as history, and the entry no longer counts as a current approval anywhere on the homepage,
// until a renewal is verified and data/companyProfile.js is updated with the new validity date.
export const isCurrent = (recognition, now = Date.now()) => !recognition || now <= new Date(`${recognition.validUntil}T23:59:59+08:00`).getTime();

export function accreditationRows(now = Date.now()) {
  return accreditations.map((entry) => {
    const { recognition } = entry;
    if (!recognition) return { org: entry.org, status: entry.label, current: true };
    const until = longDate(recognition.validUntil);
    return isCurrent(recognition, now)
      ? { org: entry.org, status: `${entry.label}. Recognised training centre for ${recognition.scope}, valid until ${until}.`, current: true }
      : { org: entry.org, status: `Recognition as a training centre for ${recognition.scope} was valid until ${until}.`, current: false };
  });
}

// The hero fact names JKKP only while its recognition is current.
export function heroFact(now = Date.now()) {
  const jkkp = accreditations.find((entry) => entry.recognition);
  const lead = "Industrial safety and technical competency since 2012.";
  return jkkp && isCurrent(jkkp.recognition, now)
    ? `${lead} Approved by JKKP, registered with HRD Corp and CIDB.`
    : `${lead} Registered with HRD Corp and CIDB.`;
}
