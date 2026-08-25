import { NextRequest, NextResponse } from "next/server";
import { verifyCallbackHash, getBillTransactions, parseToyyibpayTransactionDate } from "../../../../../lib/payments/toyyibpay";
import { createSupabaseServiceClient } from "../../../../../lib/supabase/server";

/**
 * ToyyibPay Phase 2C callback -- public, provider-facing, no staff login.
 * Not covered by middleware.ts (matcher is /admin/:path* only, per this
 * repo's own documented rule) -- this route implements its own complete
 * authorization/validation boundary from scratch.
 *
 * Every response is the same generic "OK" regardless of outcome: this
 * route never reveals whether a BillCode/order_id exists, matched, or why
 * anything was rejected -- an attacker probing this endpoint learns
 * nothing from the HTTP response itself. Real signal only ever goes to
 * audit_logs (server-side), never back in the response body.
 *
 * No financial mutation happens directly in this Route Handler -- every
 * write goes through one of the three narrowly-scoped, service-role-only
 * RPCs added in the Phase 2C migration
 * (finalize_toyyibpay_payment_from_callback /
 * mark_toyyibpay_attempt_failed_from_callback /
 * log_toyyibpay_callback_event), each of which independently re-validates
 * everything about the attempt's current state -- this route resolves and
 * verifies, the RPCs decide and commit.
 */

export const dynamic = "force-dynamic";

// Stateless-only cost bound: no shared/distributed rate-limit store exists
// in this codebase today (the one precedent, the login/reset-password
// limiter, is an in-memory Map -- explicitly flagged elsewhere in this
// repo as broken across serverless instances, and this task explicitly
// says not to repeat that pattern as "the only protection"). What IS done
// here, honestly labeled as a cost bound rather than a rate limit: reject
// oversized bodies before parsing, and fail closed on cheap checks
// (required fields, hash) before ever touching the database or making an
// outbound HTTP call -- so even a high-volume abuse burst is individually
// inexpensive per request. True distributed rate limiting would need a
// shared counter store (e.g. a Postgres-table-backed limiter, or a
// managed service) that does not exist in this project yet -- flagged as
// a gap in the Phase 2C report, not silently pretended away.
const MAX_BODY_BYTES = 8 * 1024;

function genericResponse() {
  return new NextResponse("OK", { status: 200 });
}

function extractFields(params: URLSearchParams) {
  return {
    refno: params.get("refno"),
    status: params.get("status"),
    reason: params.get("reason"),
    billcode: params.get("billcode"),
    orderId: params.get("order_id"),
    amount: params.get("amount"),
    transactionTime: params.get("transaction_time"),
    hash: params.get("hash"),
  };
}

type SupabaseServiceClient = ReturnType<typeof createSupabaseServiceClient>;

/**
 * Every call to log_toyyibpay_callback_event checks its own { error } and
 * console.errors (server-side only, no secret/PII) on failure -- an audit
 * write failing must never throw, but it must not be silently invisible
 * either (Phase 2C real-contract-recovery fix, item 3).
 */
async function logCallbackEvent(
  supabase: SupabaseServiceClient,
  attemptId: string | null,
  eventType: "invalid_hash" | "missing_fields" | "unknown_billcode_or_order_id" | "billcode_mismatch" | "verification_failed" | "no_matching_transaction",
  detail: Record<string, unknown>
) {
  const { error } = await supabase.rpc("log_toyyibpay_callback_event", {
    p_attempt_id: attemptId,
    p_event_type: eventType,
    p_detail: detail,
  });
  if (error) {
    console.error("[toyyibpay-callback] log_toyyibpay_callback_event failed", { eventType, message: error.message });
  }
}

