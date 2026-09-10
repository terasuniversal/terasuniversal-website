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

  const totals = useMemo(() => {
    return computeQuotationTotals({
      items: items.map((i) => ({ quantity: Number(i.quantity) || 0, unitPrice: Number(i.unit_price) || 0, discount: Number(i.discount) || 0 })),
      discount: Number(discount) || 0,
      sstApplicable,
      sstRate: Number(sstRate) || 0,
    });
  }, [items, discount, sstApplicable, sstRate]);

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

      <Card title="Customer Information">
        <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="ta-field-row">
            <Field label="Company Name" name="customer_company_name">
              <input name="customer_company_name" defaultValue={initialHeader?.customer_company_name ?? ""} maxLength={200} />
            </Field>
            <Field label="Contact / Attention" name="customer_contact_name">
              <input name="customer_contact_name" defaultValue={initialHeader?.customer_contact_name ?? ""} maxLength={200} />
            </Field>
          </div>
          <div className="ta-field-row">
            <Field label="Registration No." name="customer_registration_no">
              <input name="customer_registration_no" defaultValue={initialHeader?.customer_registration_no ?? ""} maxLength={100} />
            </Field>
            <Field label="Email" name="customer_email">
              <input name="customer_email" type="email" defaultValue={initialHeader?.customer_email ?? ""} maxLength={320} />
            </Field>
          </div>
          <Field label="Phone" name="customer_phone">
            <input name="customer_phone" defaultValue={initialHeader?.customer_phone ?? ""} maxLength={60} />
          </Field>
        </div>
      </Card>

      <Card title="Address Information">
        <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Field label="Billing Address" name="billing_address">
            <textarea name="billing_address" rows={4} value={billingAddress} onChange={(e) => setBillingAddress(e.target.value)} />
          </Field>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
            <input type="checkbox" onChange={(e) => { if (e.target.checked) setTrainingAddress(billingAddress); }} />
            Same as Billing Address
          </label>
          <Field label="Training / Service Address" name="training_service_address">
            <textarea name="training_service_address" rows={4} value={trainingAddress} onChange={(e) => setTrainingAddress(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title="Line Items">
        <div className="ta-card-pad">
          <div className="ta-table-wrap">
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
                          <select aria-label={`Course for line ${index + 1}`} value={item.course_id} onChange={(e) => applyCourseDefaults(index, e.target.value)}>
                            <option value="">Manual item</option>
                            {(courseOptions ?? []).map((candidate) => <option key={candidate.course_id} value={candidate.course_id}>{candidate.profile.standard_display_name}</option>)}
                          </select>
                          {option && (
                            <>
                              <div style={{ fontSize: 12, color: "var(--ta-muted)" }}>Commercial name: <strong>{item.course_name_snapshot || commercialName(option.profile, item.hrdf_claim)}</strong></div>
                              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                                <input
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
                                  return <label key={entry.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4 }}><input type="checkbox" checked={checked} onChange={(e) => updatePackageItem(index, entry.key, e.target.checked, displayLabel)} />{displayLabel}</label>;
                                })}
                                {option.profile.accommodation_description_default?.trim() && <>
                                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4 }}><input type="checkbox" checked={Boolean(accommodationSnapshot)} onChange={(e) => updatePackageItem(index, ACCOMMODATION_PACKAGE_KEY, e.target.checked, accommodationSnapshot?.label ?? option.profile.accommodation_description_default!.trim())} />Accommodation</label>
                                  {accommodationSnapshot && <input aria-label="Accommodation description" value={accommodationSnapshot.label} onChange={(e) => updatePackageLabel(index, ACCOMMODATION_PACKAGE_KEY, e.target.value)} placeholder="Accommodation description" />}
                                </>}
                                {option.profile.meals_description_default?.trim() && <>
                                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 4 }}><input type="checkbox" checked={Boolean(mealsSnapshot)} onChange={(e) => updatePackageItem(index, MEALS_PACKAGE_KEY, e.target.checked, mealsSnapshot?.label ?? option.profile.meals_description_default!.trim())} />Meals</label>
                                  {mealsSnapshot && <input aria-label="Meals description" value={mealsSnapshot.label} onChange={(e) => updatePackageLabel(index, MEALS_PACKAGE_KEY, e.target.value)} placeholder="Meals description" />}
                                </>}
                              </fieldset>
                            </>
                          )}
                          {!option && item.course_name_snapshot && <div style={{ fontSize: 12, color: "var(--ta-muted)" }}>Saved course snapshot: <strong>{item.course_name_snapshot}</strong></div>}
                          <textarea rows={4} value={item.description} onChange={(e) => updateItem(index, { description: e.target.value })} placeholder="Quotation description" required />
                        </div>
                      </td>
                      <td><input type="number" min="0.01" step="0.01" value={item.quantity} onChange={(e) => updateItem(index, { quantity: e.target.value })} required /></td>
                      <td>
                        <select value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value as SalesQuotationUnit })}>
                          {QUOTATION_UNITS.map((u) => <option key={u} value={u}>{QUOTATION_UNIT_LABELS[u]}</option>)}
                        </select>
                      </td>
                      <td><input type="number" min="0" step="0.01" value={item.unit_price} onChange={(e) => updateItem(index, { unit_price: e.target.value })} required /></td>
                      <td><input type="number" min="0" step="0.01" value={item.discount} onChange={(e) => updateItem(index, { discount: e.target.value })} /></td>
                      <td>RM {lineTotal.toLocaleString("en-MY", { minimumFractionDigits: 2 })}</td>
                      <td>{items.length > 1 && <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={() => removeItem(index)}>Remove</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" style={{ marginTop: 10 }} onClick={addItem}>+ Add Line</button>
        </div>
      </Card>

      <Card title="Commercial Terms">
        <div className="ta-card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="ta-field-row">
            <Field label="Valid Until" name="valid_until">
              <input name="valid_until" type="date" defaultValue={initialHeader?.valid_until ?? ""} />
            </Field>
            <Field label="Currency" name="currency">
              <input name="currency" defaultValue={initialHeader?.currency ?? "MYR"} maxLength={10} />
            </Field>
          </div>
          <div className="ta-field-row">
            <Field label="Quotation Discount (RM)" name="discount">
              <input name="discount" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
            </Field>
            <Field label="SST Rate (%)" name="sst_rate" hint={!sstApplicable ? "Enabled only if SST Applicable is checked" : undefined}>
              <input name="sst_rate" type="number" min="0" max="100" step="0.01" value={sstRate} onChange={(e) => setSstRate(e.target.value)} disabled={!sstApplicable} />
            </Field>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
            <input type="checkbox" name="sst_applicable" checked={sstApplicable} onChange={(e) => setSstApplicable(e.target.checked)} />
            SST applicable
          </label>
          <Field label="Terms" name="terms" hint="Free text — shown on the quotation.">
            <textarea name="terms" rows={4} defaultValue={initialHeader?.terms ?? ""} />
          </Field>
          <Field label="Internal Notes" name="notes">
            <textarea name="notes" rows={3} defaultValue={initialHeader?.notes ?? ""} />
          </Field>
        </div>
      </Card>

      <Card title="Totals (preview)">
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
