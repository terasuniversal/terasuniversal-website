// Malaysian phone numbers (W9-G1 / W9-G1.1, eBook lead form). One validator for client and server: the form shows the
// same answer the API stores. Accepted input: domestic (012-345 6789, 03-1234 5678) or international (+60, 0060, 60),
// with spaces, hyphens, dots or brackets. Output is E.164 (+60…) so the CRM can deduplicate on one canonical value.
//
// Number structures follow MCMC, Numbering and Electronic Addressing Plan (NEAP), 2023 edition:
//   §9.2.2–9.2.3 public cellular, prefix 01Y (Y = 0–4, 6–9): 7-digit subscriber number Z XXXXXX with Z = 2–9, or 8-digit
//                subscriber number Z XXXXXXX with Z = 1–9.
//   §9.2.4      other mobile service providers, prefix 01YZ with Y = 5 (015Z, Z = 0–9): 7-digit subscriber number
//                A XXXXXX with A = 1–9 (so 015 numbers have 11 digits with the leading 0).
//   §6.3/§6.4   geographic numbers: 1-digit NDC 3, 4, 5, 6, 7, 9 with a 7- or 8-digit subscriber number, or 2-digit NDC
//                82–89 with a 6-digit subscriber number; the first subscriber digit X1 is 2–9 and "99" never starts one.
// A number that matches a structure is only well-formed: it may be unassigned, unreachable, not on WhatsApp or not the
// submitter's. The plan's assignment registry (which blocks are actually issued) is not consulted. Foreign numbers are
// rejected because the form asks for a Malaysian WhatsApp or phone number.
const ALLOWED = /^[0-9+\s().-]+$/;

function nationalNumber(digits) {
  if (digits.startsWith("0060")) return digits.slice(4);
  if (digits.startsWith("60")) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return null;
}

function classify(n) {
  if (/^1[0-46-9][2-9]\d{6}$/.test(n)) return "mobile"; // 01Y + 7-digit subscriber number (Z = 2–9)
  if (/^1[0-46-9][1-9]\d{7}$/.test(n)) return "mobile"; // 01Y + 8-digit subscriber number (Z = 1–9)
  if (/^15\d[1-9]\d{6}$/.test(n)) return "mobile-other"; // 015Z + 7-digit subscriber number (A = 1–9)
  const sn = (rest) => /^[2-9]/.test(rest) && !rest.startsWith("99");
  if (/^[345679]\d{7,8}$/.test(n)) return sn(n.slice(1)) ? "fixed" : null; // 1-digit NDC + 7 or 8 digits
  if (/^8[2-9]\d{6}$/.test(n)) return sn(n.slice(2)) ? "fixed" : null; // 2-digit NDC + 6 digits
  return null;
}

function display(n, type) {
  if (type !== "fixed") return n.length === 10 ? `+60 ${n.slice(0, 2)}-${n.slice(2, 6)} ${n.slice(6)}` : `+60 ${n.slice(0, 2)}-${n.slice(2, 5)} ${n.slice(5)}`;
  if (n.startsWith("8")) return `+60 ${n.slice(0, 2)}-${n.slice(2, 5)} ${n.slice(5)}`;
  return n.length === 9 ? `+60 ${n.slice(0, 1)}-${n.slice(1, 5)} ${n.slice(5)}` : `+60 ${n.slice(0, 1)}-${n.slice(1, 4)} ${n.slice(4)}`;
}

/** @returns {{ ok: true, e164: string, display: string, type: "mobile" | "mobile-other" | "fixed" } | { ok: false }} */
export function normalizeMalaysianPhone(input) {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 30 || !ALLOWED.test(raw)) return { ok: false };
  if (raw.indexOf("+") > 0 || (raw.match(/\+/g) || []).length > 1) return { ok: false };
  const plus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (plus && !digits.startsWith("60")) return { ok: false };
  const n = plus ? digits.slice(2) : nationalNumber(digits);
  if (!n) return { ok: false };
  const type = classify(n);
  if (!type) return { ok: false };
  return { ok: true, e164: `+60${n}`, display: display(n, type), type };
}