/**
 * Top-level safe exception boundary: every code path below this point
 * already returns genericResponse() explicitly, but a small number of
 * calls (e.g. verifyCallbackHash() -> getCredentials() throwing when
 * TOYYIBPAY_ENV/credentials aren't configured -- the exact bare-500 defect
 * this boundary was added to close) can throw before reaching their own
 * try/catch. Nothing here changes parsing, hash, Get Bill Transactions,
 * finalization, or RPC logic -- this only guarantees that ANY unexpected
 * throw still ends in the same generic response, after logging the real
 * reason server-side only (message text, never a full error object that
 * could carry a stack trace or secret value).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await handleCallback(req);
  } catch (err) {
    console.error("[toyyibpay-callback] unexpected error", { message: err instanceof Error ? err.message : String(err) });
    return genericResponse();
  }
}

async function handleCallback(req: NextRequest): Promise<NextResponse> {
  const callbackReceivedAt = new Date().toISOString();
  const supabase = createSupabaseServiceClient();

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return genericResponse();
  }

  const contentType = req.headers.get("content-type") ?? "";
  let params: URLSearchParams;
  try {
    if (contentType.includes("application/json")) {
      const json = (await req.json()) as Record<string, unknown>;
      params = new URLSearchParams();
      for (const [k, v] of Object.entries(json)) params.set(k, String(v ?? ""));
    } else if (contentType.includes("multipart/form-data")) {
      // Real ToyyibPay sandbox callbacks arrive this way (confirmed live,
      // 2026-08-25) -- req.text() + URLSearchParams is NOT valid for this
      // encoding (it mis-parses the whole MIME body as one garbage key,
      // losing every field). formData() is the correct Web API parser.
      const form = await req.formData();
      params = new URLSearchParams();
      for (const [k, v] of form.entries()) {
        // ToyyibPay never sends file parts; a File/Blob value here would
        // stringify to "[object File]" -- skip rather than corrupt.
        if (typeof v === "string") params.set(k, v);
      }
    } else if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      params = new URLSearchParams(text);
    } else {
      // Unsupported content type -- fail closed, no parsing attempt, no
      // raw-body logging (may contain unnecessary provider/customer data).
      await logCallbackEvent(supabase, null, "missing_fields", { reason: "unsupported_content_type", content_type: contentType });
      return genericResponse();
    }
  } catch {
    return genericResponse();
  }

  const fields = extractFields(params);

  // Phase 2C QA diagnostic ONLY: log which field NAMES were actually
  // received (never values -- refno/order_id/amount are not secrets but
  // are still real data, and hash/status could theoretically be sensitive
  // in combination) so the real contract can be confirmed against the
  // documented assumption before this route is declared final. Field
  // names only, never the hash value itself, never the secret key.
  console.log("[toyyibpay-callback] received field names:", Array.from(params.keys()));

  if (!fields.status || !fields.billcode || !fields.orderId || !fields.refno) {
    await logCallbackEvent(supabase, null, "missing_fields", { received_field_names: Array.from(params.keys()) });
    return genericResponse();
  }

  // Hash validation -- server-only, before any DB/HTTP work. Missing or
  // invalid hash is a hard stop: no fallback to trusting the callback body.
  if (!fields.hash || !verifyCallbackHash({ status: fields.status, orderId: fields.orderId, refno: fields.refno, hash: fields.hash })) {
    await logCallbackEvent(supabase, null, "invalid_hash", { billcode: fields.billcode, order_id: fields.orderId });
    return genericResponse();
  }

  // Resolve the attempt by BOTH billcode AND order_id (order_id is our own
  // attempt UUID) -- the invoice id itself is never taken from the
  // callback at all, only ever derived server-side from this row.
  const { data: attempt, error: attemptLookupError } = await supabase
    .from("invoice_payments")
    .select("id, invoice_id, provider_bill_code, status")
    .eq("id", fields.orderId)
    .eq("payment_provider", "toyyibpay")
    .maybeSingle();

  if (attemptLookupError) {
    // A failed lookup is not the same as "no matching attempt" -- don't
    // misclassify a transient DB error as unknown_billcode_or_order_id.
    console.error("[toyyibpay-callback] invoice_payments lookup failed", { message: attemptLookupError.message });
    await logCallbackEvent(supabase, null, "verification_failed", { billcode: fields.billcode, reason: "attempt_lookup_error" });
    return genericResponse();
  }

  if (!attempt || attempt.provider_bill_code !== fields.billcode) {
    await logCallbackEvent(supabase, attempt?.id ?? null, attempt ? "billcode_mismatch" : "unknown_billcode_or_order_id", {
      billcode: fields.billcode,
      order_id: fields.orderId,
    });
    return genericResponse();
  }

  // Never trust the callback's own status/amount for money -- always
  // confirm server-to-server via Get Bill Transactions before any
  // financial mutation.
  let transactions;
  try {
    transactions = await getBillTransactions(fields.billcode);
  } catch {
    await logCallbackEvent(supabase, attempt.id, "verification_failed", { billcode: fields.billcode });
    return genericResponse();
  }

  const tx = transactions.find((t) => t.billCode === fields.billcode) ?? transactions[0];
  if (!tx) {
    await logCallbackEvent(supabase, attempt.id, "no_matching_transaction", { billcode: fields.billcode });
    return genericResponse();
  }

  if (tx.providerStatus === "successful") {
    if (!tx.providerTransactionId || !tx.amount) {
      await logCallbackEvent(supabase, attempt.id, "verification_failed", {
        billcode: fields.billcode,
        reason: "successful status but missing transaction id or amount",
      });
      return genericResponse();
    }

    // Provider transaction time: parsed and validated, but timezone is
    // unconfirmed (see parseToyyibpayTransactionDate) -- never passed as
    // p_provider_transaction_time while that's true, so the RPC's own
    // coalesce(..., now()) uses TERAS's own verification time for
    // paid_at instead of an unverified provider clock reading. The raw
    // + parsed values are still preserved in raw_response as evidence.
    const parsedTime = tx.transactionTime ? parseToyyibpayTransactionDate(tx.transactionTime) : null;
    const rawResponseWithEvidence = {
      ...(tx.raw as object),
      _teras_provider_time_evidence: parsedTime ?? { raw: tx.transactionTime, parseFailed: true },
    };

    const { data: finalizeResult, error: finalizeError } = await supabase.rpc("finalize_toyyibpay_payment_from_callback", {
      p_attempt_id: attempt.id,
      p_billcode: fields.billcode,
      p_verified_amount: tx.amount,
      p_provider_transaction_id: tx.providerTransactionId,
      p_provider_transaction_time: null,
      p_callback_received_at: callbackReceivedAt,
      p_raw_response: rawResponseWithEvidence,
    });
    if (finalizeError) {
      // The RPC itself failed (constraint, cast, connectivity, etc.) --
      // this must never be treated as a successful finalize. No financial
      // state was changed by a failed RPC call; log and stop, never claim
      // success.
      console.error("[toyyibpay-callback] finalize_toyyibpay_payment_from_callback failed", { attemptId: attempt.id, message: finalizeError.message });
      await logCallbackEvent(supabase, attempt.id, "verification_failed", {
        billcode: fields.billcode,
        reason: "finalize_rpc_error",
      });
      return genericResponse();
    }
    void finalizeResult; // outcome already logged by the RPC itself (finalized/duplicate_ignored/reconciliation_required/amount_exceeds_balance)
    return genericResponse();
  }

  if (tx.providerStatus === "unsuccessful") {
    const { error: markFailedError } = await supabase.rpc("mark_toyyibpay_attempt_failed_from_callback", {
      p_attempt_id: attempt.id,
      p_billcode: fields.billcode,
      p_callback_received_at: callbackReceivedAt,
      p_reason: fields.reason ?? "provider reported unsuccessful",
    });
    if (markFailedError) {
      console.error("[toyyibpay-callback] mark_toyyibpay_attempt_failed_from_callback failed", { attemptId: attempt.id, message: markFailedError.message });
      await logCallbackEvent(supabase, attempt.id, "verification_failed", {
        billcode: fields.billcode,
        reason: "mark_failed_rpc_error",
      });
    }
    return genericResponse();
  }

  // "pending" or "unknown" -- leave the local attempt exactly as-is. No
  // mutation, no log noise for the ordinary in-flight case.
  return genericResponse();
}

export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405 });
}
