import { StatusDot } from "@/components/StatusDot";

type LedgerStatus = "Pending" | "Bonded" | "Unbonding" | "Released" | "Cancelled";

const stages: LedgerStatus[] = ["Pending", "Bonded", "Unbonding", "Released"];

export function StatusTimeline({ status }: { status: LedgerStatus }) {
  const current = status === "Cancelled" ? 0 : stages.indexOf(status);

  return (
    <div className="flex items-center gap-1">
      {stages.map((stage, index) => {
        const active = index === current;
        const done = index < current || status === "Released";
        return (
          <div key={stage} className="flex items-center gap-1">
            <span title={stage} className="grid h-5 w-5 place-items-center">
              <StatusDot status={active ? "active" : done ? "done" : "pending"} />
            </span>
            {index < stages.length - 1 && (
              <span className={`h-px w-6 ${done ? "bg-neon" : "bg-ink-700"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
