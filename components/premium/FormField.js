import inner from "./inner.module.css";

// One labelled form control for the public Contact and Request Proposal forms. It owns the label, the
// required/optional marker, the hint and the error text, and wires them to the control with aria-describedby.
// `children` is a function that receives the props to spread on the control, so the control stays a plain
// <input>, <select> or <textarea> and the form keeps its own state.
export default function FormField({ id, label, required = false, optional = false, hint, error, wide = false, children }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const controlProps = { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, "aria-required": required ? true : undefined };
  return (
    <div className={`${inner.field} ${wide ? inner.fieldWide : ""} ${error ? inner.fieldInvalid : ""}`}>
      <label htmlFor={id}>
        {label}
        {required && <span className={inner.fieldMark}> (required)</span>}
        {optional && <span className={inner.fieldMark}> (optional)</span>}
      </label>
      {hint && <p id={hintId} className={inner.fieldHint}>{hint}</p>}
      {children(controlProps)}
      {error && <p id={errorId} className={inner.fieldError}><span className={inner.fieldErrorTag}>Error:</span> {error}</p>}
    </div>
  );
}
