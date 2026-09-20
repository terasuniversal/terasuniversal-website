import Image from "next/image";
import { COMPANY_DOCUMENT_CONFIG } from "../../../lib/documents/company";

type DocumentType = "QUOTATION" | "INVOICE" | "RECEIPT";

type DocumentHeaderProps = {
  type: DocumentType;
  identity: Array<{ label: string; value: string }>;
};

export function DocumentHeader({ type, identity }: DocumentHeaderProps) {
  return (
    <header className="teras-document-header">
      <div className="teras-document-brand">
        <Image className="teras-document-logo" src="/teras-universal-logo-official.svg" alt="TERAS Universal" width={1184} height={847} />
        <div className="teras-document-company">{COMPANY_DOCUMENT_CONFIG.legalName}</div>
        <div className="teras-document-registration">Company Registration No. {COMPANY_DOCUMENT_CONFIG.registrationNumber}</div>
        <div className="teras-document-address">{COMPANY_DOCUMENT_CONFIG.officeAddress}</div>
      </div>
      <div className="teras-document-identity">
        <div className="teras-document-title">{type}</div>
        <div className="teras-document-meta">
          {identity.map((row) => <div className="teras-document-meta-row" key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}
        </div>
      </div>
    </header>
  );
}

export function DocumentFooter({ documentNumber, customerName, pageNumber, pageCount }: { documentNumber: string; customerName?: string | null; pageNumber: number; pageCount: number }) {
  return <footer className="teras-document-running-footer">
    <span>{COMPANY_DOCUMENT_CONFIG.legalName} · {documentNumber}{customerName ? ` · ${customerName}` : ""}</span>
    <span>Page {pageNumber} of {pageCount}</span>
  </footer>;
}
