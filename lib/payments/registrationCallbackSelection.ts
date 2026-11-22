/**
 * PKG-1d-A: decides what a ToyyibPay registration callback may do, from the provider's own getBillTransactions rows.
 *
 * Pure (no I/O) so every provider sequence can be tested without ToyyibPay. Money evidence comes ONLY from the
 * server-to-server rows: the callback body's status, amount and refno are never proof. The callback refno is used
 * only to choose between several provider-verified successful rows of the same bill, so a forged or stale refno can
 * at most change which already-verified transaction is recorded first -- never create a payment.
 *
 * Rules:
 *  - rows of another bill are discarded (the registration flow asks the provider for one bill, strictly);
 *  - a transaction id that the provider reports both as successful and as not successful is a provider-record
 *    conflict: nothing changes, it is logged for reconciliation;
 *  - any valid successful row (transaction id + positive amount) wins over failed or pending rows, whatever the row
 *    order (B2: a bill paid after a failed try must never be read as failed);
 *  - "failed" only when there is no successful row at all and at least one unsuccessful row;
 *  - pending or unrecognised statuses do nothing.
 */

export type SelectableProviderStatus = "successful" | "pending" | "unsuccessful" | "unknown";

export interface SelectableTransaction {
  providerTransactionId: string | null;
  providerStatus: SelectableProviderStatus;
  amount: string | null;
  billCode: string | null;
}

export type ProviderOutcome<T extends SelectableTransaction> =
  | { kind: "success"; transaction: T; additional: T[] }
  | { kind: "invalid_success" }
  | { kind: "conflict"; transactionIds: string[] }
  | { kind: "failed" }
  | { kind: "no_action"; reason: "pending" | "unknown" }
  | { kind: "none" };

const clean = (value: string | null | undefined): string => (typeof value === "string" ? value.trim() : "");

function hasValidMoney(row: SelectableTransaction): boolean {
  const amount = Number(clean(row.amount));
  return clean(row.providerTransactionId).length > 0 && Number.isFinite(amount) && amount > 0;
}

export function selectProviderOutcome<T extends SelectableTransaction>(
  rows: readonly T[],
  billCode: string,
  callbackRefno: string | null,
): ProviderOutcome<T> {
  const bill = clean(billCode);
  const relevant = rows.filter((row) => bill.length > 0 && clean(row.billCode) === bill);
  if (relevant.length === 0) return { kind: "none" };

  const statusesByTransaction = new Map<string, Set<SelectableProviderStatus>>();
  for (const row of relevant) {
    const id = clean(row.providerTransactionId);
    if (!id) continue;
    const set = statusesByTransaction.get(id) ?? new Set<SelectableProviderStatus>();
    set.add(row.providerStatus);
    statusesByTransaction.set(id, set);
  }
  const conflicting = [...statusesByTransaction.entries()]
    .filter(([, statuses]) => statuses.has("successful") && statuses.size > 1)
    .map(([id]) => id)
    .sort();
  if (conflicting.length > 0) return { kind: "conflict", transactionIds: conflicting };

  const successful = relevant.filter((row) => row.providerStatus === "successful");
  const valid = successful.filter(hasValidMoney);
  if (valid.length > 0) {
    const byId = new Map<string, T>();
    for (const row of valid) {
      const id = clean(row.providerTransactionId);
      if (!byId.has(id)) byId.set(id, row);
    }
    const ordered = [...byId.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row);
    const refno = clean(callbackRefno);
    const chosen = (refno && ordered.find((row) => clean(row.providerTransactionId) === refno)) || ordered[0];
    return { kind: "success", transaction: chosen, additional: ordered.filter((row) => row !== chosen) };
  }
  if (successful.length > 0) return { kind: "invalid_success" };
  if (relevant.some((row) => row.providerStatus === "unsuccessful")) return { kind: "failed" };
  if (relevant.some((row) => row.providerStatus === "pending")) return { kind: "no_action", reason: "pending" };
  return { kind: "no_action", reason: "unknown" };
}
