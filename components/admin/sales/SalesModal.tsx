"use client";

import type { ReactNode } from "react";

export function SalesModal({
  open,
  title,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="ta-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="ta-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="marketing-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ta-modal-head">
          <h2 id="marketing-modal-title">{title}</h2>
          <button type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ta-modal-body">{children}</div>
        {footer && <div className="ta-modal-foot">{footer}</div>}
      </section>
    </div>
  );
}
