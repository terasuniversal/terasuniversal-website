"use client";

import { useActionState, useMemo, useState } from "react";
import { Card, Field } from "../../../../../components/admin/ui";
import { QUOTATION_UNITS, QUOTATION_UNIT_LABELS, computeQuotationTotals, type SalesQuotationUnit } from "../../../../../lib/sales/crm";
import {
  ACCOMMODATION_PACKAGE_KEY,
  MEALS_PACKAGE_KEY,
  buildDefaultPackageSnapshot,
  commercialName,
  normalizePackageIncludeItems,
  type CourseCommercialOption,
  type PackageIncludeSnapshot,
} from "../../../../../lib/sales/course-commercial";
import type { SalesActionState } from "./actions";
import type { QuotationTrainingDetails } from "../../../../../lib/validation/schemas";

interface ItemDraft {
  description: string;
  quantity: string;
  unit: SalesQuotationUnit;
  unit_price: string;
  discount: string;
  course_id: string;
  course_name_snapshot: string;
  hrdf_claim: boolean;
  package_includes_snapshot: PackageIncludeSnapshot[];
}

const EMPTY_TRAINING: QuotationTrainingDetails = {
  schema_version: 1,
  programme: { course_id: null, course_name_snapshot: "", start_date: null, end_date: null, duration_label: "" },
  venue: { type: "teras_hq", name: "TERAS HQ", address: "Lot 1961, Jalan Tanah Merah, Kg. Tanah Merah Dalam, 06000 Jitra, Kedah." },
  participants: { count: 0, names: [], tbc: true },
  accommodation: { included: false, description: "", nights: null },
  meals: { included: false, meals_per_day: null, description: "" },
  inclusions: { training_notes: false, practical_assessment: false, certificate: false, other: [] },
};

const EMPTY_ITEM: ItemDraft = {
  description: "",
  quantity: "1",
  unit: "pax",
  unit_price: "0",
  discount: "0",
  course_id: "",
  course_name_snapshot: "",
  hrdf_claim: false,
  package_includes_snapshot: [],
};

/**
 * Shared create/edit form for a quotation header + line items. The totals
 * shown here are a live client-side preview (using the same
 * computeQuotationTotals() the server re-runs authoritatively) — the
 * stored subtotal/tax/total always come from the server action, never from
 * this preview, so a manipulated client payload can't misstate the saved
 * total (Task 8: "Calculations must be deterministic").
 */
