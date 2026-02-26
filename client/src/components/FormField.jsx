export default function FormField({ label, error, required = false, ...props }) {
  return (
    <label className={`field ${error ? "field-error" : ""}`}>
      <span>
        {label}
        {required && <span style={{ color: "#e34b4b" }}>*</span>}
      </span>
      <input {...props} aria-invalid={!!error} />
      {error && <small className="error-msg">{error}</small>}
    </label>
  );
}
