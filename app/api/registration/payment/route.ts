import { NextResponse } from "next/server";
import { checkSharedRateLimit } from "../../../../lib/rate-limit";
import {
  clientIp,
  isAllowedOrigin,
  publicErrorMessage,
  publicRegistrationPaymentSchema,
} from "../../../../lib/public-registration";
import { createBill, inactivateBill, registrationCallbackUrl, ringgitStringToSen, getToyyibpayCapability } from "../../../../lib/payments/toyyibpay";
import { canonicalSiteOrigin } from "../../../../lib/site-origin";
import { createSupabaseServerClient, createSupabaseServiceClient } from "../../../../lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (!(await checkSharedRateLimit({ key: `registration:payment:${clientIp(request)}`, windowSeconds: 60, maxAttempts: 3, failClosed: true }))) {
    return NextResponse.json({ error: "Please wait a moment before trying again." }, { status: 429 });
  }
  if (!getToyyibpayCapability().enabled) {
    return NextResponse.json({ error: "Online payment is not available. TERAS can verify a bank-transfer payment instead." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = publicRegistrationPaymentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "We could not start payment for that registration." }, { status: 400 });

  const publicClient = await createSupabaseServerClient();
  const { data: attempt, error: beginError } = await publicClient.rpc("begin_public_registration_payment", {
    p_registration_reference: parsed.data.registration_reference,
    p_registration_secret: parsed.data.registration_secret,
    p_provider: parsed.data.provider,
  });
  if (beginError || !attempt?.registration_reference) {
    console.error("Public registration payment begin failed", { code: beginError?.code, message: beginError?.message, ip: clientIp(request) });
    return NextResponse.json({ error: publicErrorMessage(beginError) }, { status: 400 });
  }

  if (attempt.payment_url) return NextResponse.json({ payment_url: attempt.payment_url, status: attempt.status });
  if (attempt.bill_creation_owner !== true) {
    return NextResponse.json({ status: "bill_creation_in_progress", retry_after_seconds: 5 }, { status: 202 });
  }

  const service = createSupabaseServiceClient();
  // The public RPC deliberately does not return PII. Resolve the payer only
  // inside this server-only route using the opaque reference and service role.
  let payerRow: { full_name: string; email: string | null; phone: string | null } | null = null;
  const { data: registration } = await service
    .from("public_registrations")
    .select("id")
    .eq("registration_reference", parsed.data.registration_reference)
    .maybeSingle();
  if (registration?.id) {
    const { data: fallbackPayer } = await service
      .from("public_registration_attendees")
      .select("full_name, email, phone")
      .eq("registration_id", registration.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    payerRow = fallbackPayer;
  }

  if (!registration?.id) {
    return NextResponse.json({ error: "We could not start payment. Please try again." }, { status: 400 });
  }
  const { data: attemptRow } = await service
    .from("public_registration_payments")
    .select("id, amount, payment_url, bill_creation_state")
    .eq("registration_id", registration.id)
    .eq("payment_provider", "toyyibpay")
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!attemptRow?.id || attemptRow.bill_creation_state !== "claimed") {
    return NextResponse.json({ error: "We could not start payment. Please try again." }, { status: 502 });
  }

  try {
    const origin = await canonicalSiteOrigin();
    const bill = await createBill({
      invoiceNo: parsed.data.registration_reference,
      description: `TERAS training registration ${parsed.data.registration_reference}`,
      amountSen: ringgitStringToSen(String(attemptRow.amount)),
      returnUrl: `${origin}/payments/toyyibpay/registration-return?reference=${encodeURIComponent(parsed.data.registration_reference)}`,
      callbackUrl: registrationCallbackUrl(origin),
      externalReferenceNo: String(attemptRow.id),
      billTo: payerRow?.full_name || "TERAS Training Participant",
      billEmail: payerRow?.email || null,
      billPhone: payerRow?.phone || null,
    });

    const { data: attached, error: attachError } = await service.rpc("attach_public_registration_toyy_pay_bill", {
      p_attempt_id: attemptRow.id,
      p_bill_code: bill.billCode,
      p_payment_url: bill.paymentUrl,
    });
    if (attachError || !attached) {
      await inactivateBill(bill.billCode).catch((compensationError) => {
        console.error("ToyyibPay registration orphan compensation failed", { message: compensationError instanceof Error ? compensationError.message : "Unknown error" });
      });
      await service.rpc("record_public_registration_payment_orphan", { p_attempt_id: attemptRow.id, p_bill_code: bill.billCode, p_payment_url: bill.paymentUrl, p_reason: "local bill attachment failed" });
      return NextResponse.json({ error: "We could not start payment. Please try again." }, { status: 502 });
    }
    return NextResponse.json({ payment_url: bill.paymentUrl, status: "processing" });
  } catch (error) {
    await service.rpc("fail_public_registration_payment_setup", { p_attempt_id: attemptRow.id, p_reason: "provider bill creation failed" });
    console.error("ToyyibPay registration bill creation failed", { message: error instanceof Error ? error.message : "Unknown error" });
    return NextResponse.json({ error: "We could not start payment. Please try again or use bank transfer." }, { status: 502 });
  }
}
