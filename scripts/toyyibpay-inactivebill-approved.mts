/**
 * ToyyibPay Inactive Bill classifier (owner-approved, CRM F-PAY-1): the exact, named edit to lib/payments/toyyibpay.ts.
 *   NE-1 lib/payments/toyyibpay.ts: inactivateBill() classifies the response against the three bodies documented in the
 *        ToyyibPay API reference and reports success only for {"status":"success",...}. The previous check read both
 *        documented {"status":"failed",...} bodies (pending transaction, already inactive) as success.
 * revertToyyibpayInactiveBill(path, text) undoes ONLY this edit and fails closed when the edit is absent, duplicated or
 * altered, so a contract that pins this file to its release base (public-registration-kill-switch K8) keeps proving that
 * nothing else in it moved. revertToyyibpayInactiveBillInBase() applies the same revert to a base that already contains
 * the edit (after it lands on main) and leaves an older base untouched.
 */
const EDITS: Record<string, [string, string][]> = {
  "lib/payments/toyyibpay.ts": [
    [
      "/**\n * Outcome of an Inactive Bill call. Only \"inactivated\" means ToyyibPay confirmed it stopped the bill.\n * - already_inactive: the bill was inactive before this call (it may also have been paid; undocumented).\n * - pending_transaction: a payment is in progress on the bill right now.\n * - failed: any other explicit failure body.\n * - unknown: anything not matching the documented shapes.\n */\nexport type InactivateBillOutcome = \"inactivated\" | \"already_inactive\" | \"pending_transaction\" | \"failed\" | \"unknown\";\n\nexport interface InactivateBillResult {\n  /** True only for the documented, structurally valid success body (outcome \"inactivated\"). */\n  success: boolean;\n  outcome: InactivateBillOutcome;\n  raw: unknown;\n}\n\n/**\n * Classifies an Inactive Bill response body against the ToyyibPay API reference\n * (https://toyyibpay.com/apireference/, \"Inactive Bill\", read 2026-11-23), which lists exactly three responses:\n *   {\"status\":\"success\",\"result\":\"Bill status changed to inactive\"}\n *   {\"status\":\"failed\",\"result\":\"Bill has pending transaction process\"}\n *   {\"status\":\"failed\",\"result\":\"Bill is inactive\"}\n * Fail-closed: success needs status exactly \"success\" and a result string that mentions \"inactive\". The previous\n * check (anything but \"error\"/\"0\"/missing) read both documented \"failed\" bodies as success, so a manual payment\n * or a cancellation could proceed while a customer was mid-payment on the bill.\n */\nexport function classifyInactiveBillResponse(raw: unknown): InactivateBillOutcome {\n  let body: unknown = raw;\n  if (Array.isArray(raw)) {\n    if (raw.length !== 1) return \"unknown\";\n    body = raw[0];\n  }\n  if (body === null || typeof body !== \"object\" || Array.isArray(body)) return \"unknown\";\n  const { status, result } = body as Record<string, unknown>;\n  if (typeof status !== \"string\") return \"unknown\";\n  const text = typeof result === \"string\" ? result.trim() : null;\n\n  if (status === \"success\") return text !== null && /\\binactive\\b/i.test(text) ? \"inactivated\" : \"unknown\";\n  if (status === \"failed\") {\n    if (text === \"Bill is inactive\") return \"already_inactive\";\n    if (text === \"Bill has pending transaction process\") return \"pending_transaction\";\n    return \"failed\";\n  }\n  if (status === \"error\" || status === \"0\") return \"failed\";\n  return \"unknown\";\n}\n\n/**\n * POST /index.php/api/inactiveBill. Used by the provider-orphan-bill compensation (Create Bill succeeded but the\n * local record failed), by the manual payment and invoice cancellation flows (to stop an active bill before the\n * invoice changes), and by public registration compensation. Transport problems (timeout, network, non-2xx,\n * non-JSON) throw; callers must treat a throw exactly like success === false.\n */\nexport async function inactivateBill(billCode: string): Promise<InactivateBillResult> {\n  const { userSecretKey, baseUrl } = getCredentials();\n  if (!billCode || billCode.trim().length === 0) {\n    throw new Error(\"ToyyibPay inactivateBill: billCode is required.\");\n  }\n\n  // Phase 2E fix: confirmed live against the real sandbox that this\n  // endpoint (unlike createBill/getBillTransactions, which both use\n  // \"userSecretKey\") expects the credential field named \"secretKey\" --\n  // sending \"userSecretKey\" here gets rejected with \"secretKey parameter\n  // is empty!\" and this call has never actually inactivated a bill before\n  // this fix. Do not rename the field for createBill/getBillTransactions --\n  // their \"userSecretKey\" naming is independently confirmed correct.\n  const raw = await postForm(baseUrl, \"/index.php/api/inactiveBill\", {\n    secretKey: userSecretKey,\n    billCode,\n  });\n\n  const outcome = classifyInactiveBillResponse(raw);\n  return { success: outcome === \"inactivated\", outcome, raw };\n",
      "export interface InactivateBillResult {\n  /** Best-effort: true only if ToyyibPay's response is recognizably a success. Callers must not assume true on ambiguous responses. */\n  success: boolean;\n  raw: unknown;\n}\n\n/**\n * POST /index.php/api/inactiveBill -- compensation call for the\n * provider-orphan-bill scenario (Create Bill HTTP succeeded, the local DB\n * record failed after bounded retries). Never called from any code path\n * that isn't specifically that compensation flow.\n */\nexport async function inactivateBill(billCode: string): Promise<InactivateBillResult> {\n  const { userSecretKey, baseUrl } = getCredentials();\n  if (!billCode || billCode.trim().length === 0) {\n    throw new Error(\"ToyyibPay inactivateBill: billCode is required.\");\n  }\n\n  // Phase 2E fix: confirmed live against the real sandbox that this\n  // endpoint (unlike createBill/getBillTransactions, which both use\n  // \"userSecretKey\") expects the credential field named \"secretKey\" --\n  // sending \"userSecretKey\" here gets rejected with \"secretKey parameter\n  // is empty!\" and this call has never actually inactivated a bill before\n  // this fix. Do not rename the field for createBill/getBillTransactions --\n  // their \"userSecretKey\" naming is independently confirmed correct.\n  const raw = await postForm(baseUrl, \"/index.php/api/inactiveBill\", {\n    secretKey: userSecretKey,\n    billCode,\n  });\n\n  const first = Array.isArray(raw) ? raw[0] : raw;\n  const status = first && typeof first === \"object\" && \"status\" in first ? String((first as Record<string, unknown>).status) : null;\n  // ToyyibPay's exact success-status vocabulary for this endpoint is not\n  // confirmed against a live response -- treat anything other than an\n  // explicit error/failure marker as inconclusive, not as confirmed\n  // success. Callers (the orphan-compensation flow) must log the raw\n  // response either way and never assume success silently.\n  const success = status !== null && status !== \"error\" && status !== \"0\";\n\n  return { success, raw };\n",
    ],
  ],
};

