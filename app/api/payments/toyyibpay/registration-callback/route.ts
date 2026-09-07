import { NextRequest, NextResponse } from "next/server";
import { checkSharedRateLimit } from "../../../../../lib/rate-limit";
import {
  getBillTransactions,
  parseToyyibpayTransactionDate,
  verifyCallbackHash,
} from "../../../../../lib/payments/toyyibpay";
import { createSupabaseServiceClient } from "../../../../../lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;

function genericResponse() {
  return new NextResponse("OK", { status: 200 });
}

function fields(params: URLSearchParams) {
  return {
    refno: params.get("refno"),
    status: params.get("status"),
    reason: params.get("reason"),
    billcode: params.get("billcode"),
    orderId: params.get("order_id"),
    transactionTime: params.get("transaction_time"),
    hash: params.get("hash"),
  };
}

async function logEvent(service: ReturnType<typeof createSupabaseServiceClient>, attemptId: string | null, eventType: string, detail: Record<string, unknown>) {
  const { error } = await service.rpc("log_public_registration_payment_event", {
    p_attempt_id: attemptId,
    p_event_type: eventType,
    p_detail: detail,
  });
  if (error) console.error("Public registration payment event logging failed", { eventType, message: error.message });
}

async function parseRequest(request: NextRequest): Promise<URLSearchParams | null> {
  const contentType = request.headers.get("content-type") || "";
  try {
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const params = new URLSearchParams();
      for (const [key, value] of form.entries()) if (typeof value === "string") params.set(key, value);
      return params;
    }
    if (contentType.includes("application/x-www-form-urlencoded")) return new URLSearchParams(await request.text());
    if (contentType.includes("application/json")) {
      const json = (await request.json()) as Record<string, unknown>;
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(json)) params.set(key, String(value ?? ""));
      return params;
    }
  } catch {
    return null;
  }
  return null;
}

export async function POST(request: NextRequest) {
  const service = createSupabaseServiceClient();
  try {
    const contentLength = Number(request.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) return genericResponse();
    const params = await parseRequest(request);
    if (!params) {
      await logEvent(service, null, "missing_fields", { reason: "unsupported_or_invalid_body" });
      return genericResponse();
    }

    const value = fields(params);
    if (!value.status || !value.billcode || !value.orderId || !value.refno || !value.hash) {
      await logEvent(service, null, "missing_fields", { received_field_names: Array.from(params.keys()) });
      return genericResponse();
    }
    if (!verifyCallbackHash({ status: value.status, orderId: value.orderId, refno: value.refno, hash: value.hash })) {
      await logEvent(service, null, "invalid_hash", { received_field_names: Array.from(params.keys()) });
      return genericResponse();
    }
    if (!(await checkSharedRateLimit({ key: `toyyibpay:registration-callback:${value.orderId}`, windowSeconds: 60, maxAttempts: 10 }))) {
      return genericResponse();
    }

    const { data: attempt, error: lookupError } = await service
      .from("public_registration_payments")
      .select("id, provider_bill_code, status")
      .eq("id", value.orderId)
      .eq("payment_provider", "toyyibpay")
      .maybeSingle();
    if (lookupError) {
      console.error("Public registration payment lookup failed", { message: lookupError.message });
      await logEvent(service, null, "verification_failed", { reason: "attempt_lookup_error" });
      return genericResponse();
    }
    if (!attempt) {
      await logEvent(service, null, "unknown_attempt", { billcode: value.billcode });
      return genericResponse();
    }
    if (attempt.provider_bill_code !== value.billcode) {
      await logEvent(service, attempt.id, "billcode_mismatch", {});
      return genericResponse();
    }

    let transactions;
    try {
      transactions = await getBillTransactions(value.billcode, { strictProviderBillCode: true });
    } catch (error) {
      console.error("ToyyibPay registration transaction lookup failed", { message: error instanceof Error ? error.message : "Unknown error" });
      await logEvent(service, attempt.id, "verification_failed", { reason: "provider_transaction_lookup_failed" });
      return genericResponse();
    }
    const transaction = transactions.find((item) => item.billCode === value.billcode);
    if (!transaction) {
      await logEvent(service, attempt.id, "no_matching_transaction", {});
      return genericResponse();
    }

    if (transaction.providerStatus === "successful") {
      if (!transaction.providerTransactionId || !transaction.amount) {
        await logEvent(service, attempt.id, "verification_failed", { reason: "missing_verified_fields" });
        return genericResponse();
      }
      const parsedTime = transaction.transactionTime ? parseToyyibpayTransactionDate(transaction.transactionTime) : null;
      const rawResponse = {
        ...(transaction.raw as object),
        _teras_provider_time_evidence: parsedTime ?? { raw: transaction.transactionTime, parseFailed: true },
      };
      const { error } = await service.rpc("finalize_public_registration_payment_from_callback", {
        p_attempt_id: attempt.id,
        p_bill_code: value.billcode,
        p_verified_amount: transaction.amount,
        p_provider_transaction_id: transaction.providerTransactionId,
        p_callback_received_at: new Date().toISOString(),
        p_raw_response: rawResponse,
      });
      if (error) {
        console.error("Public registration payment finalization failed", { attemptId: attempt.id, message: error.message });
        await logEvent(service, attempt.id, error.message.includes("amount_mismatch") ? "amount_mismatch" : "verification_failed", { reason: "finalization_failed" });
      }
      return genericResponse();
    }

    if (transaction.providerStatus === "unsuccessful") {
      const { error } = await service.rpc("mark_public_registration_payment_failed_from_callback", {
        p_attempt_id: attempt.id,
        p_bill_code: value.billcode,
        p_callback_received_at: new Date().toISOString(),
        p_reason: value.reason || "provider reported unsuccessful",
      });
      if (error) console.error("Public registration payment failure transition failed", { attemptId: attempt.id, message: error.message });
    }
    return genericResponse();
  } catch (error) {
    console.error("Public registration callback unexpected error", { message: error instanceof Error ? error.message : "Unknown error" });
    return genericResponse();
  }
}

export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405 });
}
