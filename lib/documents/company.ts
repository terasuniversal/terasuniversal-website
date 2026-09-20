export const COMPANY_DOCUMENT_CONFIG = {
  legalName: "TERAS UNIVERSAL SDN. BHD.",
  registrationNumber: "201201003207 (976732-P)",
  registrationSource: "D:/CLOUD/COMPANY/SSM TERBARU.pdf",
  officeAddress: "Lot 1961, Kampung Tanah Merah, Tanah Merah Dalam, 06000 Jitra, Kedah.",
  paymentInstructionsFallback: "Please contact TERAS UNIVERSAL SDN. BHD. for official bank transfer details. Quote the invoice number as the payment reference.",
  invoicePaymentQr: {
    assetPath: "/documents/payment/teras-universal-duitnow-qr-code.png",
    qrLabel: "DuitNow QR",
    bankLabel: "Maybank · MAE by Maybank2u",
    accountHolder: "TERAS UNIVERSAL SDN. BHD.",
  },
} as const;

export function quotationValidityText(validUntil: string | null | undefined, formatDate: (value: string) => string): string {
  return validUntil ? `This quotation is valid until ${formatDate(validUntil)}.` : "This quotation has no expiry date.";
}

export function quotationTermsText(terms: string | null | undefined, validUntil: string | null | undefined, formatDate: (value: string) => string): string {
  return [quotationValidityText(validUntil, formatDate), terms?.trim()].filter(Boolean).join("\n\n");
}

export function invoicePaymentTerms(dueDate: string | null | undefined, formatDate: (value: string) => string): string {
  return dueDate ? `Payment is due by ${formatDate(dueDate)}. Please quote the invoice number as the payment reference.` : "Please quote the invoice number as the payment reference.";
}

export function paymentInstructions(invoiceNumber: string): string {
  return `${COMPANY_DOCUMENT_CONFIG.paymentInstructionsFallback} Invoice: ${invoiceNumber}.`;
}

export function invoicePaymentQrInstructions(invoiceNumber: string): string {
  return `Scan the DuitNow QR to pay via ${COMPANY_DOCUMENT_CONFIG.invoicePaymentQr.bankLabel}. Use ${invoiceNumber} as the payment reference.`;
}
