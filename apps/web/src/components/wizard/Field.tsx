import type { ReactNode } from "react";
import { Missing } from "./Missing";

/**
 * Labelled form field of the wizard. `missing` marks what extraction did not find; `error` is shown under the field
 * after the owner pressed «Дальше», and `id` lets the wizard scroll to the first such field.
 */
export function Field({
  id,
  label,
  help,
  missing,
  optional,
  error,
  children,
}: {
  id?: string;
  label: ReactNode;
  help?: ReactNode;
  missing?: boolean;
  optional?: boolean;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={error ? "field field-invalid" : "field"} id={id ? `field-${id}` : undefined}>
      <div className="field-label">
        {label}
        <Missing show={(missing ?? false) && !error} optional={optional ?? false} />
      </div>
      {children}
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : help ? (
        <div className="field-help">{help}</div>
      ) : null}
    </div>
  );
}
