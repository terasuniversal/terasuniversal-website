"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

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
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const getFocusable = () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[role="dialog"] button:not([disabled]), [role="dialog"] [href], [role="dialog"] input:not([disabled]), [role="dialog"] select:not([disabled]), [role="dialog"] textarea:not([disabled]), [role="dialog"] [tabindex]:not([tabindex="-1"])',
        ),
      );

    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="ta-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="ta-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ta-modal-head">
          <h2 id={titleId}>{title}</h2>
          <button ref={closeButtonRef} type="button" className="ta-btn ta-btn-outline ta-btn-sm" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="ta-modal-body">{children}</div>
        {footer && <div className="ta-modal-foot">{footer}</div>}
      </section>
    </div>
  );
}
