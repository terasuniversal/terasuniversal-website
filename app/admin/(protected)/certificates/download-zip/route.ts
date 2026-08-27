import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentProfile, hasModuleAccess } from "../../../../../lib/auth/session";
import { isAdmin } from "../../../../../lib/auth/rbac";
import { loadCertificateRender } from "../certData";
import { renderCertificateDocument } from "../../../../../lib/certificate-html";
import { createZip, safeFileName, type ZipEntry } from "../../../../../lib/zip";
import { writeAuditEvent } from "../../../../../lib/audit/server";

// The ZIP writer uses Node's Buffer — force the Node.js runtime (not Edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Bulk Certificate Download (Automation Centre).
 *   ?scheduleId=<uuid>          → every non-deleted certificate for a schedule
 *   ?ids=<id>,<id>,…            → an explicit selection of certificates
 * Bundles each certificate as a self-contained, printable HTML document into a
 * single .zip (STORE, dependency-free). Admin & Super Admin only. Every run is
 * recorded in automation_runs + the audit log.
 */
const MAX_CERTS = 500; // safety cap; larger batches should be split.

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active || !isAdmin(profile.role)) return new NextResponse("Forbidden", { status: 403 });
  if (!(await hasModuleAccess("certificates"))) return new NextResponse("Forbidden", { status: 403 });

  const p = request.nextUrl.searchParams;
  const scheduleId = p.get("scheduleId");
  const idsParam = p.get("ids");
  const supabase = await createSupabaseServerClient();

  // --- Resolve the target certificate ids ---
  let ids: string[] = [];
  let scope = "";
  if (idsParam) {
    ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    scope = `selection of ${ids.length}`;
  } else if (scheduleId) {
    const { data } = await supabase
      .from("certificates")
      .select("id")
      .eq("schedule_id", scheduleId)
      .is("deleted_at", null)
      .order("certificate_number");
    ids = (data ?? []).map((r: any) => r.id);
    scope = `schedule ${scheduleId}`;
  } else {
    return new NextResponse("Provide ?scheduleId= or ?ids=", { status: 400 });
  }

  if (ids.length === 0) return new NextResponse("No certificates found for the request.", { status: 404 });
  const capped = ids.slice(0, MAX_CERTS);

  // --- Render each certificate to a self-contained HTML document ---
  const entries: ZipEntry[] = [];
  const failed: { id: string; reason: string }[] = [];
  const usedNames = new Set<string>();

  for (const id of capped) {
    try {
      const r = await loadCertificateRender(id);
      if (!r) { failed.push({ id, reason: "not found" }); continue; }
      const html = renderCertificateDocument(r.data, r.config);
      const base = safeFileName(`${r.data.certificate_number || "certificate"}_${r.data.holder_name || ""}`);
      // Avoid collisions when two certs share a number/name.
      let name = `${base}.html`;
      let n = 2;
      while (usedNames.has(name)) { name = `${base}_${n++}.html`; }
      usedNames.add(name);
      entries.push({ name: `certificates/${name}`, data: html });
    } catch (e: any) {
      failed.push({ id, reason: e?.message ?? "render error" });
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);

  if (entries.length === 0) {
    // Record the failed run before returning.
    await supabase.from("automation_runs").insert({
      run_type: "bulk_download", status: "failed", summary: `Bulk certificate download (${scope}) — 0 rendered`,
      total_count: capped.length, success_count: 0, skipped_count: 0, failed_count: failed.length,
      params: { scope, scheduleId, ids_count: ids.length }, result: { failed },
    });
    return new NextResponse("No certificates could be rendered.", { status: 500 });
  }

  // A manifest listing what's inside.
  const manifestLines = [
    "TERAS UNIVERSAL — Certificate Bundle",
    `Generated: ${stamp}`,
    `Scope: ${scope}`,
    `Included: ${entries.length}`,
    ids.length > MAX_CERTS ? `NOTE: capped at ${MAX_CERTS} of ${ids.length} — split the batch to get the rest.` : "",
    failed.length ? `Skipped (${failed.length}): ${failed.map((f) => f.id).join(", ")}` : "",
  ].filter(Boolean);
  entries.push({ name: "MANIFEST.txt", data: manifestLines.join("\n") + "\n" });

  const zip = createZip(entries);

  // --- Record the automation run + audit ---
  const status = failed.length === 0 ? "success" : "partial";
  await supabase.from("automation_runs").insert({
    run_type: "bulk_download", status,
    summary: `Bulk certificate download (${scope}) — ${entries.length - 1} file(s)`,
    total_count: capped.length, success_count: entries.length - 1, skipped_count: 0, failed_count: failed.length,
    params: { scope, scheduleId, ids_count: ids.length, capped: ids.length > MAX_CERTS },
    result: { failed },
  });
  await writeAuditEvent({
    action: "export", entityType: "certificates",
    summary: `Bulk certificate ZIP: ${entries.length - 1} file(s) (${scope})`,
  });

  const filename = scheduleId ? `certificates-${safeFileName(scheduleId)}-${stamp}.zip` : `certificates-${stamp}.zip`;
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zip.length),
    },
  });
}
