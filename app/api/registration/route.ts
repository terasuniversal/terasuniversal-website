import { NextResponse } from "next/server";
import { checkSharedRateLimit } from "../../../lib/rate-limit";
import {
  clientIp,
  isAllowedOrigin,
  publicErrorMessage,
  publicRegistrationCreateSchema,
} from "../../../lib/public-registration";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (!(await checkSharedRateLimit({ key: `registration:create:${clientIp(request)}`, windowSeconds: 60, maxAttempts: 5, failClosed: true }))) {
    return NextResponse.json({ error: "Please wait a moment before trying again." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = publicRegistrationCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Please check the registration details.", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_public_registration", {
    p_schedule_id: parsed.data.schedule_id,
    p_idempotency_key: parsed.data.idempotency_key,
    p_registration_secret: parsed.data.registration_secret,
    p_attendees: parsed.data.attendees,
  });
  if (error) {
    console.error("Public registration creation failed", { code: error.code, message: error.message, ip: clientIp(request) });
    const status = error.message.includes("capacity_exceeded") ? 409 : error.message.includes("duplicate_registration") ? 409 : 400;
    return NextResponse.json({ error: publicErrorMessage(error) }, { status });
  }

  return NextResponse.json({ registration: data }, { status: 201 });
}
