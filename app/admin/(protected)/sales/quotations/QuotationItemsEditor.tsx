"use client";

import { useActionState, useMemo, useState } from "react";
import { Card, Field } from "../../../../../components/admin/ui";
import { QUOTATION_UNITS, QUOTATION_UNIT_LABELS, computeQuotationTotals, type SalesQuotationUnit } from "../../../../../lib/sales/crm";
import type { SalesActionState } from "./actions";

interface ItemDraft {
  description: string;
  quantity: string;
  unit: SalesQuotationUnit;
  unit_price: string;
  discount: string;
}

const EMPTY_ITEM: ItemDraft = { description: "", quantity: "1", unit: "pax", unit_price: "0", discount: "0" };

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
  submitLabel,
}: {
  action: (prev: SalesActionState, fd: FormData) => Promise<SalesActionState>;
  initialHeader?: {
    valid_until?: string | null;
    currency?: string;
    discount?: number;
    sst_applicable?: boolean;
    sst_rate?: number;
    terms?: string | null;
    notes?: string | null;
  };
  initialItems?: ItemDraft[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<SalesActionState, FormData>(action, {});
  const [items, setItems] = useState<ItemDraft[]>(initialItems && initialItems.length > 0 ? initialItems : [{ ...EMPTY_ITEM }]);
  const [discount, setDiscount] = useState(String(initialHeader?.discount ?? 0));
  const [sstApplicable, setSstApplicable] = useState(initialHeader?.sst_applicable ?? false);
  const [sstRate, setSstRate] = useState(String(initialHeader?.sst_rate ?? 0));

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

  const itemsJson = JSON.stringify(
    items.map((i) => ({ description: i.description, quantity: Number(i.quantity) || 0, unit: i.unit, unit_price: Number(i.unit_price) || 0, discount: Number(i.discount) || 0 }))
  );

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {state.message && <div className="ta-alert ta-alert-error">{state.message}</div>}
      {state.errors?.items && <div className="ta-alert ta-alert-error">{state.errors.items}</div>}
      <input type="hidden" name="items" value={itemsJson} />

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
                  return (
                    <tr key={index}>
                      <td><input value={item.description} onChange={(e) => updateItem(index, { description: e.target.value })} placeholder="e.g. Basic Scaffolder (Level 1) training" required /></td>
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
