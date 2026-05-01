import { Card } from "@/components/Card";

type StatCellProps = {
  caption: string;
  value: string;
  subtitle: string;
  accent?: "default" | "neon" | "cc" | "amber";
  padding?: number;
};

const accentClass: Record<NonNullable<StatCellProps["accent"]>, string> = {
  default: "text-ink-100",
  neon: "text-neon",
  cc: "text-cc",
  amber: "text-amber-bright",
};

export function StatCell({
  caption,
  value,
  subtitle,
  accent = "default",
  padding = 20,
}: StatCellProps) {
  return (
    <Card padding={padding} className="space-y-3">
      <div className="font-mono text-xxs uppercase tracking-widest text-ink-400">
        {caption}
      </div>
      <div className={`font-display text-4xl tabular ${accentClass[accent]}`}>
        {value}
      </div>
      <div className="font-mono text-xs text-ink-400">{subtitle}</div>
    </Card>
  );
}