export function QuotationItemsEditor({
  action,
  initialHeader,
  initialItems,
  courseOptions,
  submitLabel,
}: {
  action: (prev: SalesActionState, fd: FormData) => Promise<SalesActionState>;
  initialHeader?: {
    customer_company_name?: string | null;
    customer_contact_name?: string | null;
    customer_registration_no?: string | null;
    customer_email?: string | null;
    customer_phone?: string | null;
    billing_address?: string | null;
    training_service_address?: string | null;
    valid_until?: string | null;
    currency?: string;
    discount?: number;
    sst_applicable?: boolean;
    sst_rate?: number;
    terms?: string | null;
    notes?: string | null;
    training_details?: QuotationTrainingDetails;
  };
  initialItems?: ItemDraft[];
  courseOptions?: CourseCommercialOption[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<SalesActionState, FormData>(action, {});
  const [items, setItems] = useState<ItemDraft[]>(initialItems && initialItems.length > 0 ? initialItems : [{ ...EMPTY_ITEM }]);
  const [discount, setDiscount] = useState(String(initialHeader?.discount ?? 0));
  const [sstApplicable, setSstApplicable] = useState(initialHeader?.sst_applicable ?? false);
  const [sstRate, setSstRate] = useState(String(initialHeader?.sst_rate ?? 0));
  const [billingAddress, setBillingAddress] = useState(initialHeader?.billing_address ?? "");
  const [trainingAddress, setTrainingAddress] = useState(initialHeader?.training_service_address ?? "");
  const [training, setTraining] = useState<QuotationTrainingDetails>(initialHeader?.training_details ?? EMPTY_TRAINING);

  const totals = useMemo(() => {
    return computeQuotationTotals({
      items: items.map((i) => ({ quantity: Number(i.quantity) || 0, unitPrice: Number(i.unit_price) || 0, discount: Number(i.discount) || 0 })),
      discount: Number(discount) || 0,
      sstApplicable,
      sstRate: Number(sstRate) || 0,
    });
  }, [items, discount, sstApplicable, sstRate]);

  function updateTraining<K extends keyof QuotationTrainingDetails>(key: K, value: QuotationTrainingDetails[K]) {
    setTraining((current) => ({ ...current, [key]: value }));
  }
  function updateParticipantName(index: number, value: string) {
    const names = training.participants.names.map((name, i) => i === index ? value : name);
    updateTraining("participants", { ...training.participants, names, tbc: names.length === 0 });
  }
  function addParticipantName() {
    if (training.participants.names.length >= training.participants.count) return;
    updateTraining("participants", { ...training.participants, names: [...training.participants.names, ""], tbc: false });
  }
  function removeParticipantName(index: number) {
    updateTraining("participants", { ...training.participants, names: training.participants.names.filter((_, i) => i !== index), tbc: training.participants.names.length <= 1 });
  }

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }
  function addItem() {
    setItems((current) => [...current, { ...EMPTY_ITEM }]);
  }
  function removeItem(index: number) {
    setItems((current) => (current.length > 1 ? current.filter((_, i) => i !== index) : current));
  }

  function updatePackageItem(index: number, key: string, checked: boolean, label: string) {
    setItems((current) => current.map((item, i) => {
      if (i !== index) return item;
      const without = item.package_includes_snapshot.filter((entry) => entry.key !== key);
      return { ...item, package_includes_snapshot: checked ? [...without, { key, label }] : without };
    }));
  }

  function updatePackageLabel(index: number, key: string, label: string) {
    setItems((current) => current.map((item, i) => i !== index ? item : {
      ...item,
      package_includes_snapshot: item.package_includes_snapshot.map((entry) => entry.key === key ? { ...entry, label } : entry),
    }));
  }

  function applyCourseDefaults(index: number, courseId: string) {
    const option = courseOptions?.find((candidate) => candidate.course_id === courseId);
    setItems((current) => current.map((item, i) => {
      if (i !== index) return item;
      if (!option) return { ...item, course_id: "", course_name_snapshot: "", hrdf_claim: false, package_includes_snapshot: [] };
      const profile = option.profile;
      return {
        ...item,
        course_id: courseId,
        course_name_snapshot: commercialName(profile, false),
        hrdf_claim: false,
        description: profile.quotation_description,
        package_includes_snapshot: buildDefaultPackageSnapshot(profile),
      };
    }));
  }

  const itemsJson = JSON.stringify(
    items.map((i) => ({
      description: i.description,
      quantity: Number(i.quantity) || 0,
      unit: i.unit,
      unit_price: Number(i.unit_price) || 0,
      discount: Number(i.discount) || 0,
      course_id: i.course_id,
      hrdf_claim: i.hrdf_claim,
      package_includes_snapshot: i.package_includes_snapshot,
    }))
  );

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}
      {state.errors?.items && <div className="ta-alert ta-alert-error">{state.errors.items}</div>}
      <input type="hidden" name="items" value={itemsJson} />
      <input type="hidden" name="training_details" value={JSON.stringify(training)} />

      <Card title="1. Customer">

        <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="ta-field-row">
            <Field label="Company Name" name="customer_company_name">
              <input id="quotation-customer-company" name="customer_company_name" defaultValue={initialHeader?.customer_company_name ?? ""} maxLength={200} />
            </Field>
            <Field label="Contact / Attention" name="customer_contact_name">
              <input id="quotation-customer-contact" name="customer_contact_name" defaultValue={initialHeader?.customer_contact_name ?? ""} maxLength={200} />
            </Field>
          </div>
          <div className="ta-field-row">
            <Field label="Registration No." name="customer_registration_no">
              <input id="quotation-customer-registration" name="customer_registration_no" defaultValue={initialHeader?.customer_registration_no ?? ""} maxLength={100} />
            </Field>
            <Field label="Email" name="customer_email">
              <input id="quotation-customer-email" name="customer_email" type="email" defaultValue={initialHeader?.customer_email ?? ""} maxLength={320} />
            </Field>
          </div>
          <Field label="Phone" name="customer_phone">
            <input id="quotation-customer-phone" name="customer_phone" defaultValue={initialHeader?.customer_phone ?? ""} maxLength={60} />
          </Field>
        </div>
      </Card>

      <Card title="Address Information">
        <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Billing Address" name="billing_address">
            <textarea id="quotation-billing-address" name="billing_address" rows={4} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
          </Field>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
            <input id="quotation-same-billing" type="checkbox" onChange={(e) => { if (e.target.checked) setTrainingAddress(billingAddress); }} />
            Same as Billing Address
          </label>
          <Field label="Training / Service Address" name="training_service_address">
            <textarea id="quotation-training-address" name="training_service_address" rows={4} value={trainingAddress} onChange={(e) => setTrainingAddress(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="2. Training Programme">
        <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="ta-field-row">
            <Field label="Course / Programme" name="training-course-name"><input id="quotation-training-course" value={training.programme.course_name_snapshot} onChange={(e) => updateTraining("programme", { ...training.programme, course_name_snapshot: e.target.value })} maxLength={200} /></Field>
            <Field label="Duration" name="training-duration"><input id="quotation-training-duration" value={training.programme.duration_label} onChange={(e) => updateTraining("programme", { ...training.programme, duration_label: e.target.value })} maxLength={80} placeholder="e.g. 2 days" /></Field>
          </div>
          <div className="ta-field-row">
            <Field label="Start Date" name="training-start-date"><input id="quotation-training-start" type="date" value={training.programme.start_date ?? ""} onChange={(e) => updateTraining("programme", { ...training.programme, start_date: e.target.value || null })} /></Field>
            <Field label="End Date" name="training-end-date"><input id="quotation-training-end" type="date" value={training.programme.end_date ?? ""} onChange={(e) => updateTraining("programme", { ...training.programme, end_date: e.target.value || null })} /></Field>
          </div>
          <div className="ta-field-row">
            <Field label="Participant Count" name="training-participant-count"><input id="quotation-training-count" type="number" min="0" max="1000" step="1" value={training.participants.count} onChange={(e) => updateTraining("participants", { ...training.participants, count: Math.max(0, Number(e.target.value) || 0) })} /></Field>
            <Field label="Venue Type" name="training-venue-type"><select id="quotation-training-venue-type" value={training.venue.type} onChange={(e) => { const type = e.target.value as "teras_hq" | "in_house"; updateTraining("venue", { ...training.venue, type, name: type === "teras_hq" ? "TERAS HQ" : "", address: type === "teras_hq" ? EMPTY_TRAINING.venue.address : "" }); }}><option value="teras_hq">TERAS HQ</option><option value="in_house">In-House</option></select></Field>
          </div>
          <div className="ta-field-row"><Field label="Venue Name" name="training-venue-name"><input id="quotation-training-venue-name" value={training.venue.name} onChange={(e) => updateTraining("venue", { ...training.venue, name: e.target.value })} maxLength={200} /></Field><Field label="Venue Address" name="training-venue-address"><textarea id="quotation-training-venue-address" rows={2} value={training.venue.address} onChange={(e) => updateTraining("venue", { ...training.venue, address: e.target.value })} maxLength={1000} /></Field></div>
        </div>
      </Card>

      <Card title="3. Participants">
        <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ color: "var(--ta-muted)", fontSize: 13 }}>Names are quotation snapshots only and do not create Training Operations records.</div>
          {training.participants.names.map((name, index) => <div key={index} style={{ display: "flex", gap: 8 }}><input id={`quotation-participant-${index}`} aria-label={`Participant name ${index + 1}`} value={name} onChange={(e) => updateParticipantName(index, e.target.value)} maxLength={160} placeholder={`Participant ${index + 1}`} /><button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => removeParticipantName(index)}>Remove</button></div>)}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={addParticipantName} disabled={training.participants.names.length >= training.participants.count}>+ Add Participant</button><label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input id="quotation-participants-tbc" type="checkbox" checked={training.participants.tbc} onChange={(e) => updateTraining("participants", { ...training.participants, tbc: e.target.checked })} /> To Be Confirmed (TBC)</label></div>
        </div>
      </Card>

      <Card title="4. Package Inclusions">
        <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="ta-field-row"><Field label="Accommodation" name="training-accommodation"><select id="quotation-accommodation-included" value={String(training.accommodation.included)} onChange={(e) => updateTraining("accommodation", { ...training.accommodation, included: e.target.value === "true" })}><option value="false">Not Included</option><option value="true">Included</option></select></Field><Field label="Nights (optional)" name="training-accommodation-nights"><input id="quotation-accommodation-nights" type="number" min="1" max="365" step="1" value={training.accommodation.nights ?? ""} onChange={(e) => updateTraining("accommodation", { ...training.accommodation, nights: e.target.value ? Number(e.target.value) : null })} /></Field></div>
          <Field label="Accommodation Details" name="training-accommodation-details"><input id="quotation-accommodation-details" value={training.accommodation.description} onChange={(e) => updateTraining("accommodation", { ...training.accommodation, description: e.target.value })} maxLength={500} /></Field>
          <div className="ta-field-row"><Field label="Meals" name="training-meals"><select id="quotation-meals-included" value={String(training.meals.included)} onChange={(e) => updateTraining("meals", { ...training.meals, included: e.target.value === "true" })}><option value="false">Not Included</option><option value="true">Included</option></select></Field><Field label="Meals per day (optional)" name="training-meals-per-day"><input id="quotation-meals-per-day" type="number" min="1" max="10" step="1" value={training.meals.meals_per_day ?? ""} onChange={(e) => updateTraining("meals", { ...training.meals, meals_per_day: e.target.value ? Number(e.target.value) : null })} /></Field></div>
          <Field label="Meals Details" name="training-meals-details"><input id="quotation-meals-details" value={training.meals.description} onChange={(e) => updateTraining("meals", { ...training.meals, description: e.target.value })} maxLength={500} /></Field>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>{([["training_notes", "Training notes"], ["practical_assessment", "Practical assessment"], ["certificate", "Certificate"]] as const).map(([key, label]) => <label key={key} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input id={`quotation-inclusion-${key}`} type="checkbox" checked={training.inclusions[key]} onChange={(e) => updateTraining("inclusions", { ...training.inclusions, [key]: e.target.checked })} />{label}</label>)}</div>
          <Field label="Other inclusions (one per line)" name="training-other-inclusions"><textarea id="quotation-other-inclusions" rows={3} value={training.inclusions.other.join("\n")} onChange={(e) => updateTraining("inclusions", { ...training.inclusions, other: e.target.value.split("\n").map((v) => v.trim()).filter(Boolean) })} maxLength={6000} /></Field>
          <div style={{ color: "var(--ta-muted)", fontSize: 12 }}>These are descriptive inclusions. Charges remain controlled by the commercial line items.</div>
        </div>
      </Card>

      <Card title="5. Commercial / Line Items">
        <div className="ta-card-pad">
          <div className="ta-table-wrap quotation-line-items-desktop" aria-hidden="true" inert>
            <table className="ta-table">
              <thead>
                <tr><th>Description</th><th style={{ width: 90 }}>Qty</th><th style={{ width: 110 }}>Unit</th><th style={{ width: 120 }}>Unit Price (RM)</th><th style={{ width: 110 }}>Discount (RM)</th><th style={{ width: 110 }}>Line Total</th><th></th></tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0) - (Number(item.discount) || 0);
                  const option = courseOptions?.find((candidate) => candidate.course_id === item.course_id);
                  const profileItems = option ? normalizePackageIncludeItems(option.profile.package_includes) : [];
                  const accommodationSnapshot = item.package_includes_snapshot.find((entry) => entry.key === ACCOMMODATION_PACKAGE_KEY);
                  const mealsSnapshot = item.package_includes_snapshot.find((entry) => entry.key === MEALS_PACKAGE_KEY);
                  return (
                    <tr key={index}>
                      <td>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 250 }}>
                          <select id={`quotation-line-${index}-course`} aria-label={`Course for line ${index + 1}`} value={item.course_id} onChange={(e) => applyCourseDefaults(index, e.target.value)}>
                            <option value="">Manual item</option>
                            {(courseOptions ?? []).map((candidate) => <option key={candidate.course_id} value={candidate.course_id}>{candidate.profile.standard_display_name}</option>)}
                          </select>
                          {option && (
                            <>
                              <div style={{ fontSize: 12, color: "var(--ta-muted)" }}>Commercial name: <strong>{item.course_name_snapshot || commercialName(option.profile, item.hrdf_claim)}</strong></div>
                              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                                <input
                                  id={`quotation-line-${index}-hrdf-claim`}
                                  type="checkbox"
                                  checked={item.hrdf_claim}
                                  disabled={!option.profile.hrdf_claimable || !option.profile.hrdf_display_name?.trim()}
                                  onChange={(e) => updateItem(index, { hrdf_claim: e.target.checked, course_name_snapshot: commercialName(option.profile, e.target.checked) })}
                                />
                                HRDF Claim
                              </label>
                              <div style={{ fontSize: 12, color: "var(--ta-muted)" }}>{option.profile.hrdf_claimable && option.profile.hrdf_display_name ? "HRDF name available" : "HRDF not configured for this course"}</div>
                              <fieldset style={{ border: "1px solid var(--ta-line)", borderRadius: 6, padding: 8, margin: 0 }}>
                                <legend style={{ fontSize: 12, padding: "0 4px" }}>Package Includes</legend>
                                {profileItems.map((entry) => {
                                  const selectedSnapshot = item.package_includes_snapshot.find((snapshot) => snapshot.key === entry.key);
                                  const checked = Boolean(selectedSnapshot);
                                  const displayLabel = selectedSnapshot?.label ?? entry.label;
                                  return <label key={entry.key} htmlFor={`quotation-line-${index}-package-${entry.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4 }}><input id={`quotation-line-${index}-package-${entry.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`} type="checkbox" checked={checked} onChange={(e) => updatePackageItem(index, entry.key, e.target.checked, displayLabel)} />{displayLabel}</label>;
                                })}
                                {option.profile.accommodation_description_default?.trim() && <>
                                  <label htmlFor={`quotation-line-${index}-accommodation`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4 }}><input id={`quotation-line-${index}-accommodation`} type="checkbox" checked={Boolean(accommodationSnapshot)} onChange={(e) => updatePackageItem(index, ACCOMMODATION_PACKAGE_KEY, e.target.checked, accommodationSnapshot?.label ?? option.profile.accommodation_description_default!.trim())} />Accommodation</label>
                                  {accommodationSnapshot && <input id={`quotation-line-${index}-accommodation-description`} aria-label="Accommodation description" value={accommodationSnapshot.label} onChange={(e) => updatePackageLabel(index, ACCOMMODATION_PACKAGE_KEY, e.target.value)} placeholder="Accommodation description" />}
                                </>}
                                {option.profile.meals_description_default?.trim() && <>
                                  <label htmlFor={`quotation-line-${index}-meals`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4 }}><input id={`quotation-line-${index}-meals`} type="checkbox" checked={Boolean(mealsSnapshot)} onChange={(e) => updatePackageItem(index, MEALS_PACKAGE_KEY, e.target.checked, mealsSnapshot?.label ?? option.profile.meals_description_default!.trim())} />Meals</label>
                                  {mealsSnapshot && <input id={`quotation-line-${index}-meals-description`} aria-label="Meals description" value={mealsSnapshot.label} onChange={(e) => updatePackageLabel(index, MEALS_PACKAGE_KEY, e.target.value)} placeholder="Meals description" />}
                                </>}
                              </fieldset>
                            </>
                          )}
                          {!option && item.course_name_snapshot && <div style={{ fontSize: 12, color: "var(--ta-muted)" }}>Saved course snapshot: <strong>{item.course_name_snapshot}</strong></div>}
                          <textarea id={`quotation-line-${index}-description`} aria-label={`Description for line ${index + 1}`} rows={4} value={item.description} onChange={(e) => updateItem(index, { description: e.target.value })} placeholder="Quotation description" required />
                        </div>
                      </td>
                      <td><input id={`quotation-line-${index}-quantity`} aria-label={`Quantity for line ${index + 1}`} type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} required /></td>
                      <td>
                        <select id={`quotation-line-${index}-unit`} aria-label={`Unit for line ${index + 1}`} value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value as SalesQuotationUnit })}>
                          {QUOTATION_UNITS.map((u) => <option key={u} value={u}>{QUOTATION_UNIT_LABELS[u]}</option>)}
                        </select>
                      </td>
                      <td><input id={`quotation-line-${index}-unit-price`} aria-label={`Unit price for line ${index + 1}`} type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => updateItem(index, { unit_price: e.target.value })} required /></td>
                      <td><input id={`quotation-line-${index}-discount`} aria-label={`Discount for line ${index + 1}`} type="number" min="0" step="0.01" value={item.discount} onChange={(e) => updateItem(index, { discount: e.target.value })} /></td>
                      <td>RM {lineTotal.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                      <td>{items.length > 1 && <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => removeItem(index)}>Remove</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="quotation-line-items-mobile">
            {items.map((item, index) => {
              const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0) - (Number(item.discount) || 0);
              const option = courseOptions?.find((candidate) => candidate.course_id === item.course_id);
              const profileItems = option ? normalizePackageIncludeItems(option.profile.package_includes) : [];
              return <details className="quotation-mobile-item" key={index} open={items.length === 1}>
                <summary><div className="quotation-mobile-summary"><strong>{item.course_name_snapshot || item.description || `Line item ${index + 1}`}</strong><b>RM {lineTotal.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</b><small>{item.quantity || "0"} × {QUOTATION_UNIT_LABELS[item.unit]}</small></div></summary>
                <div className="quotation-mobile-item-fields">
                  <Field label="Course / Programme" name={`mobile-course-${index}`}><select id={`quotation-mobile-line-${index}-course`} aria-label={`Course for line ${index + 1}`} value={item.course_id} onChange={(e) => applyCourseDefaults(index, e.target.value)}><option value="">Manual item</option>{(courseOptions ?? []).map((candidate) => <option key={candidate.course_id} value={candidate.course_id}>{candidate.profile.standard_display_name}</option>)}</select></Field>
                  {option && <>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}><input type="checkbox" checked={item.hrdf_claim} disabled={!option.profile.hrdf_claimable || !option.profile.hrdf_display_name?.trim()} onChange={(e) => updateItem(index, { hrdf_claim: e.target.checked, course_name_snapshot: commercialName(option.profile, e.target.checked) })} /> HRDF Claim</label>
                    <fieldset><legend style={{ fontSize: 12, padding: "0 4px" }}>Package Includes</legend>{profileItems.map((entry) => { const selected = item.package_includes_snapshot.some((snapshot) => snapshot.key === entry.key); return <label key={entry.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4 }}><input type="checkbox" checked={selected} onChange={(e) => updatePackageItem(index, entry.key, e.target.checked, entry.label)} />{entry.label}</label>; })}{option.profile.accommodation_description_default?.trim() && <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4 }}><input type="checkbox" checked={item.package_includes_snapshot.some((entry) => entry.key === ACCOMMODATION_PACKAGE_KEY)} onChange={(e) => updatePackageItem(index, ACCOMMODATION_PACKAGE_KEY, e.target.checked, option.profile.accommodation_description_default!.trim())} />Accommodation</label>}{option.profile.meals_description_default?.trim() && <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4 }}><input type="checkbox" checked={item.package_includes_snapshot.some((entry) => entry.key === MEALS_PACKAGE_KEY)} onChange={(e) => updatePackageItem(index, MEALS_PACKAGE_KEY, e.target.checked, option.profile.meals_description_default!.trim())} />Meals</label>}</fieldset>
                  </>}
                  <Field label="Description" name={`mobile-description-${index}`}><textarea aria-label={`Description for line ${index + 1}`} rows={3} value={item.description} onChange={(e) => updateItem(index, { description: e.target.value })} placeholder="Quotation description" required /></Field>
                  <div className="ta-field-row"><Field label="Qty" name={`mobile-quantity-${index}`}><input aria-label={`Quantity for line ${index + 1}`} type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} required /></Field><Field label="Unit" name={`mobile-unit-${index}`}><select aria-label={`Unit for line ${index + 1}`} value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value as SalesQuotationUnit })}>{QUOTATION_UNITS.map((u) => <option key={u} value={u}>{QUOTATION_UNIT_LABELS[u]}</option>)}</select></Field></div>
                  <div className="ta-field-row"><Field label="Unit Price (RM)" name={`mobile-price-${index}`}><input aria-label={`Unit price for line ${index + 1}`} type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => updateItem(index, { unit_price: e.target.value })} required /></Field><Field label="Discount (RM)" name={`mobile-discount-${index}`}><input aria-label={`Discount for line ${index + 1}`} type="number" min="0" step="0.01" value={item.discount} onChange={(e) => updateItem(index, { discount: e.target.value })} /></Field></div>
                  {items.length > 1 && <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => removeItem(index)}>Remove line</button>}
                </div>
              </details>;
            })}
          </div>
          <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" style={{ marginTop: 10 }} onClick={addItem}>+ Add Line</button>
        </div>
      </Card>

      <Card title="6. Terms / Notes">
        <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="ta-field-row">
            <Field label="Valid Until" name="valid_until">
              <input id="quotation-valid-until" name="valid_until" type="date" defaultValue={initialHeader?.valid_until ?? ""} />
            </Field>
            <Field label="Currency" name="currency">
              <input id="quotation-currency" name="currency" defaultValue={initialHeader?.currency ?? "MYR"} maxLength={10} />
            </Field>
          </div>
          <div className="ta-field-row">
            <Field label="Quotation Discount (RM)" name="discount">
              <input id="quotation-discount" name="discount" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
            <Field label="SST Rate (%)" name="sst_rate" hint={!sstApplicable ? "Enabled only if SST Applicable is checked" : undefined}>
              <input id="quotation-sst-rate" name="sst_rate" type="number" min="0" max="100" step="0.01" value={sstRate} onChange={(e) => setSstRate(e.target.value)} disabled={!sstApplicable} />
            </Field>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
            <input id="quotation-sst-applicable" type="checkbox" name="sst_applicable" checked={sstApplicable} onChange={(e) => setSstApplicable(e.target.checked)} />
            SST applicable
          </label>
          <Field label="Terms" name="terms" hint="Free text — shown on the quotation.">
            <textarea id="quotation-terms" name="terms" rows={4} defaultValue={initialHeader?.terms ?? ""} />
          </Field>
          <Field label="Internal Notes" name="notes">
            <textarea id="quotation-notes" name="notes" rows={3} defaultValue={initialHeader?.notes ?? ""} />
          </Field>
        </div>
      </Card>

      <Card title="7. Review & Totals">
        <div className="ta-card-pad">
          <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 6, margin: 0 }}>
            <dt>Subtotal</dt><dd style={{ margin: 0, textAlign: "right" }}>RM {totals.subtotal.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</dd>
            <dt>Discount</dt><dd style={{ margin: 0, textAlign: "right" }}>− RM {(Number(discount) || 0).toLocaleString("en-MY", { minimumFractionDigits: 2 })}</dd>
            <dt>Taxable Amount</dt><dd style={{ margin: 0, textAlign: "right" }}>RM {totals.taxableAmount.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</dd>
            <dt>Tax {sstApplicable ? `(SST ${sstRate}%)` : "(not applicable)"}</dt><dd style={{ margin: 0, textAlign: "right" }}>RM {totals.tax.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</dd>
            <dt><strong>Grand Total</strong></dt><dd style={{ margin: 0, textAlign: "right" }}><strong>RM {totals.total.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</strong></dd>
          </dl>
        </div>
      </Card>

      <button type="submit" className="ta-btn ta-btn-primary" disabled={pending} style={{ alignSelf: "flex-start" }}>
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
