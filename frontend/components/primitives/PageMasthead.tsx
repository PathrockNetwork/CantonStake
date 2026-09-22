"use client";

import { networkMode } from "@/lib/network";
import { tokens } from "@/lib/tokens";
import { useProtocolStatus } from "@/lib/use-protocol-status";

type PageMastheadProps = {
  index: string;
  section: string;
  title: string;
  accent: string;
  description: string;
  note?: string;
};

/** Reference-board masthead shared by the six product screens. */
export function PageMasthead({
  index,
  section,
  title,
  accent,
  description,
  note = "Self-custodial. Native yield. Multi-party consent. A more open financial future.",
}: PageMastheadProps) {
  const protocol = useProtocolStatus();
  return (
    <section className="page-masthead">
      <div className="page-masthead__copy">
        <div className="page-masthead__eyebrow mono">
          <span aria-hidden="true" />
          {index} · {section}
        </div>
        <h1 className="page-masthead__title display">
          {title}
          <em>{accent}</em>
        </h1>
        <p>{description}</p>
      </div>

      <aside className="page-masthead__aside">
        <div className="page-masthead__manifesto mono">
          <span aria-hidden="true">{"{"}</span>
          <p>{note}</p>
          <span aria-hidden="true">{"}"}</span>
        </div>
        <div
          className={`page-masthead__live mono page-masthead__live--${networkMode}`}
        >
          <i aria-hidden="true" />
          {protocol.label.toUpperCase()} · {networkMode.toUpperCase()}
        </div>
      </aside>
    </section>
  );
}

export function ReferenceMetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="reference-metric-grid">{children}</div>;
}

export function ReferenceMetric({
  label,
  value,
  detail,
  accent = tokens.neon,
}: {
  label: string;
  value: React.ReactNode;
  detail: React.ReactNode;
  accent?: string;
}) {
  return (
    <div className="reference-metric">
      <div className="reference-metric__mark" style={{ color: accent }} aria-hidden="true">
        ◇
      </div>
      <div>
        <div className="reference-metric__label mono">{label}</div>
        <div className="reference-metric__value tabular" style={{ color: accent }}>
          {value}
        </div>
        <div className="reference-metric__detail mono">{detail}</div>
      </div>
      <div className="reference-metric__spark" style={{ color: accent }} aria-hidden="true">
        <i /><i /><i /><i />
      </div>
    </div>
  );
}
