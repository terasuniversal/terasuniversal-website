import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { email } = await request.json();
    const cleanEmail = String(email || "").trim();
    if (!cleanEmail) return NextResponse.json({ error: "Masukkan email admin dahulu." }, { status: 400 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return NextResponse.json({ error: "Supabase belum dikonfigurasi." }, { status: 503 });
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error } = await client.auth.resetPasswordForEmail(cleanEmail, { redirectTo: `${new URL(request.url).origin}/admin/certificates` });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Reset kata laluan tidak berjaya." }, { status: 500 });
  }
}
