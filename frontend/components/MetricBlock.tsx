type MetricBlockProps = {
  label: string;
  value: string;
  accent?: boolean;
};

export function MetricBlock({ label, value, accent = false }: MetricBlockProps) {
  return (
    <div>
      <div className="font-mono text-xxs uppercase tracking-widest text-ink-400 mb-1">
        {label}
      </div>
      <div
        className={`font-display text-3xl tabular ${
          accent ? "text-amber-bright" : "text-ink-300"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
