type DotStatus = "pending" | "running" | "done" | "error" | "active";
type StatusDotProps = { status: DotStatus; size?: number };
const colors: Record<DotStatus, string> = {
  pending: "bg-ink-500",
  running: "bg-neon",
  done: "bg-success",
  error: "bg-danger",
  active: "bg-neon",
};

export function StatusDot({ status, size = 6 }: StatusDotProps) {
  const pulse = status === "pending" || status === "running" ? "animate-pulse" : "";
  return (
    <span
      className={`inline-block rounded-full ${colors[status]} ${pulse}`}
      style={{ width: size, height: size }}
    />
  );
}
