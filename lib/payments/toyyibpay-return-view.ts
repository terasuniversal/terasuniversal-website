/**
 * ToyyibPay public invoice return page content (R2 PAY-02 made the page display-only; R4 Wave 1 R4-2 made it generic;
 * Public-First G-2 fixed the wording so the page never implies a payment was made, succeeded or failed).
 *
 * The return URL carries only an attempt UUID, which is a bearer value stored at ToyyibPay and in the payer's browser
 * history -- knowing it does not prove the visitor owns the payment. So the page shows ONE fixed message for every
 * visitor and every query string (valid, invalid, missing, unknown or someone else's attempt id, forged status_id):
 * no invoice number, no amount, no payment status, no provider reference, and no database lookup at all, so neither
 * the content nor the response time can reveal whether an attempt exists. Payment truth is established only by the
 * hash-verified callback and the authorised admin refresh; staff see the outcome in the admin area.
 *
 * Standalone by design: this module and app/payments/toyyibpay/return/page.tsx import nothing else, so the page can be
 * released on its own without any other ToyyibPay R2/R4 module.
 */
export interface GenericReturnView {
  label: string;
  heading: string;
  message: string;
  followUp: string;
}

export const GENERIC_RETURN_VIEW: GenericReturnView = Object.freeze({
  label: "Payment Service Return",
  heading: "You have returned from the payment service",
  message:
    "Your payment status cannot be confirmed on this page. If you have already made a payment, please contact TERAS for assistance. Do not assume that returning to this page confirms payment.",
  followUp: "TERAS will confirm any payment separately after verifying it.",
});
