/**
 * ToyyibPay Phase 2B -- server-only HTTP client. Never import this file
 * from a "use client" component or any code reachable from the browser --
 * it reads TOYYIBPAY_USER_SECRET_KEY, which must never leave the server
 * (same rule this codebase already applies to SUPABASE_SERVICE_ROLE_KEY).
 * Every export here is either a pure helper or a function that performs
 * exactly one outbound HTTP call -- no Postgres function ever calls out to
 * ToyyibPay; that boundary is deliberate (see the Phase 2A migration's own
 * closing notes) and this file is the only place that boundary is crossed.
 */

const SANDBOX_BASE_URL = "https://dev.toyyibpay.com";
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Hard environment gate. TOYYIBPAY_ENV must be the literal string
 * "sandbox" -- never inferred from NODE_ENV (a production Vercel build can
 * still run with sandbox credentials, and a local dev server must never be
 * trusted to "figure out" it's safe). Phase 2B has no production code path
 * at all: any value other than exactly "sandbox" is a hard failure, not a
 * fallback to some other base URL.
 */
function assertSandboxEnvironment(): void {
  const env = process.env.TOYYIBPAY_ENV;
  if (env !== "sandbox") {
    throw new Error(
      "ToyyibPay: TOYYIBPAY_ENV must be exactly 'sandbox' for this build of the app. Refusing to make any ToyyibPay request."
    );
  }
}

function getCredentials(): { userSecretKey: string; categoryCode: string } {
  assertSandboxEnvironment();
  const userSecretKey = process.env.TOYYIBPAY_USER_SECRET_KEY;
  const categoryCode = process.env.TOYYIBPAY_CATEGORY_CODE;
  if (!userSecretKey || !categoryCode) {
    // Never include the actual (missing/empty) values in this message.
    throw new Error("ToyyibPay: TOYYIBPAY_USER_SECRET_KEY / TOYYIBPAY_CATEGORY_CODE are not configured on this server.");
  }
  return { userSecretKey, categoryCode };
}

/**
 * ToyyibPay's billName/billDescription accept only alphanumeric characters,
 * space, and underscore, per the Create Bill API reference. Strips
 * anything else rather than rejecting -- this is presentation text, not a
 * value the DB trusts for anything.
 */
function sanitizeToyyibpayText(input: string, maxLen: number): string {
  const cleaned = input.replace(/[^a-zA-Z0-9 _]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, maxLen);
}

async function postForm(path: string, params: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${SANDBOX_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`ToyyibPay request to ${path} timed out after ${REQUEST_TIMEOUT_MS}ms.`);
    }
    throw new Error(`ToyyibPay request to ${path} failed: network error.`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`ToyyibPay request to ${path} returned HTTP ${response.status}.`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`ToyyibPay request to ${path} returned a non-JSON response.`);
  }
}

export interface CreateBillInput {
  /** Used as billName -- sanitized to ToyyibPay's alphanumeric/space/underscore rule. */
  invoiceNo: string;
  /** Used as billDescription -- sanitized the same way. */
  description: string;
  /** Integer sen, server-computed only -- never accepted from the browser. */
  amountSen: number;
  returnUrl: string;
  callbackUrl: string;
  /** billExternalReferenceNo -- the local payment-attempt UUID, not the invoice number (see architecture audit: an invoice can have multiple attempts over time). */
  externalReferenceNo: string;
  billTo: string;
  billEmail?: string | null;
  billPhone?: string | null;
}

export interface CreateBillResult {
  billCode: string;
  paymentUrl: string;
}

/**
 * POST /index.php/api/createBill. ToyyibPay responds with a JSON array --
 * `[{ "BillCode": "..." }]` on success, or `[{ "msg": "...", "status": "error" }]`
 * (schema not fully confirmed against a live sandbox response at the time
 * this was written -- both shapes are handled defensively, and any other
 * shape is treated as an error rather than assumed successful).
 */
