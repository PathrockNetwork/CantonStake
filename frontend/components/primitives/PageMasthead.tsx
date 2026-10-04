"use client";

import { networkMode } from "@/lib/network";
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
