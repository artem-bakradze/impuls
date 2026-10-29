import type { ReactNode } from "react";
import { Missing } from "./Missing";

/** Labelled form field of the wizard; `missing` marks what extraction did not find. */
export function Field({ label, help, missing, children }: { label: ReactNode; help?: ReactNode; missing?: boolean; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">
        {label}
        <Missing show={missing ?? false} />
      </div>
      {children}
      {help ? <div className="field-help">{help}</div> : null}
    </div>
  );
}
