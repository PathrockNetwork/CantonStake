type TraceStatus = "pending" | "running" | "done" | "error";

type TraceRowProps = {
  index: string;
  label: string;
  status: TraceStatus;
  detail: string;
  accent?: boolean;
};

export function TraceRow({ index, label, status, detail, accent = false }: TraceRowProps) {
  const dot = {
    pending: "text-ink-500",
    running: "text-neon animate-pulse",
    done: "text-success",
    error: "text-danger",
  }[status];

  return (
    <div className="flex items-start gap-4">
      <span className="pt-1 font-mono text-xxs text-ink-400">{index}</span>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className={`chip chip-dot ${dot} border-transparent px-0`} />
          <span className={`text-sm ${accent ? "font-medium text-neon" : "text-ink-100"}`}>
            {label}
          </span>
        </div>
        <div className="ml-3 mt-1 break-all font-mono text-xxs text-ink-400">
          {detail}
        </div>
      </div>
    </div>
  );
}
