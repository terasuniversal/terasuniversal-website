"use client";

import { createContext, useContext, useActionState, type CSSProperties, type ReactNode } from "react";

export type MutationState = { message?: string; error?: string };
export type MutationAction = (previousState: MutationState, formData: FormData) => Promise<MutationState>;

type MutationContextValue = { pending: boolean; pendingLabel: string; idleLabel: string };
const MutationContext = createContext<MutationContextValue | null>(null);

export function MutationForm({
  action,
  children,
  pendingLabel,
  idleLabel,
  className,
  style,
}: {
  action: MutationAction;
  children: ReactNode;
  pendingLabel: string;
  idleLabel: string;
  className?: string;
  style?: CSSProperties;
}) {
  const [state, formAction, pending] = useActionState<MutationState, FormData>(action, {});

  return (
    <MutationContext.Provider value={{ pending, pendingLabel, idleLabel }}>
      <form action={formAction} className={className} style={style} aria-busy={pending}>
        <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, minInlineSize: 0 }}>
          {children}
        </fieldset>
        {state.message && <div role="status" aria-live="polite" className="ta-alert ta-alert-success">{state.message}</div>}
        {state.error && <div role="alert" aria-live="assertive" className="ta-alert ta-alert-error">{state.error}</div>}
      </form>
    </MutationContext.Provider>
  );
}

export function MutationSubmitButton({
  className = "ta-btn ta-btn-primary ta-btn-sm",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const mutation = useContext(MutationContext);
  if (!mutation) throw new Error("MutationSubmitButton must be used inside MutationForm");

  return (
    <button type="submit" className={className} disabled={mutation.pending} aria-busy={mutation.pending}>
      {mutation.pending ? mutation.pendingLabel : children ?? mutation.idleLabel}
    </button>
  );
}
