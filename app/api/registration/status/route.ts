import { NextResponse } from "next/server";
import { checkSharedRateLimit } from "../../../../lib/rate-limit";
import {
  clientIp,
  isAllowedOrigin,
  publicRegistrationStatusSchema,
} from "../../../../lib/public-registration";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isAllowedOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  if (!(await checkSharedRateLimit({ key: `registration:status:${clientIp(request)}`, windowSeconds: 60, maxAttempts: 10, failClosed: true }))) {
    return NextResponse.json({ error: "Please wait a moment before trying again." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const parsed = publicRegistrationStatusSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "We could not verify that registration." }, { status: 400 });

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("get_public_registration_status", {
    p_registration_reference: parsed.data.registration_reference,
    p_registration_secret: parsed.data.registration_secret,
  });
  if (error) {
    console.error("Public registration status lookup failed", { code: error.code, message: error.message, ip: clientIp(request) });
    return NextResponse.json({ error: "We could not verify that registration." }, { status: 400 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return NextResponse.json({ error: "We could not verify that registration." }, { status: 404 });
  return NextResponse.json({ registration: row });
}
