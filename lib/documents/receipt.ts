export type ReceiptPaymentState = {
  id: string;
  payment_provider: string;
  status: string;
  amount: number;
  verified_amount: number | null;
  provider_transaction_id: string | null;
  verified_at: string | null;
  paid_at: string | null;
  created_at: string;
  payment_source: string | null;
};

export function isReceiptEligiblePayment(payment: ReceiptPaymentState): boolean {
  if (payment.payment_source === "hrdf" || payment.status !== "successful" || !payment.paid_at) return false;
  if (payment.payment_provider !== "toyyibpay") return payment.amount > 0;
  return payment.verified_amount !== null
    && payment.verified_amount > 0
    && Boolean(payment.provider_transaction_id)
    && Boolean(payment.verified_at);
}

export function receiptPaymentAmount(payment: ReceiptPaymentState): number {
  if (!isReceiptEligiblePayment(payment)) throw new Error("payment_not_receipt_eligible");
  return payment.payment_provider === "toyyibpay" ? Number(payment.verified_amount) : Number(payment.amount);
}

export function assertReceiptPaymentHistory(payments: ReceiptPaymentState[], current: ReceiptPaymentState): void {
  const malformed = payments.some((payment) => {
    if (payment.payment_provider !== "toyyibpay" || payment.status !== "successful") return false;
    const inHistoricalWindow = !payment.paid_at || compareReceiptPaymentOrder(payment, current) <= 0;
    return inHistoricalWindow
      && (!payment.verified_amount || payment.verified_amount <= 0 || !payment.provider_transaction_id || !payment.verified_at);
  });
  if (malformed) throw new Error("receipt_payment_history_invalid");
}

export function compareReceiptPaymentOrder(left: ReceiptPaymentState, right: ReceiptPaymentState): number {
  const paid = String(left.paid_at).localeCompare(String(right.paid_at));
  if (paid !== 0) return paid;
  const created = left.created_at.localeCompare(right.created_at);
  if (created !== 0) return created;
  return left.id.localeCompare(right.id);
}

export function amountPaidThroughPayment(payments: ReceiptPaymentState[], paymentId: string): number {
  const current = payments.find((payment) => payment.id === paymentId);
  if (!current || !isReceiptEligiblePayment(current)) throw new Error("payment_not_receipt_eligible");
  assertReceiptPaymentHistory(payments, current);
  return payments
    .filter((payment) => isReceiptEligiblePayment(payment) && compareReceiptPaymentOrder(payment, current) <= 0)
    .reduce((total, payment) => total + receiptPaymentAmount(payment), 0);
}

export function assertReceiptCurrency(paymentCurrency: string, invoiceCurrency: string): void {
  if (paymentCurrency !== invoiceCurrency) throw new Error("receipt_currency_mismatch");
}
