import type { ReactNode } from "react";

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-6">
      {children}
    </div>
  );
}
