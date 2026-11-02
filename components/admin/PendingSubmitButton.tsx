"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button that disables itself while its parent form's server action is
 * running, so a double-click cannot send the same request twice. It is a UX
 * guard only: duplicates are still refused by the database.
 */
export default function PendingSubmitButton({
  children,
  pendingLabel,
  className,
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={disabled || pending} aria-busy={pending}>
      {pending ? pendingLabel ?? children : children}
    </button>
  );
}
