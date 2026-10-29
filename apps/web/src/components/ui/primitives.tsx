import type { CSSProperties, ReactNode } from "react";

/** Small building blocks of the design system (globals.css). */
export function Surface({ children, className = "", style, ...rest }: { children: ReactNode; className?: string; style?: CSSProperties; id?: string; "data-testid"?: string }) {
  return (
    <section className={`surface ${className}`} style={style} {...rest}>
      {children}
    </section>
  );
}

export function SurfaceHead({ title, extra, icon }: { title: ReactNode; extra?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="surface-head">
      <div className="row" style={{ gap: 10 }}>
        {icon ? <span className="icon-tile accent">{icon}</span> : null}
        <h2 className="t-h3">{title}</h2>
      </div>
      {extra}
    </div>
  );
}

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export function Chip({ tone = "neutral", children, plain = false }: { tone?: Tone; children: ReactNode; plain?: boolean }) {
  return <span className={`chip ${tone === "neutral" ? "" : `chip-${tone}`} ${plain ? "chip-plain" : ""}`}>{children}</span>;
}

export function Note({ tone = "neutral", icon, children, role, "data-testid": testId }: { tone?: Exclude<Tone, "danger">; icon?: ReactNode; children: ReactNode; role?: string; "data-testid"?: string }) {
  return (
    <div className={`note ${tone === "neutral" ? "" : `note-${tone}`}`} role={role} data-testid={testId}>
      {icon ? <span className="note-icon">{icon}</span> : null}
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: ReactNode; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="icon-tile">{icon}</span>
      <div className="t-h3" style={{ color: "var(--text)" }}>
        {title}
      </div>
      {children ? <div className="t-small" style={{ maxWidth: 380 }}>{children}</div> : null}
    </div>
  );
}

export function PageHead({ title, lead, extra }: { title: ReactNode; lead?: ReactNode; extra?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="t-h1">{title}</h1>
        {lead ? <p className="t-lead">{lead}</p> : null}
      </div>
      {extra}
    </div>
  );
}