export async function createBill(input: CreateBillInput): Promise<CreateBillResult> {
  const { userSecretKey, categoryCode } = getCredentials();

  if (!Number.isInteger(input.amountSen) || input.amountSen <= 0) {
    throw new Error("ToyyibPay createBill: amountSen must be a positive integer.");
  }

  const billName = sanitizeToyyibpayText(input.invoiceNo, 30);
  const billDescription = sanitizeToyyibpayText(input.description, 100) || billName;
  const billTo = sanitizeToyyibpayText(input.billTo, 100) || "Customer";

  const raw = await postForm("/index.php/api/createBill", {
    userSecretKey,
    categoryCode,
    billName,
    billDescription,
    billPriceSetting: "1", // fixed amount -- never dynamic/open pricing
    billPayorInfo: "1",
    billAmount: String(input.amountSen),
    billReturnUrl: input.returnUrl,
    billCallbackUrl: input.callbackUrl,
    billExternalReferenceNo: input.externalReferenceNo,
    billTo,
    billEmail: input.billEmail ?? "",
    billPhone: input.billPhone ?? "",
    billPaymentChannel: "2", // FPX + card
  });

  const first = Array.isArray(raw) ? raw[0] : raw;
  const billCode = first && typeof first === "object" && "BillCode" in first ? String((first as Record<string, unknown>).BillCode) : null;

  if (!billCode) {
    const msg = first && typeof first === "object" && "msg" in first ? String((first as Record<string, unknown>).msg) : "unknown error";
    throw new Error(`ToyyibPay createBill did not return a BillCode: ${msg}`);
  }

  return { billCode, paymentUrl: `${SANDBOX_BASE_URL}/${billCode}` };
}

export interface InactivateBillResult {
  /** Best-effort: true only if ToyyibPay's response is recognizably a success. Callers must not assume true on ambiguous responses. */
  success: boolean;
  raw: unknown;
}

/**
 * POST /index.php/api/inactiveBill -- compensation call for the
 * provider-orphan-bill scenario (Create Bill HTTP succeeded, the local DB
 * record failed after bounded retries). Never called from any code path
 * that isn't specifically that compensation flow.
 */
export async function inactivateBill(billCode: string): Promise<InactivateBillResult> {
  const { userSecretKey } = getCredentials();
  if (!billCode || billCode.trim().length === 0) {
    throw new Error("ToyyibPay inactivateBill: billCode is required.");
  }

  const raw = await postForm("/index.php/api/inactiveBill", {
    userSecretKey,
    billCode,
  });

  const first = Array.isArray(raw) ? raw[0] : raw;
  const status = first && typeof first === "object" && "status" in first ? String((first as Record<string, unknown>).status) : null;
  // ToyyibPay's exact success-status vocabulary for this endpoint is not
  // confirmed against a live response -- treat anything other than an
  // explicit error/failure marker as inconclusive, not as confirmed
  // success. Callers (the orphan-compensation flow) must log the raw
  // response either way and never assume success silently.
  const success = status !== null && status !== "error" && status !== "0";

  return { success, raw };
}

/**
 * RM (numeric(12,2), e.g. from a Postgres numeric column read as a string
 * by supabase-js) -> ToyyibPay sen (integer). Decimal-string arithmetic
 * only -- never `Number(x) * 100`, which is exactly the floating-point
 * financial-truth risk this function exists to avoid (e.g. 1.15 * 100 is
 * not exactly 115 in IEEE 754 binary floating point).
 *
 * Accepts up to 2 decimal places (invoices/invoice_payments amounts are
 * always numeric(12,2)); rejects anything else rather than silently
 * truncating or rounding a value it wasn't given permission to round.
 *
 * Verified against every example in the Phase 2B task spec:
 *   "1.00"     -> 100
 *   "1272.00"  -> 127200
 *   "0.01"     -> 1
 *   "99999.99" -> 9999999
 */
export function ringgitStringToSen(value: string): number {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`ringgitStringToSen: "${value}" is not a valid RM amount string.`);
  }
  const [, whole, frac = ""] = match;
  const fracPadded = (frac + "00").slice(0, 2);
  const sen = Number(whole) * 100 + Number(fracPadded);
  if (!Number.isSafeInteger(sen)) {
    throw new Error(`ringgitStringToSen: "${value}" produces an unsafe integer sen value.`);
  }
  return sen;
}
