import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getAdminClient(request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY; const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !key || !token) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
}

async function requireAdmin(request) {
  const client = getAdminClient(request);
  if (!client) return { response: NextResponse.json({ error: "Sesi admin tidak sah. Sila log masuk semula." }, { status: 401 }) };
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return { response: NextResponse.json({ error: "Sesi admin telah tamat. Sila log masuk semula." }, { status: 401 }) };
  const { data: admin, error: adminError } = await client.from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (adminError || !admin) return { response: NextResponse.json({ error: "Akses admin tidak dibenarkan." }, { status: 403 }) };
  return { client, userId: userData.user.id };
}

function validateCourseDates(form) {
  const startDate = String(form?.course_date || "").trim();
  const endDate = String(form?.course_end_date || "").trim();
  if (endDate && !startDate) return "Course start date diperlukan apabila course end date diisi.";
  if (endDate && endDate < startDate) return "Course end date tidak boleh lebih awal daripada course start date.";
  return null;
}
function certificatePayload(form, ids = {}) {
  return { ...ids, participant_name: String(form?.participant_name || "").trim(), course_name: String(form?.course_name || "").trim(), certificate_no: String(form?.certificate_no || "").trim().toUpperCase(), training_start_date: form?.course_date || null, training_end_date: form?.course_end_date || null, issue_date: form?.course_date || null, expiry_date: form?.expiry_date || null, status: ["valid", "expired", "revoked"].includes(form?.status) ? form.status : "valid", trainer_name: String(form?.instructor || "").trim() || null, venue: String(form?.venue || "").trim() || null, identity_no: String(form?.identity_no || "").trim().toUpperCase() || null, instructor: String(form?.instructor || "").trim() || null, certificate_file_url: String(form?.certificate_file_url || "").trim() || null, public_verification_enabled: form?.public_verification_enabled !== false };
}

async function createRecord(client, form) {
  const required = ["participant_name", "identity_no", "course_name", "course_date", "certificate_no"];
  if (required.some((field) => !String(form?.[field] || "").trim())) return "Medan wajib tidak lengkap.";
  const dateError = validateCourseDates(form);
  if (dateError) return dateError;
  const { data: participant, error: participantError } = await client.from("participants").insert({ full_name: String(form.participant_name).trim(), identity_no: String(form.identity_no).trim().toUpperCase(), identity_last4: String(form.identity_no).trim().slice(-4), status: "active" }).select("id").single();
  if (participantError) return participantError.message;
  const { data: course, error: courseError } = await client.from("courses").insert({ course_name: String(form.course_name).trim(), active: true }).select("id").single();
  if (courseError) return courseError.message;
  const { error: certificateError } = await client.from("certificates").insert(certificatePayload(form, { participant_id: participant.id, course_id: course.id }));
  return certificateError?.message || null;
}

export async function GET(request) {
  const auth = await requireAdmin(request); if (auth.response) return auth.response;
  const { data, error } = await auth.client.from("certificates").select("*").order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ rows: data || [] });
}

export async function POST(request) {
  const auth = await requireAdmin(request); if (auth.response) return auth.response;
  let body; try { body = await request.json(); } catch { return NextResponse.json({ error: "Permintaan tidak sah." }, { status: 400 }); }
  const action = body?.action;
  if (action === "delete") {
    const { error } = await auth.client.from("certificates").delete().eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 }); return NextResponse.json({ ok: true });
  }
  if (action === "update") {
    const dateError = validateCourseDates(body.form);
    if (dateError) return NextResponse.json({ error: dateError }, { status: 400 });
    const { error } = await auth.client.from("certificates").update(certificatePayload(body.form)).eq("id", body.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 }); return NextResponse.json({ ok: true });
  }
  if (action === "create") {
    const error = await createRecord(auth.client, body.form || {});
    if (error) return NextResponse.json({ error }, { status: 400 }); return NextResponse.json({ ok: true });
  }
  if (action === "bulk") {
    const sourceRows = Array.isArray(body.rows) ? body.rows : [];
    if (!sourceRows.length) return NextResponse.json({ error: "Tiada rekod untuk diimport." }, { status: 400 });
    if (sourceRows.length > 500) return NextResponse.json({ error: "Maksimum 500 rekod untuk satu import." }, { status: 400 });
    let imported = 0; const errors = [];
    for (const row of sourceRows) { const error = await createRecord(auth.client, row); if (error) errors.push(`Baris ${row._row || imported + errors.length + 2}: ${error}`); else imported += 1; }
    return NextResponse.json({ ok: errors.length === 0, imported, failed: errors.length, errors });
  }
  if (action === "log") {
    const { error } = await auth.client.from("certificate_import_logs").insert({ created_by: auth.userId, source: body.source === "pdf" ? "pdf" : "csv", source_file_count: Number(body.source_count || 0), row_count: Number(body.row_count || 0), imported_count: Number(body.imported_count || 0), skipped_count: Number(body.skipped_count || 0), error_count: Number(body.error_count || 0), status: body.status || "completed", error_summary: Array.isArray(body.errors) ? body.errors.slice(0, 50) : [] });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Operasi tidak dikenali." }, { status: 400 });
}
