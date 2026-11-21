import { NextResponse } from "next/server";
import { checkSharedRateLimit, hashedClientId } from "../../../../lib/rate-limit";
import {
  clientIp,
  isTrustedRegistrationOrigin,
  publicErrorMessage,
  publicRegistrationPaymentSchema,
  registrationReferenceBucket,
} from "../../../../lib/public-registration";
import { createBill, inactivateBill, ringgitStringToSen, getToyyibpayCapability } from "../../../../lib/payments/toyyibpay";
import { canonicalSiteOrigin } from "../../../../lib/site-origin";
import { createSupabaseServiceClient } from "../../../../lib/supabase/server";
import { publicRegistrationEnabled, REGISTRATION_DISABLED_MESSAGE } from "../../../../lib/public-registration-gate";

export const runtime = "nodejs";

// PKG-1b: a new ToyyibPay bill is only created while at least this much of the registration hold remains, and the bill
// expires no later than the hold itself. Bill expiry narrows the late-payment window; it does not by itself prevent a
// late payment from being confirmed over capacity (database-side capacity integrity is PKG-1c).
const MIN_HOLD_REMAINING_MS = 60_000;

export async function POST(request: Request) {
  // F-1: no new payment attempt and no ToyyibPay bill while public registration is switched off. Checked before the
  // database and before ToyyibPay; callbacks for payments started earlier are separate routes and are not affected.
  if (!publicRegistrationEnabled()) return NextResponse.json({ error: REGISTRATION_DISABLED_MESSAGE }, { status: 503 });
  if (!isTrustedRegistrationOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (!(await checkSharedRateLimit({ key: `registration:payment:${hashedClientId(clientIp(request))}`, windowSeconds: 60, maxAttempts: 3, failClosed: true }))) {
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

  // PKG-1b: a second shared, fail-closed bucket per registration reference (digest only), so one registration cannot be
  // driven from many addresses. The per-address bucket above is unchanged.
  const referenceBucket = hashedClientId(registrationReferenceBucket(parsed.data.registration_reference));
  if (!(await checkSharedRateLimit({ key: `registration:payment-ref:${referenceBucket}`, windowSeconds: 60, maxAttempts: 3, failClosed: true }))) {
    return NextResponse.json({ error: "Please wait a moment before trying again." }, { status: 429 });
  }

  // PKG-1: begin_public_registration_payment is EXECUTE-able by service_role only. The server-only service client is
  // built after every public check above; the RPC itself still proves the reference and secret.
  let service: ReturnType<typeof createSupabaseServiceClient>;
  try {
    service = createSupabaseServiceClient();
  } catch (clientError) {
    console.error("Public registration payment service client unavailable", { message: clientError instanceof Error ? clientError.message : "Unknown error" });
    return NextResponse.json({ error: "We could not start payment. Please try again." }, { status: 503 });
  }
  const { data: attempt, error: beginError } = await service.rpc("begin_public_registration_payment", {
    p_registration_reference: parsed.data.registration_reference,
    p_registration_secret: parsed.data.registration_secret,
    p_provider: parsed.data.provider,
  });
  if (beginError || !attempt?.registration_reference) {
    console.error("Public registration payment begin failed", { code: beginError?.code, message: beginError?.message, client: hashedClientId(clientIp(request)) });
    return NextResponse.json({ error: publicErrorMessage(beginError) }, { status: 400 });
  }

  if (attempt.payment_url) return NextResponse.json({ payment_url: attempt.payment_url, status: attempt.status });
  if (attempt.bill_creation_owner !== true) {
    return NextResponse.json({ status: "bill_creation_in_progress", retry_after_seconds: 5 }, { status: 202 });
  }

  // The RPC deliberately returns no PII and no attempt id. Resolve them inside this server-only route; every lookup's
  // error is checked, and no bill is created after any database failure.
  const { data: registration, error: registrationError } = await service
    .from("public_registrations")
    .select("id, hold_expires_at")
    .eq("registration_reference", parsed.data.registration_reference)
    .maybeSingle();
  if (registrationError) {
    console.error("Public registration payment lookup failed", { step: "registration", message: registrationError.message });
    return NextResponse.json({ error: "We could not start payment. Please try again." }, { status: 502 });
  }
  if (!registration?.id) {
    return NextResponse.json({ error: "We could not start payment. Please try again." }, { status: 400 });
  }
  const { data: attemptRow, error: attemptError } = await service
    .from("public_registration_payments")
    .select("id, amount, payment_url, bill_creation_state")
    .eq("registration_id", registration.id)
    .eq("payment_provider", "toyyibpay")
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (attemptError) {
    console.error("Public registration payment lookup failed", { step: "attempt", message: attemptError.message });
    return NextResponse.json({ error: "We could not start payment. Please try again." }, { status: 502 });
  }
  if (!attemptRow?.id || attemptRow.bill_creation_state !== "claimed") {
    return NextResponse.json({ error: "We could not start payment. Please try again." }, { status: 502 });
  }

  // From here this request owns the claimed attempt: any refusal releases it, so the payer can start again.
  const releaseClaim = async (reason: string) => {
    const { error: releaseError } = await service.rpc("fail_public_registration_payment_setup", { p_attempt_id: attemptRow.id, p_reason: reason });
    if (releaseError) console.error("Public registration payment claim release failed", { message: releaseError.message });
  };

  const { data: payerRow, error: payerError } = await service
    .from("public_registration_attendees")
    .select("full_name, email, phone")
    .eq("registration_id", registration.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (payerError) {
    console.error("Public registration payment lookup failed", { step: "payer", message: payerError.message });
    await releaseClaim("payer lookup failed before bill creation");
    return NextResponse.json({ error: "We could not start payment. Please try again." }, { status: 502 });
  }

  const holdEndsAt = registration.hold_expires_at ? new Date(registration.hold_expires_at) : null;
  if (!holdEndsAt || !Number.isFinite(holdEndsAt.getTime()) || holdEndsAt.getTime() - Date.now() < MIN_HOLD_REMAINING_MS) {
    await releaseClaim("registration hold too close to expiry for a new bill");
    return NextResponse.json({ error: publicErrorMessage(new Error("registration_expired")) }, { status: 409 });
  }

  try {
    const origin = await canonicalSiteOrigin();
    const bill = await createBill({
      invoiceNo: parsed.data.registration_reference,
      description: `TERAS training registration ${parsed.data.registration_reference}`,
      amountSen: ringgitStringToSen(String(attemptRow.amount)),
      returnUrl: `${origin}/payments/toyyibpay/registration-return?reference=${encodeURIComponent(parsed.data.registration_reference)}`,
      callbackUrl: `${origin}/api/payments/toyyibpay/registration-callback`,
      externalReferenceNo: String(attemptRow.id),
      billTo: payerRow?.full_name || "TERAS Training Participant",
      billEmail: payerRow?.email || null,
      billPhone: payerRow?.phone || null,
      expiresAt: holdEndsAt,
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
