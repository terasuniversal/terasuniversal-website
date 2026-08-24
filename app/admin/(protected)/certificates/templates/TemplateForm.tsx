"use client";

import { useActionState, useState, useEffect } from "react";
import Link from "next/link";
import type { TemplateFormState } from "./actions";
import { Field } from "../../../../../components/admin/ui";
import { CertificateFront, CertificateBack } from "../../../../../components/admin/CertificateRenderer";
import type { CertData } from "../../../../../components/admin/CertificateDocument";
import { generateQrSvg } from "../../../../../lib/certificate-format";

const PREVIEW_DATA_BASE: Omit<CertData, "qr_svg"> = {
  certificate_number: "TU-SESP-2026-0001",
  holder_name: "Ahmad Bin Ali",
  course_name: "TERAS Professional Scaffold Erection Skills Programme",
  programme_duration: null,
  ic_passport: "900101-01-5523",
  participant_id: "TU-000123",
  training_date: "12 July 2026",
  training_end_date: "21 July 2026",
  venue: "TERAS Training Centre",
  trainer: "En. Ali",
  issue_date: "21 July 2026",
  verification_url: "https://www.terasuniversal.com.my/verify/TU-SESP-2026-0001",
};

export function TemplateForm({
  action,
  template,
  mode,
}: {
  action: (prev: TemplateFormState, fd: FormData) => Promise<TemplateFormState>;
  template?: any;
  mode: "create" | "edit";
}) {
  const [state, formAction, pending] = useActionState<TemplateFormState, FormData>(action, {});
  const c = template?.config ?? {};
  const joinLines = (arr?: string[]) => (arr ?? []).join("\n");
  const [preview, setPreview] = useState({
    // Read-only pass-through — which dedicated design a template uses is an
    // exclusive binding set up alongside the template itself, not a field
    // exposed for editing here (see CertificateRenderer.tsx).
    design_variant: c.design_variant as string | undefined,
    logo_url: c.logo_url ?? "/teras-universal-logo.png",
    primary_color: c.primary_color ?? "#0B3A63",
    accent_color: c.accent_color ?? "#D4AF37",
    signature_name: c.signature_name ?? "Trainer",
    signature_title: c.signature_title ?? "Training Manager",
    body_text: c.body_text ?? "",
    show_qr: c.show_qr !== false,
    duration_label: c.duration_label ?? "",
    skills_update_recommendation: c.skills_update_recommendation ?? "",
    certificate_number_prefix: c.certificate_number_prefix ?? "",
    show_back_page: c.show_back_page !== false,
    show_skills_record: c.show_skills_record !== false,
    programme_title: c.programme_title ?? "",
    objectives_text: c.objectives_text ?? "",
    coverage_items: c.coverage_items ?? [],
    learning_outcomes: c.learning_outcomes ?? [],
    assessment_methods: c.assessment_methods ?? [],
    skills_record: c.skills_record ?? [],
    important_notice: c.important_notice ?? "",
    contact_phone: c.contact_phone ?? "",
    contact_email: c.contact_email ?? "",
    contact_website: c.contact_website ?? "",
  });
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    generateQrSvg(PREVIEW_DATA_BASE.verification_url!, preview.primary_color).then((svg) => {
      if (!cancelled) setQrSvg(svg);
    });
    return () => { cancelled = true; };
  }, [preview.primary_color]);
  const previewData: CertData = { ...PREVIEW_DATA_BASE, qr_svg: qrSvg };
  const upd = (k: string, v: any) => setPreview((p) => ({ ...p, [k]: v }));
  const updLines = (k: string, raw: string) => upd(k, raw.split("\n").map((s) => s.trim()).filter(Boolean));
  const updSkillsRecord = (raw: string) =>
    upd(
      "skills_record",
      raw
        .split("\n")
        .map((line) => {
          const [area, status] = line.split("|").map((s) => s.trim());
          return area ? { area, status: status || "Not Recorded" } : null;
        })
        .filter((r): r is { area: string; status: string } => r !== null)
    );

  return (
    <div className="ta-grid cols-2" style={{ alignItems: "start" }}>
      <form action={formAction} className="ta-form">
        {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}
        {/* This design is fixed A4 portrait, front + back — the `orientation`
            column no longer drives layout, so the field is submitted as a
            fixed value rather than shown as a (now-meaningless) choice. */}
        <input type="hidden" name="orientation" value="portrait" />
        <Field label="Template name *" name="name" error={state.errors?.name}>
          <input id="name" name="name" defaultValue={template?.name ?? ""} required />
        </Field>
        <Field label="Description" name="description">
          <input id="description" name="description" defaultValue={template?.description ?? ""} />
        </Field>
        <Field label="Certificate design" name="design_variant">
          <select
            id="design_variant"
            name="design_variant"
            value={preview.design_variant ?? ""}
            onChange={(e) => upd("design_variant", e.target.value || undefined)}
          >
            <option value="">TERAS Standard</option>
            <option value="professional_scaffold_erection_skills">Premium Scaffold</option>
          </select>
        </Field>
        <div className="ta-field-row">
          <Field label="Logo URL" name="logo_url">
            <input id="logo_url" name="logo_url" defaultValue={preview.logo_url} onChange={(e) => upd("logo_url", e.target.value)} />
          </Field>
          <Field label="Background URL (optional)" name="background_url">
            <input id="background_url" name="background_url" defaultValue={c.background_url ?? ""} />
          </Field>
        </div>
        <div className="ta-field-row">
          <Field label="Primary colour" name="primary_color">
            <input id="primary_color" name="primary_color" type="color" defaultValue={preview.primary_color} onChange={(e) => upd("primary_color", e.target.value)} />
          </Field>
          <Field label="Accent colour" name="accent_color">
            <input id="accent_color" name="accent_color" type="color" defaultValue={preview.accent_color} onChange={(e) => upd("accent_color", e.target.value)} />
          </Field>
        </div>
        <Field label="Programme description (optional — shown below the programme name)" name="body_text">
          <textarea id="body_text" name="body_text" rows={2} defaultValue={preview.body_text} onChange={(e) => upd("body_text", e.target.value)} placeholder="This programme focuses on…" />
        </Field>
        <div className="ta-field-row">
          <Field label="Duration label (e.g. 10-Day Intensive Practical Training)" name="duration_label">
            <input id="duration_label" name="duration_label" defaultValue={preview.duration_label} onChange={(e) => upd("duration_label", e.target.value)} />
          </Field>
          <Field label="Recommended skills update" name="skills_update_recommendation">
            <input id="skills_update_recommendation" name="skills_update_recommendation" defaultValue={preview.skills_update_recommendation} onChange={(e) => upd("skills_update_recommendation", e.target.value)} placeholder="Within Three (3) Years" />
          </Field>
        </div>
        <Field label="Certificate number prefix (optional — e.g. TU-SESP; leave blank to use the default CERT-YYYY-NNNNNN numbering)" name="certificate_number_prefix">
          <input id="certificate_number_prefix" name="certificate_number_prefix" defaultValue={preview.certificate_number_prefix} onChange={(e) => upd("certificate_number_prefix", e.target.value)} placeholder="TU-SESP" />
        </Field>
        <div className="ta-field-row">
          <Field label="Trainer name" name="signature_name">
            <input id="signature_name" name="signature_name" defaultValue={preview.signature_name} onChange={(e) => upd("signature_name", e.target.value)} />
          </Field>
          <Field label="Training manager name" name="signature_title">
            <input id="signature_title" name="signature_title" defaultValue={preview.signature_title} onChange={(e) => upd("signature_title", e.target.value)} />
          </Field>
        </div>
        <Field label="Trainer signature image URL (optional)" name="signature_url">
          <input id="signature_url" name="signature_url" defaultValue={c.signature_url ?? ""} />
        </Field>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
            <input type="checkbox" name="show_qr" defaultChecked={preview.show_qr} onChange={(e) => upd("show_qr", e.target.checked)} style={{ width: "auto" }} /> Show QR code
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
            <input type="checkbox" name="show_back_page" defaultChecked={preview.show_back_page} onChange={(e) => upd("show_back_page", e.target.checked)} style={{ width: "auto" }} /> Show back page (Programme Information)
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
            <input type="checkbox" name="show_skills_record" defaultChecked={preview.show_skills_record} onChange={(e) => upd("show_skills_record", e.target.checked)} style={{ width: "auto" }} /> Show Participant Skills Record table
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
            <input type="checkbox" name="is_active" defaultChecked={template ? template.is_active : true} style={{ width: "auto" }} /> Active
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
            <input type="checkbox" name="is_default" defaultChecked={template?.is_default ?? false} style={{ width: "auto" }} /> Default
          </label>
        </div>

        <div style={{ fontWeight: 700, color: "var(--ta-navy)", margin: "18px 0 4px" }}>Back page — Programme Information</div>
        <Field label="Programme title override (optional — defaults to the certificate's course name)" name="programme_title">
          <input id="programme_title" name="programme_title" defaultValue={preview.programme_title} onChange={(e) => upd("programme_title", e.target.value)} />
        </Field>
        <Field label="Programme objectives" name="objectives_text">
          <textarea id="objectives_text" name="objectives_text" rows={3} defaultValue={preview.objectives_text} onChange={(e) => upd("objectives_text", e.target.value)} />
        </Field>
        <div className="ta-field-row">
          <Field label="Programme coverage (one per line)" name="coverage_items">
            <textarea id="coverage_items" name="coverage_items" rows={5} defaultValue={joinLines(preview.coverage_items)} onChange={(e) => updLines("coverage_items", e.target.value)} />
          </Field>
          <Field label="Learning outcomes (one per line)" name="learning_outcomes">
            <textarea id="learning_outcomes" name="learning_outcomes" rows={5} defaultValue={joinLines(preview.learning_outcomes)} onChange={(e) => updLines("learning_outcomes", e.target.value)} />
          </Field>
        </div>
        <div className="ta-field-row">
          <Field label="Assessment method (one per line)" name="assessment_methods">
            <textarea id="assessment_methods" name="assessment_methods" rows={4} defaultValue={joinLines(preview.assessment_methods)} onChange={(e) => updLines("assessment_methods", e.target.value)} />
          </Field>
          <Field label="Participant skills record (one per line, Area | Status)" name="skills_record">
            <textarea
              id="skills_record"
              name="skills_record"
              rows={4}
              defaultValue={(preview.skills_record as { area: string; status: string }[]).map((r) => `${r.area} | ${r.status}`).join("\n")}
              onChange={(e) => updSkillsRecord(e.target.value)}
              placeholder={"Theory Session | Not Recorded\nPractical Assessment | Not Recorded"}
            />
          </Field>
        </div>
        <Field label="Important notice" name="important_notice">
          <textarea id="important_notice" name="important_notice" rows={3} defaultValue={preview.important_notice} onChange={(e) => upd("important_notice", e.target.value)} />
        </Field>
        <div className="ta-field-row">
          <Field label="Contact phone" name="contact_phone">
            <input id="contact_phone" name="contact_phone" defaultValue={preview.contact_phone} onChange={(e) => upd("contact_phone", e.target.value)} placeholder="019-519 3834" />
          </Field>
          <Field label="Contact email" name="contact_email">
            <input id="contact_email" name="contact_email" defaultValue={preview.contact_email} onChange={(e) => upd("contact_email", e.target.value)} placeholder="admin@terasuniversal.com.my" />
          </Field>
        </div>
        <Field label="Contact website" name="contact_website">
          <input id="contact_website" name="contact_website" defaultValue={preview.contact_website} onChange={(e) => upd("contact_website", e.target.value)} placeholder="www.terasuniversal.com.my" />
        </Field>

        <div className="ta-form-actions">
          <Link href="/admin/certificates/templates" className="ta-btn ta-btn-outline">Cancel</Link>
          <button type="submit" className="ta-btn ta-btn-primary" disabled={pending}>{pending ? "Saving…" : mode === "edit" ? "Save template" : "Create template"}</button>
        </div>
      </form>

      {/* Live preview (scaled) — front + back, A4 portrait */}
      <div>
        <div style={{ fontWeight: 700, color: "var(--ta-navy)", marginBottom: 8 }}>Live preview — Front</div>
        <div style={{ overflow: "hidden", border: "1px solid var(--ta-line)", borderRadius: 10, background: "#eef1f6", padding: 10, marginBottom: 16 }}>
          <div style={{ transform: "scale(0.42)", transformOrigin: "top left", height: 480 }}>
            <CertificateFront config={preview} data={previewData} />
          </div>
        </div>
        {preview.show_back_page && (
          <>
            <div style={{ fontWeight: 700, color: "var(--ta-navy)", marginBottom: 8 }}>Live preview — Back</div>
            <div style={{ overflow: "hidden", border: "1px solid var(--ta-line)", borderRadius: 10, background: "#eef1f6", padding: 10 }}>
              <div style={{ transform: "scale(0.42)", transformOrigin: "top left", height: 480 }}>
                <CertificateBack config={preview} data={previewData} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
