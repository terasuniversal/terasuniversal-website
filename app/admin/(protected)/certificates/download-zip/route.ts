import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "../../../../../lib/supabase/server";
import { getCurrentProfile, hasModuleAccess } from "../../../../../lib/auth/session";
import { isAdmin } from "../../../../../lib/auth/rbac";
import { loadCertificateRender } from "../certData";
import { renderCertificateDocument } from "../../../../../lib/certificate-html";
import { createZip, MAX_ZIP_RESPONSE_BYTES, safeFileName, suggestedZipBatchSize, type ZipEntry } from "../../../../../lib/zip";
import { CertificateRenderAssetError, zipCertificateRenderAssets } from "../../../../../lib/certificate-render-assets";

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
  // Private signature/seal images, each stored once under certificates/assets/ and referenced by every HTML file.
  const assetFiles = new Map<string, Uint8Array>();

  for (const id of capped) {
    try {
      const r = await loadCertificateRender(id);
      if (!r) { failed.push({ id, reason: "not found" }); continue; }
      // Assets join the archive only once this certificate has rendered, so a failed one adds nothing.
      const certificateAssets = new Map<string, Uint8Array>();
      const html = renderCertificateDocument({ ...r.data, render_assets: await zipCertificateRenderAssets(r.config, certificateAssets) }, r.config);
      for (const [path, bytes] of certificateAssets) assetFiles.set(path, bytes);
      const base = safeFileName(`${r.data.certificate_number || "certificate"}_${r.data.holder_name || ""}`);
      // Avoid collisions when two certs share a number/name.
      let name = `${base}.html`;
      let n = 2;
      while (usedNames.has(name)) { name = `${base}_${n++}.html`; }
      usedNames.add(name);
      entries.push({ name: `certificates/${name}`, data: html });
    } catch (e: unknown) {
      // Fixed reasons only: this list is stored in automation_runs, so no storage paths or raw errors.
      failed.push({ id, reason: e instanceof CertificateRenderAssetError ? e.message : "render error" });
    }
  }
  const renderedCount = entries.length;

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
  for (const [path, bytes] of assetFiles) entries.push({ name: `certificates/${path}`, data: Buffer.from(bytes) });
  entries.push({ name: "MANIFEST.txt", data: manifestLines.join("\n") + "\n" });

  const zip = createZip(entries);

  // Too large to return in one response: fail the whole run rather than send a truncated or rejected archive.
  if (zip.length > MAX_ZIP_RESPONSE_BYTES) {
    const sharedBytes = [...assetFiles.values()].reduce((sum, bytes) => sum + bytes.length, 0);
    const suggested = suggestedZipBatchSize(zip.length, renderedCount, sharedBytes);
    // Rendered but not delivered counts as skipped; nothing is a success.
    const { error: runError } = await supabase.from("automation_runs").insert({
      run_type: "bulk_download", status: "failed", summary: `Bulk certificate download (${scope}) — too large for one download`,
      total_count: capped.length, success_count: 0, skipped_count: renderedCount, failed_count: failed.length,
      params: { scope, scheduleId, ids_count: ids.length, capped: ids.length > MAX_CERTS },
      result: { failed, reason: "zip_too_large", zip_bytes: zip.length, limit_bytes: MAX_ZIP_RESPONSE_BYTES, rendered_count: renderedCount },
    });
    // The download is refused either way; a missing run record must still be visible in the logs.
    if (runError) console.error("Bulk certificate download: could not record oversized run", { code: runError.code });
    const advice = suggested > 0 ? `Select ${suggested} or fewer certificates at a time and download them in batches.` : "Select fewer certificates and download them in smaller batches.";
    return new NextResponse(
      `This selection of ${renderedCount} certificates is too large to download as one file. ${advice}`,
      { status: 413, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  // --- Record the automation run + audit ---
  const status = failed.length === 0 ? "success" : "partial";
  await supabase.from("automation_runs").insert({
    run_type: "bulk_download", status,
    summary: `Bulk certificate download (${scope}) — ${renderedCount} file(s)`,
    total_count: capped.length, success_count: renderedCount, skipped_count: 0, failed_count: failed.length,
    params: { scope, scheduleId, ids_count: ids.length, capped: ids.length > MAX_CERTS },
    result: { failed },
  });
  await supabase.rpc("log_event" as never, {
    p_action: "export", p_entity_type: "certificates",
    p_summary: `Bulk certificate ZIP: ${renderedCount} file(s) (${scope})`,
  } as never);

  const filename = scheduleId ? `certificates-${safeFileName(scheduleId)}-${stamp}.zip` : `certificates-${stamp}.zip`;
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(zip.length),
    },
  });
}