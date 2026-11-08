// LOCAL MOCKS for the prototype. Nothing here contacts a network service.
//  * mock timestamp authority: signs "hash|time" with a TEST-ONLY Ed25519 key (a real deployment would use an RFC 3161 TSA).
//  * mock mailer: writes .eml files into a directory (a real deployment would use the existing Resend integration).
// Failure injection for tests: TSA_FAIL=1, MAIL_FAIL=1.
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function tsaStamp(hashHex, nowIso, tsaPrivatePem) {
  if (process.env.TSA_FAIL === "1") throw new Error("TSA_UNAVAILABLE");
  const message = `${hashHex}|${nowIso}`;
  return { tsa: "mock-tsa-1", hash: hashHex, time: nowIso, signature: sign(null, Buffer.from(message), createPrivateKey(tsaPrivatePem)).toString("base64") };
}

export function tsaVerify(token, hashHex, tsaPublicPem) {
  try {
    if (!token || token.hash !== hashHex || typeof token.time !== "string") return false;
    return verify(null, Buffer.from(`${token.hash}|${token.time}`), createPublicKey(tsaPublicPem), Buffer.from(token.signature, "base64"));
  } catch { return false; }
}

export function sendMail(dir, { to, subject, body }) {
  if (process.env.MAIL_FAIL === "1") throw new Error("MAIL_UNAVAILABLE");
  mkdirSync(dir, { recursive: true });
  const n = String(readdirSync(dir).length + 1).padStart(5, "0");
  writeFileSync(join(dir, `${n}.eml`), `To: ${to}\nSubject: ${subject}\n\n${body}\n`);
}
