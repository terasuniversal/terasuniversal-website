import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { hasMinRole } from "../../../../lib/auth/rbac";

export const runtime = "nodejs";

async function requireAdmin({ manage = false } = {}) {
  const client = await createSupabaseServerClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return { response: NextResponse.json({ error: "Sesi admin telah tamat. Sila log masuk semula." }, { status: 401 }) };
  const { data: profile, error: profileError } = await client.from("profiles").select("role, is_active").eq("id", userData.user.id).maybeSingle();
  if (profileError || !profile?.is_active || !hasMinRole(profile.role, manage ? "admin" : "editor")) return { response: NextResponse.json({ error: "Akses admin tidak dibenarkan." }, { status: 403 }) };
  const { data: moduleAllowed, error: moduleError } = await client.rpc("has_module_access_level", {
    p_module_key: "certificates",
    p_level: manage ? "admin" : "view",
  });
  if (moduleError || moduleAllowed !== true) return { response: NextResponse.json({ error: "Akses admin tidak dibenarkan." }, { status: 403 }) };
  return { client, userId: userData.user.id };
}

// Legacy certificate import is retired (Owner decision 2026-11-23): it has no UI caller, created participants and
// courses outside the canonical issuance flow, and is not part of the TERAS CRM workflow. Its actions answer 410 so
// any stale client fails loudly instead of writing. Historical participant imports use /admin/participants/legacy-import.
const LEGACY_IMPORT_RETIRED = "Import sijil legasi telah ditamatkan. Gunakan aliran pengeluaran sijil semasa.";

export async function GET(request) {
  const auth = await requireAdmin(); if (auth.response) return auth.response;
  const { data, error } = await auth.client.from("certificates").select("*").is("deleted_at", null).order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ rows: data || [] });
}

export async function POST(request) {
  const auth = await requireAdmin({ manage: true }); if (auth.response) return auth.response;
  let body; try { body = await request.json(); } catch { return NextResponse.json({ error: "Permintaan tidak sah." }, { status: 400 }); }
  const action = body?.action;
  if (action === "create" || action === "update") {
    return NextResponse.json({ error: "Modern certificate creation/editing must use the canonical eligibility and issuance flow." }, { status: 409 });
  }
  if (action === "delete") {
    const { error } = await auth.client.rpc("set_certificate_deleted", { p_certificate_id: body.id, p_deleted: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 }); return NextResponse.json({ ok: true });
  }
  if (action === "legacy_import" || action === "log") {
    return NextResponse.json({ error: LEGACY_IMPORT_RETIRED }, { status: 410 });
  }
  if (action === "bulk") return NextResponse.json({ error: "Use the explicit legacy_import action for historical certificate imports." }, { status: 409 });
  return NextResponse.json({ error: "Operasi tidak dikenali." }, { status: 400 });
}
