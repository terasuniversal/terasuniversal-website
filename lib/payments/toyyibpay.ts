/**
 * ToyyibPay Phase 2B/2C -- server-only HTTP client. Never import this file
 * from a "use client" component or any code reachable from the browser --
 * it reads TOYYIBPAY_USER_SECRET_KEY, which must never leave the server
 * (same rule this codebase already applies to SUPABASE_SERVICE_ROLE_KEY).
 * Every export here is either a pure helper or a function that performs
 * exactly one outbound HTTP call -- no Postgres function ever calls out to
 * ToyyibPay; that boundary is deliberate (see the Phase 2A migration's own
 * closing notes) and this file is the only place that boundary is crossed.
 */

import { createHash, timingSafeEqual } from "crypto";

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

/**
 * Sen (integer) -> RM decimal string, e.g. for normalizing whatever amount
 * format Get Bill Transactions actually returns into the same numeric(12,2)
 * shape invoice_payments.amount already uses. Integer division/modulo only
 * -- no floating-point multiplication anywhere in this conversion either.
 */
export function senToRinggitString(sen: number): string {
  if (!Number.isSafeInteger(sen) || sen < 0) {
    throw new Error(`senToRinggitString: ${sen} is not a valid non-negative integer sen value.`);
  }
  const whole = Math.trunc(sen / 100);
  const cents = sen % 100;
  return `${whole}.${String(cents).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------
// Phase 2C: callback hash verification.
//
// Formula (CONFIRMED against a real live sandbox callback, 2026-08-25 --
// invoice INV-2026-0020, BillCode h2usjico):
//   MD5(userSecretKey + status + order_id + refno + "ok")
// An earlier real callback attempt on the same day (INV-2026-0019,
// BillCode 359tj155) arrived as multipart/form-data, which the route's
// body parser did not yet handle at the time, so that first callback's
// fields were never extracted (correctly rejected as missing_fields, no
// financial impact). Once multipart parsing was fixed, the next real
// callback verified successfully against this exact formula with no
// invalid_hash rejection -- confirmed, not merely assumed. If a future
// callback ever fails verification against this formula, that must be
// investigated and reported before the formula is touched again -- never
// silently adapted.

export interface CallbackHashInput {
  status: string;
  orderId: string;
  refno: string;
  hash: string;
}

/**
 * Server-only. Never logs the secret key, the computed expected hash, or
 * the received hash. Returns false (not an exception) for any
 * missing/malformed field -- callers must treat false identically
 * regardless of *why* verification failed, so no information about which
 * field was wrong is ever available to an attacker via timing or error
 * content.
 */
export function verifyCallbackHash(input: CallbackHashInput): boolean {
  const { userSecretKey } = getCredentials();
  if (!input.status || !input.orderId || !input.refno || !input.hash) return false;

  const expected = createHash("md5")
    .update(userSecretKey + input.status + input.orderId + input.refno + "ok")
    .digest("hex");

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(input.hash, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

// ---------------------------------------------------------------------
// Phase 2C: Get Bill Transactions -- the authoritative server-to-server
// verification call. A callback is never trusted for money on its own
// (per the architecture audit); this is what actually confirms it.

/** TERAS-internal provider status, kept deliberately separate from ToyyibPay's own numeric codes (documented: 1=successful, 2=pending, 3=unsuccessful, 4=pending). */
export type ProviderPaymentStatus = "successful" | "pending" | "unsuccessful" | "unknown";

export interface ProviderBillTransaction {
  /** The provider's own transaction reference (refno), used for the (payment_provider, provider_transaction_id) uniqueness check. */
  providerTransactionId: string | null;
  providerStatus: ProviderPaymentStatus;
  /** RM decimal string, numeric(12,2)-compatible -- normalized from whatever raw format the provider actually returns (confirmed empirically, see the Phase 2C QA report). */
  amount: string | null;
  billCode: string | null;
  /** ISO-ish timestamp string if the provider supplies one, else null -- never fabricated. */
  transactionTime: string | null;
  /** Preserved only for restricted invoice_payments.metadata storage -- never logged in full (may contain payer details). */
  raw: unknown;
}

// ---------------------------------------------------------------------
// Phase 2C real-contract fix: Get Bill Transactions' billPaymentDate was
// empirically observed (live sandbox payment, 2026-08-25) as
// "25-08-2026 04:00:35" -- DD-MM-YYYY HH:mm:ss, NOT ISO 8601. Passing
// this directly to a Postgres timestamptz parameter throws
// "22008: date/time field value out of range" (confirmed live), which
// would silently fail an RPC call unless the caller checks { error }.
//
// Timezone is NOT confirmed. ToyyibPay's API docs do not state one, and
// the one live data point available doesn't cleanly resolve it: the
// sandbox "Success" click and this timestamp were compared against the
// server's own wall-clock request time and neither a UTC nor a
// Malaysia-time (UTC+8) reading lines up closely enough to treat as
// confirmed -- sandbox environments are commonly clock-drifted. This
// function still parses and validates the value deterministically (so it
// can be preserved as evidence / used once timezone is confirmed), but
// `timezoneConfirmed` is always `false` today. Callers must NOT pass
// `isoAssumedUtc` as `p_provider_transaction_time` while it is false --
// pass null instead, so the finalize RPC's own
// `coalesce(p_provider_transaction_time, now())` falls back to TERAS's
// own verification time for `paid_at`, per explicit product decision.
export interface ParsedProviderTransactionTime {
  /** The exact raw string as returned by the provider, preserved for audit evidence regardless of parse outcome. */
  raw: string;
  /** Deterministic ISO 8601 string built by treating the parsed components as UTC. NOT necessarily correct wall-clock time -- see timezoneConfirmed. */
  isoAssumedUtc: string;
  /** Always false until ToyyibPay's actual timezone contract is confirmed by documentation or further live evidence. */
  timezoneConfirmed: false;
}

const TOYYIBPAY_DATE_PATTERN = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})$/;

/**
 * Strictly parses ToyyibPay's observed "DD-MM-YYYY HH:mm:ss" transaction
 * date format. Returns null (never throws) for anything that doesn't
 * match the pattern or fails calendar validation (e.g. day 31 in a
 * 30-day month, hour 24, Feb 30) -- a malformed provider date must be
 * rejected, not guessed at.
 */
export function parseToyyibpayTransactionDate(rawValue: string): ParsedProviderTransactionTime | null {
  const match = TOYYIBPAY_DATE_PATTERN.exec(rawValue.trim());
  if (!match) return null;

  const [, ddStr, mmStr, yyyyStr, hhStr, minStr, ssStr] = match;
  const day = Number(ddStr);
  const month = Number(mmStr);
  const year = Number(yyyyStr);
  const hour = Number(hhStr);
  const minute = Number(minStr);
  const second = Number(ssStr);

  if (year < 2000 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  if (day < 1 || day > 31) return null;

  // Calendar round-trip check -- catches day 30/31 in a short month, Feb 29
  // in a non-leap year, etc. Date.UTC normalizes out-of-range days into the
  // next month, so any drift from the input means it wasn't a real date.
  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const roundTrip = new Date(asUtcMs);
  if (
    roundTrip.getUTCFullYear() !== year ||
    roundTrip.getUTCMonth() !== month - 1 ||
    roundTrip.getUTCDate() !== day ||
    roundTrip.getUTCHours() !== hour ||
    roundTrip.getUTCMinutes() !== minute ||
    roundTrip.getUTCSeconds() !== second
  ) {
    return null;
  }

  return { raw: rawValue, isoAssumedUtc: roundTrip.toISOString(), timezoneConfirmed: false };
}

function mapProviderStatus(rawStatus: unknown): ProviderPaymentStatus {
  const s = String(rawStatus ?? "").trim();
  if (s === "1") return "successful";
  if (s === "2" || s === "4") return "pending";
  if (s === "3") return "unsuccessful";
  return "unknown";
}

/**
 * POST /index.php/api/getBillTransactions. Field-name normalization
 * confirmed against a real sandbox response (2026-08-25, live paid bill):
 * `billpaymentStatus`, `billpaymentAmount`, `billpaymentInvoiceNo` all
 * matched this function's first-choice keys exactly. `billPaymentDate`
 * also matched, but its value format ("25-08-2026 04:00:35", DD-MM-YYYY)
 * is NOT ISO 8601 -- see parseToyyibpayTransactionDate above; callers
 * must run transactionTime through that parser, never pass it to
 * Postgres directly. The other candidate key spellings kept in the
 * fallback chains below remain unconfirmed/defensive -- not yet
 * disproven, just never observed in the one real response captured so
 * far.
 */
export async function getBillTransactions(billCode: string): Promise<ProviderBillTransaction[]> {
  const { userSecretKey } = getCredentials();
  if (!billCode || billCode.trim().length === 0) {
    throw new Error("ToyyibPay getBillTransactions: billCode is required.");
  }

  const raw = await postForm("/index.php/api/getBillTransactions", {
    userSecretKey,
    billCode,
  });

  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];

  return rows.map((row): ProviderBillTransaction => {
    const r = (row ?? {}) as Record<string, unknown>;
    const statusRaw = r.billpaymentStatus ?? r.billPaymentStatus ?? r.status;
    const refnoRaw = r.billpaymentInvoiceNo ?? r.refno ?? r.billplzTransactionId ?? r.transaction_id ?? null;
    const amountRaw = r.billpaymentAmount ?? r.billPaymentAmount ?? r.amount ?? null;
    const timeRaw = r.billPaymentDate ?? r.billpaymentDate ?? r.transaction_time ?? r.paidAt ?? null;
    const billCodeRaw = r.billCode ?? r.billpaymentBillCode ?? billCode;

    return {
      providerTransactionId: refnoRaw !== null ? String(refnoRaw) : null,
      providerStatus: mapProviderStatus(statusRaw),
      amount: amountRaw !== null && amountRaw !== undefined ? String(amountRaw) : null,
      billCode: billCodeRaw !== null ? String(billCodeRaw) : null,
      transactionTime: timeRaw !== null && timeRaw !== undefined ? String(timeRaw) : null,
      raw: row,
    };
  });
}
