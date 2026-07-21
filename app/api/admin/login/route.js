import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured.");
  return { url, key };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const email = String(body?.email || "").trim();
    const password = String(body?.password || "");
    if (!email || !password) return NextResponse.json({ error: "Sila masukkan email dan kata laluan dahulu." }, { status: 400 });
    const { url, key } = getConfig();
    const authClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) return NextResponse.json({ error: error?.message || "Log masuk tidak berjaya." }, { status: 401 });
    const adminClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${data.session.access_token}` } } });
    const { data: admin, error: adminError } = await adminClient.from("admin_users").select("user_id").eq("user_id", data.user.id).maybeSingle();
    if (adminError || !admin) return NextResponse.json({ error: "Akaun ini belum didaftarkan sebagai admin TERAS UNIVERSAL." }, { status: 403 });
    return NextResponse.json({ session: data.session });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Log masuk tidak berjaya." }, { status: 500 });
  }
}