export const TOYYIBPAY_INACTIVEBILL_CHANGED = Object.keys(EDITS).sort();
export const TOYYIBPAY_INACTIVEBILL_ADDED = ["scripts/toyyibpay-inactive-bill-classifier.test.mts", "scripts/toyyibpay-inactivebill-approved.mts"];

function occurrences(text: string, part: string): number {
  let count = 0;
  for (let at = text.indexOf(part); at !== -1; at = text.indexOf(part, at + part.length)) count += 1;
  return count;
}

function eolFor(text: string): (s: string) => string {
  const crlf = text.includes("\r\n");
  return (s: string) => (crlf ? s.replace(/\r?\n/g, "\r\n") : s);
}

/** Undo the named edit. Throws unless the approved text is present exactly once and the old text is absent. */
export function revertToyyibpayInactiveBill(path: string, text: string): string {
  const eol = eolFor(text);
  let out = text;
  for (const [now, before] of EDITS[path] ?? []) {
    const from = eol(now);
    const to = eol(before);
    const seen = occurrences(out, from);
    if (seen !== 1) throw new Error(`toyyibpay-inactivebill: expected the approved edit exactly once in ${path}, found ${seen}`);
    if (occurrences(out, to) !== 0) throw new Error(`toyyibpay-inactivebill: the pre-edit text is still present in ${path}`);
    out = out.replace(from, () => to);
  }
  return out;
}

/** For a comparison base: revert when the base already carries the edit (post-merge), keep an older base as it is. */
export function revertToyyibpayInactiveBillInBase(path: string, text: string): string {
  const eol = eolFor(text);
  const pairs = EDITS[path] ?? [];
  if (pairs.every(([now]) => occurrences(text, eol(now)) === 0)) {
    for (const [, before] of pairs) {
      if (occurrences(text, eol(before)) !== 1) throw new Error(`toyyibpay-inactivebill: base of ${path} is neither the pre-edit nor the approved version`);
    }
    return text;
  }
  return revertToyyibpayInactiveBill(path, text);
}
